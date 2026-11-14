import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { CaptionCue, ClipRegion, CursorTelemetryPoint } from "@/components/video-editor/types";
import { extractRawActivitySeries, planSmartCuts } from "@/lib/smartCut/smartCutPlanner";
import {
	DEFAULT_SMART_CUT_OPTIONS,
	type RawActivitySeries,
	type SmartCutAnalysisResult,
	type SmartCutCandidate,
	type SmartCutOptions,
} from "@/lib/smartCut/smartCutTypes";

const STORAGE_KEY = "anyrecord.smartCutOptions.v2";

function loadSavedSmartCutOptions(): SmartCutOptions {
	if (typeof window === "undefined") return DEFAULT_SMART_CUT_OPTIONS;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_SMART_CUT_OPTIONS;
		const parsed = JSON.parse(raw) as Partial<SmartCutOptions>;
		return {
			...DEFAULT_SMART_CUT_OPTIONS,
			...parsed,
			prePaddingSec: 0,
			postPaddingSec: 0,
			screenActivityEnabled: false,
		};
	} catch {
		return DEFAULT_SMART_CUT_OPTIONS;
	}
}

function saveSmartCutOptions(options: SmartCutOptions) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
	} catch {
		// ignore storage errors
	}
}

export interface UseSmartCutControllerParams {
	videoPath: string | null;
	audioPaths?: string[];
	webcamPath?: string | null;
	durationSec: number;
	clipRegions: ClipRegion[];
	cursorTelemetry: CursorTelemetryPoint[];
	autoCaptions: CaptionCue[];
	onApplySmartCut: (
		cuts: SmartCutCandidate[],
	) => { appliedCutCount: number; removedDurationMs: number } | null;
	onSeekPreview?: (timelineTimeSec: number) => void;
}

export function useSmartCutController({
	videoPath,
	audioPaths,
	webcamPath,
	durationSec,
	clipRegions,
	cursorTelemetry,
	autoCaptions,
	onApplySmartCut,
	onSeekPreview,
}: UseSmartCutControllerParams) {
	const [isOpen, setIsOpen] = useState(false);
	const [options, setOptions] = useState<SmartCutOptions>(loadSavedSmartCutOptions);
	const [analyzing, setAnalyzing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [stageLabel, setStageLabel] = useState("");
	const [rawSeries, setRawSeries] = useState<RawActivitySeries | null>(null);
	const [disabledCutIds, setDisabledCutIds] = useState<Set<string>>(new Set());

	const cacheKeyRef = useRef<string | null>(null);
	const rawSeriesRef = useRef<RawActivitySeries | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	const durationMs = Math.max(0, Math.round(durationSec * 1000));
	const audioKey = (audioPaths ?? []).join("|");
	const currentCacheKey = `${videoPath ?? ""}::${durationMs}::${autoCaptions.length}::${cursorTelemetry.length}::${webcamPath ?? ""}::${audioKey}`;

	const updateOptions = useCallback((patch: Partial<SmartCutOptions>) => {
		setOptions((prev) => {
			const next = { ...prev, ...patch };
			saveSmartCutOptions(next);
			return next;
		});
		setDisabledCutIds(new Set());
	}, []);

	const resetOptions = useCallback(() => {
		setOptions(DEFAULT_SMART_CUT_OPTIONS);
		saveSmartCutOptions(DEFAULT_SMART_CUT_OPTIONS);
		setDisabledCutIds(new Set());
	}, []);

	const runAnalysis = useCallback(
		async (force = false) => {
			if (!videoPath || durationMs <= 0) return;
			if (!force && rawSeriesRef.current && cacheKeyRef.current === currentCacheKey) {
				return;
			}

			abortControllerRef.current?.abort();
			const controller = new AbortController();
			abortControllerRef.current = controller;

			setAnalyzing(true);
			setProgress(0.05);
			setStageLabel("Preparing analysis…");

			try {
				const series = await extractRawActivitySeries({
					videoPath,
					audioPaths,
					webcamPath,
					durationMs,
					cursorTelemetry,
					autoCaptions,
					signal: controller.signal,
					onProgress: (p, stage) => {
						if (!controller.signal.aborted) {
							setProgress(p);
							setStageLabel(stage);
						}
					},
				});

				if (!controller.signal.aborted) {
					cacheKeyRef.current = currentCacheKey;
					rawSeriesRef.current = series;
					setRawSeries(series);
					setDisabledCutIds(new Set());
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					toast.error(err instanceof Error ? err.message : "Smart Cut analysis failed");
				}
			} finally {
				if (!controller.signal.aborted) {
					setAnalyzing(false);
				}
			}
		},
		[
			videoPath,
			audioPaths,
			webcamPath,
			durationMs,
			cursorTelemetry,
			autoCaptions,
			currentCacheKey,
		],
	);

	useEffect(() => {
		if (isOpen) {
			void runAnalysis(false);
		}
	}, [isOpen, runAnalysis]);

	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	const analysisResult: SmartCutAnalysisResult | null = useMemo(() => {
		if (!rawSeries) return null;
		const baseResult = planSmartCuts({
			raw: rawSeries,
			options,
			clipRegions,
		});

		if (disabledCutIds.size === 0) {
			return baseResult;
		}

		const mapEnabled = (list: SmartCutCandidate[]) =>
			list.map((cut) => ({
				...cut,
				enabled: !disabledCutIds.has(cut.id),
			}));

		const cuts = mapEnabled(baseResult.cuts);
		const cutsByCategory = {
			inactive: mapEnabled(baseResult.cutsByCategory.inactive),
			timing: cuts,
			audio: mapEnabled(baseResult.cutsByCategory.audio),
			input: mapEnabled(baseResult.cutsByCategory.input),
			screen: mapEnabled(baseResult.cutsByCategory.screen),
			webcam: mapEnabled(baseResult.cutsByCategory.webcam),
		};
		const totalSavedMs = Math.min(
			Math.max(0, baseResult.originalDurationMs - 500),
			cuts.reduce((sum, cut) => sum + (cut.enabled ? cut.durationMs : 0), 0),
		);
		const estimatedDurationMs = Math.max(500, baseResult.originalDurationMs - totalSavedMs);

		return {
			...baseResult,
			cuts,
			cutsByCategory,
			totalSavedMs,
			estimatedDurationMs,
		};
	}, [rawSeries, options, clipRegions, disabledCutIds]);

	const toggleCut = useCallback((cutId: string) => {
		setDisabledCutIds((prev) => {
			const next = new Set(prev);
			if (next.has(cutId)) {
				next.delete(cutId);
			} else {
				next.add(cutId);
			}
			return next;
		});
	}, []);

	const applyCuts = useCallback(
		(candidateCuts?: SmartCutCandidate[]) => {
			if (!analysisResult) return false;
			const targetCuts = candidateCuts ?? analysisResult.cuts;
			const enabledCuts = targetCuts.filter((c) => c.enabled);
			if (enabledCuts.length === 0) {
				toast.info("No removable cuts selected to apply.");
				return false;
			}

			const outcome = onApplySmartCut(enabledCuts);
			if (!outcome || outcome.appliedCutCount === 0) {
				toast.info("No cuts were applied.");
				return false;
			}

			const savedSec = (outcome.removedDurationMs / 1000).toFixed(1);
			toast.success(
				`Removed ${outcome.appliedCutCount} ${outcome.appliedCutCount === 1 ? "cut" : "cuts"} (-${savedSec}s)`,
			);
			setDisabledCutIds(new Set());
			return true;
		},
		[analysisResult, onApplySmartCut],
	);

	const previewCut = useCallback(
		(cut: SmartCutCandidate) => {
			onSeekPreview?.(cut.timelineStartMs / 1000);
		},
		[onSeekPreview],
	);

	return {
		isOpen,
		setIsOpen,
		options,
		updateOptions,
		resetOptions,
		analyzing,
		progress,
		stageLabel,
		analysisResult,
		toggleCut,
		reanalyze: () => runAnalysis(true),
		applyCuts,
		previewCut,
	};
}

