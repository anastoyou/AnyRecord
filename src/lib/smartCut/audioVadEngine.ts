import type { CaptionCue } from "@/components/video-editor/types";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { SMART_CUT_BIN_MS } from "./smartCutTypes";

const MIN_RMS_AMPLITUDE = 1e-5; // -100 dBFS floor
const CAPTION_TAIL_CUSHION_MS = 300;

export interface AudioVadBinsResult {
	rmsDb: Float32Array;
	zcr: Float32Array;
	noiseFloorDb: number;
	hasSignal: boolean;
}

/**
 * Marks bins that overlap any transcribed speech cue (plus a 300ms tail cushion).
 */
export function buildCaptionSpeechMask(
	cues: CaptionCue[],
	binCount: number,
	binMs: number = SMART_CUT_BIN_MS,
	tailCushionMs: number = CAPTION_TAIL_CUSHION_MS,
): Uint8Array {
	const mask = new Uint8Array(binCount);
	if (!cues || cues.length === 0 || binCount <= 0) {
		return mask;
	}

	for (const cue of cues) {
		if (!cue.text || !cue.text.trim()) continue;
		const startBin = Math.max(0, Math.floor(cue.startMs / binMs));
		const endBin = Math.min(binCount - 1, Math.ceil((cue.endMs + tailCushionMs) / binMs));
		for (let i = startBin; i <= endBin; i++) {
			mask[i] = 1;
		}
	}

	return mask;
}

/**
 * Pure analyzer that computes RMS energy (in dBFS), Zero-Crossing Rate (ZCR),
 * and adaptive 10th-percentile noise floor from decoded PCM channel arrays.
 */
export function analyzeAudioChannelBins(
	channels: Float32Array[],
	sampleRate: number,
	binCount: number,
	binMs: number = SMART_CUT_BIN_MS,
): AudioVadBinsResult {
	const rmsDb = new Float32Array(binCount).fill(-100);
	const zcr = new Float32Array(binCount);

	if (channels.length === 0 || sampleRate <= 0 || binCount <= 0) {
		return { rmsDb, zcr, noiseFloorDb: -70, hasSignal: false };
	}

	const samplesPerBin = Math.max(1, Math.floor((sampleRate * binMs) / 1000));
	const channelCount = channels.length;
	const totalSamples = channels[0]?.length ?? 0;

	if (totalSamples === 0) {
		return { rmsDb, zcr, noiseFloorDb: -70, hasSignal: false };
	}

	let activeBins = 0;
	const nonSilentDbValues: number[] = [];

	for (let bin = 0; bin < binCount; bin++) {
		const sampleStart = bin * samplesPerBin;
		if (sampleStart >= totalSamples) break;
		const sampleEnd = Math.min(totalSamples, sampleStart + samplesPerBin);
		const count = sampleEnd - sampleStart;
		if (count <= 0) continue;

		let sumSquares = 0;
		let zeroCrossings = 0;
		const firstChannel = channels[0];

		for (let ch = 0; ch < channelCount; ch++) {
			const data = channels[ch];
			for (let i = sampleStart; i < sampleEnd; i++) {
				const sample = data[i] ?? 0;
				sumSquares += sample * sample;
			}
		}

		for (let i = sampleStart + 1; i < sampleEnd; i++) {
			const prev = firstChannel[i - 1] ?? 0;
			const curr = firstChannel[i] ?? 0;
			if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
				zeroCrossings++;
			}
		}

		const meanSquare = sumSquares / (count * channelCount);
		const rms = Math.sqrt(meanSquare);
		const db = 20 * Math.log10(Math.max(rms, MIN_RMS_AMPLITUDE));

		rmsDb[bin] = db;
		zcr[bin] = zeroCrossings / count;

		if (db > -85) {
			activeBins++;
			nonSilentDbValues.push(db);
		}
	}

	if (activeBins === 0 || nonSilentDbValues.length === 0) {
		return { rmsDb, zcr, noiseFloorDb: -70, hasSignal: false };
	}

	nonSilentDbValues.sort((a, b) => a - b);
	const p10Index = Math.floor(nonSilentDbValues.length * 0.1);
	const noiseFloorDb = Math.max(-75, Math.min(-30, nonSilentDbValues[p10Index] ?? -60));

	return {
		rmsDb,
		zcr,
		noiseFloorDb,
		hasSignal: true,
	};
}

/**
 * Decodes one or more audio/video sources and merges their VAD bin series.
 */
export async function extractAudioVadSeries(params: {
	sources: string[];
	binCount: number;
	binMs?: number;
	signal?: AbortSignal;
}): Promise<AudioVadBinsResult> {
	const { sources, binCount, binMs = SMART_CUT_BIN_MS, signal } = params;
	const combinedRmsDb = new Float32Array(binCount).fill(-100);
	const combinedZcr = new Float32Array(binCount);

	const uniqueSources = [...new Set(sources.filter(Boolean))];
	if (uniqueSources.length === 0 || typeof window === "undefined") {
		return { rmsDb: combinedRmsDb, zcr: combinedZcr, noiseFloorDb: -70, hasSignal: false };
	}

	const AudioContextCtor =
		window.AudioContext ||
		(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return { rmsDb: combinedRmsDb, zcr: combinedZcr, noiseFloorDb: -70, hasSignal: false };
	}

	let hasAnySignal = false;
	let minNoiseFloorDb = -30;
	const audioContext = new AudioContextCtor();

	try {
		for (const source of uniqueSources) {
			if (signal?.aborted) break;
			try {
				const resolvedUrl = await resolveMediaResourceUrl(source);
				const response = await fetch(resolvedUrl, { signal });
				if (!response.ok) continue;

				const buffer = await response.arrayBuffer();
				if (signal?.aborted) break;

				const decoded = await audioContext.decodeAudioData(buffer.slice(0));
				const channels: Float32Array[] = [];
				for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
					channels.push(decoded.getChannelData(ch));
				}

				const result = analyzeAudioChannelBins(channels, decoded.sampleRate, binCount, binMs);
				if (result.hasSignal) {
					hasAnySignal = true;
					minNoiseFloorDb = Math.min(minNoiseFloorDb, result.noiseFloorDb);
					for (let i = 0; i < binCount; i++) {
						if (result.rmsDb[i] > combinedRmsDb[i]) {
							combinedRmsDb[i] = result.rmsDb[i];
							combinedZcr[i] = result.zcr[i];
						}
					}
				}
			} catch {
				// Ignore individual track decode failure (e.g. video without audio stream)
			}
		}
	} finally {
		void audioContext.close().catch(() => undefined);
	}

	return {
		rmsDb: combinedRmsDb,
		zcr: combinedZcr,
		noiseFloorDb: hasAnySignal ? minNoiseFloorDb : -70,
		hasSignal: hasAnySignal,
	};
}

