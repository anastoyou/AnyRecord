import type { CaptionCue, ClipRegion, CursorTelemetryPoint } from "@/components/video-editor/types";

export const SMART_CUT_BIN_MS = 100;

export type SmartCutSensitivity = "low" | "medium" | "high";
export type SmartCutWebcamRole = "supporting" | "ignored";
export type SmartCutSignalCategory =
	| "inactive"
	| "timing"
	| "audio"
	| "input"
	| "screen"
	| "webcam";
export type SmartCutSignalKey = Exclude<SmartCutSignalCategory, "inactive" | "timing">;

export interface SmartCutSignalSegment {
	id: string;
	signal: SmartCutSignalKey;
	/** Start time in source recording milliseconds */
	sourceStartMs: number;
	/** End time in source recording milliseconds */
	sourceEndMs: number;
	/** Start time on current timeline milliseconds */
	timelineStartMs: number;
	/** End time on current timeline milliseconds */
	timelineEndMs: number;
	/** Timeline duration in milliseconds */
	durationMs: number;
	/** Peak signal score in [0, 1] */
	peakScore: number;
}

export interface SmartCutOptions {
	// 1. Timing & Durations
	minInactivitySec: number;
	prePaddingSec: number;
	postPaddingSec: number;
	minKeepSegmentSec: number;
	mergeGapSec: number;

	// 2. Audio & Speech (VAD)
	speechProtectionEnabled: boolean;
	audioSilenceEnabled: boolean;
	silenceThresholdDb: number;
	useAutoCaptions: boolean;

	// 3. Mouse & Keyboard Activity
	mouseActivityEnabled: boolean;
	mouseSensitivity: SmartCutSensitivity;
	clickProtectionSec: number;
	keyboardActivityEnabled: boolean;

	// 4. Screen & Visual Motion
	screenActivityEnabled: boolean;
	screenSensitivity: SmartCutSensitivity;

	// 5. Webcam Presence
	webcamActivityEnabled: boolean;
	webcamRole: SmartCutWebcamRole;
}

export const DEFAULT_SMART_CUT_OPTIONS: SmartCutOptions = {
	minInactivitySec: 3.0,
	prePaddingSec: 0,
	postPaddingSec: 0,
	minKeepSegmentSec: 1.0,
	mergeGapSec: 0.5,

	speechProtectionEnabled: true,
	audioSilenceEnabled: true,
	silenceThresholdDb: -36,
	useAutoCaptions: true,

	mouseActivityEnabled: true,
	mouseSensitivity: "medium",
	clickProtectionSec: 1.0,
	keyboardActivityEnabled: true,

	screenActivityEnabled: false,
	screenSensitivity: "medium",

	webcamActivityEnabled: true,
	webcamRole: "supporting",
};

export interface RawActivitySeries {
	durationMs: number;
	binCount: number;
	binMs: number;
	audioRmsDb: Float32Array;
	audioZcr: Float32Array;
	audioNoiseFloorDb: number;
	hasAudioSignal: boolean;
	captionActive: Uint8Array;
	mouseDisplacement: Float32Array;
	mouseClickActive: Uint8Array;
	textCursorActive: Uint8Array;
	keyboardActive: Uint8Array;
	screenMapd: Float32Array;
	hasScreenSamples: boolean;
	webcamMapd: Float32Array;
	hasWebcamSamples: boolean;
}

export interface SmartCutCandidate {
	id: string;
	/** Signal category that produced this removable cut */
	category?: SmartCutSignalCategory;
	/** Start time in source recording milliseconds */
	sourceStartMs: number;
	/** End time in source recording milliseconds */
	sourceEndMs: number;
	/** Start time on current timeline milliseconds */
	timelineStartMs: number;
	/** End time on current timeline milliseconds */
	timelineEndMs: number;
	/** Timeline duration removed in milliseconds */
	durationMs: number;
	/** Whether this cut is selected to be removed */
	enabled: boolean;
}

export interface SmartCutAnalysisResult {
	cuts: SmartCutCandidate[];
	cutsByCategory: Record<SmartCutSignalCategory, SmartCutCandidate[]>;
	activityScores: Float32Array;
	speechMask: Uint8Array;
	signalScores: Record<SmartCutSignalKey, Float32Array>;
	signalSegments: Record<SmartCutSignalKey, SmartCutSignalSegment[]>;
	originalDurationMs: number;
	estimatedDurationMs: number;
	totalSavedMs: number;
}

export interface SmartCutSequencePlan {
	/** Clips split at cut boundaries prior to deleting the cut spans (used as `before` for rippleRegions) */
	splitBeforeClips: ClipRegion[];
	/** Surviving clips before repacking */
	keptClips: ClipRegion[];
	/** Number of cuts applied */
	appliedCutCount: number;
	/** Total timeline milliseconds removed */
	removedDurationMs: number;
}

export interface SmartCutAnalyzerInput {
	videoPath: string | null;
	audioPaths?: string[];
	webcamPath?: string | null;
	durationMs: number;
	cursorTelemetry: CursorTelemetryPoint[];
	autoCaptions: CaptionCue[];
	onProgress?: (progress: number, stage: string) => void;
	signal?: AbortSignal;
}

