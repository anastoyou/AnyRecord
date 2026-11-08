import { describe, expect, it } from "vitest";
import {
	packClipSequence,
	rippleRegionAnchors,
	rippleRegions,
} from "@/components/video-editor/clipSequence";
import type { AnnotationRegion, AudioRegion, ClipRegion, ZoomRegion } from "@/components/video-editor/types";
import { analyzeAudioChannelBins, buildCaptionSpeechMask } from "./audioVadEngine";
import { computeFrameLuminanceMapd } from "./screenMotionEngine";
import { buildSmartCutSequencePlan, planSmartCuts } from "./smartCutPlanner";
import {
	DEFAULT_SMART_CUT_OPTIONS,
	type RawActivitySeries,
	SMART_CUT_BIN_MS,
} from "./smartCutTypes";
import { analyzeTelemetryActivityBins } from "./telemetryActivityEngine";

function createBlankRawSeries(durationMs: number): RawActivitySeries {
	const binMs = SMART_CUT_BIN_MS;
	const binCount = Math.ceil(durationMs / binMs);
	return {
		durationMs,
		binCount,
		binMs,
		audioRmsDb: new Float32Array(binCount).fill(-80),
		audioZcr: new Float32Array(binCount),
		audioNoiseFloorDb: -65,
		hasAudioSignal: true,
		captionActive: new Uint8Array(binCount),
		mouseDisplacement: new Float32Array(binCount),
		mouseClickActive: new Uint8Array(binCount),
		textCursorActive: new Uint8Array(binCount),
		keyboardActive: new Uint8Array(binCount),
		screenMapd: new Float32Array(binCount),
		hasScreenSamples: true,
		webcamMapd: new Float32Array(binCount),
		hasWebcamSamples: true,
	};
}

function fillBinRange(
	arr: Float32Array | Uint8Array,
	startMs: number,
	endMs: number,
	value: number,
	binMs = SMART_CUT_BIN_MS,
) {
	const startBin = Math.max(0, Math.floor(startMs / binMs));
	const endBin = Math.min(arr.length - 1, Math.floor(endMs / binMs) - 1);
	for (let i = startBin; i <= endBin; i++) {
		arr[i] = value;
	}
}

describe("Smart Cut Multi-Signal Detection & Planning Engine", () => {
	it("cuts inactive gaps >= 5s while applying 0.5s pre-cut and 0.7s post-cut padding", () => {
		// 20s recording:
		// 0s - 5s: speaking (-20 dB)
		// 5s - 13s: 8s complete inactivity
		// 13s - 20s: mouse movement
		const raw = createBlankRawSeries(20_000);
		fillBinRange(raw.audioRmsDb, 0, 5_000, -20);
		fillBinRange(raw.mouseDisplacement, 13_000, 20_000, 0.02);

		const result = planSmartCuts({
			raw,
			options: DEFAULT_SMART_CUT_OPTIONS,
		});

		expect(result.cuts).toHaveLength(1);
		const cut = result.cuts[0];
		// Raw inactive: 5000ms -> 13000ms
		// With prePad 500ms and postPad 700ms: 5500ms -> 12300ms (6800ms cut)
		expect(cut.sourceStartMs).toBe(5_500);
		expect(cut.sourceEndMs).toBe(12_300);
		expect(cut.durationMs).toBe(6_800);
		expect(result.totalSavedMs).toBe(6_800);
		expect(result.estimatedDurationMs).toBe(13_200);
	});

	it("enforces speech immunity: never cuts a section with speech even if mouse, keyboard, and screen are completely still", () => {
		const raw = createBlankRawSeries(20_000);
		// User speaks continuously from 0s to 20s while sitting completely still
		fillBinRange(raw.audioRmsDb, 0, 20_000, -22);

		const result = planSmartCuts({
			raw,
			options: DEFAULT_SMART_CUT_OPTIONS,
		});

		expect(result.cuts).toHaveLength(0);
		expect(result.totalSavedMs).toBe(0);
	});

	it("preserves silent work when keyboard typing or mouse clicks are active", () => {
		const raw = createBlankRawSeries(20_000);
		// Silent throughout, but telemetry has keypresses and clicks
		const telemetry = analyzeTelemetryActivityBins(
			[
				{ timeMs: 2_000, cx: 0.2, cy: 0.2, interactionType: "click" },
				{ timeMs: 5_000, cx: 0.2, cy: 0.2, interactionType: "keypress" },
				{ timeMs: 8_000, cx: 0.2, cy: 0.2, interactionType: "keypress" },
				{ timeMs: 11_000, cx: 0.3, cy: 0.4, interactionType: "click" },
				{ timeMs: 14_000, cx: 0.3, cy: 0.4, interactionType: "keypress" },
				{ timeMs: 17_000, cx: 0.5, cy: 0.5, interactionType: "click" },
			],
			raw.binCount,
		);
		raw.mouseClickActive = telemetry.mouseClickActive;
		raw.keyboardActive = telemetry.keyboardActive;

		const result = planSmartCuts({
			raw,
			options: DEFAULT_SMART_CUT_OPTIONS,
		});

		// No gap between events exceeds 5s
		expect(result.cuts).toHaveLength(0);
	});

	it("bridges tiny non-speech micro-movements <= 0.5s between two inactive spans, but never bridges speech", () => {
		const raw = createBlankRawSeries(20_000);
		// Active at 0-2s and 18-20s
		fillBinRange(raw.audioRmsDb, 0, 2_000, -18);
		fillBinRange(raw.audioRmsDb, 18_000, 20_000, -18);

		// Tiny 200ms mouse bump at 10.0s - 10.2s inside the 2s..18s silence
		fillBinRange(raw.mouseDisplacement, 10_000, 10_200, 0.01);

		const bridgedResult = planSmartCuts({
			raw,
			options: DEFAULT_SMART_CUT_OPTIONS,
		});
		// Should merge into a single continuous cut (2500ms -> 17300ms)
		expect(bridgedResult.cuts).toHaveLength(1);
		expect(bridgedResult.cuts[0].sourceStartMs).toBe(2_500);
		expect(bridgedResult.cuts[0].sourceEndMs).toBe(17_300);

		// Now replace that 200ms bump with spoken word (caption cue)
		const rawWithSpeech = createBlankRawSeries(20_000);
		fillBinRange(rawWithSpeech.audioRmsDb, 0, 2_000, -18);
		fillBinRange(rawWithSpeech.audioRmsDb, 18_000, 20_000, -18);
		rawWithSpeech.captionActive = buildCaptionSpeechMask(
			[{ id: "cue-1", startMs: 9_800, endMs: 10_200, text: "Wait" }],
			rawWithSpeech.binCount,
		);

		const unbridgedResult = planSmartCuts({
			raw: rawWithSpeech,
			options: DEFAULT_SMART_CUT_OPTIONS,
		});
		// Must NOT bridge over spoken word -> produces 2 separate cuts around the word
		expect(unbridgedResult.cuts).toHaveLength(2);
		expect(unbridgedResult.cuts[0].sourceEndMs).toBeLessThanOrEqual(9_800);
		expect(unbridgedResult.cuts[1].sourceStartMs).toBeGreaterThanOrEqual(10_500);
	});

	it("splits clips non-destructively and ripples zoom, annotation, and audio regions in sync", () => {
		const initialClips: ClipRegion[] = [
			{
				id: "clip-1",
				startMs: 0,
				endMs: 20_000,
				sourceStartMs: 0,
				speed: 1,
			},
		];
		const zoomRegions: ZoomRegion[] = [
			{ id: "zoom-before", startMs: 1_000, endMs: 3_000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			{ id: "zoom-after", startMs: 15_000, endMs: 18_000, depth: 3, focus: { cx: 0.4, cy: 0.6 } },
		];
		const annotationRegions: AnnotationRegion[] = [
			{
				id: "ann-after",
				startMs: 16_000,
				endMs: 19_000,
				type: "text",
				content: "Step 2",
				position: { x: 50, y: 50 },
				size: { width: 20, height: 10 },
				style: {
					color: "#fff",
					backgroundColor: "#000",
					fontSize: 16,
					fontFamily: "Inter",
					fontWeight: "bold",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
				},
				zIndex: 1,
			},
		];
		const audioRegions: AudioRegion[] = [
			{
				id: "aud-after",
				startMs: 15_000,
				endMs: 17_000,
				audioPath: "/sfx.wav",
				volume: 1,
			},
		];

		let nextId = 2;
		// Cut 5000ms -> 10000ms (removes 5000ms)
		const plan = buildSmartCutSequencePlan({
			clipRegions: initialClips,
			sourceDurationMs: 20_000,
			cuts: [
				{
					id: "smart-cut-1",
					sourceStartMs: 5_000,
					sourceEndMs: 10_000,
					timelineStartMs: 5_000,
					timelineEndMs: 10_000,
					durationMs: 5_000,
					enabled: true,
				},
			],
			createClipId: () => `clip-${nextId++}`,
		});

		expect(plan.appliedCutCount).toBe(1);
		expect(plan.removedDurationMs).toBe(5_000);

		const packedClips = packClipSequence(plan.keptClips);
		expect(packedClips).toHaveLength(2);
		// First clip: 0..5000 (sourceStartMs: 0)
		expect(packedClips[0]).toMatchObject({
			startMs: 0,
			endMs: 5_000,
			sourceStartMs: 0,
		});
		// Second clip: 5000..15000 on timeline, reading from 10000..20000 in source!
		expect(packedClips[1]).toMatchObject({
			startMs: 5_000,
			endMs: 15_000,
			sourceStartMs: 10_000,
		});

		const rippledZooms = rippleRegions(zoomRegions, plan.splitBeforeClips, packedClips);
		expect(rippledZooms).toEqual([
			expect.objectContaining({ id: "zoom-before", startMs: 1_000, endMs: 3_000 }),
			expect.objectContaining({ id: "zoom-after", startMs: 10_000, endMs: 13_000 }),
		]);

		const rippledAnnotations = rippleRegions(
			annotationRegions,
			plan.splitBeforeClips,
			packedClips,
		);
		expect(rippledAnnotations).toEqual([
			expect.objectContaining({ id: "ann-after", startMs: 11_000, endMs: 14_000 }),
		]);

		const rippledAudio = rippleRegionAnchors(audioRegions, plan.splitBeforeClips, packedClips);
		expect(rippledAudio).toEqual([
			expect.objectContaining({ id: "aud-after", startMs: 10_000, endMs: 12_000 }),
		]);
	});

	it("computes audio VAD energy and frame luminance MAPD accurately", () => {
		const sampleRate = 1000;
		const samples = new Float32Array(1000); // 1 second = 10 bins of 100ms
		// First 500ms silent (0.0001), next 500ms loud sine wave (0.5 amplitude)
		for (let i = 0; i < 500; i++) samples[i] = 0.0001;
		for (let i = 500; i < 1000; i++) samples[i] = i % 2 === 0 ? 0.5 : -0.5;

		const vad = analyzeAudioChannelBins([samples], sampleRate, 10, 100);
		expect(vad.hasSignal).toBe(true);
		expect(vad.rmsDb[0]).toBeLessThan(-70);
		expect(vad.rmsDb[6]).toBeGreaterThan(-10);

		const blackFrame = new Uint8ClampedArray(16 * 9 * 4).fill(0);
		const whiteFrame = new Uint8ClampedArray(16 * 9 * 4).fill(255);
		expect(computeFrameLuminanceMapd(blackFrame, blackFrame, 16, 9)).toBe(0);
		expect(computeFrameLuminanceMapd(blackFrame, whiteFrame, 16, 9)).toBeCloseTo(1, 2);
	});
});

