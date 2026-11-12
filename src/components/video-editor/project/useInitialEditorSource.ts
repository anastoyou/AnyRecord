/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor state setters are stable and initial source loading intentionally runs once per launch configuration. */
import { type MutableRefObject, useEffect, useRef } from "react";
import { loadNoiseSuppressionPreferences } from "@/hooks/useNoiseSuppressionPreferences";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";

type SessionPresentation = {
	hideOverlayCursorByDefault?: boolean;
	nativeCaptureUnavailable?: boolean;
	recordingMode?: "screen-camera" | "camera-only" | "screen-only";
};

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	videoSourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: SessionPresentation | null | undefined) => void;
};

export function useInitialEditorSource({
	project,
	appearance,
	timeline,
	smokeConfig,
	devConfig,
	videoSourcePath,
	pendingFreshRecordingAutoZoomPathRef,
	applyLoadedProject,
	resetSourceScopedEditorState,
	applySessionPresentation,
}: Input) {
	const initialLoadStartedRef = useRef(false);

	useEffect(() => {
		// This effect owns launch-time hydration. Several of the callbacks it uses
		// intentionally close over live editor state, so their identities may change
		// after hydration updates that state. Never interpret that as a request to
		// reload the source and reset the editor again.
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;

		async function loadInitialData() {
			try {
				if (smokeConfig.enabled && smokeConfig.projectPath) {
					const result = await window.electronAPI.openProjectFileAtPath(
						smokeConfig.projectPath,
					);
					if (!result.success || !result.project) {
						project.setError(
							`Smoke export failed to load project ${smokeConfig.projectPath}: ${result.error || result.message || "unknown error"}`,
						);
						return;
					}
					if (
						!(await applyLoadedProject(
							result.project,
							result.path ?? smokeConfig.projectPath,
						))
					) {
						project.setError(
							`Smoke export could not apply project ${smokeConfig.projectPath}`,
						);
						return;
					}
					project.setError(null);
					return;
				}

				if (!smokeConfig.enabled && devConfig.inputPath) {
					const sourcePath = fromFileUrl(devConfig.inputPath);
					const webcamPath = devConfig.webcamInputPath
						? fromFileUrl(devConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					const nsPrefs = loadNoiseSuppressionPreferences();
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						noiseSuppressionEnabled:
							nsPrefs.enabled || nsPrefs.webcamNoiseSuppressionEnabled,
						noiseSuppressionLevel:
							nsPrefs.level > 0 ? nsPrefs.level : nsPrefs.webcamNoiseSuppressionLevel,
					}));
					project.setError(null);
					return;
				}

				if (smokeConfig.enabled) {
					if (!smokeConfig.inputPath) {
						project.setError("Smoke export input path is missing.");
						return;
					}
					const sourcePath = fromFileUrl(smokeConfig.inputPath);
					const webcamPath = smokeConfig.webcamInputPath
						? fromFileUrl(smokeConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current = null;
					const nsPrefs = loadNoiseSuppressionPreferences();
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						shadow: smokeConfig.webcamShadow ?? previous.shadow,
						size: smokeConfig.webcamSize ?? previous.size,
						width: smokeConfig.webcamSize ?? previous.width ?? previous.size,
						height: smokeConfig.webcamSize ?? previous.height ?? previous.size,
						noiseSuppressionEnabled:
							nsPrefs.enabled || nsPrefs.webcamNoiseSuppressionEnabled,
						noiseSuppressionLevel:
							nsPrefs.level > 0 ? nsPrefs.level : nsPrefs.webcamNoiseSuppressionLevel,
					}));
					project.setError(null);
					return;
				}

				const currentProject = await window.electronAPI.loadCurrentProjectFile();
				if (
					currentProject.success &&
					currentProject.project &&
					(await applyLoadedProject(currentProject.project, currentProject.path ?? null))
				) {
					return;
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceUrl = await resolveVideoUrl(sourcePath);
					const latestSessionResult =
						await window.electronAPI.getCurrentRecordingSession?.();
					const activeSession =
						latestSessionResult?.success &&
						latestSessionResult.session?.videoPath &&
						fromFileUrl(latestSessionResult.session.videoPath) === sourcePath
							? latestSessionResult.session
							: sessionResult.session;
					const resolvedWebcamPath = activeSession?.webcamPath
						? fromFileUrl(activeSession.webcamPath)
						: null;
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					applySessionPresentation(activeSession);
					const isCameraOnly = activeSession?.recordingMode === "camera-only";
					project.setRecordingMode(activeSession?.recordingMode ?? null);
					if (isCameraOnly) {
						appearance.setPadding({ top: 0, bottom: 0, left: 0, right: 0, linked: true });
						appearance.setBorderRadius(0);
						appearance.setShadowIntensity(0);
						appearance.setShowCursor(false);
					}
					const nsPrefs = loadNoiseSuppressionPreferences();
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: !isCameraOnly && Boolean(resolvedWebcamPath),
						sourcePath: isCameraOnly ? null : resolvedWebcamPath,
						timeOffsetMs:
							activeSession?.timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS,
						noiseSuppressionEnabled:
							nsPrefs.enabled || nsPrefs.webcamNoiseSuppressionEnabled,
						noiseSuppressionLevel:
							nsPrefs.level > 0 ? nsPrefs.level : nsPrefs.webcamNoiseSuppressionLevel,
					}));
					return;
				}

				const currentVideo = await window.electronAPI.getCurrentVideoPath();
				if (!currentVideo.success || !currentVideo.path) {
					// An empty session is the normal dashboard launch, not a load failure.
					project.setProjectBrowserOpen(true);
					return;
				}
				const sourcePath = fromFileUrl(currentVideo.path);
				project.setVideoSourcePath(sourcePath);
				project.setVideoPath(await resolveVideoUrl(sourcePath));
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
				resetSourceScopedEditorState();
				pendingFreshRecordingAutoZoomPathRef.current = null;
				applySessionPresentation(null);
				appearance.setWebcam((previous) => ({
					...previous,
					visibleRanges: undefined,
					enabled: false,
					sourcePath: null,
					timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
				}));
			} catch (error) {
				project.setError(`Error loading video: ${String(error)}`);
			} finally {
				project.setLoading(false);
			}
		}
		void loadInitialData();
	}, [
		applyLoadedProject,
		applySessionPresentation,
		devConfig,
		resetSourceScopedEditorState,
		smokeConfig,
	]);

	useEffect(() => {
		const applyRecordingSession = (
			session:
				| {
						videoPath?: string | null;
						webcamPath?: string | null;
						timeOffsetMs?: number;
						recordingMode?: "screen-camera" | "camera-only" | "screen-only";
				  }
				| null
				| undefined,
		) => {
			const sessionSourcePath = session?.videoPath ? fromFileUrl(session.videoPath) : null;
			const webcamPath = session?.webcamPath ? fromFileUrl(session.webcamPath) : null;
			if (!session || !videoSourcePath || sessionSourcePath !== videoSourcePath) return;
			const isCameraOnly = session.recordingMode === "camera-only";
			project.setRecordingMode(session.recordingMode ?? null);
			if (isCameraOnly) {
				appearance.setPadding({ top: 0, bottom: 0, left: 0, right: 0, linked: true });
				appearance.setBorderRadius(0);
				appearance.setShadowIntensity(0);
				appearance.setShowCursor(false);
			}
			const nsPrefs = loadNoiseSuppressionPreferences();
			appearance.setWebcam((previous) => {
				if (isCameraOnly) {
					if (!previous.enabled && !previous.sourcePath) return previous;
					return {
						...previous,
						visibleRanges: undefined,
						enabled: false,
						sourcePath: null,
					};
				}
				if (previous.sourcePath === webcamPath && previous.enabled === Boolean(webcamPath)) {
					return previous;
				}
				return {
					...previous,
					visibleRanges: undefined,
					enabled: Boolean(webcamPath),
					sourcePath: webcamPath,
					timeOffsetMs: webcamPath
						? (session.timeOffsetMs ?? previous.timeOffsetMs)
						: DEFAULT_WEBCAM_TIME_OFFSET_MS,
					noiseSuppressionEnabled:
						nsPrefs.enabled || nsPrefs.webcamNoiseSuppressionEnabled,
					noiseSuppressionLevel:
						nsPrefs.level > 0 ? nsPrefs.level : nsPrefs.webcamNoiseSuppressionLevel,
				};
			});
			timeline.setSourceAudioFallbackRefreshKey((key) => key + 1);
		};

		if (videoSourcePath && window.electronAPI.getCurrentRecordingSession) {
			void window.electronAPI.getCurrentRecordingSession().then((result) => {
				if (result?.success && result.session) {
					applyRecordingSession(result.session);
				}
			});
		}

		if (!window.electronAPI.onRecordingSessionChanged) return;
		return window.electronAPI.onRecordingSessionChanged(applyRecordingSession);
	}, [videoSourcePath, appearance.setWebcam, timeline.setSourceAudioFallbackRefreshKey]);

	useEffect(() => {
		let cancelled = false;
		if (!appearance.webcam.sourcePath) {
			appearance.setResolvedWebcamVideoUrl(null);
			return;
		}
		void resolveVideoUrl(appearance.webcam.sourcePath).then((url) => {
			if (!cancelled) appearance.setResolvedWebcamVideoUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [appearance.webcam.sourcePath, appearance.setResolvedWebcamVideoUrl]);

	useEffect(() => {
		if (!appearance.autoApplyFreshRecordingAutoZooms) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [appearance.autoApplyFreshRecordingAutoZooms, pendingFreshRecordingAutoZoomPathRef]);
}
