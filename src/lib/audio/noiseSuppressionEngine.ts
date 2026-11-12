import type { NoiseSuppressionAudioWorkletHandle } from "@workadventure/noise-suppression/audio-worklet";
import type { DeepFilterNetAudioWorkletHandle } from "@workadventure/noise-suppression/deepfilternet";

export type NoiseSuppressionModel = "deepfilternet" | "dtln";

export const DEFAULT_NOISE_SUPPRESSION_ENABLED = true;
export const DEFAULT_NOISE_SUPPRESSION_LEVEL = 75;
export const DEFAULT_NOISE_SUPPRESSION_MODEL: NoiseSuppressionModel = "deepfilternet";
export const DEEPFILTERNET_SAMPLE_RATE = 48000;
export const DTLN_SAMPLE_RATE = 16000;

export interface NoiseSuppressionGainParameters {
	dryGain: number;
	wetGain: number;
	highPassHz: number;
	speechAttenuationDb: number;
	pauseAttenuationDb: number;
}

export interface NoiseSuppressionMeterLevels {
	/** Raw microphone input level (0 - 100) */
	inputLevel: number;
	/** Denoised output level (0 - 100) */
	outputLevel: number;
	/** Estimated noise reduction activity (0 - 100) */
	reductionAmount: number;
}

export interface NoiseSuppressionSessionOptions {
	enabled?: boolean;
	/** Noise reduction strength from 0 to 100 */
	level?: number;
	model?: NoiseSuppressionModel;
	/** Pre-denoiser or mix input gain (defaults to 1.4 to match AnyRecord mic boost) */
	inputGain?: number;
	/** Enable real-time background noise detection */
	detectBackgroundNoise?: boolean;
	onBackgroundNoiseDetected?: (detected: boolean) => void;
	onOverload?: (load: number) => void;
}

export interface NoiseSuppressionSession {
	/** Processed MediaStream ready for MediaRecorder or WebAudio mixing */
	readonly outputStream: MediaStream;
	/** Resolves to true when the WASM AudioWorklet is active, or false if using DSP fallback */
	readonly workletReady: Promise<boolean>;
	isUsingWorklet: () => boolean;
	isBackgroundNoiseDetected: () => boolean;
	getEnabled: () => boolean;
	getSuppressionLevel: () => number;
	getModel: () => NoiseSuppressionModel;
	setEnabled: (enabled: boolean) => void;
	setSuppressionLevel: (level: number) => void;
	setInputGain: (gain: number) => void;
	getLevels: () => NoiseSuppressionMeterLevels;
	dispose: () => void;
}

export function clampSuppressionLevel(level: number): number {
	if (!Number.isFinite(level)) {
		return DEFAULT_NOISE_SUPPRESSION_LEVEL;
	}
	return Math.max(0, Math.min(100, Math.round(level)));
}

export function computeDryWetGains(
	enabled: boolean,
	level: number,
): NoiseSuppressionGainParameters {
	const clamped = clampSuppressionLevel(level);
	if (!enabled || clamped <= 0) {
		return {
			dryGain: 1,
			wetGain: 0,
			highPassHz: 20,
			speechAttenuationDb: 12,
			pauseAttenuationDb: 12,
		};
	}

	const ratio = clamped / 100;
	return {
		dryGain: Number((1 - ratio).toFixed(4)),
		wetGain: Number(ratio.toFixed(4)),
		highPassHz: Math.round(45 + ratio * 65),
		speechAttenuationDb: Math.round(12 + ratio * 33),
		pauseAttenuationDb: Math.round(20 + ratio * 45),
	};
}

export function computeWorkletLatencySeconds(
	model: NoiseSuppressionModel,
	pauseGateEnabled = true,
): number {
	if (model === "dtln") {
		return 0.032;
	}
	// DeepFilterNet3: 30ms model window + 10.7ms reframing + 30ms (3 frames) pause gate lookahead
	return pauseGateEnabled ? 0.0707 : 0.0407;
}

export function computeAnalyserRmsLevel(dataArray: Uint8Array): number {
	if (dataArray.length === 0) {
		return 0;
	}
	let sum = 0;
	for (let i = 0; i < dataArray.length; i += 1) {
		const sample = dataArray[i] ?? 0;
		sum += sample * sample;
	}
	const rms = Math.sqrt(sum / dataArray.length);
	return Math.min(100, Math.round((rms / 255) * 100 * 2.1));
}

/**
 * Creates a real-time microphone/webcam audio noise suppression session powered by
 * `@workadventure/noise-suppression` (DeepFilterNet3 48kHz / DTLN 16kHz AudioWorklet)
 * with continuous 0-100% wet/dry attenuation control and live metering.
 */
export async function createNoiseSuppressionSession(
	rawStream: MediaStream,
	options: NoiseSuppressionSessionOptions = {},
): Promise<NoiseSuppressionSession> {
	let currentEnabled = options.enabled ?? DEFAULT_NOISE_SUPPRESSION_ENABLED;
	let currentLevel = clampSuppressionLevel(options.level ?? DEFAULT_NOISE_SUPPRESSION_LEVEL);
	const model: NoiseSuppressionModel = options.model ?? DEFAULT_NOISE_SUPPRESSION_MODEL;
	const targetSampleRate =
		model === "dtln" ? DTLN_SAMPLE_RATE : DEEPFILTERNET_SAMPLE_RATE;

	const context = new AudioContext({
		sampleRate: targetSampleRate,
		latencyHint: "interactive",
	});
	if (context.state === "suspended") {
		await context.resume().catch(() => undefined);
	}

	const sourceNode = context.createMediaStreamSource(rawStream);
	const inputGainNode = context.createGain();
	inputGainNode.gain.value = Number.isFinite(options.inputGain)
		? Math.max(0, options.inputGain as number)
		: 1.4;

	const inputAnalyser = context.createAnalyser();
	inputAnalyser.fftSize = 256;
	inputAnalyser.smoothingTimeConstant = 0.78;

	const outputAnalyser = context.createAnalyser();
	outputAnalyser.fftSize = 256;
	outputAnalyser.smoothingTimeConstant = 0.78;

	const initialParams = computeDryWetGains(currentEnabled, currentLevel);

	// Dry path (latency-compensated so dry/wet blending has zero comb-filtering)
	const dryDelayNode = context.createDelay(0.25);
	dryDelayNode.delayTime.value = 0;
	const dryGainNode = context.createGain();
	dryGainNode.gain.value = initialParams.dryGain;

	// Wet post-filter path (removes low-frequency mic rumble / plosives alongside AI denoiser)
	const highPassFilter = context.createBiquadFilter();
	highPassFilter.type = "highpass";
	highPassFilter.frequency.value = initialParams.highPassHz;
	highPassFilter.Q.value = 0.707;

	// Fallback voice presence filter (used before WASM finishes loading or if worklet is unavailable)
	const fallbackLowPass = context.createBiquadFilter();
	fallbackLowPass.type = "lowpass";
	fallbackLowPass.frequency.value = 7800;
	fallbackLowPass.Q.value = 0.707;

	const wetGainNode = context.createGain();
	wetGainNode.gain.value = initialParams.wetGain;

	const mixGainNode = context.createGain();
	mixGainNode.gain.value = 1;

	const destinationNode = context.createMediaStreamDestination();

	// Connect initial graph (using fallback filter on wet branch until worklet is ready)
	sourceNode.connect(inputGainNode);
	inputGainNode.connect(inputAnalyser);

	// Dry branch
	inputGainNode.connect(dryDelayNode);
	dryDelayNode.connect(dryGainNode);
	dryGainNode.connect(mixGainNode);

	// Initial wet branch (fallback filter)
	inputGainNode.connect(highPassFilter);
	highPassFilter.connect(fallbackLowPass);
	fallbackLowPass.connect(wetGainNode);
	wetGainNode.connect(mixGainNode);

	// Master output
	mixGainNode.connect(outputAnalyser);
	mixGainNode.connect(destinationNode);

	let disposed = false;
	let usingWorklet = false;
	let backgroundNoiseDetected = false;
	let backgroundNoisePollTimer: ReturnType<typeof setInterval> | null = null;
	let backgroundNoiseResetTimer: ReturnType<typeof setTimeout> | null = null;
	let deepFilterHandle: DeepFilterNetAudioWorkletHandle | null = null;
	let dtlnHandle: NoiseSuppressionAudioWorkletHandle | null = null;

	const inputBins = new Uint8Array(inputAnalyser.frequencyBinCount);
	const outputBins = new Uint8Array(outputAnalyser.frequencyBinCount);

	const applyParameters = () => {
		if (disposed) return;
		const params = computeDryWetGains(currentEnabled, currentLevel);
		const now = context.currentTime;
		dryGainNode.gain.setTargetAtTime(params.dryGain, now, 0.015);
		wetGainNode.gain.setTargetAtTime(params.wetGain, now, 0.015);
		highPassFilter.frequency.setTargetAtTime(params.highPassHz, now, 0.015);
	};

	const workletReady = (async (): Promise<boolean> => {
		try {
			if (model === "dtln") {
				const { createNoiseSuppressionAudioWorklet } = await import(
					"@workadventure/noise-suppression/audio-worklet"
				);
				if (disposed) return false;
				const handle = await createNoiseSuppressionAudioWorklet(context, {
					bypassUntilReady: true,
				});
				if (disposed) {
					handle.dispose();
					return false;
				}
				dtlnHandle = handle;
				await handle.ready;
				if (disposed) {
					handle.dispose();
					return false;
				}
				// Rewire wet branch through the DTLN AudioWorkletNode
				try {
					highPassFilter.disconnect(fallbackLowPass);
					fallbackLowPass.disconnect(wetGainNode);
				} catch {
					// ignore
				}
				highPassFilter.connect(handle.node);
				handle.node.connect(wetGainNode);
				dryDelayNode.delayTime.setValueAtTime(
					computeWorkletLatencySeconds("dtln", false),
					context.currentTime,
				);
				usingWorklet = true;
				return true;
			}

			// Default: DeepFilterNet3 (48 kHz)
			const { createDeepFilterNetAudioWorklet } = await import(
				"@workadventure/noise-suppression/deepfilternet"
			);
			if (disposed) return false;
			const initialAttenuation = computeDryWetGains(true, Math.max(50, currentLevel));
			const handle = await createDeepFilterNetAudioWorklet(context, {
				speechAttenuationDb: initialAttenuation.speechAttenuationDb,
				pauseAttenuationDb: initialAttenuation.pauseAttenuationDb,
				minSpeechFrames: 2,
				pauseGateLookaheadFrames: 3,
				bypassUntilReady: true,
				postGain: true,
				onOverload: (load) => {
					console.warn(
						`[NoiseSuppression] DeepFilterNet3 high CPU load (${Math.round(load * 100)}%)`,
					);
					options.onOverload?.(load);
				},
			});
			if (disposed) {
				handle.dispose();
				return false;
			}
			deepFilterHandle = handle;
			await handle.ready;
			if (disposed) {
				handle.dispose();
				return false;
			}
			// Rewire wet branch through DeepFilterNet3 AudioWorkletNode
			try {
				highPassFilter.disconnect(fallbackLowPass);
				fallbackLowPass.disconnect(wetGainNode);
			} catch {
				// ignore
			}
			highPassFilter.connect(handle.node);
			handle.node.connect(wetGainNode);
			dryDelayNode.delayTime.setValueAtTime(
				computeWorkletLatencySeconds(
					"deepfilternet",
					initialAttenuation.pauseAttenuationDb > initialAttenuation.speechAttenuationDb,
				),
				context.currentTime,
			);
			usingWorklet = true;
			return true;
		} catch (error) {
			console.warn(
				"[NoiseSuppression] Worklet initialization failed; using WebAudio filter fallback:",
				error,
			);
			usingWorklet = false;
			return false;
		}
	})();

	if (options.detectBackgroundNoise) {
		let noisyFrames = 0;
		backgroundNoisePollTimer = setInterval(() => {
			if (disposed) return;
			inputAnalyser.getByteFrequencyData(inputBins);
			outputAnalyser.getByteFrequencyData(outputBins);
			const inputLevel = computeAnalyserRmsLevel(inputBins);
			const outputLevel = computeAnalyserRmsLevel(outputBins);
			const nonSpeechNoiseFloor =
				inputLevel >= 12 &&
				((currentEnabled && inputLevel - outputLevel >= 8) ||
					(!currentEnabled && inputLevel >= 18 && inputLevel <= 45));
			if (nonSpeechNoiseFloor) {
				noisyFrames += 1;
				if (noisyFrames >= 4 && !backgroundNoiseDetected) {
					backgroundNoiseDetected = true;
					options.onBackgroundNoiseDetected?.(true);
					if (backgroundNoiseResetTimer) {
						clearTimeout(backgroundNoiseResetTimer);
					}
					backgroundNoiseResetTimer = setTimeout(() => {
						backgroundNoiseDetected = false;
						options.onBackgroundNoiseDetected?.(false);
					}, 3500);
				}
			} else {
				noisyFrames = Math.max(0, noisyFrames - 1);
			}
		}, 250);
	}

	return {
		outputStream: destinationNode.stream,
		workletReady,
		isUsingWorklet: () => usingWorklet,
		isBackgroundNoiseDetected: () => backgroundNoiseDetected,
		getEnabled: () => currentEnabled,
		getSuppressionLevel: () => currentLevel,
		getModel: () => model,
		setEnabled: (nextEnabled: boolean) => {
			currentEnabled = Boolean(nextEnabled);
			applyParameters();
		},
		setSuppressionLevel: (nextLevel: number) => {
			currentLevel = clampSuppressionLevel(nextLevel);
			applyParameters();
		},
		setInputGain: (nextGain: number) => {
			if (!disposed && Number.isFinite(nextGain)) {
				inputGainNode.gain.setTargetAtTime(
					Math.max(0, Math.min(4, nextGain)),
					context.currentTime,
					0.015,
				);
			}
		},
		getLevels: (): NoiseSuppressionMeterLevels => {
			if (disposed) {
				return { inputLevel: 0, outputLevel: 0, reductionAmount: 0 };
			}
			inputAnalyser.getByteFrequencyData(inputBins);
			outputAnalyser.getByteFrequencyData(outputBins);
			const inputLevel = computeAnalyserRmsLevel(inputBins);
			const outputLevel = computeAnalyserRmsLevel(outputBins);
			const reductionAmount = currentEnabled
				? Math.max(0, Math.min(100, inputLevel - outputLevel))
				: 0;
			return { inputLevel, outputLevel, reductionAmount };
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			if (backgroundNoisePollTimer) {
				clearInterval(backgroundNoisePollTimer);
				backgroundNoisePollTimer = null;
			}
			if (backgroundNoiseResetTimer) {
				clearTimeout(backgroundNoiseResetTimer);
				backgroundNoiseResetTimer = null;
			}
			try {
				deepFilterHandle?.dispose();
			} catch {
				// ignore
			}
			try {
				dtlnHandle?.dispose();
			} catch {
				// ignore
			}
			try {
				sourceNode.disconnect();
				inputGainNode.disconnect();
				dryDelayNode.disconnect();
				dryGainNode.disconnect();
				highPassFilter.disconnect();
				fallbackLowPass.disconnect();
				wetGainNode.disconnect();
				mixGainNode.disconnect();
				destinationNode.disconnect();
			} catch {
				// ignore
			}
			void context.close().catch(() => undefined);
		},
	};
}
