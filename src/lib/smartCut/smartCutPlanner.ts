import {
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	sortClipRegions,
} from "@/components/video-editor/types";
import { buildCaptionSpeechMask, extractAudioVadSeries } from "./audioVadEngine";
import { extractVideoMotionSeries } from "./screenMotionEngine";
import {
	type RawActivitySeries,
	SMART_CUT_BIN_MS,
	type SmartCutAnalysisResult,
	type SmartCutAnalyzerInput,
	type SmartCutCandidate,
	type SmartCutOptions,
	type SmartCutSensitivity,
	type SmartCutSequencePlan,
	type SmartCutSignalCategory,
	type SmartCutSignalKey,
	type SmartCutSignalSegment,
} from "./smartCutTypes";
import { analyzeTelemetryActivityBins } from "./telemetryActivityEngine";

const ACTIVE_SCORE_THRESHOLD = 0.25;
const MIN_EFFECTIVE_CUT_MS = 300;
const MIN_SURVIVING_TIMELINE_MS = 500;

function getMouseSensitivityThreshold(sensitivity: SmartCutSensitivity): number {
	switch (sensitivity) {
		case "low":
			return 0.015;
		case "high":
			return 0.002;
		default:
			return 0.006;
	}
}

function getScreenSensitivityThreshold(sensitivity: SmartCutSensitivity): number {
	switch (sensitivity) {
		case "low":
			return 0.015;
		case "high":
			return 0.004;
		default:
			return 0.008;
	}
}

/**
 * Extracts all 5 raw signal series in 100ms bins for a recording.
 * Once extracted, `planSmartCuts` can re-evaluate any user setting change in <1ms.
 */
export async function extractRawActivitySeries(
	input: SmartCutAnalyzerInput,
): Promise<RawActivitySeries> {
	const durationMs = Math.max(0, Math.round(input.durationMs));
	const binMs = SMART_CUT_BIN_MS;
	const binCount = Math.max(1, Math.ceil(durationMs / binMs));

	input.onProgress?.(0.05, "Analyzing telemetry & captions…");

	const captionActive = buildCaptionSpeechMask(input.autoCaptions, binCount, binMs);
	const telemetryBins = analyzeTelemetryActivityBins(input.cursorTelemetry, binCount, binMs);

	const audioSources = [
		...(input.audioPaths ?? []),
		...(input.videoPath ? [input.videoPath] : []),
	];

	input.onProgress?.(0.15, "Analyzing voice & audio activity…");
	const audioPromise = extractAudioVadSeries({
		sources: audioSources,
		binCount,
		binMs,
		signal: input.signal,
	});

	const screenPromise = Promise.resolve({
		mapd: new Float32Array(binCount),
		hasSamples: false,
	});

	const webcamPromise = input.webcamPath
		? extractVideoMotionSeries({
				videoPath: input.webcamPath,
				durationMs,
				binCount,
				binMs,
				centerWeighted: true,
				signal: input.signal,
			})
		: Promise.resolve({ mapd: new Float32Array(binCount), hasSamples: false });

	const [audioVad, screenMotion, webcamMotion] = await Promise.all([
		audioPromise,
		screenPromise,
		webcamPromise,
	]);

	input.onProgress?.(1.0, "Complete");

	return {
		durationMs,
		binCount,
		binMs,
		audioRmsDb: audioVad.rmsDb,
		audioZcr: audioVad.zcr,
		audioNoiseFloorDb: audioVad.noiseFloorDb,
		hasAudioSignal: audioVad.hasSignal,
		captionActive,
		mouseDisplacement: telemetryBins.mouseDisplacement,
		mouseClickActive: telemetryBins.mouseClickActive,
		textCursorActive: telemetryBins.textCursorActive,
		keyboardActive: telemetryBins.keyboardActive,
		screenMapd: screenMotion.mapd,
		hasScreenSamples: screenMotion.hasSamples,
		webcamMapd: webcamMotion.mapd,
		hasWebcamSamples: webcamMotion.hasSamples,
	};
}

function hasSpeechInBinRange(speechMask: Uint8Array, startBin: number, endBin: number): boolean {
	const lo = Math.max(0, startBin);
	const hi = Math.min(speechMask.length - 1, endBin);
	for (let i = lo; i <= hi; i++) {
		if (speechMask[i] === 1) return true;
	}
	return false;
}

function extractRemovableCutsFromScores(params: {
	category: SmartCutSignalCategory;
	scores: Float32Array;
	protectMask: Uint8Array;
	options: SmartCutOptions;
	binMs: number;
	durationMs: number;
	effectiveClips: ClipRegion[];
	idPrefix: string;
}): SmartCutCandidate[] {
	const {
		category,
		scores,
		protectMask,
		options,
		binMs,
		durationMs,
		effectiveClips,
		idPrefix,
	} = params;
	const binCount = scores.length;
	if (binCount === 0 || durationMs <= 0) return [];

	const inactiveMask = new Uint8Array(binCount);
	for (let k = 0; k < binCount; k++) {
		inactiveMask[k] = scores[k] < ACTIVE_SCORE_THRESHOLD ? 1 : 0;
	}

	const maxBridgeBins = Math.max(0, Math.round((options.mergeGapSec * 1000) / binMs));
	if (maxBridgeBins > 0) {
		let k = 0;
		while (k < binCount) {
			if (inactiveMask[k] === 0) {
				const blipStart = k;
				while (k < binCount && inactiveMask[k] === 0) {
					k++;
				}
				const blipEnd = k - 1;
				const blipLen = blipEnd - blipStart + 1;
				const boundedByInactive =
					blipStart > 0 &&
					blipEnd < binCount - 1 &&
					inactiveMask[blipStart - 1] === 1 &&
					inactiveMask[blipEnd + 1] === 1;

				if (
					boundedByInactive &&
					blipLen <= maxBridgeBins &&
					!hasSpeechInBinRange(protectMask, blipStart, blipEnd)
				) {
					for (let b = blipStart; b <= blipEnd; b++) {
						inactiveMask[b] = 1;
					}
				}
			} else {
				k++;
			}
		}
	}

	const minInactivityMs = Math.max(500, Math.round(options.minInactivitySec * 1000));
	const prePadMs = Math.max(0, Math.round(options.prePaddingSec * 1000));
	const postPadMs = Math.max(0, Math.round(options.postPaddingSec * 1000));

	interface SourceSpan {
		startMs: number;
		endMs: number;
	}
	const paddedSpans: SourceSpan[] = [];

	let idx = 0;
	while (idx < binCount) {
		if (inactiveMask[idx] === 1) {
			const startBin = idx;
			while (idx < binCount && inactiveMask[idx] === 1) {
				idx++;
			}
			const endBin = idx;
			const rawStartMs = startBin * binMs;
			const rawEndMs = Math.min(durationMs, endBin * binMs);
			const rawLenMs = rawEndMs - rawStartMs;

			if (rawLenMs >= minInactivityMs) {
				const effectivePrePadMs = rawStartMs <= binMs ? 0 : prePadMs;
				const effectivePostPadMs = rawEndMs >= durationMs - binMs ? 0 : postPadMs;
				const cutStartMs = Math.min(durationMs, rawStartMs + effectivePrePadMs);
				const cutEndMs = Math.max(0, rawEndMs - effectivePostPadMs);

				if (cutEndMs - cutStartMs >= MIN_EFFECTIVE_CUT_MS) {
					paddedSpans.push({ startMs: cutStartMs, endMs: cutEndMs });
				}
			}
		} else {
			idx++;
		}
	}

	const minKeepMs = Math.max(0, Math.round(options.minKeepSegmentSec * 1000));
	const mergedSourceSpans: SourceSpan[] = [];
	for (const span of paddedSpans) {
		const prev = mergedSourceSpans[mergedSourceSpans.length - 1];
		if (!prev) {
			mergedSourceSpans.push({ ...span });
			continue;
		}

		const gapMs = span.startMs - prev.endMs;
		const gapStartBin = Math.floor(prev.endMs / binMs);
		const gapEndBin = Math.ceil(span.startMs / binMs);
		const gapHasSpeech = hasSpeechInBinRange(protectMask, gapStartBin, gapEndBin);

		if (gapMs < minKeepMs && !gapHasSpeech) {
			prev.endMs = span.endMs;
		} else {
			mergedSourceSpans.push({ ...span });
		}
	}

	const cuts: SmartCutCandidate[] = [];
	let cutIndex = 1;

	for (const clip of effectiveClips) {
		const clipSourceStart = getClipSourceStartMs(clip);
		const clipSourceEnd = getClipSourceEndMs(clip);
		const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;

		for (const span of mergedSourceSpans) {
			const overlapSourceStart = Math.max(span.startMs, clipSourceStart);
			const overlapSourceEnd = Math.min(span.endMs, clipSourceEnd);
			if (overlapSourceEnd <= overlapSourceStart) continue;

			const timelineStartMs = Math.round(
				clip.startMs + (overlapSourceStart - clipSourceStart) / speed,
			);
			const timelineEndMs = Math.round(
				clip.startMs + (overlapSourceEnd - clipSourceStart) / speed,
			);
			const cutDurationMs = timelineEndMs - timelineStartMs;

			if (cutDurationMs >= MIN_EFFECTIVE_CUT_MS) {
				cuts.push({
					id: `${idPrefix}-${cutIndex++}`,
					category,
					sourceStartMs: overlapSourceStart,
					sourceEndMs: overlapSourceEnd,
					timelineStartMs,
					timelineEndMs,
					durationMs: cutDurationMs,
					enabled: true,
				});
			}
		}
	}

	return cuts;
}

function extractSignalSegments(params: {
	signal: SmartCutSignalKey;
	scores: Float32Array;
	binMs: number;
	durationMs: number;
	effectiveClips: ClipRegion[];
}): SmartCutSignalSegment[] {
	const { signal, scores, binMs, durationMs, effectiveClips } = params;
	const binCount = scores.length;
	if (binCount === 0 || durationMs <= 0) return [];

	const activeMask = new Uint8Array(binCount);
	for (let i = 0; i < binCount; i++) {
		activeMask[i] = scores[i] >= ACTIVE_SCORE_THRESHOLD ? 1 : 0;
	}

	// Bridge brief 400ms micro-gaps within the same signal so phrases/bursts stay grouped
	const maxGapBins = Math.max(1, Math.round(400 / binMs));
	let k = 0;
	while (k < binCount) {
		if (activeMask[k] === 0) {
			const gapStart = k;
			while (k < binCount && activeMask[k] === 0) k++;
			const gapEnd = k - 1;
			const gapLen = gapEnd - gapStart + 1;
			if (
				gapStart > 0 &&
				gapEnd < binCount - 1 &&
				activeMask[gapStart - 1] === 1 &&
				activeMask[gapEnd + 1] === 1 &&
				gapLen <= maxGapBins
			) {
				for (let b = gapStart; b <= gapEnd; b++) {
					activeMask[b] = 1;
				}
			}
		} else {
			k++;
		}
	}

	const rawSpans: { startMs: number; endMs: number; peakScore: number }[] = [];
	let idx = 0;
	while (idx < binCount) {
		if (activeMask[idx] === 1) {
			const startBin = idx;
			let peakScore = 0;
			while (idx < binCount && activeMask[idx] === 1) {
				if (scores[idx] > peakScore) peakScore = scores[idx];
				idx++;
			}
			const startMs = startBin * binMs;
			const endMs = Math.min(durationMs, idx * binMs);
			if (endMs - startMs >= MIN_EFFECTIVE_CUT_MS) {
				rawSpans.push({ startMs, endMs, peakScore });
			}
		} else {
			idx++;
		}
	}

	const segments: SmartCutSignalSegment[] = [];
	let segIdx = 1;
	for (const clip of effectiveClips) {
		const clipSourceStart = getClipSourceStartMs(clip);
		const clipSourceEnd = getClipSourceEndMs(clip);
		const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;

		for (const span of rawSpans) {
			const overlapSourceStart = Math.max(span.startMs, clipSourceStart);
			const overlapSourceEnd = Math.min(span.endMs, clipSourceEnd);
			if (overlapSourceEnd <= overlapSourceStart) continue;

			const timelineStartMs = Math.round(
				clip.startMs + (overlapSourceStart - clipSourceStart) / speed,
			);
			const timelineEndMs = Math.round(
				clip.startMs + (overlapSourceEnd - clipSourceStart) / speed,
			);
			const segDurationMs = timelineEndMs - timelineStartMs;
			if (segDurationMs >= MIN_EFFECTIVE_CUT_MS) {
				segments.push({
					id: `${signal}-seg-${segIdx++}`,
					signal,
					sourceStartMs: overlapSourceStart,
					sourceEndMs: overlapSourceEnd,
					timelineStartMs,
					timelineEndMs,
					durationMs: segDurationMs,
					peakScore: span.peakScore,
				});
			}
		}
	}

	return segments;
}

/**
 * Synchronous, deterministic multi-signal fusion & cut planner.
 * Runs in <1ms so UI sliders update detected cuts in real time.
 */
export function planSmartCuts(params: {
	raw: RawActivitySeries;
	options: SmartCutOptions;
	clipRegions?: ClipRegion[];
}): SmartCutAnalysisResult {
	const { raw, options, clipRegions = [] } = params;
	const { binCount, binMs, durationMs } = raw;

	const activityScores = new Float32Array(binCount);
	const strictInactiveScores = new Float32Array(binCount);
	const speechMask = new Uint8Array(binCount);
	const strictSpeechMask = new Uint8Array(binCount);
	const signalScores: Record<SmartCutSignalKey, Float32Array> = {
		audio: new Float32Array(binCount),
		input: new Float32Array(binCount),
		screen: new Float32Array(binCount),
		webcam: new Float32Array(binCount),
	};

	if (durationMs <= 0 || binCount <= 0) {
		return {
			cuts: [],
			cutsByCategory: {
				inactive: [],
				timing: [],
				audio: [],
				input: [],
				screen: [],
				webcam: [],
			},
			activityScores,
			speechMask,
			signalScores,
			signalSegments: {
				audio: [],
				input: [],
				screen: [],
				webcam: [],
			},
			originalDurationMs: 0,
			estimatedDurationMs: 0,
			totalSavedMs: 0,
		};
	}

	const mouseDispThreshold = getMouseSensitivityThreshold(options.mouseSensitivity);
	const screenMapdThreshold = getScreenSensitivityThreshold(options.screenSensitivity);
	const clickProtectRadiusBins = Math.max(
		1,
		Math.round(((options.clickProtectionSec * 1000) / binMs) * 0.5),
	);

	// Precompute expanded click / text-cursor protection mask
	const clickProtectedMask = new Uint8Array(binCount);
	const strictClickProtectedMask = new Uint8Array(binCount);
	for (let i = 0; i < binCount; i++) {
		if (raw.mouseClickActive[i] === 1 || raw.textCursorActive[i] === 1) {
			const start = Math.max(0, i - clickProtectRadiusBins);
			const end = Math.min(binCount - 1, i + clickProtectRadiusBins);
			for (let k = start; k <= end; k++) {
				strictClickProtectedMask[k] = 1;
				if (options.mouseActivityEnabled) {
					clickProtectedMask[k] = 1;
				}
			}
		}
	}

	// Effective audio silence threshold relative to noise floor
	const effectiveAudioThresholdDb = Math.min(
		-12,
		Math.max(options.silenceThresholdDb, raw.audioNoiseFloorDb + 8),
	);

	// 1. Score each 100ms bin across all enabled signals
	for (let k = 0; k < binCount; k++) {
		const hasCaptionSpeech =
			options.speechProtectionEnabled &&
			options.useAutoCaptions &&
			raw.captionActive[k] === 1;
		const hasAudioEnergy =
			options.audioSilenceEnabled &&
			raw.hasAudioSignal &&
			raw.audioRmsDb[k] >= effectiveAudioThresholdDb;
		const hasNeighborAudioEnergy =
			hasAudioEnergy &&
			(binCount === 1 ||
				(k > 0 && raw.audioRmsDb[k - 1] >= effectiveAudioThresholdDb - 4) ||
				(k < binCount - 1 && raw.audioRmsDb[k + 1] >= effectiveAudioThresholdDb - 4));

		const isSustainedSpeech =
			hasCaptionSpeech || (hasAudioEnergy && hasNeighborAudioEnergy);

		speechMask[k] = isSustainedSpeech && options.speechProtectionEnabled ? 1 : 0;

		// Strict all-signals check for "Inactive" (no mic, no input, no screen activity at all)
		const rawHasAudio =
			raw.captionActive[k] === 1 ||
			(raw.hasAudioSignal && raw.audioRmsDb[k] >= effectiveAudioThresholdDb);
		const rawNeighborAudio =
			rawHasAudio &&
			(binCount === 1 ||
				(k > 0 && raw.audioRmsDb[k - 1] >= effectiveAudioThresholdDb - 4) ||
				(k < binCount - 1 && raw.audioRmsDb[k + 1] >= effectiveAudioThresholdDb - 4));
		const strictSpeech = raw.captionActive[k] === 1 || rawNeighborAudio;
		strictSpeechMask[k] = strictSpeech ? 1 : 0;

		const strictAudioScore = strictSpeech ? 1.0 : rawHasAudio ? 0.6 : 0;
		const strictKeyScore = raw.keyboardActive[k] === 1 ? 0.8 : 0;
		const strictClickScore = strictClickProtectedMask[k] === 1 ? 0.8 : 0;
		const strictMouseScore = raw.mouseDisplacement[k] >= mouseDispThreshold ? 0.6 : 0;
		strictInactiveScores[k] = Math.max(
			strictAudioScore,
			strictKeyScore,
			strictClickScore,
			strictMouseScore,
		);

		const audioScore = isSustainedSpeech
			? options.speechProtectionEnabled
				? 1.0
				: 0.9
			: hasAudioEnergy
				? 0.6
				: 0;
		const keyScore = options.keyboardActivityEnabled && raw.keyboardActive[k] === 1 ? 0.8 : 0;
		const clickScore =
			options.mouseActivityEnabled && clickProtectedMask[k] === 1 ? 0.8 : 0;
		const mouseMoveScore =
			options.mouseActivityEnabled && raw.mouseDisplacement[k] >= mouseDispThreshold
				? 0.6
				: 0;
		const screenScore =
			options.screenActivityEnabled &&
			raw.hasScreenSamples &&
			raw.screenMapd[k] >= screenMapdThreshold
				? 0.5
				: 0;
		const hasWeakPrimaryActivity =
			(options.mouseActivityEnabled &&
				raw.mouseDisplacement[k] >= mouseDispThreshold * 0.5) ||
			(options.screenActivityEnabled &&
				raw.hasScreenSamples &&
				raw.screenMapd[k] >= screenMapdThreshold * 0.5);
		const webcamActiveRaw =
			options.webcamActivityEnabled &&
			raw.hasWebcamSamples &&
			raw.webcamMapd[k] >= 0.015;
		const webcamScore =
			webcamActiveRaw && options.webcamRole === "supporting"
				? hasWeakPrimaryActivity
					? 0.4
					: 0.2
				: 0;

		// Populate individual signal series for per-signal visualization
		const subAudio =
			raw.hasAudioSignal && raw.audioRmsDb[k] > raw.audioNoiseFloorDb
				? Math.min(
						0.22,
						Math.max(
							0,
							((raw.audioRmsDb[k] - raw.audioNoiseFloorDb) /
								Math.max(6, effectiveAudioThresholdDb - raw.audioNoiseFloorDb)) *
								0.22,
						),
					)
				: 0;
		signalScores.audio[k] = Math.max(audioScore, subAudio);

		const subMouse =
			options.mouseActivityEnabled && raw.mouseDisplacement[k] > 0
				? Math.min(0.22, (raw.mouseDisplacement[k] / mouseDispThreshold) * 0.22)
				: 0;
		signalScores.input[k] = Math.max(keyScore, clickScore, mouseMoveScore, subMouse);

		const subScreen =
			options.screenActivityEnabled && raw.hasScreenSamples && raw.screenMapd[k] > 0
				? Math.min(0.22, (raw.screenMapd[k] / screenMapdThreshold) * 0.22)
				: 0;
		signalScores.screen[k] = Math.max(screenScore, subScreen);

		const webcamDisplayScore = webcamActiveRaw
			? Math.min(0.95, Math.max(0.45, raw.webcamMapd[k] * 12))
			: options.webcamActivityEnabled && raw.hasWebcamSamples && raw.webcamMapd[k] > 0
				? Math.min(0.22, (raw.webcamMapd[k] / 0.015) * 0.22)
				: 0;
		signalScores.webcam[k] = webcamDisplayScore;

		if (isSustainedSpeech && options.speechProtectionEnabled) {
			activityScores[k] = 1.0;
			continue;
		}

		activityScores[k] = Math.max(
			audioScore,
			keyScore,
			clickScore,
			mouseMoveScore,
			screenScore,
			webcamScore,
		);
	}

	const effectiveClips: ClipRegion[] =
		clipRegions.length > 0
			? sortClipRegions(clipRegions)
			: [
					{
						id: "clip-1",
						startMs: 0,
						endMs: durationMs,
						sourceStartMs: 0,
						speed: 1,
					},
				];

	const originalDurationMs = getTimelineDurationMs(effectiveClips, durationMs);
	const emptyProtectMask = new Uint8Array(binCount);

	const inactiveCuts = extractRemovableCutsFromScores({
		category: "inactive",
		scores: strictInactiveScores,
		protectMask: strictSpeechMask,
		options,
		binMs,
		durationMs,
		effectiveClips,
		idPrefix: "inactive-cut",
	});

	const cuts = extractRemovableCutsFromScores({
		category: "timing",
		scores: activityScores,
		protectMask: speechMask,
		options,
		binMs,
		durationMs,
		effectiveClips,
		idPrefix: "smart-cut",
	});

	const hasAudioSource =
		(options.speechProtectionEnabled || options.audioSilenceEnabled) &&
		(raw.hasAudioSignal ||
			(options.useAutoCaptions && raw.captionActive.some((v) => v === 1)));
	const audioCuts = hasAudioSource
		? extractRemovableCutsFromScores({
				category: "audio",
				scores: signalScores.audio,
				protectMask: speechMask,
				options,
				binMs,
				durationMs,
				effectiveClips,
				idPrefix: "audio-cut",
			})
		: [];

	const hasInputSource =
		(options.mouseActivityEnabled || options.keyboardActivityEnabled) &&
		(raw.mouseDisplacement.some((v) => v > 0) ||
			raw.mouseClickActive.some((v) => v === 1) ||
			raw.keyboardActive.some((v) => v === 1));
	const inputCuts = hasInputSource
		? extractRemovableCutsFromScores({
				category: "input",
				scores: signalScores.input,
				protectMask: emptyProtectMask,
				options,
				binMs,
				durationMs,
				effectiveClips,
				idPrefix: "input-cut",
			})
		: [];

	const screenCuts =
		options.screenActivityEnabled && raw.hasScreenSamples
			? extractRemovableCutsFromScores({
					category: "screen",
					scores: signalScores.screen,
					protectMask: emptyProtectMask,
					options,
					binMs,
					durationMs,
					effectiveClips,
					idPrefix: "screen-cut",
				})
			: [];

	const webcamCuts =
		options.webcamActivityEnabled &&
		options.webcamRole === "supporting" &&
		raw.hasWebcamSamples
			? extractRemovableCutsFromScores({
					category: "webcam",
					scores: signalScores.webcam,
					protectMask: emptyProtectMask,
					options,
					binMs,
					durationMs,
					effectiveClips,
					idPrefix: "webcam-cut",
				})
			: [];

	const cutsByCategory: Record<SmartCutSignalCategory, SmartCutCandidate[]> = {
		inactive: inactiveCuts,
		timing: cuts,
		audio: audioCuts,
		input: inputCuts,
		screen: screenCuts,
		webcam: webcamCuts,
	};

	const totalSavedMs = Math.min(
		Math.max(0, originalDurationMs - MIN_SURVIVING_TIMELINE_MS),
		cuts.reduce((acc, cut) => acc + (cut.enabled ? cut.durationMs : 0), 0),
	);
	const estimatedDurationMs = Math.max(
		MIN_SURVIVING_TIMELINE_MS,
		originalDurationMs - totalSavedMs,
	);

	const signalSegments: Record<SmartCutSignalKey, SmartCutSignalSegment[]> = {
		audio: extractSignalSegments({
			signal: "audio",
			scores: signalScores.audio,
			binMs,
			durationMs,
			effectiveClips,
		}),
		input: extractSignalSegments({
			signal: "input",
			scores: signalScores.input,
			binMs,
			durationMs,
			effectiveClips,
		}),
		screen: extractSignalSegments({
			signal: "screen",
			scores: signalScores.screen,
			binMs,
			durationMs,
			effectiveClips,
		}),
		webcam: extractSignalSegments({
			signal: "webcam",
			scores: signalScores.webcam,
			binMs,
			durationMs,
			effectiveClips,
		}),
	};

	return {
		cuts,
		cutsByCategory,
		activityScores,
		speechMask,
		signalScores,
		signalSegments,
		originalDurationMs,
		estimatedDurationMs,
		totalSavedMs,
	};
}

/**
 * Splits `clipRegions` around the enabled `SmartCutCandidate`s and returns
 * both the split pre-delete sequence (`splitBeforeClips` for `rippleRegions`)
 * and the surviving `keptClips` ready for `packClipSequence`.
 */
export function buildSmartCutSequencePlan(params: {
	clipRegions: ClipRegion[];
	sourceDurationMs: number;
	cuts: SmartCutCandidate[];
	createClipId: () => string;
}): SmartCutSequencePlan {
	const { clipRegions, sourceDurationMs, cuts, createClipId } = params;
	const baseDurationMs = Math.max(0, Math.round(sourceDurationMs));
	const effectiveClips: ClipRegion[] =
		clipRegions.length > 0
			? sortClipRegions(clipRegions)
			: [
					{
						id: createClipId(),
						startMs: 0,
						endMs: baseDurationMs,
						sourceStartMs: 0,
						speed: 1,
					},
				];

	const enabledCuts = cuts
		.filter((c) => c.enabled && c.timelineEndMs > c.timelineStartMs)
		.sort((a, b) => a.timelineStartMs - b.timelineStartMs);

	if (enabledCuts.length === 0) {
		return {
			splitBeforeClips: effectiveClips,
			keptClips: effectiveClips,
			appliedCutCount: 0,
			removedDurationMs: 0,
		};
	}

	const splitBeforeClips: ClipRegion[] = [];
	const keptClips: ClipRegion[] = [];
	let appliedCutCount = 0;
	let removedDurationMs = 0;

	for (const clip of effectiveClips) {
		const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
		const clipSourceStart = getClipSourceStartMs(clip);

		// Find cuts intersecting this clip
		const overlappingCuts = enabledCuts
			.map((cut) => ({
				startMs: Math.max(clip.startMs, Math.round(cut.timelineStartMs)),
				endMs: Math.min(clip.endMs, Math.round(cut.timelineEndMs)),
			}))
			.filter((cut) => cut.endMs - cut.startMs >= MIN_EFFECTIVE_CUT_MS);

		if (overlappingCuts.length === 0) {
			splitBeforeClips.push(clip);
			keptClips.push(clip);
			continue;
		}

		// Merge any abutting or overlapping cuts within the clip
		const mergedClipCuts: { startMs: number; endMs: number }[] = [];
		for (const cut of overlappingCuts) {
			const prev = mergedClipCuts[mergedClipCuts.length - 1];
			if (prev && cut.startMs <= prev.endMs) {
				prev.endMs = Math.max(prev.endMs, cut.endMs);
			} else {
				mergedClipCuts.push({ ...cut });
			}
		}

		let cursorTimelineMs = clip.startMs;
		let reusedOriginalId = false;

		const allocateKeptId = () => {
			if (!reusedOriginalId) {
				reusedOriginalId = true;
				return clip.id;
			}
			return createClipId();
		};

		for (const cut of mergedClipCuts) {
			// Kept segment before this cut
			if (cut.startMs > cursorTimelineMs) {
				const keptSegment: ClipRegion = {
					...clip,
					id: allocateKeptId(),
					startMs: cursorTimelineMs,
					endMs: cut.startMs,
					sourceStartMs: Math.round(
						clipSourceStart + (cursorTimelineMs - clip.startMs) * speed,
					),
				};
				splitBeforeClips.push(keptSegment);
				keptClips.push(keptSegment);
			}

			// Cut segment itself (present in splitBeforeClips so rippleRegions knows it was removed)
			const cutSegment: ClipRegion = {
				...clip,
				id: `cut-${createClipId()}`,
				startMs: cut.startMs,
				endMs: cut.endMs,
				sourceStartMs: Math.round(clipSourceStart + (cut.startMs - clip.startMs) * speed),
			};
			splitBeforeClips.push(cutSegment);
			appliedCutCount++;
			removedDurationMs += cut.endMs - cut.startMs;

			cursorTimelineMs = cut.endMs;
		}

		// Trailing kept segment after the last cut in this clip
		if (cursorTimelineMs < clip.endMs) {
			const trailingSegment: ClipRegion = {
				...clip,
				id: allocateKeptId(),
				startMs: cursorTimelineMs,
				endMs: clip.endMs,
				sourceStartMs: Math.round(
					clipSourceStart + (cursorTimelineMs - clip.startMs) * speed,
				),
			};
			splitBeforeClips.push(trailingSegment);
			keptClips.push(trailingSegment);
		}
	}

	// Safety guard: never leave the timeline with 0 clips
	if (keptClips.length === 0 && effectiveClips.length > 0) {
		const first = effectiveClips[0];
		const fallbackEndMs = Math.min(
			first.endMs,
			first.startMs + Math.max(MIN_SURVIVING_TIMELINE_MS, 1000),
		);
		const fallbackClip: ClipRegion = {
			...first,
			endMs: fallbackEndMs,
		};
		return {
			splitBeforeClips: [fallbackClip],
			keptClips: [fallbackClip],
			appliedCutCount: Math.max(0, appliedCutCount - 1),
			removedDurationMs: Math.max(0, removedDurationMs - (fallbackEndMs - first.startMs)),
		};
	}

	return {
		splitBeforeClips,
		keptClips,
		appliedCutCount,
		removedDurationMs,
	};
}

