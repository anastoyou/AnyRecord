import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import { toast } from "@/components/ui/toast";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useProjectSaveActions } from "./useProjectSaveActions";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	hasUnsavedChanges: boolean;
	setIsPlaying: Set<boolean>;
	setCurrentTime: Set<number>;
	setDuration: Set<number>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	openUnsavedChangesDialog: (actionLabel: string) => Promise<"save" | "discard" | "cancel">;
	saveProject: ReturnType<typeof useProjectSaveActions>["saveProject"];
	refreshProjectLibrary: () => Promise<void>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: null) => void;
	handleSaveProject: () => Promise<unknown>;
	handleSaveProjectAs: () => Promise<unknown>;
	authToken?: string;
};

export function useProjectOpenActions({
	project,
	appearance,
	videoPlaybackRef,
	pendingFreshRecordingAutoZoomPathRef,
	hasUnsavedChanges,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	applyLoadedProject,
	saveProject,
	refreshProjectLibrary,
	resetSourceScopedEditorState,
	applySessionPresentation,
	handleSaveProject,
	handleSaveProjectAs,
	authToken,
}: UseProjectOpenActionsInput) {
	const confirmReplaceSourceWithUnsavedChanges = useCallback(
		async (_actionLabel: string) => {
			if (!hasUnsavedChanges) return true;
			return saveProject(false, { remountPreviewAfterSave: false });
		},
		[hasUnsavedChanges, saveProject],
	);

	const handleOpenProjectFromLibrary = useCallback(
		async (targetProjectPath: string) => {
			if (!(await confirmReplaceSourceWithUnsavedChanges("open another project"))) return;
			try {
				let resolvedPath = targetProjectPath;
				if (resolvedPath.startsWith("cloud://")) {
					const projectId = resolvedPath.slice("cloud://".length);
					toast.info("Downloading cloud project and media...");
					const dlResult = await window.electronAPI.cloudinaryDownloadCloudProject({
						authToken,
						projectId,
					});
					if (!dlResult.success || !dlResult.localProjectPath) {
						throw new Error(dlResult.error || "Failed to download cloud project");
					}
					resolvedPath = dlResult.localProjectPath;
				}
				const result = await window.electronAPI.openProjectFileAtPath(resolvedPath);
				if (result.canceled) return;
				if (!result.success) {
					project.setError(result.error || result.message || "Failed to load project");
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError("Could not load project: invalid project file format");
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				project.setError(
					`Could not load project: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[
			applyLoadedProject,
			authToken,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
		],
	);

	const handleImportMediaOrProject = useCallback(async () => {
		if (!(await confirmReplaceSourceWithUnsavedChanges("import a file"))) return;
		try {
			const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
			if (result.canceled) return;
			if (!result.success) {
				toast.error(result.message || "Failed to import file");
				return;
			}
			if (result.kind === "project" || result.project) {
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError("Could not load project: invalid project file format");
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				toast.success(
					result.path ? `Project loaded from ${result.path}` : "Project loaded",
				);
				return;
			}
			if (!result.path) {
				toast.error("No media file selected");
				return;
			}

			const sourcePath = fromFileUrl(result.path);
			const setPathResult = await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: false,
			});
			if (!setPathResult.success) throw new Error("Could not load media");
			const sourceVideoUrl = await resolveVideoUrl(sourcePath);
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be tearing down.
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			project.setVideoSourcePath(sourcePath);
			project.setVideoPath(sourceVideoUrl);
			project.setCurrentProjectPath(null);
			project.setLastSavedSnapshot(null);
			resetSourceScopedEditorState();
			pendingFreshRecordingAutoZoomPathRef.current =
				appearance.autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
			appearance.setWebcam((previous) => ({
				...previous,
				visibleRanges: undefined,
				enabled: false,
				sourcePath: null,
				timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}));
			applySessionPresentation(null);
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success("Media imported");
		} catch (error) {
			project.setError(
				`Could not load file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}, [
		confirmReplaceSourceWithUnsavedChanges,
		applyLoadedProject,
		project,
		appearance,
		videoPlaybackRef,
		setIsPlaying,
		setCurrentTime,
		setDuration,
		resetSourceScopedEditorState,
		pendingFreshRecordingAutoZoomPathRef,
		applySessionPresentation,
		refreshProjectLibrary,
	]);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (project.projectBrowserOpen) {
			project.setProjectBrowserOpen(false);
			return;
		}
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		project.setProjectLibraryLoading(true);
		project.setProjectBrowserOpen(true);
		try {
			if (project.videoPath && !project.error) {
				await saveProject(false, {
					remountPreviewAfterSave: false,
					refreshLibraryAfterSave: false,
				});
			}
		} finally {
			await refreshProjectLibrary();
		}
	}, [
		project.projectBrowserOpen,
		project.setProjectBrowserOpen,
		project.setProjectLibraryLoading,
		refreshProjectLibrary,
		videoPlaybackRef,
		setIsPlaying,
		saveProject,
		project.videoPath,
		project.error,
	]);

	useEffect(() => {
		const openRequestedDashboard = () => {
			if (!localStorage.getItem("recordly.open-dashboard")) return;
			localStorage.removeItem("recordly.open-dashboard");
			if (!project.projectBrowserOpen) void handleOpenProjectBrowser();
		};
		openRequestedDashboard();
		window.addEventListener("storage", openRequestedDashboard);
		return () => window.removeEventListener("storage", openRequestedDashboard);
	}, [handleOpenProjectBrowser, project.projectBrowserOpen]);

	useEffect(() => {
		const removeLoad = window.electronAPI.onMenuLoadProject(
			() => void handleOpenProjectBrowser(),
		);
		const removeSave = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAs = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);
		return () => {
			removeLoad?.();
			removeSave?.();
			removeSaveAs?.();
		};
	}, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

	const handleDeleteProjects = useCallback(
		async (paths: string[]) => {
			const cloudPaths = paths.filter((p) => p.startsWith("cloud://"));
			const localPaths = paths.filter((p) => !p.startsWith("cloud://"));
			const deleted: string[] = [];

			if (
				cloudPaths.length > 0 &&
				authToken &&
				window.electronAPI.cloudinaryDeleteCloudProject
			) {
				for (const cp of cloudPaths) {
					const projectId = cp.replace("cloud://", "");
					try {
						const res = await window.electronAPI.cloudinaryDeleteCloudProject({
							authToken,
							projectId,
						});
						if (res.success) {
							deleted.push(cp);
						}
					} catch (e) {
						console.warn("Failed to delete cloud project", e);
					}
				}
			}

			if (localPaths.length > 0) {
				const result = await window.electronAPI.trashProjectFiles(localPaths);
				deleted.push(...result.deleted);
				if (
					project.currentProjectPath &&
					result.deleted.includes(project.currentProjectPath)
				) {
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
				}
				if (result.errors.length) toast.error(result.errors.join("\n"));
			}

			await refreshProjectLibrary();
			return deleted;
		},
		[authToken, project, refreshProjectLibrary],
	);
	const handleRenameLibraryProject = useCallback(
		async (path: string, name: string) => {
			let newPath = path;
			if (path.startsWith("cloud://")) {
				const projectId = path.replace("cloud://", "");
				if (authToken && window.electronAPI.cloudinaryRenameCloudProject) {
					const res = await window.electronAPI.cloudinaryRenameCloudProject({
						authToken,
						projectId,
						name,
					});
					if (!res.success) {
						throw new Error(res.error || "Could not rename cloud project");
					}
				}
			} else {
				const result = await window.electronAPI.renameLibraryProject(path, name);
				if (!result.success || !result.path)
					throw new Error(result.error || "Could not rename project");
				newPath = result.path;
				if (project.currentProjectPath === path) project.setCurrentProjectPath(result.path);

				const matchedEntry = project.projectLibraryEntries.find((e) => e.path === path);
				if (
					matchedEntry?.cloudProjectId &&
					authToken &&
					window.electronAPI.cloudinaryRenameCloudProject
				) {
					void window.electronAPI.cloudinaryRenameCloudProject({
						authToken,
						projectId: matchedEntry.cloudProjectId,
						name,
					});
				}
			}
			await refreshProjectLibrary();
			return newPath;
		},
		[authToken, project, refreshProjectLibrary],
	);

	return {
		handleRenameLibraryProject,
		handleOpenProjectFromLibrary,
		handleImportMediaOrProject,
		handleOpenProjectBrowser,
		handleDeleteProjects,
	};
}
