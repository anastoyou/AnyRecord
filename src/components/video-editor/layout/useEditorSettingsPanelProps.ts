import {
	type ComponentProps,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
} from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useClipAudioReset } from "../audio/useClipAudioReset";
import {
	createDefaultAudioPortion,
	clampAudioPortion,
	type AudioPortion,
} from "../audio/audioPortion";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAutoCaptionController } from "../captions/useAutoCaptionController";
import type { useGestureController } from "../gestures/useGestureController";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { type EditorEffectSection, mapTimelineTimeToSourceTime } from "../types";

const EMPTY_SOURCE_AUDIO_TRACK_META: NonNullable<
	ComponentProps<typeof SettingsPanel>["sourceAudioTrackMeta"]
> = [];
const EMPTY_SOURCE_AUDIO_TRACK_SETTINGS: NonNullable<
	ComponentProps<typeof SettingsPanel>["sourceAudioTrackSettings"]
> = {};

type Input = {
	activeEffectSection: EditorEffectSection;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	audio?: ReturnType<typeof useVideoEditorAudio>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	autoCaptionController: ReturnType<typeof useAutoCaptionController>;
	gestureController: ReturnType<typeof useGestureController>;
	effectiveShowCursor: boolean;
	handleShowCursorChange: (show: boolean) => void;
	currentTime: number;
	isPlaying: boolean;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress: number;
	isGeneratingCaptions: boolean;
	sessionNativeCaptureUnavailable: boolean;
	setNativeCaptureUnavailableModalOpen: Dispatch<SetStateAction<boolean>>;
	handleUploadWebcam: () => void;
	handleClearWebcam: () => void;
	duration?: number;
	onSeek?: (seconds: number) => void;
	videoSourcePath?: string | null;
};

export function useEditorSettingsPanelProps(input: Input): ComponentProps<typeof SettingsPanel> {
	const {
		activeEffectSection,
		appearance,
		timeline,
		zoomCommands,
		clipCommands,
		audioCommands,
		audio,
		captionCommands,
		annotationCommands,
		autoCaptionController,
		gestureController,
		effectiveShowCursor,
		handleShowCursorChange,
		currentTime,
		isPlaying,
		aspectRatio,
		setAspectRatio,
		whisperExecutablePath,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		sessionNativeCaptureUnavailable,
		setNativeCaptureUnavailableModalOpen,
		handleUploadWebcam,
		handleClearWebcam,
	} = input;
	const selectedZoom = timeline.zoomRegions.find(
		(region) => region.id === timeline.selectedZoomId,
	);
	const selectedClip = timeline.clipRegions.find(
		(region) => region.id === timeline.selectedClipId,
	);
	const selectedAudio = timeline.audioRegions.find(
		(region) => region.id === timeline.selectedAudioId,
	);

	const clipAudioReset = useClipAudioReset(timeline);
	const resetClipAudioRef = useRef(clipAudioReset.onResetClipAudio);
	resetClipAudioRef.current = clipAudioReset.onResetClipAudio;
	const onResetClipAudio = useCallback(() => {
		resetClipAudioRef.current();
	}, []);

	const sourceAudioTrackSettings =
		(timeline.selectedClipId
			? audio?.selectedClipSourceAudioTrackSettings
			: (audio?.activeSourceAudioTrackSettings ?? audio?.selectedClipSourceAudioTrackSettings)) ??
		EMPTY_SOURCE_AUDIO_TRACK_SETTINGS;

	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const durationRef = useRef(input.duration);
	durationRef.current = input.duration;
	const audioPortionsLengthRef = useRef(timeline.audioPortions.length);
	audioPortionsLengthRef.current = timeline.audioPortions.length;
	const selectedAudioPortionIdRef = useRef(timeline.selectedAudioPortionId);
	selectedAudioPortionIdRef.current = timeline.selectedAudioPortionId;
	const onSeekRef = useRef(input.onSeek);
	onSeekRef.current = input.onSeek;

	const showSourceAudioTrack = useMemo(
		() => timeline.clipRegions.some((clip) => clip.showSourceAudio),
		[timeline.clipRegions],
	);
	const handleShowSourceAudioTrackChange = useCallback(
		(show: boolean) => {
			timeline.setClipRegions((prev) => prev.map((clip) => ({ ...clip, showSourceAudio: show })));
		},
		[timeline.setClipRegions],
	);
	const onZoomDepthChange = useCallback(
		(
			depth: Parameters<NonNullable<ComponentProps<typeof SettingsPanel>["onZoomDepthChange"]>>[0],
		) => {
			if (timeline.selectedZoomId) {
				zoomCommands.handleZoomDepthChange(depth);
			}
		},
		[timeline.selectedZoomId, zoomCommands.handleZoomDepthChange],
	);
	const onZoomModeChange = useCallback(
		(
			mode: Parameters<NonNullable<ComponentProps<typeof SettingsPanel>["onZoomModeChange"]>>[0],
		) => {
			if (timeline.selectedZoomId) {
				zoomCommands.handleZoomModeChange(mode);
			}
		},
		[timeline.selectedZoomId, zoomCommands.handleZoomModeChange],
	);
	const onAudioPortionAdd = useCallback(() => {
		const portion = createDefaultAudioPortion(
			currentTimeRef.current * 1000,
			(durationRef.current ?? 60) * 1000,
			audioPortionsLengthRef.current + 1,
		);
		timeline.setAudioPortions((prev) => [...prev, portion]);
		timeline.setSelectedAudioPortionId(portion.id);
	}, [timeline.setAudioPortions, timeline.setSelectedAudioPortionId]);
	const onAudioPortionUpdate = useCallback(
		(id: string, patch: Partial<AudioPortion>) => {
			timeline.setAudioPortions((prev) =>
				prev.map((p) =>
					p.id === id
						? clampAudioPortion({ ...p, ...patch }, (durationRef.current ?? 60) * 1000)
						: p,
				),
			);
		},
		[timeline.setAudioPortions],
	);
	const onAudioPortionDelete = useCallback(
		(id: string) => {
			timeline.setAudioPortions((prev) => prev.filter((p) => p.id !== id));
			if (selectedAudioPortionIdRef.current === id) {
				timeline.setSelectedAudioPortionId(null);
			}
		},
		[timeline.setAudioPortions, timeline.setSelectedAudioPortionId],
	);
	const getTimelineCurrentTimeMs = useCallback(() => currentTimeRef.current * 1000, []);
	const onSeekToMs = useCallback((ms: number) => {
		onSeekRef.current?.(ms / 1000);
	}, []);
	const onOpenNativeCaptureUnavailableModal = useCallback(() => {
		setNativeCaptureUnavailableModalOpen(true);
	}, [setNativeCaptureUnavailableModalOpen]);

	return {
		hasClipAudioOverrides: clipAudioReset.hasClipAudioOverrides,
		onResetClipAudio,
		panelMode: "editor",
		activeEffectSection,
		selected: appearance.wallpaper,
		onWallpaperChange: appearance.setWallpaper,
		selectedZoomDepth: selectedZoom?.depth ?? null,
		onZoomDepthChange,
		selectedZoomId: timeline.selectedZoomId,
		selectedZoomMode: selectedZoom?.mode ?? (timeline.selectedZoomId ? "auto" : null),
		onZoomModeChange,
		onZoomDelete: zoomCommands.handleZoomDelete,
		selectedClipId: timeline.selectedClipId,
		selectedClipSpeed: selectedClip?.speed ?? (timeline.selectedClipId ? 1 : null),
		selectedClipMuted: selectedClip?.muted ?? (timeline.selectedClipId ? false : null),
		onClipSpeedChange: clipCommands.handleClipSpeedChange,
		onClipMutedChange: clipCommands.handleClipMutedChange,
		onClipDelete: clipCommands.handleClipDelete,
		selectedAudioId: timeline.selectedAudioId,
		selectedAudioVolume: selectedAudio?.volume ?? null,
		selectedAudioNormalize:
			selectedAudio?.normalize ?? (timeline.selectedAudioId ? false : null),
		onAudioVolumeChange: audioCommands.handleAudioVolumeChange,
		onAudioNormalizeChange: audioCommands.handleAudioNormalizeChange,
		onAudioDelete: audioCommands.handleAudioDelete,
		audioPortions: timeline.audioPortions,
		selectedAudioPortionId: timeline.selectedAudioPortionId,
		onSelectAudioPortion: timeline.setSelectedAudioPortionId,
		onAudioPortionAdd,
		onAudioPortionUpdate,
		onAudioPortionDelete,
		timelineCurrentTimeMs: 0,
		getTimelineCurrentTimeMs,
		onSeekToMs,
		sourceAudioTrackMeta: audio?.sourceAudioTrackMeta ?? EMPTY_SOURCE_AUDIO_TRACK_META,
		sourceAudioTrackSettings,
		onSourceAudioTrackVolumeChange: audio?.onSourceAudioTrackVolumeChange,
		onSourceAudioTrackNormalizeChange: audio?.onSourceAudioTrackNormalizeChange,
		showSourceAudioTrack,
		onShowSourceAudioTrackChange: handleShowSourceAudioTrackChange,
		shadowIntensity: appearance.shadowIntensity,
		onShadowChange: appearance.setShadowIntensity,
		backgroundBlur: appearance.backgroundBlur,
		onBackgroundBlurChange: appearance.setBackgroundBlur,
		autoApplyFreshRecordingAutoZooms: appearance.autoApplyFreshRecordingAutoZooms,
		onAutoApplyFreshRecordingAutoZoomsChange: appearance.setAutoApplyFreshRecordingAutoZooms,
		connectZooms: appearance.connectZooms,
		onConnectZoomsChange: appearance.setConnectZooms,
		zoomInDurationMs: appearance.zoomInDurationMs,
		onZoomInDurationMsChange: appearance.setZoomInDurationMs,
		zoomInOverlapMs: appearance.zoomInOverlapMs,
		onZoomInOverlapMsChange: appearance.setZoomInOverlapMs,
		zoomOutDurationMs: appearance.zoomOutDurationMs,
		onZoomOutDurationMsChange: appearance.setZoomOutDurationMs,
		connectedZoomGapMs: appearance.connectedZoomGapMs,
		onConnectedZoomGapMsChange: appearance.setConnectedZoomGapMs,
		connectedZoomDurationMs: appearance.connectedZoomDurationMs,
		onConnectedZoomDurationMsChange: appearance.setConnectedZoomDurationMs,
		zoomInEasing: appearance.zoomInEasing,
		onZoomInEasingChange: appearance.setZoomInEasing,
		zoomOutEasing: appearance.zoomOutEasing,
		onZoomOutEasingChange: appearance.setZoomOutEasing,
		connectedZoomEasing: appearance.connectedZoomEasing,
		onConnectedZoomEasingChange: appearance.setConnectedZoomEasing,
		showCursor: effectiveShowCursor,
		onShowCursorChange: handleShowCursorChange,
		loopCursor: appearance.loopCursor,
		onLoopCursorChange: appearance.setLoopCursor,
		cursorStyle: appearance.cursorStyle,
		onCursorStyleChange: appearance.setCursorStyle,
		cursorSize: appearance.cursorSize,
		onCursorSizeChange: appearance.setCursorSize,
		cursorSmoothing: appearance.cursorSmoothing,
		onCursorSmoothingChange: appearance.setCursorSmoothing,
		cursorSpringStiffnessMultiplier: appearance.cursorSpringStiffnessMultiplier,
		onCursorSpringStiffnessMultiplierChange: appearance.setCursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: appearance.cursorSpringDampingMultiplier,
		onCursorSpringDampingMultiplierChange: appearance.setCursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: appearance.cursorSpringMassMultiplier,
		onCursorSpringMassMultiplierChange: appearance.setCursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: appearance.cameraSpringStiffnessMultiplier,
		onCameraSpringStiffnessMultiplierChange: appearance.setCameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: appearance.cameraSpringDampingMultiplier,
		onCameraSpringDampingMultiplierChange: appearance.setCameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: appearance.cameraSpringMassMultiplier,
		onCameraSpringMassMultiplierChange: appearance.setCameraSpringMassMultiplier,
		zoomClassicMode: appearance.zoomClassicMode,
		onZoomClassicModeChange: appearance.setZoomClassicMode,
		cursorClickEffect: appearance.cursorClickEffect,
		cursorClickEffectColor: appearance.cursorClickEffectColor,
		onCursorClickEffectChange: appearance.setCursorClickEffect,
		onCursorClickEffectColorChange: appearance.setCursorClickEffectColor,
		cursorClickEffectScale: appearance.cursorClickEffectScale,
		onCursorClickEffectScaleChange: appearance.setCursorClickEffectScale,
		cursorClickEffectOpacity: appearance.cursorClickEffectOpacity,
		onCursorClickEffectOpacityChange: appearance.setCursorClickEffectOpacity,
		cursorClickEffectDurationMs: appearance.cursorClickEffectDurationMs,
		onCursorClickEffectDurationMsChange: appearance.setCursorClickEffectDurationMs,
		cursorClickBounce: appearance.cursorClickBounce,
		onCursorClickBounceChange: appearance.setCursorClickBounce,
		cursorClickBounceDuration: appearance.cursorClickBounceDuration,
		onCursorClickBounceDurationChange: appearance.setCursorClickBounceDuration,
		cursorSway: appearance.cursorSway,
		onCursorSwayChange: appearance.setCursorSway,
		borderRadius: appearance.borderRadius,
		onBorderRadiusChange: appearance.setBorderRadius,
		webcam: appearance.webcam,
		webcamPreviewSrc: appearance.webcam.sourcePath ? appearance.resolvedWebcamVideoUrl : null,
		webcamPreviewCurrentTime:
			activeEffectSection === "webcam" && !isPlaying
				? mapTimelineTimeToSourceTime(currentTime * 1000, timeline.clipRegions) / 1000
				: 0,
		webcamPreviewPlaying: isPlaying,
		onWebcamChange: appearance.setWebcam,
		onUploadWebcam: handleUploadWebcam,
		onClearWebcam: handleClearWebcam,
		padding: appearance.padding,
		onPaddingChange: appearance.setPadding,
		cropRegion: appearance.cropRegion,
		onCropChange: appearance.setCropRegion,
		aspectRatio,
		onAspectRatioChange: setAspectRatio,
		selectedAnnotationId: timeline.selectedAnnotationId,
		annotationRegions: timeline.annotationRegions,
		autoCaptions: timeline.autoCaptions,
		autoCaptionSettings: timeline.autoCaptionSettings,
		whisperExecutablePath,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		onAutoCaptionSettingsChange: timeline.setAutoCaptionSettings,
		onPickWhisperExecutable: autoCaptionController.handlePickWhisperExecutable,
		onPickWhisperModel: autoCaptionController.handlePickWhisperModel,
		onGenerateAutoCaptions: autoCaptionController.handleGenerateAutoCaptions,
		onClearAutoCaptions: captionCommands.handleClearAutoCaptions,
		captionCurrentTimeMs:
			activeEffectSection === "captions" || activeEffectSection === "caption"
				? mapTimelineTimeToSourceTime(currentTime * 1000, timeline.clipRegions)
				: 0,
		selectedCaptionId: timeline.selectedCaptionId,
		onBeginCaptionEdit: captionCommands.handleBeginCaptionEdit,
		onCaptionTextEdit: captionCommands.handleCaptionTextEdit,
		onCaptionRetime: captionCommands.handleCaptionRetime,
		onCaptionSplit: captionCommands.handleCaptionSplit,
		onCaptionMerge: captionCommands.handleCaptionMerge,
		onCaptionDelete: captionCommands.handleCaptionDelete,
		onDownloadWhisperSmallModel: autoCaptionController.handleDownloadWhisperSmallModel,
		onDeleteWhisperSmallModel: autoCaptionController.handleDeleteWhisperSmallModel,
		nativeCaptureUnavailableSession: sessionNativeCaptureUnavailable,
		onOpenNativeCaptureUnavailableModal,
		onAnnotationContentChange: annotationCommands.handleAnnotationContentChange,
		onAnnotationTypeChange: annotationCommands.handleAnnotationTypeChange,
		onAnnotationStyleChange: annotationCommands.handleAnnotationStyleChange,
		onAnnotationFigureDataChange: annotationCommands.handleAnnotationFigureDataChange,
		onAnnotationBlurIntensityChange: annotationCommands.handleAnnotationBlurIntensityChange,
		onAnnotationBlurColorChange: annotationCommands.handleAnnotationBlurColorChange,
		onAnnotationDelete: annotationCommands.handleAnnotationDelete,
		gestureRegions: timeline.gestureRegions,
		gestureSettings: timeline.gestureSettings,
		onGestureSettingsChange: timeline.setGestureSettings,
		onUpdateDefaultAttachment: gestureController.handleUpdateDefaultAttachment,
		onUpdateGestureRegions: gestureController.handleUpdateAllGestureRegions,
		selectedGestureId: timeline.selectedGestureId,
		onAnalyzeWebcamGestures: gestureController.handleAnalyzeWebcam,
		isAnalyzingGestures: gestureController.isAnalyzing,
		gestureAnalysisProgress: gestureController.analysisProgress,
		webcamSourcePath: appearance.webcam?.sourcePath || input.videoSourcePath || null,
		onSelectGestureRegion: gestureController.handleSelectGesture,
		onUpdateGestureRegion: gestureController.handleUpdateGestureRegion,
		onDeleteGestureRegion: gestureController.handleDeleteGestureRegion,
		onBackToGestures: gestureController.handleBackToGestures,
	};
}
