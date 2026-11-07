/* biome-ignore-all lint/correctness/useExhaustiveDependencies: grouped editor domain objects contain the thumbnail renderer dependencies. */
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { FrameRenderer } from "@/lib/exporter/frameRenderer";
import { PROJECT_THUMBNAIL_HEIGHT, PROJECT_THUMBNAIL_WIDTH } from "@/lib/projectThumbnail";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { toFileUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { getClipSourceEndMs, getClipSourceStartMs, type SpeedRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { findPreviewClipAtTimelineTime } from "../videoPlayback/clipPlayback";

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	currentTime: number;
	effectiveShowCursor: boolean;
	authToken?: string;
};

export function useProjectLibraryController({
	project,
	appearance,
	timeline,
	videoPlaybackRef,
	effectiveShowCursor,
	authToken,
}: Input) {
	const { setProjectLibraryEntries, setProjectLibraryLoading } = project;
	const {
		backgroundBlur,
		borderRadius,
		connectZooms,
		connectedZoomDurationMs,
		connectedZoomEasing,
		connectedZoomGapMs,
		cropRegion,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorMotionBlur,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		zoomSmoothness,
		cursorStyle,
		cursorSway,
		padding,
		resolvedWebcamVideoUrl,
		shadowIntensity,
		wallpaper,
		webcam,
		zoomInDurationMs,
		zoomInEasing,
		zoomInOverlapMs,
		zoomMotionBlur,
		zoomMotionBlurTuning,
		zoomOutDurationMs,
		zoomOutEasing,
		zoomClassicMode,
	} = appearance;
	const {
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		cursorTelemetry,
		clipRegions,
		speedRegions,
		zoomRegions,
	} = timeline;
	const thumbnailUpdates = useRef(
		new Map<string, { thumbnailPath: string; updatedAt: number }>(),
	);
	const refreshProjectLibrary = useCallback(async () => {
		setProjectLibraryLoading(true);
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) {
				throw new Error(result.error || "Failed to load project library");
			}

			let cloudProjects: Array<{
				id: string;
				userId: string;
				projectId: string;
				name: string;
				videoUrl: string;
				videoPublicId: string | null;
				thumbnailUrl: string | null;
				projectData: Record<string, unknown>;
				updatedAt: string;
			}> = [];
			const cloudProjectsById = new Map<string, (typeof cloudProjects)[number]>();
			const cloudProjectsByName = new Map<string, (typeof cloudProjects)[number]>();

			if (authToken && window.electronAPI.cloudinaryListCloudProjects) {
				try {
					const cloudResult = await window.electronAPI.cloudinaryListCloudProjects({
						authToken,
					});
					if (cloudResult.success && cloudResult.projects) {
						cloudProjects = cloudResult.projects;
						for (const p of cloudProjects) {
							if (p.projectId) {
								cloudProjectsById.set(p.projectId, p);
							}
							if (p.name) {
								cloudProjectsByName.set(p.name.trim().toLowerCase(), p);
							}
						}
					}
				} catch (cloudErr) {
					console.warn("Unable to fetch cloud projects:", cloudErr);
				}
			}

			const matchedCloudIds = new Set<string>();

			const localEntries = result.entries.map((entry) => {
				const ready = thumbnailUpdates.current.get(entry.path);
				const thumbnailPath =
					ready?.updatedAt === entry.updatedAt
						? ready.thumbnailPath
						: entry.thumbnailPath;

				const matchedCloud =
					(entry.projectId ? cloudProjectsById.get(entry.projectId) : undefined) ??
					cloudProjectsByName.get(entry.name.trim().toLowerCase());

				if (matchedCloud) {
					matchedCloudIds.add(matchedCloud.projectId);
					return {
						...entry,
						thumbnailPath: thumbnailPath || matchedCloud.thumbnailUrl || null,
						isCloud: true,
						cloudProjectId: matchedCloud.projectId,
					};
				}

				return {
					...entry,
					thumbnailPath,
				};
			});

			const remoteCloudEntries: ProjectLibraryEntry[] = cloudProjects
				.filter((p) => !matchedCloudIds.has(p.projectId))
				.map((p) => ({
					name: p.name,
					path: `cloud://${p.projectId}`,
					updatedAt: new Date(p.updatedAt).getTime(),
					thumbnailPath: p.thumbnailUrl || null,
					isCurrent: false,
					isInProjectsDirectory: false,
					isCloud: true,
					cloudProjectId: p.projectId,
				}));

			const combined = [...localEntries, ...remoteCloudEntries].sort(
				(a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
			);

			setProjectLibraryEntries(combined);
			const paths = new Set(result.entries.map((entry) => entry.path));
			for (const key of thumbnailUpdates.current.keys()) {
				if (!paths.has(key)) thumbnailUpdates.current.delete(key);
			}
		} catch (projectLibraryError) {
			console.warn("Unable to refresh project library:", projectLibraryError);
		} finally {
			setProjectLibraryLoading(false);
		}
	}, [authToken, setProjectLibraryEntries, setProjectLibraryLoading]);

	useEffect(
		() =>
			window.electronAPI.onProjectThumbnailReady?.((ready) => {
				thumbnailUpdates.current.set(ready.path, ready);
				setProjectLibraryEntries((entries) =>
					entries.map((entry) =>
						entry.path === ready.path && entry.updatedAt === ready.updatedAt
							? { ...entry, thumbnailPath: ready.thumbnailPath }
							: entry,
					),
				);
			}),
		[setProjectLibraryEntries],
	);

	const captureProjectThumbnail = useCallback(async () => {
		const previewHandle = videoPlaybackRef.current;
		const previewVideo = previewHandle?.video ?? null;

		const targetWidth = PROJECT_THUMBNAIL_WIDTH;
		const targetHeight = PROJECT_THUMBNAIL_HEIGHT;

		const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
		const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
		const frameTimestampUs = 0;

		if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
			let videoFrame: VideoFrame | null = null;
			let frameRenderer: FrameRenderer | null = null;
			const thumbnailVideo = document.createElement("video");

			try {
				const firstClip = findPreviewClipAtTimelineTime(0, clipRegions);
				const sourceSeconds = firstClip ? getClipSourceStartMs(firstClip) / 1000 : 0;
				thumbnailVideo.muted = true;
				thumbnailVideo.preload = "auto";
				await new Promise<void>((resolve, reject) => {
					const timeout = window.setTimeout(
						() => finish(new Error("Thumbnail decode timed out")),
						10000,
					);
					const finish = (error?: Error) => {
						clearTimeout(timeout);
						thumbnailVideo.onloadeddata = null;
						thumbnailVideo.onseeked = null;
						thumbnailVideo.onerror = null;
						error ? reject(error) : resolve();
					};
					thumbnailVideo.onerror = () =>
						finish(new Error("Thumbnail source unavailable"));
					thumbnailVideo.onloadeddata = () => {
						if (sourceSeconds > 0) {
							thumbnailVideo.onseeked = () => finish();
							thumbnailVideo.currentTime = sourceSeconds;
						} else finish();
					};
					thumbnailVideo.src = previewVideo.currentSrc || previewVideo.src;
				});
				const sourceTimestampUs = sourceSeconds * 1_000_000;
				if (findPreviewClipAtTimelineTime(frameTimestampUs / 1000, clipRegions)) {
					videoFrame = new VideoFrame(thumbnailVideo, { timestamp: sourceTimestampUs });
				}
				frameRenderer = new FrameRenderer({
					timelineEffects: true,
					width: targetWidth,
					height: targetHeight,
					wallpaper,
					zoomRegions,
					showShadow: shadowIntensity > 0,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					zoomMotionBlurTuning,
					connectZooms,
					zoomInDurationMs,
					zoomInOverlapMs,
					zoomOutDurationMs,
					connectedZoomGapMs,
					connectedZoomDurationMs,
					zoomInEasing,
					zoomOutEasing,
					connectedZoomEasing,
					borderRadius,
					padding,
					cropRegion,
					webcam,
					webcamUrl:
						resolvedWebcamVideoUrl ??
						(webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
					videoWidth: previewVideo.videoWidth,
					videoHeight: previewVideo.videoHeight,
					annotationRegions,
					autoCaptions,
					autoCaptionSettings,
					speedRegions: (() => {
						const clipDerived: SpeedRegion[] = clipRegions
							.filter((clip) => clip.speed !== 1)
							.map((clip) => ({
								id: `clip-speed-${clip.id}`,
								startMs: getClipSourceStartMs(clip),
								endMs: getClipSourceEndMs(clip),
								speed: clip.speed as SpeedRegion["speed"],
							}));
						if (clipDerived.length === 0) return speedRegions;
						const result = [...speedRegions];
						for (const cs of clipDerived) {
							const overlaps = speedRegions.some(
								(sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
							);
							if (!overlaps) {
								result.push(cs);
							}
						}
						return result;
					})(),
					previewWidth,
					previewHeight,
					cursorTelemetry,
					showCursor: effectiveShowCursor,
					cursorStyle,
					cursorSize,
					cursorSmoothing,
					cursorSpringStiffnessMultiplier,
					cursorSpringDampingMultiplier,
					cursorSpringMassMultiplier,
					cameraSpringStiffnessMultiplier,
					cameraSpringDampingMultiplier,
					cameraSpringMassMultiplier,
					zoomSmoothness,
					zoomClassicMode,
					cursorMotionBlur,
					cursorClickEffect,
					cursorClickEffectColor,
					cursorClickEffectScale,
					cursorClickEffectOpacity,
					cursorClickEffectDurationMs,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
				});
				await frameRenderer.initialize();
				await frameRenderer.renderFrame(
					videoFrame,
					sourceTimestampUs,
					sourceTimestampUs,
					undefined,
					frameTimestampUs,
				);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch (thumbnailRenderError) {
				console.warn(
					"Unable to render thumbnail from composed frame:",
					thumbnailRenderError,
				);
			} finally {
				videoFrame?.close();
				frameRenderer?.destroy();
				thumbnailVideo.removeAttribute("src");
				thumbnailVideo.load();
			}
		}

		return null;
	}, [
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		backgroundBlur,
		borderRadius,
		connectZooms,
		connectedZoomDurationMs,
		connectedZoomEasing,
		connectedZoomGapMs,
		cropRegion,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorMotionBlur,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		zoomSmoothness,
		cursorStyle,
		cursorSway,
		cursorTelemetry,
		clipRegions,
		padding,
		resolvedWebcamVideoUrl,
		shadowIntensity,
		effectiveShowCursor,
		speedRegions,
		wallpaper,
		webcam,
		zoomInDurationMs,
		zoomInEasing,
		zoomInOverlapMs,
		zoomMotionBlur,
		zoomMotionBlurTuning,
		zoomOutDurationMs,
		zoomOutEasing,
		zoomRegions,
		zoomClassicMode,
	]);

	return { refreshProjectLibrary, captureProjectThumbnail };
}
