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

	const screenPromise = extractVideoMotionSeries({
		videoPath: input.videoPath,
		durationMs,
		binCount,
		binMs,
		centerWeighted: false,
		signal: input.signal,
		onProgress: (p) => {
			input.onProgress?.(0.25 + p * 0.55, "Scanning screen visual activity…");
		},
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
	const speechMask = new Uint8Array(binCount);

	if (durationMs <= 0 || binCount <= 0) {
		return {
			cuts: [],
			activityScores,
			speechMask,
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
	if (options.mouseActivityEnabled) {
		for (let i = 0; i < binCount; i++) {
			if (raw.mouseClickActive[i] === 1 || raw.textCursorActive[i] === 1) {
				const start = Math.max(0, i - clickProtectRadiusBins);
				const end = Math.min(binCount - 1, i + clickProtectRadiusBins);
				for (let k = start; k <= end; k++) {
					clickProtectedMask[k] = 1;
				}
			}
		}
	}

	// Effective audio silence threshold relative to noise floor
	const effectiveAudioThresholdDb = Math.min(
		options.silenceThresholdDb + 6,
		Math.max(options.silenceThresholdDb, raw.audioNoiseFloorDb + 10),
	);

	// 1. Score each 100ms bin across all enabled signals
	for (let k = 0; k < binCount; k++) {
		let isSpeech = false;
		if (options.speechProtectionEnabled) {
			if (options.useAutoCaptions && raw.captionActive[k] === 1) {
				isSpeech = true;
			}
			if (
				!isSpeech &&
				options.audioSilenceEnabled &&
				raw.hasAudioSignal &&
				raw.audioRmsDb[k] >= effectiveAudioThresholdDb
			) {
				isSpeech = true;
			}
		} else if (
			options.audioSilenceEnabled &&
			raw.hasAudioSignal &&
			raw.audioRmsDb[k] >= effectiveAudioThresholdDb
		) {
			// Even if strict speech immunity is toggled off, audio activity still contributes if audioSilenceEnabled is true
			isSpeech = true;
		}

		speechMask[k] = isSpeech && options.speechProtectionEnabled ? 1 : 0;

		if (isSpeech && options.speechProtectionEnabled) {
			activityScores[k] = 1.0;
			continue;
		}

		const audioScore = isSpeech ? 0.9 : 0;
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
		const webcamScore =
			options.webcamActivityEnabled &&
			options.webcamRole === "supporting" &&
			raw.hasWebcamSamples &&
			raw.webcamMapd[k] >= 0.012
				? 0.35
				: 0;

		activityScores[k] = Math.max(
			audioScore,
			keyScore,
			clickScore,
			mouseMoveScore,
			screenScore,
			webcamScore,
		);
	}

	// 2. Build initial inactivity mask (1 = inactive, 0 = active)
	const inactiveMask = new Uint8Array(binCount);
	for (let k = 0; k < binCount; k++) {
		inactiveMask[k] = activityScores[k] < ACTIVE_SCORE_THRESHOLD ? 1 : 0;
	}

	// 3. Bridge tiny non-speech active blips <= mergeGapSec between inactive regions
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
					!hasSpeechInBinRange(speechMask, blipStart, blipEnd)
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

	// 4. Extract contiguous inactive spans >= minInactivitySec and apply pre/post padding
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
				const cutStartMs = Math.min(durationMs, rawStartMs + prePadMs);
				const cutEndMs = Math.max(0, rawEndMs - postPadMs);

				if (cutEndMs - cutStartMs >= MIN_EFFECTIVE_CUT_MS) {
					paddedSpans.push({ startMs: cutStartMs, endMs: cutEndMs });
				}
			}
		} else {
			idx++;
		}
	}

	// 5. Enforce minimum keep segment between consecutive cuts (if no speech is in the gap)
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
		const gapHasSpeech = hasSpeechInBinRange(speechMask, gapStartBin, gapEndBin);

		if (gapMs < minKeepMs && !gapHasSpeech) {
			prev.endMs = span.endMs;
		} else {
			mergedSourceSpans.push({ ...span });
		}
	}

	// 6. Project source cuts onto active timeline ClipRegions
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
					id: `smart-cut-${cutIndex++}`,
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

	const totalSavedMs = Math.min(
		Math.max(0, originalDurationMs - MIN_SURVIVING_TIMELINE_MS),
		cuts.reduce((acc, cut) => acc + (cut.enabled ? cut.durationMs : 0), 0),
	);
	const estimatedDurationMs = Math.max(
		MIN_SURVIVING_TIMELINE_MS,
		originalDurationMs - totalSavedMs,
	);

	return {
		cuts,
		activityScores,
		speechMask,
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

