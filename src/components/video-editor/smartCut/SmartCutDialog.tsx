import {
	ArrowCounterClockwise,
	CaretLeft,
	CaretRight,
	Check,
	Clock,
	Cursor,
	Microphone,
	Pause,
	Play,
	Repeat,
	Scissors,
	Sparkle,
	SpeakerHigh,
	SpeakerX,
	SpinnerGap,
	Webcam,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import {
	SMART_CUT_BIN_MS,
	type SmartCutAnalysisResult,
	type SmartCutCandidate,
	type SmartCutOptions,
	type SmartCutSensitivity,
	type SmartCutSignalCategory,
} from "@/lib/smartCut/smartCutTypes";

type SettingsTab = SmartCutSignalCategory;

interface SignalThemeConfig {
	id: SettingsTab;
	label: string;
	badgeBg: string;
	badgeText: string;
	badgeBorder: string;
	dotBg: string;
	barBg: string;
	overlayActiveClass: string;
	overlaySelectedClass: string;
	checkActiveClass: string;
	chipActiveClass: string;
	chipSelectedClass: string;
	tabActiveClass: string;
	applyBtnClass: string;
}

const SIGNAL_THEMES: Record<SettingsTab, SignalThemeConfig> = {
	inactive: {
		id: "inactive",
		label: "Inactive",
		badgeBg: "bg-rose-500/15",
		badgeText: "text-rose-400",
		badgeBorder: "border-rose-500/35",
		dotBg: "bg-rose-500",
		barBg: "bg-rose-500/75",
		overlayActiveClass: "border-x border-rose-500/80 bg-rose-500/30 hover:bg-rose-500/45",
		overlaySelectedClass: "border-x-2 border-rose-400 bg-rose-500/55 ring-1 ring-rose-400",
		checkActiveClass: "border-rose-500 bg-rose-500 text-white",
		chipActiveClass: "border-rose-500/30 bg-rose-500/10 text-foreground hover:bg-rose-500/20",
		chipSelectedClass: "border-rose-400 bg-rose-500/20 text-foreground ring-1 ring-rose-400/50",
		tabActiveClass: "bg-rose-500/15 text-rose-400 border border-rose-500/35 shadow-sm",
		applyBtnClass: "bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-40",
	},
	timing: {
		id: "timing",
		label: "Timing",
		badgeBg: "bg-sky-500/15",
		badgeText: "text-sky-400",
		badgeBorder: "border-sky-500/35",
		dotBg: "bg-sky-500",
		barBg: "bg-sky-500/75",
		overlayActiveClass: "border-x border-sky-500/80 bg-sky-500/30 hover:bg-sky-500/45",
		overlaySelectedClass: "border-x-2 border-sky-400 bg-sky-500/55 ring-1 ring-sky-400",
		checkActiveClass: "border-sky-500 bg-sky-500 text-white",
		chipActiveClass: "border-sky-500/30 bg-sky-500/10 text-foreground hover:bg-sky-500/20",
		chipSelectedClass: "border-sky-400 bg-sky-500/20 text-foreground ring-1 ring-sky-400/50",
		tabActiveClass: "bg-sky-500/15 text-sky-400 border border-sky-500/35 shadow-sm",
		applyBtnClass: "bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40",
	},
	audio: {
		id: "audio",
		label: "Audio",
		badgeBg: "bg-emerald-500/15",
		badgeText: "text-emerald-400",
		badgeBorder: "border-emerald-500/35",
		dotBg: "bg-emerald-500",
		barBg: "bg-emerald-500/75",
		overlayActiveClass:
			"border-x border-emerald-500/80 bg-emerald-500/30 hover:bg-emerald-500/45",
		overlaySelectedClass:
			"border-x-2 border-emerald-400 bg-emerald-500/55 ring-1 ring-emerald-400",
		checkActiveClass: "border-emerald-500 bg-emerald-500 text-white",
		chipActiveClass:
			"border-emerald-500/30 bg-emerald-500/10 text-foreground hover:bg-emerald-500/20",
		chipSelectedClass:
			"border-emerald-400 bg-emerald-500/20 text-foreground ring-1 ring-emerald-400/50",
		tabActiveClass: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 shadow-sm",
		applyBtnClass: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40",
	},
	input: {
		id: "input",
		label: "Input",
		badgeBg: "bg-amber-500/15",
		badgeText: "text-amber-400",
		badgeBorder: "border-amber-500/35",
		dotBg: "bg-amber-500",
		barBg: "bg-amber-500/75",
		overlayActiveClass: "border-x border-amber-500/80 bg-amber-500/30 hover:bg-amber-500/45",
		overlaySelectedClass: "border-x-2 border-amber-400 bg-amber-500/55 ring-1 ring-amber-400",
		checkActiveClass: "border-amber-500 bg-amber-500 text-white",
		chipActiveClass:
			"border-amber-500/30 bg-amber-500/10 text-foreground hover:bg-amber-500/20",
		chipSelectedClass:
			"border-amber-400 bg-amber-500/20 text-foreground ring-1 ring-amber-400/50",
		tabActiveClass: "bg-amber-500/15 text-amber-400 border border-amber-500/35 shadow-sm",
		applyBtnClass: "bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40",
	},
	screen: {
		id: "screen",
		label: "Screen",
		badgeBg: "bg-violet-500/15",
		badgeText: "text-violet-400",
		badgeBorder: "border-violet-500/35",
		dotBg: "bg-violet-500",
		barBg: "bg-violet-500/75",
		overlayActiveClass:
			"border-x border-violet-500/80 bg-violet-500/30 hover:bg-violet-500/45",
		overlaySelectedClass:
			"border-x-2 border-violet-400 bg-violet-500/55 ring-1 ring-violet-400",
		checkActiveClass: "border-violet-500 bg-violet-500 text-white",
		chipActiveClass:
			"border-violet-500/30 bg-violet-500/10 text-foreground hover:bg-violet-500/20",
		chipSelectedClass:
			"border-violet-400 bg-violet-500/20 text-foreground ring-1 ring-violet-400/50",
		tabActiveClass: "bg-violet-500/15 text-violet-400 border border-violet-500/35 shadow-sm",
		applyBtnClass: "bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40",
	},
	webcam: {
		id: "webcam",
		label: "Webcam",
		badgeBg: "bg-cyan-500/15",
		badgeText: "text-cyan-400",
		badgeBorder: "border-cyan-500/35",
		dotBg: "bg-cyan-500",
		barBg: "bg-cyan-500/75",
		overlayActiveClass: "border-x border-cyan-500/80 bg-cyan-500/30 hover:bg-cyan-500/45",
		overlaySelectedClass: "border-x-2 border-cyan-400 bg-cyan-500/55 ring-1 ring-cyan-400",
		checkActiveClass: "border-cyan-500 bg-cyan-500 text-white",
		chipActiveClass: "border-cyan-500/30 bg-cyan-500/10 text-foreground hover:bg-cyan-500/20",
		chipSelectedClass:
			"border-cyan-400 bg-cyan-500/20 text-foreground ring-1 ring-cyan-400/50",
		tabActiveClass: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/35 shadow-sm",
		applyBtnClass: "bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40",
	},
};

interface SmartCutDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	videoPath?: string | null;
	audioPaths?: string[];
	webcamPath?: string | null;
	options: SmartCutOptions;
	onUpdateOptions: (patch: Partial<SmartCutOptions>) => void;
	onResetOptions: () => void;
	analyzing: boolean;
	progress: number;
	stageLabel: string;
	result: SmartCutAnalysisResult | null;
	onToggleCut: (cutId: string) => void;
	onPreviewCut: (cut: SmartCutCandidate) => void;
	onReanalyze: () => void;
	onApplyCuts: (cuts?: SmartCutCandidate[]) => void;
}

function formatMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0:00";
	const totalSec = Math.max(0, Math.round(ms / 1000));
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMsDetailed(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0:00.0";
	const totalSec = Math.max(0, ms / 1000);
	const mins = Math.floor(totalSec / 60);
	const secs = Math.floor(totalSec % 60);
	const tenths = Math.floor((totalSec % 1) * 10);
	return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
}

function formatSecShort(ms: number): string {
	const sec = Math.max(0, ms) / 1000;
	return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
}

const SENSITIVITY_LEVELS: { id: SmartCutSensitivity; label: string }[] = [
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
];

export function SmartCutDialog({
	open,
	onOpenChange,
	videoPath,
	audioPaths,
	webcamPath,
	options,
	onUpdateOptions,
	onResetOptions,
	analyzing,
	progress,
	stageLabel,
	result,
	onToggleCut,
	onReanalyze,
	onApplyCuts,
}: SmartCutDialogProps) {
	const [activeTab, setActiveTab] = useState<SettingsTab>("inactive");
	const [detailModalState, setDetailModalState] = useState<{
		cutId: string;
		category: SettingsTab;
		fallbackCut: SmartCutCandidate;
		applied?: boolean;
	} | null>(null);
	const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string | null>(null);
	const [resolvedAudioUrls, setResolvedAudioUrls] = useState<string[]>([]);
	const [popupIsPlaying, setPopupIsPlaying] = useState(false);
	const [popupCurrentMs, setPopupCurrentMs] = useState(0);
	const [popupLoop, setPopupLoop] = useState(true);
	const [popupMuted, setPopupMuted] = useState(false);

	const popupVideoRef = useRef<HTMLVideoElement | null>(null);
	const popupAudioRefs = useRef<HTMLAudioElement[]>([]);

	const currentTheme = SIGNAL_THEMES[activeTab];

	const currentCategoryCuts = useMemo(() => {
		if (!result) return [];
		return result.cutsByCategory?.[activeTab] ?? (activeTab === "timing" ? result.cuts : []);
	}, [result, activeTab]);

	const enabledCategoryCuts = useMemo(
		() => currentCategoryCuts.filter((c) => c.enabled),
		[currentCategoryCuts],
	);

	const enabledCutsCount = enabledCategoryCuts.length;

	const currentSavedMs = useMemo(() => {
		if (!result || result.originalDurationMs <= 0) return 0;
		const sum = enabledCategoryCuts.reduce((acc, c) => acc + c.durationMs, 0);
		return Math.min(Math.max(0, result.originalDurationMs - 500), sum);
	}, [result, enabledCategoryCuts]);

	const currentEstimatedDurationMs = useMemo(() => {
		if (!result || result.originalDurationMs <= 0) return 0;
		return Math.max(500, result.originalDurationMs - currentSavedMs);
	}, [result, currentSavedMs]);

	const savedPercent = useMemo(() => {
		if (!result || result.originalDurationMs <= 0 || currentSavedMs <= 0) return 0;
		return Math.min(99, Math.round((currentSavedMs / result.originalDurationMs) * 100));
	}, [result, currentSavedMs]);

	const timelineBars = useMemo(() => {
		const barCount = 72;
		if (!result || result.activityScores.length === 0 || result.originalDurationMs <= 0) {
			return new Array<{ height: number; inEnabledCut: boolean }>(barCount).fill({
				height: 0.15,
				inEnabledCut: false,
			});
		}

		const scores =
			activeTab === "timing" || activeTab === "inactive"
				? result.activityScores
				: (result.signalScores?.[activeTab] ?? result.activityScores);
		const totalBins = scores.length;
		const bars: { height: number; inEnabledCut: boolean }[] = [];

		for (let i = 0; i < barCount; i++) {
			const startBin = Math.floor((i * totalBins) / barCount);
			const endBin = Math.max(startBin + 1, Math.floor(((i + 1) * totalBins) / barCount));
			let maxScore = 0;
			for (let j = startBin; j < endBin && j < totalBins; j++) {
				if (scores[j] > maxScore) maxScore = scores[j];
			}

			const barTimeMs = ((i + 0.5) / barCount) * result.originalDurationMs;
			const inEnabledCut = currentCategoryCuts.some(
				(cut) =>
					cut.enabled &&
					barTimeMs >= cut.timelineStartMs &&
					barTimeMs <= cut.timelineEndMs,
			);

			bars.push({
				height: Math.max(0.14, maxScore),
				inEnabledCut,
			});
		}

		return bars;
	}, [result, activeTab, currentCategoryCuts]);

	const activeDetail = useMemo(() => {
		if (!detailModalState || !result) return null;
		const list =
			result.cutsByCategory?.[detailModalState.category] ??
			(detailModalState.category === "timing" ? result.cuts : []);
		const index = list.findIndex((c) => c.id === detailModalState.cutId);
		const resolvedCut =
			index !== -1 && !detailModalState.applied ? list[index] : detailModalState.fallbackCut;
		return {
			cut: resolvedCut,
			category: detailModalState.category,
			index: index !== -1 ? index : 0,
			totalInList: Math.max(1, list.length),
			list,
			applied: Boolean(detailModalState.applied),
		};
	}, [detailModalState, result]);

	const activeDetailMetrics = useMemo(() => {
		if (!activeDetail || !result) return null;
		const { cut } = activeDetail;
		const startBin = Math.max(0, Math.floor(cut.sourceStartMs / SMART_CUT_BIN_MS));
		const endBin = Math.min(
			result.activityScores.length - 1,
			Math.max(startBin, Math.ceil(cut.sourceEndMs / SMART_CUT_BIN_MS) - 1),
		);
		const binCount = Math.max(1, endBin - startBin + 1);

		let sumAudio = 0;
		let sumInput = 0;
		let sumScreen = 0;
		let sumWebcam = 0;

		const barCount = 48;
		const cutBars: number[] = [];

		for (let b = startBin; b <= endBin; b++) {
			sumAudio += result.signalScores?.audio[b] ?? 0;
			sumInput += result.signalScores?.input[b] ?? 0;
			sumScreen += result.signalScores?.screen[b] ?? 0;
			sumWebcam += result.signalScores?.webcam[b] ?? 0;
		}

		for (let i = 0; i < barCount; i++) {
			const bStart = startBin + Math.floor((i * binCount) / barCount);
			const bEnd = Math.max(
				bStart + 1,
				startBin + Math.floor(((i + 1) * binCount) / barCount),
			);
			let maxVal = 0;
			for (let b = bStart; b < bEnd && b <= endBin; b++) {
				const val =
					activeDetail.category === "timing" || activeDetail.category === "inactive"
						? (result.activityScores[b] ?? 0)
						: (result.signalScores?.[activeDetail.category][b] ?? 0);
				if (val > maxVal) maxVal = val;
			}
			cutBars.push(Math.max(0.1, maxVal));
		}

		return {
			audioAvgPct: Math.round((sumAudio / binCount) * 100),
			inputAvgPct: Math.round((sumInput / binCount) * 100),
			screenAvgPct: Math.round((sumScreen / binCount) * 100),
			webcamAvgPct: Math.round((sumWebcam / binCount) * 100),
			cutBars,
		};
	}, [activeDetail, result]);

	const targetVideoSource =
		activeDetail?.category === "webcam" && webcamPath ? webcamPath : videoPath;

	useEffect(() => {
		let cancelled = false;
		if (!open || !targetVideoSource) {
			setResolvedVideoUrl(null);
			return;
		}
		void resolveMediaResourceUrl(targetVideoSource)
			.then((url) => {
				if (!cancelled) setResolvedVideoUrl(url);
			})
			.catch(() => {
				if (!cancelled) setResolvedVideoUrl(targetVideoSource);
			});
		return () => {
			cancelled = true;
		};
	}, [open, targetVideoSource]);

	useEffect(() => {
		let cancelled = false;
		if (!open || !audioPaths || audioPaths.length === 0) {
			setResolvedAudioUrls([]);
			return;
		}
		void Promise.all(
			audioPaths.filter(Boolean).map(async (p) => {
				try {
					return await resolveMediaResourceUrl(p);
				} catch {
					return p;
				}
			}),
		).then((urls) => {
			if (!cancelled) setResolvedAudioUrls(urls);
		});
		return () => {
			cancelled = true;
		};
	}, [open, audioPaths]);

	useEffect(() => {
		if (!open) {
			setDetailModalState(null);
			setPopupIsPlaying(false);
		}
	}, [open]);

	const syncCompanionAudio = useCallback(
		(timeSec: number, play: boolean) => {
			for (const audioEl of popupAudioRefs.current) {
				if (!audioEl) continue;
				try {
					audioEl.muted = popupMuted;
					if (Math.abs(audioEl.currentTime - timeSec) > 0.15) {
						audioEl.currentTime = timeSec;
					}
					if (play && !popupMuted && audioEl.paused) {
						void audioEl.play().catch(() => undefined);
					} else if ((!play || popupMuted) && !audioEl.paused) {
						audioEl.pause();
					}
				} catch {
					// ignore audio sync errors
				}
			}
		},
		[popupMuted],
	);

	const openCutDetailModal = useCallback(
		(cut: SmartCutCandidate, category: SettingsTab) => {
			setDetailModalState({
				cutId: cut.id,
				category,
				fallbackCut: cut,
				applied: false,
			});
			setPopupCurrentMs(cut.sourceStartMs);

			requestAnimationFrame(() => {
				const videoEl = popupVideoRef.current;
				if (!videoEl) return;
				const startSec = Math.max(0, cut.sourceStartMs / 1000);
				try {
					videoEl.currentTime = startSec;
					void videoEl.play().catch(() => undefined);
					syncCompanionAudio(startSec, true);
					setPopupIsPlaying(true);
				} catch {
					// ignore
				}
			});
		},
		[syncCompanionAudio],
	);

	const handleTogglePopupPlay = useCallback(() => {
		const videoEl = popupVideoRef.current;
		if (!videoEl || !activeDetail) return;
		const { cut } = activeDetail;

		if (videoEl.paused) {
			const endSec = cut.sourceEndMs / 1000;
			const startSec = cut.sourceStartMs / 1000;
			if (videoEl.currentTime >= endSec - 0.05 || videoEl.currentTime < startSec) {
				videoEl.currentTime = startSec;
			}
			void videoEl.play().catch(() => undefined);
			syncCompanionAudio(videoEl.currentTime, true);
			setPopupIsPlaying(true);
		} else {
			videoEl.pause();
			syncCompanionAudio(videoEl.currentTime, false);
			setPopupIsPlaying(false);
		}
	}, [activeDetail, syncCompanionAudio]);

	const handleReplayPopupCut = useCallback(() => {
		if (!activeDetail) return;
		const { cut } = activeDetail;
		const videoEl = popupVideoRef.current;
		if (!videoEl) return;
		const startSec = Math.max(0, cut.sourceStartMs / 1000);
		videoEl.currentTime = startSec;
		void videoEl.play().catch(() => undefined);
		syncCompanionAudio(startSec, true);
		setPopupCurrentMs(cut.sourceStartMs);
		setPopupIsPlaying(true);
	}, [activeDetail, syncCompanionAudio]);

	const handleCloseDetailModal = useCallback(() => {
		const videoEl = popupVideoRef.current;
		if (videoEl) {
			videoEl.pause();
		}
		syncCompanionAudio(0, false);
		setPopupIsPlaying(false);
		setDetailModalState(null);
	}, [syncCompanionAudio]);

	const handleStepDetailCut = useCallback(
		(delta: number) => {
			if (!activeDetail) return;
			const nextIdx = activeDetail.index + delta;
			const nextCut = activeDetail.list[nextIdx];
			if (!nextCut) return;
			openCutDetailModal(nextCut, activeDetail.category);
		},
		[activeDetail, openCutDetailModal],
	);

	const playheadProgressPct = useMemo(() => {
		if (!activeDetail) return 0;
		const { cut } = activeDetail;
		const span = Math.max(1, cut.sourceEndMs - cut.sourceStartMs);
		return Math.min(100, Math.max(0, ((popupCurrentMs - cut.sourceStartMs) / span) * 100));
	}, [activeDetail, popupCurrentMs]);

	const renderSectionApplyFooter = (sectionId: SettingsTab) => {
		const theme = SIGNAL_THEMES[sectionId];
		const sectionCuts =
			result?.cutsByCategory?.[sectionId] ?? (sectionId === "timing" ? (result?.cuts ?? []) : []);
		const enabledSectionCuts = sectionCuts.filter((c) => c.enabled);
		const sectionSavedMs = result
			? Math.min(
					Math.max(0, result.originalDurationMs - 500),
					enabledSectionCuts.reduce((acc, c) => acc + c.durationMs, 0),
				)
			: 0;

		return (
			<div className="flex items-center justify-between border-t border-separator/50 pt-3">
				<div className="flex items-center gap-1.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onResetOptions}
						className="h-8 gap-1 px-2 text-xs text-muted-foreground"
					>
						<ArrowCounterClockwise className="size-3.5" />
						<span>Reset</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={analyzing}
						onClick={onReanalyze}
						className="h-8 px-2 text-xs text-muted-foreground"
					>
						Re-scan
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={analyzing || enabledSectionCuts.length === 0}
						onClick={() => onApplyCuts(sectionCuts)}
						className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-xs transition-colors ${theme.applyBtnClass}`}
					>
						<Scissors className="size-3.5" />
						<span>
							Apply {theme.label}
							{enabledSectionCuts.length > 0 ? ` (${enabledSectionCuts.length})` : ""}
							{sectionSavedMs > 0 ? ` · -${formatSecShort(sectionSavedMs)}` : ""}
						</span>
					</button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
						className="h-8 px-3 text-xs"
					>
						Close
					</Button>
				</div>
			</div>
		);
	};

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="w-[92vw] max-w-xl gap-3.5 p-5">
					<DialogHeader>
						<div className="flex items-center justify-between pr-6">
							<DialogTitle className="flex items-center gap-2 text-base font-semibold">
								<Sparkle weight="fill" className="size-4 text-sky-500" />
								<span>Smart Cut</span>
							</DialogTitle>
							{result && !analyzing && (
								<div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
									<span>
										{formatMs(result.originalDurationMs)} →{" "}
										<strong className="font-medium text-foreground">
											{formatMs(currentEstimatedDurationMs)}
										</strong>
									</span>
									{currentSavedMs > 0 && (
										<span
											className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${currentTheme.badgeBg} ${currentTheme.badgeText} ${currentTheme.badgeBorder}`}
										>
											-{formatSecShort(currentSavedMs)} ({savedPercent}%)
										</span>
									)}
								</div>
							)}
						</div>
					</DialogHeader>

					{/* Signal Selector */}
					<div className="grid grid-cols-5 gap-1 rounded-xl border border-separator bg-default/20 p-1">
						{(
							[
								{ id: "inactive", label: "Inactive", icon: Scissors },
								{ id: "timing", label: "Timing", icon: Clock },
								{ id: "audio", label: "Audio", icon: Microphone },
								{ id: "input", label: "Input", icon: Cursor },
								{ id: "webcam", label: "Webcam", icon: Webcam },
							] as const
						).map(({ id, label, icon: Icon }) => {
							const theme = SIGNAL_THEMES[id];
							const isSelected = activeTab === id;
							const count =
								!result || analyzing
									? null
									: (result.cutsByCategory?.[id]?.length ??
										(id === "timing" ? result.cuts.length : 0));

							return (
								<button
									key={id}
									type="button"
									onClick={() => setActiveTab(id)}
									className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium transition-all ${
										isSelected
											? theme.tabActiveClass
											: "border border-transparent text-muted-foreground hover:text-foreground"
									}`}
								>
									<span
										className={`size-1.5 shrink-0 rounded-full ${theme.dotBg}`}
									/>
									<Icon className="size-3.5 shrink-0" />
									<span className="truncate">{label}</span>
									{count !== null && count > 0 && (
										<span className="rounded-full bg-background/60 px-1 text-[10px] tabular-nums">
											{count}
										</span>
									)}
								</button>
							);
						})}
					</div>

					{/* Timeline & Cuts */}
					<div className="space-y-2.5 rounded-xl border border-separator bg-default/10 p-3">
						<div className="flex items-center justify-between text-xs">
							<span
								className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${currentTheme.badgeBg} ${currentTheme.badgeText} ${currentTheme.badgeBorder}`}
							>
								<span className={`size-1.5 rounded-full ${currentTheme.dotBg}`} />
								<span>{currentTheme.label}</span>
							</span>
							{result && !analyzing && (
								<span className="text-[11px] tabular-nums text-muted-foreground">
									{enabledCutsCount}/{currentCategoryCuts.length}
									{currentSavedMs > 0 ? ` · -${formatSecShort(currentSavedMs)}` : ""}
								</span>
							)}
						</div>

						{analyzing ? (
							<div className="flex h-20 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
								<div className="flex items-center gap-2 text-foreground">
									<SpinnerGap className="size-4 animate-spin text-sky-500" />
									<span>{stageLabel || "Analyzing…"}</span>
									<span className="tabular-nums text-muted-foreground">
										{Math.round(progress * 100)}%
									</span>
								</div>
								<div className="h-1 w-48 overflow-hidden rounded-full bg-default/40">
									<div
										className="h-full bg-sky-500 transition-all duration-150"
										style={{ width: `${Math.max(5, Math.round(progress * 100))}%` }}
									/>
								</div>
							</div>
						) : (
							<>
								<div className="space-y-1">
									<div className="relative flex h-11 items-end gap-[2px] overflow-hidden rounded-lg border border-separator bg-background/60 px-2 py-1.5">
										{timelineBars.map((bar, idx) => (
											<div
												key={idx}
												className={`flex-1 rounded-full transition-all ${
													bar.inEnabledCut
														? currentTheme.barBg
														: "bg-foreground/20"
												}`}
												style={{ height: `${Math.round(bar.height * 100)}%` }}
											/>
										))}

										{result &&
											result.originalDurationMs > 0 &&
											currentCategoryCuts.map((cut, index) => {
												const leftPct =
													(cut.timelineStartMs /
														result.originalDurationMs) *
													100;
												const widthPct = Math.max(
													1.0,
													(cut.durationMs / result.originalDurationMs) *
														100,
												);
												const isViewingThis =
													activeDetail?.cut.id === cut.id;

												return (
													<button
														key={cut.id}
														type="button"
														onClick={() =>
															openCutDetailModal(cut, activeTab)
														}
														title={`${currentTheme.label} #${index + 1}: ${formatMs(cut.timelineStartMs)} – ${formatMs(cut.timelineEndMs)} (-${formatSecShort(cut.durationMs)})`}
														className={`absolute inset-y-0 transition-all ${
															isViewingThis
																? currentTheme.overlaySelectedClass
																: cut.enabled
																	? currentTheme.overlayActiveClass
																	: "border-x border-muted-foreground/30 bg-muted-foreground/15 opacity-45"
														}`}
														style={{
															left: `${leftPct}%`,
															width: `${widthPct}%`,
														}}
													/>
												);
											})}
									</div>

									{result && result.originalDurationMs > 0 && (
										<div className="flex items-center justify-between px-0.5 text-[10px] tabular-nums text-muted-foreground">
											<span>0:00</span>
											<span>{formatMs(result.originalDurationMs)}</span>
										</div>
									)}
								</div>

								{currentCategoryCuts.length > 0 ? (
									<div className="custom-scrollbar flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pt-0.5">
										{currentCategoryCuts.map((cut) => {
											const isViewingThis = activeDetail?.cut.id === cut.id;
											return (
												<div
													key={cut.id}
													className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
														isViewingThis
															? currentTheme.chipSelectedClass
															: cut.enabled
																? currentTheme.chipActiveClass
																: "border-separator bg-transparent text-muted-foreground opacity-60"
													}`}
												>
													<button
														type="button"
														onClick={() => onToggleCut(cut.id)}
														className={`flex size-3.5 items-center justify-center rounded border ${
															cut.enabled
																? currentTheme.checkActiveClass
																: "border-muted-foreground/50"
														}`}
														aria-label="Toggle cut"
													>
														{cut.enabled && (
															<Check
																weight="bold"
																className="size-2.5"
															/>
														)}
													</button>
													<button
														type="button"
														onClick={() =>
															openCutDetailModal(cut, activeTab)
														}
														className="inline-flex items-center gap-1 font-medium tabular-nums hover:underline"
													>
														<Play
															weight="fill"
															className={`size-2.5 ${currentTheme.badgeText}`}
														/>
														<span>
															{formatMs(cut.timelineStartMs)}–
															{formatMs(cut.timelineEndMs)}
														</span>
													</button>
													<span className="text-[10px] tabular-nums text-muted-foreground">
														-{formatSecShort(cut.durationMs)}
													</span>
												</div>
											);
										})}
									</div>
								) : (
									<p className="py-1.5 text-center text-xs text-muted-foreground">
										No cuts detected
									</p>
								)}
							</>
						)}
					</div>

					{/* Settings */}
					<div className="space-y-3 px-0.5 text-[13px]">
						{activeTab === "inactive" && (
							<>
								<div className="grid grid-cols-2 gap-2 text-xs">
									<div className="flex items-center gap-1.5 rounded-lg border border-separator bg-default/15 px-2.5 py-1.5">
										<span className="size-1.5 rounded-full bg-emerald-500" />
										<span className="text-muted-foreground">No Mic</span>
									</div>
									<div className="flex items-center gap-1.5 rounded-lg border border-separator bg-default/15 px-2.5 py-1.5">
										<span className="size-1.5 rounded-full bg-amber-500" />
										<span className="text-muted-foreground">No Input</span>
									</div>
								</div>

								<div className="space-y-1.5">
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">
											Minimum duration
										</span>
										<span className="font-medium tabular-nums">
											{options.minInactivitySec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={1.0}
										max={15.0}
										step={0.5}
										value={[options.minInactivitySec]}
										onValueChange={([v]) =>
											v !== undefined &&
											onUpdateOptions({ minInactivitySec: v })
										}
									/>
								</div>

								{renderSectionApplyFooter("inactive")}
							</>
						)}

						{activeTab === "timing" && (
							<>
								<div className="space-y-1.5">
									<div className="flex justify-between text-xs">
										<span className="text-muted-foreground">
											Minimum duration
										</span>
										<span className="font-medium tabular-nums">
											{options.minInactivitySec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={1.0}
										max={15.0}
										step={0.5}
										value={[options.minInactivitySec]}
										onValueChange={([v]) =>
											v !== undefined &&
											onUpdateOptions({ minInactivitySec: v })
										}
									/>
								</div>

								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-1.5">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">
												Min keep segment
											</span>
											<span className="font-medium tabular-nums">
												{options.minKeepSegmentSec.toFixed(1)}s
											</span>
										</div>
										<Slider
											min={0.3}
											max={3.0}
											step={0.1}
											value={[options.minKeepSegmentSec]}
											onValueChange={([v]) =>
												v !== undefined &&
												onUpdateOptions({ minKeepSegmentSec: v })
											}
										/>
									</div>

									<div className="space-y-1.5">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">Merge gap</span>
											<span className="font-medium tabular-nums">
												{options.mergeGapSec.toFixed(1)}s
											</span>
										</div>
										<Slider
											min={0.0}
											max={2.0}
											step={0.1}
											value={[options.mergeGapSec]}
											onValueChange={([v]) =>
												v !== undefined &&
												onUpdateOptions({ mergeGapSec: v })
											}
										/>
									</div>
								</div>

								{renderSectionApplyFooter("timing")}
							</>
						)}

						{activeTab === "audio" && (
							<>
								<div className="divide-y divide-separator/50">
									<div className="flex items-center justify-between py-2 first:pt-0">
										<span className="text-foreground">Speech protection</span>
										<Switch
											checked={options.speechProtectionEnabled}
											onCheckedChange={(checked) =>
												onUpdateOptions({
													speechProtectionEnabled: checked,
												})
											}
										/>
									</div>

									<div className="flex items-center justify-between py-2">
										<span className="text-foreground">Silence detection</span>
										<Switch
											checked={options.audioSilenceEnabled}
											onCheckedChange={(checked) =>
												onUpdateOptions({ audioSilenceEnabled: checked })
											}
										/>
									</div>

									<div className="space-y-1.5 py-2.5">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">
												Silence threshold
											</span>
											<span className="font-medium tabular-nums">
												{options.silenceThresholdDb} dB
											</span>
										</div>
										<Slider
											min={-60}
											max={-18}
											step={1}
											disabled={!options.audioSilenceEnabled}
											value={[options.silenceThresholdDb]}
											onValueChange={([v]) =>
												v !== undefined &&
												onUpdateOptions({ silenceThresholdDb: v })
											}
										/>
									</div>

									<div className="flex items-center justify-between py-2 last:pb-0">
										<span className="text-foreground">Caption protection</span>
										<Switch
											checked={options.useAutoCaptions}
											onCheckedChange={(checked) =>
												onUpdateOptions({ useAutoCaptions: checked })
											}
										/>
									</div>
								</div>

								{renderSectionApplyFooter("audio")}
							</>
						)}

						{activeTab === "input" && (
							<>
								<div className="divide-y divide-separator/50">
									<div className="flex items-center justify-between py-2 first:pt-0">
										<span className="text-foreground">Mouse activity</span>
										<Switch
											checked={options.mouseActivityEnabled}
											onCheckedChange={(checked) =>
												onUpdateOptions({ mouseActivityEnabled: checked })
											}
										/>
									</div>

									<div className="flex items-center justify-between py-2">
										<span className="text-muted-foreground">Sensitivity</span>
										<div className="flex gap-1 rounded-lg border border-separator bg-default/20 p-0.5">
											{SENSITIVITY_LEVELS.map((lvl) => (
												<button
													key={lvl.id}
													type="button"
													disabled={!options.mouseActivityEnabled}
													onClick={() =>
														onUpdateOptions({
															mouseSensitivity: lvl.id,
														})
													}
													className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors ${
														options.mouseSensitivity === lvl.id
															? "bg-background text-foreground shadow-sm"
															: "text-muted-foreground hover:text-foreground"
													}`}
												>
													{lvl.label}
												</button>
											))}
										</div>
									</div>

									<div className="space-y-1.5 py-2.5">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">Click hold</span>
											<span className="font-medium tabular-nums">
												{options.clickProtectionSec.toFixed(1)}s
											</span>
										</div>
										<Slider
											min={0.3}
											max={2.5}
											step={0.1}
											disabled={!options.mouseActivityEnabled}
											value={[options.clickProtectionSec]}
											onValueChange={([v]) =>
												v !== undefined &&
												onUpdateOptions({ clickProtectionSec: v })
											}
										/>
									</div>

									<div className="flex items-center justify-between py-2 last:pb-0">
										<span className="text-foreground">Keyboard activity</span>
										<Switch
											checked={options.keyboardActivityEnabled}
											onCheckedChange={(checked) =>
												onUpdateOptions({
													keyboardActivityEnabled: checked,
												})
											}
										/>
									</div>
								</div>

								{renderSectionApplyFooter("input")}
							</>
						)}

						{activeTab === "webcam" && (
							<>
								<div className="divide-y divide-separator/50">
									<div className="flex items-center justify-between py-2 first:pt-0">
										<span className="text-foreground">Webcam motion</span>
										<Switch
											checked={options.webcamActivityEnabled}
											onCheckedChange={(checked) =>
												onUpdateOptions({ webcamActivityEnabled: checked })
											}
										/>
									</div>

									<div className="flex items-center justify-between py-2 last:pb-0">
										<span className="text-muted-foreground">Priority</span>
										<div className="flex gap-1 rounded-lg border border-separator bg-default/20 p-0.5">
											{(
												[
													{ id: "supporting", label: "Supporting" },
													{ id: "ignored", label: "Ignored" },
												] as const
											).map((role) => (
												<button
													key={role.id}
													type="button"
													disabled={!options.webcamActivityEnabled}
													onClick={() =>
														onUpdateOptions({ webcamRole: role.id })
													}
													className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors ${
														options.webcamRole === role.id
															? "bg-background text-foreground shadow-sm"
															: "text-muted-foreground hover:text-foreground"
													}`}
												>
													{role.label}
												</button>
											))}
										</div>
									</div>
								</div>

								{renderSectionApplyFooter("webcam")}
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>

			{/* Detailed Cut Modal */}
			<Dialog
				open={Boolean(activeDetail && resolvedVideoUrl)}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) handleCloseDetailModal();
				}}
			>
				{activeDetail && resolvedVideoUrl && (
					<DialogContent className="w-[90vw] max-w-5xl gap-4 p-6">
						<DialogHeader>
							<div className="flex items-center justify-between pr-6">
								<DialogTitle className="flex items-center gap-2 text-sm font-semibold">
									<span
										className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${SIGNAL_THEMES[activeDetail.category].badgeBg} ${SIGNAL_THEMES[activeDetail.category].badgeText} ${SIGNAL_THEMES[activeDetail.category].badgeBorder}`}
									>
										<span
											className={`size-1.5 rounded-full ${SIGNAL_THEMES[activeDetail.category].dotBg}`}
										/>
										{SIGNAL_THEMES[activeDetail.category].label} #
										{activeDetail.index + 1}/{activeDetail.totalInList}
									</span>
									<span className="tabular-nums text-foreground">
										{formatMsDetailed(activeDetail.cut.timelineStartMs)} –{" "}
										{formatMsDetailed(activeDetail.cut.timelineEndMs)}
									</span>
									<span className="text-xs font-normal tabular-nums text-muted-foreground">
										(-{formatSecShort(activeDetail.cut.durationMs)})
									</span>
								</DialogTitle>

								<button
									type="button"
									onClick={() => onToggleCut(activeDetail.cut.id)}
									className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
										activeDetail.cut.enabled
											? `${SIGNAL_THEMES[activeDetail.category].badgeBg} ${SIGNAL_THEMES[activeDetail.category].badgeText} ${SIGNAL_THEMES[activeDetail.category].badgeBorder}`
											: "border-separator bg-default/20 text-muted-foreground"
									}`}
								>
									<span
										className={`flex size-3.5 items-center justify-center rounded border ${
											activeDetail.cut.enabled
												? SIGNAL_THEMES[activeDetail.category]
														.checkActiveClass
												: "border-muted-foreground/50"
										}`}
									>
										{activeDetail.cut.enabled && (
											<Check weight="bold" className="size-2.5" />
										)}
									</span>
									<span>{activeDetail.cut.enabled ? "Remove" : "Keep"}</span>
								</button>
							</div>
						</DialogHeader>

						{/* Video Player */}
						<div className="overflow-hidden rounded-xl border border-separator bg-black">
							<div className="relative flex aspect-video max-h-[62vh] w-full items-center justify-center bg-black">
								<video
									ref={popupVideoRef}
									src={resolvedVideoUrl}
									playsInline
									muted={
										popupMuted ||
										(activeDetail.category !== "webcam" &&
											resolvedAudioUrls.length > 0)
									}
									className="h-full w-full object-contain"
									onClick={handleTogglePopupPlay}
									onLoadedMetadata={(e) => {
										const v = e.currentTarget;
										const startSec = Math.max(
											0,
											activeDetail.cut.sourceStartMs / 1000,
										);
										v.currentTime = startSec;
										void v.play().catch(() => undefined);
										syncCompanionAudio(startSec, true);
										setPopupIsPlaying(true);
									}}
									onTimeUpdate={(e) => {
										const v = e.currentTarget;
										const curMs = v.currentTime * 1000;
										setPopupCurrentMs(curMs);
										if (curMs >= activeDetail.cut.sourceEndMs) {
											if (popupLoop) {
												const startSec = Math.max(
													0,
													activeDetail.cut.sourceStartMs / 1000,
												);
												v.currentTime = startSec;
												void v.play().catch(() => undefined);
												syncCompanionAudio(startSec, true);
												setPopupIsPlaying(true);
											} else {
												v.pause();
												v.currentTime =
													activeDetail.cut.sourceStartMs / 1000;
												syncCompanionAudio(
													activeDetail.cut.sourceStartMs / 1000,
													false,
												);
												setPopupIsPlaying(false);
											}
										}
									}}
									onPause={() => {
										setPopupIsPlaying(false);
									}}
									onPlay={() => {
										setPopupIsPlaying(true);
									}}
								/>
								{resolvedAudioUrls.map((audioUrl, idx) => (
									<audio
										key={audioUrl}
										ref={(el) => {
											if (el) popupAudioRefs.current[idx] = el;
										}}
										src={audioUrl}
										preload="auto"
									/>
								))}
							</div>

							<div className="space-y-2 border-t border-white/10 bg-zinc-950 px-3.5 py-2.5 text-xs text-white">
								{activeDetailMetrics && (
									<div className="relative flex h-6 items-end gap-[2px] overflow-hidden rounded-md bg-white/5 px-1.5 py-1">
										{activeDetailMetrics.cutBars.map((h, i) => (
											<div
												key={i}
												className={`flex-1 rounded-full ${SIGNAL_THEMES[activeDetail.category].barBg}`}
												style={{ height: `${Math.round(h * 100)}%` }}
											/>
										))}
										<div
											className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
											style={{ left: `${playheadProgressPct}%` }}
										/>
									</div>
								)}

								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={handleTogglePopupPlay}
										className="flex size-7 items-center justify-center rounded-md bg-white/15 text-white transition-colors hover:bg-white/25"
										aria-label={popupIsPlaying ? "Pause" : "Play"}
									>
										{popupIsPlaying ? (
											<Pause weight="fill" className="size-3.5" />
										) : (
											<Play weight="fill" className="size-3.5" />
										)}
									</button>
									<button
										type="button"
										onClick={handleReplayPopupCut}
										className="flex size-7 items-center justify-center rounded-md bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
										title="Replay"
									>
										<ArrowCounterClockwise className="size-3.5" />
									</button>
									<button
										type="button"
										onClick={() => setPopupLoop((prev) => !prev)}
										className={`flex size-7 items-center justify-center rounded-md transition-colors ${
											popupLoop
												? "bg-sky-500/25 text-sky-400"
												: "bg-white/10 text-white/60 hover:text-white"
										}`}
										title="Loop"
									>
										<Repeat className="size-3.5" />
									</button>
									<button
										type="button"
										onClick={() => setPopupMuted((prev) => !prev)}
										className="flex size-7 items-center justify-center rounded-md bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
										title={popupMuted ? "Unmute" : "Mute"}
									>
										{popupMuted ? (
											<SpeakerX className="size-3.5 text-rose-400" />
										) : (
											<SpeakerHigh className="size-3.5" />
										)}
									</button>

									<div className="flex-1">
										<Slider
											min={activeDetail.cut.sourceStartMs}
											max={Math.max(
												activeDetail.cut.sourceStartMs + 100,
												activeDetail.cut.sourceEndMs,
											)}
											step={50}
											value={[
												Math.min(
													activeDetail.cut.sourceEndMs,
													Math.max(
														activeDetail.cut.sourceStartMs,
														popupCurrentMs,
													),
												),
											]}
											onValueChange={([val]) => {
												if (val === undefined) return;
												setPopupCurrentMs(val);
												if (popupVideoRef.current) {
													popupVideoRef.current.currentTime =
														val / 1000;
												}
												syncCompanionAudio(val / 1000, popupIsPlaying);
											}}
										/>
									</div>

									<span className="tabular-nums text-[11px] text-white/80">
										{formatMsDetailed(
											Math.max(
												0,
												popupCurrentMs - activeDetail.cut.sourceStartMs,
											),
										)}{" "}
										/ {formatMsDetailed(activeDetail.cut.durationMs)}
									</span>
								</div>
							</div>
						</div>

						{activeDetailMetrics && (
							<div className="grid grid-cols-3 gap-2 text-xs">
								<div className="flex items-center justify-between rounded-lg border border-separator bg-default/15 px-2.5 py-1.5">
									<span className="flex items-center gap-1.5 text-muted-foreground">
										<span className="size-1.5 rounded-full bg-emerald-500" />
										Audio
									</span>
									<span className="font-medium tabular-nums text-emerald-400">
										{activeDetailMetrics.audioAvgPct}%
									</span>
								</div>
								<div className="flex items-center justify-between rounded-lg border border-separator bg-default/15 px-2.5 py-1.5">
									<span className="flex items-center gap-1.5 text-muted-foreground">
										<span className="size-1.5 rounded-full bg-amber-500" />
										Input
									</span>
									<span className="font-medium tabular-nums text-amber-400">
										{activeDetailMetrics.inputAvgPct}%
									</span>
								</div>
								<div className="flex items-center justify-between rounded-lg border border-separator bg-default/15 px-2.5 py-1.5">
									<span className="flex items-center gap-1.5 text-muted-foreground">
										<span className="size-1.5 rounded-full bg-cyan-500" />
										Webcam
									</span>
									<span className="font-medium tabular-nums text-cyan-400">
										{activeDetailMetrics.webcamAvgPct}%
									</span>
								</div>
							</div>
						)}

						<DialogFooter className="flex items-center justify-between border-t border-separator/50 pt-3 sm:justify-between">
							<div className="flex items-center gap-1.5">
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={activeDetail.index <= 0}
									onClick={() => handleStepDetailCut(-1)}
									className="h-8 gap-1 px-2.5 text-xs"
								>
									<CaretLeft className="size-3.5" />
									<span>Prev</span>
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={
										activeDetail.index >= activeDetail.totalInList - 1
									}
									onClick={() => handleStepDetailCut(1)}
									className="h-8 gap-1 px-2.5 text-xs"
								>
									<span>Next</span>
									<CaretRight className="size-3.5" />
								</Button>
							</div>

							<div className="flex items-center gap-2">
								<button
									type="button"
									disabled={activeDetail.applied}
									onClick={() => {
										const singleCut = { ...activeDetail.cut, enabled: true };
										onApplyCuts([singleCut]);
										setDetailModalState((prev) =>
											prev ? { ...prev, applied: true } : null,
										);
									}}
									className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-xs transition-colors ${SIGNAL_THEMES[activeDetail.category].applyBtnClass}`}
								>
									<Scissors className="size-3.5" />
									<span>
										{activeDetail.applied
											? "Applied"
											: `Apply Cut (-${formatSecShort(activeDetail.cut.durationMs)})`}
									</span>
								</button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleCloseDetailModal}
									className="h-8 px-3 text-xs"
								>
									Close
								</Button>
							</div>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>
		</>
	);
}
