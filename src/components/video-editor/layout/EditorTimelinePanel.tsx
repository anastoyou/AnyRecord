import type { RefObject } from "react";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { retimeCaptionFragment } from "../captionTimeline";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCameraRegionCommands } from "../hooks/useCameraRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useTimelineState } from "../state/useTimelineState";
import TimelineEditor, { type TimelineEditorHandle } from "../timeline/TimelineEditor";

type Props = {
	panelRef?: RefObject<HTMLDivElement | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	timeline: ReturnType<typeof useTimelineState>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	cameraCommands?: ReturnType<typeof useCameraRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	videoPath: string | null;
	videoSourcePath: string | null;
	cameraVideoPath?: string | null;
	hasCameraTrack?: boolean;
	showCameraAudioTrack?: boolean;
	cameraAudioVolume?: number;
	cameraAudioMuted?: boolean;
	cursorTelemetrySourcePath: string | null;
	normalizedCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	autoSuggestZoomsTrigger: number;
	handleAutoSuggestZoomsConsumed: () => void;
	disableSuggestedZooms: boolean;
	currentTime: number;
	handleSelectAnnotation: (id: string | null) => void;
	onOpenAudioSection?: () => void;
};

export function EditorTimelinePanel(props: Props) {
	const {
		timelineRef,
		timeline,
		projection,
		playback,
		audio,
		zoomCommands,
		clipCommands,
		cameraCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		videoPath,
		videoSourcePath,
		cameraVideoPath,
		hasCameraTrack = false,
		showCameraAudioTrack = false,
		cameraAudioVolume = 1,
		cameraAudioMuted = false,
		cursorTelemetrySourcePath,
		normalizedCursorTelemetry,
		autoSuggestZoomsTrigger,
		handleAutoSuggestZoomsConsumed,
		disableSuggestedZooms,
		currentTime,
		handleSelectAnnotation,
	} = props;

	return (
		<div
			ref={props.panelRef}
			tabIndex={-1}
			data-timeline-panel
			className="outline-none flex flex-shrink-0 flex-col bg-transparent px-4 pb-4 pt-2"
			style={{ height: "22%", minHeight: 180, maxHeight: 280 }}
		>
			<TimelineEditor
				ref={timelineRef}
				videoDuration={projection.timelineDuration}
				currentTime={currentTime}
				playheadTime={projection.timelinePlayheadTime}
				onSeek={playback.handleTimelineSeek}
				videoPath={videoPath}
				videoSourcePath={videoSourcePath}
				cursorTelemetrySourcePath={cursorTelemetrySourcePath}
				cursorTelemetry={normalizedCursorTelemetry}
				autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
				onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
				disableSuggestedZooms={disableSuggestedZooms}
				zoomRegions={timeline.zoomRegions}
				onZoomAdded={zoomCommands.handleZoomAdded}
				onZoomSuggested={zoomCommands.handleZoomSuggested}
				onZoomSpanChange={zoomCommands.handleZoomSpanChange}
				onZoomDelete={zoomCommands.handleZoomDelete}
				selectedZoomId={timeline.selectedZoomId}
				onSelectZoom={zoomCommands.handleSelectZoom}
				trimRegions={timeline.trimRegions}
				clipRegions={timeline.clipRegions}
				onClipSplit={clipCommands.handleClipSplit}
				onClipDelete={clipCommands.handleClipDelete}
				onClipSpanChange={clipCommands.handleClipSpanChange}
				selectedClipId={timeline.selectedClipId}
				onSelectClip={clipCommands.handleSelectClip}
				hasCameraTrack={hasCameraTrack}
				cameraVideoPath={cameraVideoPath}
				showCameraAudioTrack={showCameraAudioTrack}
				cameraAudioVolume={cameraAudioVolume}
				cameraAudioMuted={cameraAudioMuted}
				cameraRegions={cameraCommands?.cameraRegions}
				onCameraSplit={cameraCommands?.handleCameraSplit}
				onCameraSpanChange={cameraCommands?.handleCameraSpanChange}
				onCameraDelete={cameraCommands?.handleCameraDelete}
				selectedCameraId={cameraCommands?.selectedCameraId}
				onSelectCamera={cameraCommands?.handleSelectCamera}
				audioRegions={timeline.audioRegions}
				onAudioAdded={audioCommands.handleAudioAdded}
				onAudioSpanChange={audioCommands.handleAudioSpanChange}
				onAudioDelete={audioCommands.handleAudioDelete}
				selectedAudioId={timeline.selectedAudioId}
				onSelectAudio={audioCommands.handleSelectAudio}
				audioPortions={timeline.audioPortions}
				selectedAudioPortionId={timeline.selectedAudioPortionId}
				onSelectAudioPortion={(id) => {
					timeline.setSelectedAudioPortionId(id);
					if (id) {
						timeline.setSelectedZoomId(null);
						timeline.setSelectedAnnotationId(null);
						timeline.setSelectedClipId(null);
						timeline.setSelectedCaptionId(null);
						timeline.setSelectedAudioId(null);
						props.onOpenAudioSection?.();
					}
				}}
				onAudioPortionSpanChange={(id, span) => {
					timeline.updateAudioPortion(id, {
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					});
				}}
				onAudioPortionDelete={(id) => {
					timeline.removeAudioPortion(id);
				}}
				onAudioPortionAdded={(span) => {
					const id = `portion-${Date.now()}`;
					timeline.addAudioPortion({
						id,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
						volume: 1.5,
						label: "Sound 150%",
					});
				}}
				captionRegions={projection.effectiveCaptionRegions}
				onCaptionSpanChange={(id, span) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (!fragment) return;
					captionCommands.handleCaptionRetime(
						fragment.sourceCueId,
						retimeCaptionFragment(fragment, span),
					);
				}}
				selectedCaptionId={
					projection.effectiveCaptionRegions.find(
						(cue) =>
							cue.sourceCueId === timeline.selectedCaptionId &&
							currentTime * 1000 >= cue.startMs &&
							currentTime * 1000 < cue.endMs,
					)?.id ??
					projection.effectiveCaptionRegions.find(
						(cue) => cue.sourceCueId === timeline.selectedCaptionId,
					)?.id ??
					null
				}
				onSelectCaption={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					captionCommands.handleSelectCaption(fragment?.sourceCueId ?? null);
					if (fragment) playback.handleTimelineSeek(fragment.startMs / 1000);
				}}
				onCaptionDelete={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (fragment) captionCommands.handleCaptionDelete(fragment.sourceCueId);
				}}
				onCaptionAdded={captionCommands.handleCaptionAdded}
				captionsEnabled={timeline.autoCaptionSettings.enabled}
				captionQuickAddEnabled={timeline.autoCaptionSettings.timelineQuickAdd}
				annotationRegions={timeline.annotationRegions}
				onAnnotationAdded={annotationCommands.handleAnnotationAdded}
				onAnnotationSpanChange={annotationCommands.handleAnnotationSpanChange}
				onAnnotationDelete={annotationCommands.handleAnnotationDelete}
				selectedAnnotationId={timeline.selectedAnnotationId}
				onSelectAnnotation={handleSelectAnnotation}
				gestureRegions={timeline.gestureRegions}
				gestureTrackingEnabled={timeline.gestureSettings.enabled}
				selectedGestureId={timeline.selectedGestureId}
				onSelectGesture={timeline.setSelectedGestureId}
				onGestureSpanChange={(id, span) => {
					timeline.updateGestureRegion(id, {
						startMs: span.start,
						endMs: span.end,
					});
				}}
				onGestureDelete={(id) => {
					timeline.removeGestureRegion(id);
				}}
				showSourceAudioTrack={timeline.clipRegions.some((clip) => clip.showSourceAudio)}
				sourceAudioResourceVersion={timeline.sourceAudioFallbackRefreshKey}
				sourceAudioTrackSettings={audio.activeSourceAudioTrackSettings}
				getSourceAudioTrackSettingsForClip={audio.getSourceAudioTrackSettingsForClip}
				onSourceAudioAvailabilityChange={timeline.setHasClipSourceAudio}
				onSourceAudioTracksMetaChange={audio.onSourceAudioTracksMetaChange}
			/>
		</div>
	);
}
