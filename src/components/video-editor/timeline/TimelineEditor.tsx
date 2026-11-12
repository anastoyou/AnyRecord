import { Plus } from "@/components/ui/icons";
import type { Span } from "dnd-timeline";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type {
	SourceAudioTrackMeta,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { fromFileUrl } from "../projectPersistence";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../types";
import KeyframeMarkers from "./components/markers/KeyframeMarkers";
import TimelineCanvas from "./components/viewport/TimelineCanvas";
import TimelineWrapper from "./components/wrapper/TimelineWrapper";
import { calculateTimelineScale } from "./core/time";
import type { ClipSequenceSpan } from "./core/timelineTypes";
import { useTimelineAudioPeaks } from "./hooks/useTimelineAudioPeaks";
import { useTimelineEditorRuntime } from "./hooks/useTimelineEditorRuntime";
import { useTimelineRange } from "./hooks/useTimelineRange";
import {
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
} from "./sourceAudioTracks";

export interface TimelineEditorProps {
	videoDuration: number;
	currentTime: number;
	playheadTime?: number;
	onSeek?: (time: number) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger?: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms?: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	clipRegions?: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onClipSpanChange?: (id: string, span: ClipSequenceSpan) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	cameraRegions?: import("./core/timelineTypes").CameraRegion[];
	onCameraSplit?: (splitMs: number) => void;
	onCameraSpanChange?: (id: string, span: Span) => void;
	onCameraDelete?: (id: string) => void;
	selectedCameraId?: string | null;
	onSelectCamera?: (id: string | null) => void;
	cameraVideoPath?: string | null;
	hasCameraTrack?: boolean;
	showCameraAudioTrack?: boolean;
	cameraAudioVolume?: number;
	cameraAudioMuted?: boolean;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions?: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	audioPortions?: import("@/components/video-editor/audio/audioPortion").AudioPortion[];
	onAudioPortionSpanChange?: (id: string, span: Span) => void;
	onAudioPortionDelete?: (id: string) => void;
	onAudioPortionAdded?: (span: Span) => void;
	selectedAudioPortionId?: string | null;
	onSelectAudioPortion?: (id: string | null) => void;
	captionRegions?: CaptionCue[];
	onCaptionSpanChange?: (id: string, span: Span) => void;
	onCaptionDelete?: (id: string) => void;
	onCaptionAdded?: (span: Span) => void;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	selectedCaptionId?: string | null;
	onSelectCaption?: (id: string | null) => void;
	gestureRegions?: import("../gestures/gestureTypes").FingerGestureRegion[];
	onGestureSpanChange?: (id: string, span: Span) => void;
	onGestureDelete?: (id: string) => void;
	selectedGestureId?: string | null;
	onSelectGesture?: (id: string | null) => void;
	gestureTrackingEnabled?: boolean;
	videoPath?: string | null;
	videoSourcePath?: string | null;
	cursorTelemetrySourcePath?: string | null;
	showSourceAudioTrack?: boolean;
	sourceAudioResourceVersion?: number;
	onSourceAudioAvailabilityChange?: (available: boolean) => void;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	onSourceAudioTracksMetaChange?: (tracks: SourceAudioTrackMeta) => void;
}

function extractLocalPathFromMediaServerUrl(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		const url = new URL(input);
		const isLocalMediaServer =
			(url.protocol === "http:" || url.protocol === "https:") &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video";
		if (!isLocalMediaServer) return null;
		return url.searchParams.get("path");
	} catch {
		return null;
	}
}

export interface TimelineEditorHandle {
	addZoom: () => void;
	suggestZooms: () => void;
	splitClip: () => void;
	addAnnotation: (trackIndex?: number) => void;
	addAudio: (trackIndex?: number) => Promise<void>;
	keyframes: { id: string; time: number }[];
}

const TimelineEditor = forwardRef<TimelineEditorHandle, TimelineEditorProps>(
	function TimelineEditor(
		{
			videoDuration,
			currentTime,
			playheadTime,
			onSeek,
			cursorTelemetry = [],
			autoSuggestZoomsTrigger = 0,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms = false,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions = [],
			onTrimSpanChange,
			clipRegions = [],
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			cameraRegions = [],
			onCameraSplit,
			onCameraSpanChange,
			onCameraDelete,
			selectedCameraId,
			onSelectCamera,
			cameraVideoPath,
			hasCameraTrack = false,
			showCameraAudioTrack = false,
			cameraAudioVolume = 1,
			cameraAudioMuted = false,
			annotationRegions = [],
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions = [],
			onSpeedSpanChange,
			audioRegions = [],
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			audioPortions = [],
			onAudioPortionSpanChange,
			onAudioPortionDelete,
			onAudioPortionAdded,
			selectedAudioPortionId,
			onSelectAudioPortion,
			captionRegions = [],
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			captionsEnabled = false,
			captionQuickAddEnabled = true,
			selectedCaptionId,
			onSelectCaption,
			gestureRegions = [],
			onGestureSpanChange,
			onGestureDelete,
			selectedGestureId,
			onSelectGesture,
			gestureTrackingEnabled = false,
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			showSourceAudioTrack = false,
			sourceAudioResourceVersion = 0,
			onSourceAudioAvailabilityChange,
			sourceAudioTrackSettings = {},
			getSourceAudioTrackSettingsForClip,
			onSourceAudioTracksMetaChange,
		},
		ref,
	) {
		const t = useScopedT("settings");
		const totalMs = useMemo(
			() => Math.max(0, Math.round(videoDuration * 1000)),
			[videoDuration],
		);
		const currentTimeMs = useMemo(
			() => Math.round((playheadTime ?? currentTime) * 1000),
			[currentTime, playheadTime],
		);
		const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
		const safeMinDurationMs = useMemo(
			() =>
				totalMs > 0
					? Math.min(timelineScale.minItemDurationMs, totalMs)
					: timelineScale.minItemDurationMs,
			[timelineScale.minItemDurationMs, totalMs],
		);

		const timelineContainerRef = useRef<HTMLDivElement>(null);
		const isTimelineFocusedRef = useRef(false);
		const { setRange, clampedRange, handleTimelineWheel } = useTimelineRange({
			totalMs,
			timelineContainerRef,
		});

		const [liveSpanPreviewById, setLiveSpanPreviewById] = useState<Record<string, Span>>({});
		const [isDragging, setIsDragging] = useState(false);
		const liveZoomPreview = useMemo(() => {
			const previewSpans: Record<string, Span> = { ...liveSpanPreviewById };
			const hiddenZoomIds = new Set<string>();

			for (const [previewId, previewSpan] of Object.entries(liveSpanPreviewById)) {
				const oldClip = clipRegions.find((clip) => clip.id === previewId);
				if (!oldClip) continue;

				const newStart = Math.round(previewSpan.start);
				const newEnd = Math.round(previewSpan.end);
				const removedSegments = [
					...(newStart > oldClip.startMs
						? [{ startMs: oldClip.startMs, endMs: newStart }]
						: []),
					...(newEnd < oldClip.endMs ? [{ startMs: newEnd, endMs: oldClip.endMs }] : []),
				];

				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

				if (isMove) {
					const delta = startDelta;
					for (const zoom of zoomRegions) {
						const overlaps =
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
						if (!overlaps) continue;
						previewSpans[zoom.id] = {
							start: zoom.startMs + delta,
							end: zoom.endMs + delta,
						};
					}
				}

				if (removedSegments.length > 0) {
					for (const zoom of zoomRegions) {
						const removed = removedSegments.some(
							(segment) =>
								zoom.startMs < segment.endMs && zoom.endMs > segment.startMs,
						);
						if (removed) hiddenZoomIds.add(zoom.id);
					}
				}
			}

			return { previewSpans, hiddenZoomIds };
		}, [clipRegions, liveSpanPreviewById, zoomRegions]);
		const { shortcuts: keyShortcuts, isMac } = useShortcuts();
		const { peaks: sourceAudioPeaks, loading: sourceAudioLoading } = useTimelineAudioPeaks(
			videoPath,
			{ resourceVersion: sourceAudioResourceVersion },
		);
		const localSourcePath = useMemo(() => {
			if (!videoPath) return null;
			return (
				extractLocalPathFromMediaServerUrl(videoPath) ||
				(/^file:\/\//i.test(videoPath) ? fromFileUrl(videoPath) : videoPath)
			);
		}, [videoPath]);
		const micSidecarPaths = useMemo(
			() => (localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "mic") : []),
			[localSourcePath],
		);
		const micSidecarFallbackPaths = useMemo(() => micSidecarPaths.slice(1), [micSidecarPaths]);
		const systemSidecarPaths = useMemo(
			() =>
				localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "system") : [],
			[localSourcePath],
		);
		const systemSidecarFallbackPaths = useMemo(
			() => systemSidecarPaths.slice(1),
			[systemSidecarPaths],
		);
		const { peaks: micSidecarPeaks, loading: micSidecarLoading } = useTimelineAudioPeaks(
			micSidecarPaths[0] ?? null,
			{
				fallbackResources: micSidecarFallbackPaths,
				resourceVersion: sourceAudioResourceVersion,
			},
		);
		const { peaks: systemSidecarPeaks, loading: systemSidecarLoading } = useTimelineAudioPeaks(
			systemSidecarPaths[0] ?? null,
			{
				fallbackResources: systemSidecarFallbackPaths,
				resourceVersion: sourceAudioResourceVersion,
			},
		);
		const cameraAudioFallbackPaths = useMemo(
			() => [
				...micSidecarPaths,
				...(videoPath ? [videoPath] : []),
				...systemSidecarPaths,
			],
			[micSidecarPaths, systemSidecarPaths, videoPath],
		);
		const { peaks: cameraAudioPeaks } = useTimelineAudioPeaks(
			hasCameraTrack && showCameraAudioTrack ? (cameraVideoPath ?? videoPath) : null,
			{
				fallbackResources: cameraAudioFallbackPaths,
				resourceVersion: sourceAudioResourceVersion,
			},
		);
		const cameraAudioLabel = useMemo(
			() => t("effects.webcamAudio", "Camera Audio"),
			[t],
		);
		const sourceAudioTracks = useMemo(
			() =>
				buildTimelineSourceAudioTracks({
					sourceAudioPeaks,
					micSidecarPeaks,
					systemSidecarPeaks,
					labels: {
						system: t("audio.systemLabel", "Source System"),
						mic: t("audio.micLabel", "Source Mic"),
						mixed: t("audio.mixedLabel", "Source"),
					},
				}),
			[micSidecarPeaks, sourceAudioPeaks, systemSidecarPeaks, t],
		);

		const isLoading = useMemo(() => {
			// If we are still actively trying to load audio peaks (main or sidecars)
			if (videoPath && (sourceAudioLoading || micSidecarLoading || systemSidecarLoading))
				return true;

			// Robust telemetry loading detection:
			// If a source path is set but telemetry hasn't arrived (or failed/retried) for it yet.
			if (videoSourcePath && cursorTelemetrySourcePath !== videoSourcePath) return true;

			return false;
		}, [
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			sourceAudioLoading,
			micSidecarLoading,
			systemSidecarLoading,
		]);
		useEffect(() => {
			onSourceAudioTracksMetaChange?.(
				sourceAudioTracks.map((t) => ({ id: t.id, label: t.label })),
			);
		}, [onSourceAudioTracksMetaChange, sourceAudioTracks]);
		void sourceAudioTrackSettings;
		useEffect(() => {
			onSourceAudioAvailabilityChange?.(sourceAudioTracks.length > 0);
		}, [onSourceAudioAvailabilityChange, sourceAudioTracks.length]);

		const {
			keyframes,
			selectedKeyframeId,
			setSelectedKeyframeId,
			selectAllBlocksActive,
			setSelectAllBlocksActive,
			handleKeyframeMove,
			clearSelectedBlocks,
			handleSelectZoom,
			handleSelectClip,
			handleSelectCamera,
			handleSelectAnnotation,
			handleSelectAudio,
			handleSelectCaption,
			handleSelectGesture,
			handleSelectAudioPortion,
			hasOverlap,
			timelineItems,
			allRegionSpans,
			getResolvedDropRowId,
			handleItemSpanChange,
			canPlaceZoomAtMs,
			addZoomAtMs,
			canPlaceCaptionAtMs,
			addCaptionAtMs,
			resolveCaptionSpanAtMs,
			canPlaceAudioPortionAtMs,
			addAudioPortionAtMs,
		} = useTimelineEditorRuntime({
			ref,
			videoDuration,
			totalMs,
			currentTimeMs,
			safeMinDurationMs,
			cursorTelemetry,
			autoSuggestZoomsTrigger,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions,
			onTrimSpanChange,
			clipRegions,
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			cameraRegions,
			onCameraSplit,
			onCameraSpanChange,
			onCameraDelete,
			selectedCameraId,
			onSelectCamera,
			annotationRegions,
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions,
			onSpeedSpanChange,
			audioRegions,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			audioPortions,
			onAudioPortionSpanChange,
			onAudioPortionDelete,
			onAudioPortionAdded,
			selectedAudioPortionId,
			onSelectAudioPortion,
			captionCues: captionRegions,
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			selectedCaptionId,
			onSelectCaption,
			gestureRegions,
			onGestureSpanChange,
			onGestureDelete,
			selectedGestureId,
			onSelectGesture,
			gestureTrackingEnabled,
			isMac,
			keyShortcuts,
			isTimelineFocusedRef,
		});

		if (!videoDuration || videoDuration === 0) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-editor-surface gap-3">
					<div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
						<Plus className="w-6 h-6 text-muted-foreground" />
					</div>
					<div className="text-center">
						<p className="text-sm font-medium text-muted-foreground">No Video Loaded</p>
						<p className="text-xs text-muted-foreground/70 mt-1">
							Drag and drop a video to start editing
						</p>
					</div>
				</div>
			);
		}

		return (
			<div className="flex-1 min-h-0 flex flex-col bg-transparent overflow-hidden">
				<div
					ref={timelineContainerRef}
					data-testid="timeline-scroll"
					style={{ outline: "none", boxShadow: "none" }}
					className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-transparent relative px-3"
					tabIndex={0}
					onFocus={() => {
						isTimelineFocusedRef.current = true;
					}}
					onBlur={() => {
						isTimelineFocusedRef.current = false;
					}}
					onPointerDownCapture={() => {
						timelineContainerRef.current?.focus({ preventScroll: true });
						isTimelineFocusedRef.current = true;
					}}
					onClick={() => {
						setSelectedKeyframeId(null);
						setSelectAllBlocksActive(false);
					}}
					onWheel={handleTimelineWheel}
				>
					<TimelineWrapper
						range={clampedRange}
						videoDuration={videoDuration}
						hasOverlap={hasOverlap}
						onRangeChange={setRange}
						minItemDurationMs={timelineScale.minItemDurationMs}
						minVisibleRangeMs={timelineScale.minVisibleRangeMs}
						onItemSpanChange={handleItemSpanChange}
						resolveTargetRowId={getResolvedDropRowId}
						allRegionSpans={allRegionSpans}
						onDraggingChange={setIsDragging}
						onLiveSpanPreviewChange={(id, span) => {
							setLiveSpanPreviewById((prev) => {
								if (!span) {
									if (!(id in prev)) return prev;
									const next = { ...prev };
									delete next[id];
									return next;
								}
								const current = prev[id];
								if (
									current &&
									current.start === span.start &&
									current.end === span.end
								) {
									return prev;
								}
								return { ...prev, [id]: span };
							});
						}}
					>
						<KeyframeMarkers
							keyframes={keyframes}
							selectedKeyframeId={selectedKeyframeId}
							setSelectedKeyframeId={setSelectedKeyframeId}
							onKeyframeMove={handleKeyframeMove}
							videoDurationMs={totalMs}
							timelineRef={timelineContainerRef}
						/>
						<TimelineCanvas
							videoPath={videoPath}
							items={timelineItems}
							videoDurationMs={totalMs}
							currentTimeMs={currentTimeMs}
							onSeek={onSeek}
							onAddZoomAtMs={addZoomAtMs}
							canPlaceZoomAtMs={canPlaceZoomAtMs}
							onAddCaptionAtMs={addCaptionAtMs}
							canPlaceCaptionAtMs={canPlaceCaptionAtMs}
							resolveCaptionSpanAtMs={resolveCaptionSpanAtMs}
							captionsEnabled={captionsEnabled}
							captionQuickAddEnabled={captionQuickAddEnabled}
							onSelectZoom={handleSelectZoom}
							onSelectClip={handleSelectClip}
							onSelectAnnotation={handleSelectAnnotation}
							onSelectAudio={handleSelectAudio}
							onSelectCaption={handleSelectCaption}
							gestureTrackingEnabled={gestureTrackingEnabled}
							selectedGestureId={selectedGestureId}
							onSelectGesture={handleSelectGesture}
							selectedZoomId={selectedZoomId}
							selectedClipId={selectedClipId}
							hasCameraTrack={hasCameraTrack}
							cameraVideoPath={cameraVideoPath}
							showCameraAudioTrack={showCameraAudioTrack}
							cameraAudioPeaks={cameraAudioPeaks}
							cameraAudioVolume={cameraAudioVolume}
							cameraAudioMuted={cameraAudioMuted}
							cameraAudioLabel={cameraAudioLabel}
							selectedCameraId={selectedCameraId}
							onSelectCamera={handleSelectCamera}
							selectedAnnotationId={selectedAnnotationId}
							selectedAudioId={selectedAudioId}
							selectedCaptionId={selectedCaptionId}
							selectedAudioPortionId={selectedAudioPortionId}
							onSelectAudioPortion={handleSelectAudioPortion}
							canPlaceAudioPortionAtMs={canPlaceAudioPortionAtMs}
							onAddAudioPortionAtMs={addAudioPortionAtMs}
							selectAllBlocksActive={selectAllBlocksActive}
							onClearBlockSelection={clearSelectedBlocks}
							keyframes={keyframes}
							sourceAudioTracks={sourceAudioTracks}
							getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
							showSourceAudioTrack={showSourceAudioTrack}
							liveSpanPreviewById={liveZoomPreview.previewSpans}
							liveHiddenItemIds={Array.from(liveZoomPreview.hiddenZoomIds)}
							isDragging={isDragging}
							isLoading={isLoading}
						/>
					</TimelineWrapper>
				</div>
			</div>
		);
	},
);

TimelineEditor.displayName = "TimelineEditor";

export default TimelineEditor;
