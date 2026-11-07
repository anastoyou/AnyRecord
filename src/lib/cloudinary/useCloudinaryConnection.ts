import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { purgeLegacyCloudinaryConfig } from "./cloudinaryConfig";

export type CloudinaryUiState =
	| "not_connected"
	| "connecting"
	| "connected"
	| "uploading"
	| "error"
	| "disconnected";

export type CloudinaryAccountInfo = {
	connected: boolean;
	state: "not_connected" | "connected" | "disconnected" | "revoked" | "error";
	cloudName: string | null;
	accountLabel: string | null;
	accountSub: string | null;
	scopes: string[];
	connectedAt: string | null;
	lastError: string | null;
};

export type CloudinaryMediaItem = {
	id: string;
	userId: string;
	cloudName: string;
	publicId: string;
	resourceType: "image" | "video";
	secureUrl: string;
	format: string | null;
	bytes: number;
	width: number | null;
	height: number | null;
	duration: number | null;
	folder: string | null;
	originalFilename: string | null;
	createdAt: string;
};

export type CloudinaryUploadItem = {
	uploadId: string;
	filePath: string;
	fileName: string;
	sizeBytes: number;
	uploadedBytes: number;
	progress: number;
	resourceType: "image" | "video";
	status: "queued" | "uploading" | "done" | "error" | "canceled";
	secureUrl?: string;
	publicId?: string;
	format?: string | null;
	width?: number | null;
	height?: number | null;
	duration?: number | null;
	error?: string;
	media?: CloudinaryMediaItem;
};

export type CloudinaryCloudProject = {
	id: string;
	userId: string;
	projectId: string;
	name: string;
	videoUrl: string;
	videoPublicId: string | null;
	thumbnailUrl: string | null;
	projectData: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

const EMPTY_ACCOUNT: CloudinaryAccountInfo = {
	connected: false,
	state: "not_connected",
	cloudName: null,
	accountLabel: null,
	accountSub: null,
	scopes: [],
	connectedAt: null,
	lastError: null,
};

function inferResourceTypeFromName(fileName: string): "image" | "video" {
	const lower = fileName.toLowerCase();
	if (
		lower.endsWith(".jpg") ||
		lower.endsWith(".jpeg") ||
		lower.endsWith(".png") ||
		lower.endsWith(".gif") ||
		lower.endsWith(".webp") ||
		lower.endsWith(".avif")
	) {
		return "image";
	}
	return "video";
}

export function useCloudinaryConnection(options?: {
	authToken?: string | null;
	accountId?: string | null;
}) {
	const authToken = options?.authToken ?? null;

	const [account, setAccount] = useState<CloudinaryAccountInfo>(EMPTY_ACCOUNT);
	const [loadingStatus, setLoadingStatus] = useState(true);
	const [isConnecting, setIsConnecting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [uploadItems, setUploadItems] = useState<CloudinaryUploadItem[]>([]);
	const [mediaItems, setMediaItems] = useState<CloudinaryMediaItem[]>([]);
	const [loadingMedia, setLoadingMedia] = useState(false);
	const [cloudProjects, setCloudProjects] = useState<CloudinaryCloudProject[]>([]);
	const [loadingCloudProjects, setLoadingCloudProjects] = useState(false);

	const authTokenRef = useRef<string | null>(authToken);
	authTokenRef.current = authToken;
	const hasLoadedStatusRef = useRef(false);
	const isConnectingRef = useRef(false);

	useEffect(() => {
		purgeLegacyCloudinaryConfig();
	}, []);

	const refreshMedia = useCallback(async (overrideToken?: string | null) => {
		const tokenToUse = overrideToken !== undefined ? overrideToken : authTokenRef.current;
		if (!tokenToUse) {
			setMediaItems([]);
			setLoadingMedia(false);
			return;
		}
		if (typeof window === "undefined" || !window.electronAPI?.cloudinaryListMedia) {
			return;
		}
		setLoadingMedia(true);
		try {
			const res = await window.electronAPI.cloudinaryListMedia({
				authToken: overrideToken !== undefined ? overrideToken : authTokenRef.current,
				limit: 100,
			});
			if (res.success && Array.isArray(res.media)) {
				setMediaItems(res.media);
			}
		} catch {
			// ignore background media list errors
		} finally {
			setLoadingMedia(false);
		}
	}, []);

	const refreshCloudProjects = useCallback(async (overrideToken?: string | null) => {
		const tokenToUse = overrideToken !== undefined ? overrideToken : authTokenRef.current;
		if (
			!tokenToUse ||
			typeof window === "undefined" ||
			!window.electronAPI?.cloudinaryListCloudProjects
		) {
			setCloudProjects([]);
			setLoadingCloudProjects(false);
			return;
		}
		setLoadingCloudProjects(true);
		try {
			const res = await window.electronAPI.cloudinaryListCloudProjects({
				authToken: tokenToUse,
			});
			if (res.success && Array.isArray(res.projects)) {
				setCloudProjects(res.projects);
			}
		} catch {
			// ignore background error
		} finally {
			setLoadingCloudProjects(false);
		}
	}, []);

	const saveCloudProject = useCallback(
		async (input: {
			projectId?: string;
			name?: string;
			projectData: unknown;
			thumbnailDataUrl?: string | null;
		}): Promise<{ success: boolean; project?: CloudinaryCloudProject; error?: string }> => {
			if (!authTokenRef.current) {
				return { success: false, error: "Sign in to AnyRecord to sync projects to cloud." };
			}
			if (!window.electronAPI?.cloudinarySaveCloudProject) {
				return { success: false, error: "Cloud sync is not supported in this environment." };
			}
			try {
				const res = await window.electronAPI.cloudinarySaveCloudProject({
					authToken: authTokenRef.current,
					...input,
				});
				if (res.success && res.project) {
					setCloudProjects((prev) => [
						res.project!,
						...prev.filter((p) => p.projectId !== res.project!.projectId),
					]);
					return { success: true, project: res.project };
				}
				return { success: false, error: res.error || "Failed to save cloud project" };
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				return { success: false, error };
			}
		},
		[],
	);

	const downloadCloudProject = useCallback(
		async (
			projectId: string,
		): Promise<{
			success: boolean;
			localProjectPath?: string;
			projectData?: unknown;
			error?: string;
		}> => {
			if (!authTokenRef.current) {
				return { success: false, error: "Sign in to AnyRecord to download cloud projects." };
			}
			if (!window.electronAPI?.cloudinaryDownloadCloudProject) {
				return {
					success: false,
					error: "Cloud download is not supported in this environment.",
				};
			}
			try {
				const res = await window.electronAPI.cloudinaryDownloadCloudProject({
					authToken: authTokenRef.current,
					projectId,
				});
				return res;
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				return { success: false, error };
			}
		},
		[],
	);

	const deleteCloudProject = useCallback(
		async (projectId: string): Promise<boolean> => {
			if (!authTokenRef.current || !window.electronAPI?.cloudinaryDeleteCloudProject) return false;
			try {
				const res = await window.electronAPI.cloudinaryDeleteCloudProject({
					authToken: authTokenRef.current,
					projectId,
				});
				if (res.success) {
					setCloudProjects((prev) => prev.filter((p) => p.projectId !== projectId));
					return true;
				}
				return false;
			} catch {
				return false;
			}
		},
		[],
	);

	const refreshStatus = useCallback(
		async (overrideToken?: string | null, silent = false) => {
			const tokenToUse = overrideToken !== undefined ? overrideToken : authTokenRef.current;
			if (!tokenToUse) {
				setAccount(EMPTY_ACCOUNT);
				setLoadingStatus(false);
				return;
			}
			if (typeof window === "undefined" || !window.electronAPI?.cloudinaryGetStatus) {
				setLoadingStatus(false);
				return;
			}
			if (!silent && !hasLoadedStatusRef.current) {
				setLoadingStatus(true);
			}
			try {
				const res = await window.electronAPI.cloudinaryGetStatus({
					authToken: tokenToUse,
				});
				hasLoadedStatusRef.current = true;
				if (res.success && res.status) {
					const s = res.status;
					const isConnected = Boolean(s.connected || s.state === "connected");
					setAccount({
						connected: isConnected,
						state: s.state,
						cloudName: s.cloudName ?? null,
						accountLabel: s.accountLabel ?? null,
						accountSub: s.accountSub ?? null,
						scopes: s.scopes ?? [],
						connectedAt: s.connectedAt ?? null,
						lastError: s.lastError ?? null,
					});
					if (isConnected) {
						setIsConnecting(false);
						setErrorMessage(null);
						void refreshMedia(tokenToUse);
					} else if (s.lastError) {
						setErrorMessage(s.lastError);
					}
				} else if (res.error) {
					setErrorMessage(res.error);
				}
			} catch (err) {
				setErrorMessage(
					err instanceof Error ? err.message : "Could not check Cloudinary status",
				);
			} finally {
				setLoadingStatus(false);
			}
		},
		[refreshMedia],
	);

	// Reset and reload whenever the active user (authToken) changes
	useEffect(() => {
		hasLoadedStatusRef.current = false;
		setAccount(EMPTY_ACCOUNT);
		setMediaItems([]);
		setUploadItems([]);
		setErrorMessage(null);
		setIsConnecting(false);
		void refreshStatus(authToken, false);
		void refreshMedia(authToken);
	}, [authToken, refreshStatus, refreshMedia]);

	// Listen for real-time OAuth callback notifications from Electron main process
	useEffect(() => {
		if (typeof window === "undefined" || !window.electronAPI?.onCloudinaryStatusChanged) {
			return;
		}
		return window.electronAPI.onCloudinaryStatusChanged((payload) => {
			isConnectingRef.current = false;
			setIsConnecting(false);
			if (payload.status) {
				const s = payload.status;
				const isConnected = Boolean(s.connected || s.state === "connected");
				setAccount({
					connected: isConnected,
					state: s.state,
					cloudName: s.cloudName ?? null,
					accountLabel: s.accountLabel ?? null,
					accountSub: s.accountSub ?? null,
					scopes: s.scopes ?? [],
					connectedAt: s.connectedAt ?? null,
					lastError: s.lastError ?? null,
				});
				if (isConnected) {
					setErrorMessage(null);
					void refreshMedia();
					void refreshCloudProjects();
				}
			}
			if (payload.error) {
				setErrorMessage(payload.error);
			}
		});
	}, [refreshMedia, refreshCloudProjects]);

	// Check status silently when window regains focus after browser authorization
	useEffect(() => {
		if (!isConnecting) return;
		const onFocus = () => {
			void refreshStatus(undefined, true);
		};
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("focus", onFocus);
		};
	}, [isConnecting, refreshStatus]);

	// Listen for upload byte progress events
	useEffect(() => {
		if (typeof window === "undefined" || !window.electronAPI?.onCloudinaryProgress) {
			return;
		}
		return window.electronAPI.onCloudinaryProgress((progress) => {
			setUploadItems((prev) =>
				prev.map((item) => {
					if (item.uploadId !== progress.uploadId) return item;
					const total = progress.totalBytes > 0 ? progress.totalBytes : item.sizeBytes;
					const ratio = total > 0 ? Math.min(1, progress.uploadedBytes / total) : 0;
					return {
						...item,
						uploadedBytes: progress.uploadedBytes,
						sizeBytes: total,
						progress: Math.max(item.progress, Math.min(99, Math.round(ratio * 100))),
					};
				}),
			);
		});
	}, []);

	const connect = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
		if (isConnectingRef.current) {
			return { success: false, error: "Cloudinary authorization is already in progress." };
		}
		if (!authTokenRef.current) {
			const msg = "Sign in to AnyRecord to connect your Cloudinary account.";
			setErrorMessage(msg);
			return { success: false, error: msg };
		}
		if (typeof window === "undefined" || !window.electronAPI?.cloudinaryStartOAuth) {
			const msg = "Cloudinary OAuth is not available in this environment.";
			setErrorMessage(msg);
			return { success: false, error: msg };
		}
		setErrorMessage(null);
		setIsConnecting(true);
		isConnectingRef.current = true;
		try {
			const res = await window.electronAPI.cloudinaryStartOAuth({
				authToken: authTokenRef.current,
			});
			if (!res.success) {
				const msg = res.error || "Failed to start Cloudinary OAuth authorization.";
				isConnectingRef.current = false;
				setIsConnecting(false);
				setErrorMessage(msg);
				return { success: false, error: msg };
			}
			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to start Cloudinary OAuth";
			isConnectingRef.current = false;
			setIsConnecting(false);
			setErrorMessage(msg);
			return { success: false, error: msg };
		}
	}, []);

	const cancelConnect = useCallback(() => {
		isConnectingRef.current = false;
		setIsConnecting(false);
	}, []);

	const disconnect = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
		isConnectingRef.current = false;
		if (typeof window === "undefined" || !window.electronAPI?.cloudinaryDisconnect) {
			return { success: false, error: "Disconnect not available" };
		}
		setErrorMessage(null);
		setIsConnecting(false);
		try {
			const res = await window.electronAPI.cloudinaryDisconnect({
				authToken: authTokenRef.current,
			});
			if (!res.success) {
				const msg = res.error || "Failed to disconnect Cloudinary account";
				setErrorMessage(msg);
				return { success: false, error: msg };
			}
			setAccount({
				connected: false,
				state: "disconnected",
				cloudName: null,
				accountLabel: null,
				accountSub: null,
				scopes: [],
				connectedAt: null,
				lastError: null,
			});
			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to disconnect";
			setErrorMessage(msg);
			return { success: false, error: msg };
		}
	}, []);

	const uploadFiles = useCallback(
		async (
			files: Array<{
				filePath: string;
				fileName?: string;
				sizeBytes?: number;
				resourceType?: "image" | "video" | null;
				title?: string;
				folder?: string;
			}>,
		): Promise<CloudinaryUploadItem[]> => {
			if (!authTokenRef.current) {
				const msg = "Sign in to AnyRecord before uploading to Cloudinary.";
				setErrorMessage(msg);
				return [];
			}
			if (!window.electronAPI?.cloudinaryUpload) {
				const msg = "Cloudinary upload is not available in this environment.";
				setErrorMessage(msg);
				return [];
			}
			if (files.length === 0) return [];

			setErrorMessage(null);

			const queued: CloudinaryUploadItem[] = files.map((f) => {
				const fileName = f.fileName || f.filePath.split(/[\\/]/).pop() || "media";
				return {
					uploadId: crypto.randomUUID(),
					filePath: f.filePath,
					fileName,
					sizeBytes: f.sizeBytes ?? 0,
					uploadedBytes: 0,
					progress: 0,
					resourceType: f.resourceType || inferResourceTypeFromName(fileName),
					status: "queued",
				};
			});

			setUploadItems((prev) => [...queued, ...prev]);

			const completedResults: CloudinaryUploadItem[] = [];

			for (let i = 0; i < queued.length; i += 1) {
				const item = queued[i];
				const inputSpec = files[i];

				setUploadItems((prev) =>
					prev.map((entry) =>
						entry.uploadId === item.uploadId
							? { ...entry, status: "uploading", progress: 2 }
							: entry,
					),
				);

				try {
					const result = await window.electronAPI.cloudinaryUpload({
						filePath: item.filePath,
						authToken: authTokenRef.current,
						folder: inputSpec.folder || "AnyRecord",
						title: inputSpec.title || item.fileName,
						uploadId: item.uploadId,
						resourceType: item.resourceType,
					});

					if (!result.success || (!result.secureUrl && !result.url)) {
						if (result.canceled) {
							const canceledItem: CloudinaryUploadItem = {
								...item,
								status: "canceled",
								progress: 0,
							};
							completedResults.push(canceledItem);
							setUploadItems((prev) =>
								prev.map((entry) =>
									entry.uploadId === item.uploadId ? canceledItem : entry,
								),
							);
							continue;
						}
						const errText = result.error || "Upload failed";
						const failedItem: CloudinaryUploadItem = {
							...item,
							status: "error",
							error: errText,
						};
						completedResults.push(failedItem);
						setErrorMessage(errText);
						setUploadItems((prev) =>
							prev.map((entry) =>
								entry.uploadId === item.uploadId ? failedItem : entry,
							),
						);
						void refreshStatus();
						continue;
					}

					const secureUrl = result.secureUrl || result.url || "";
					const publicId = result.publicId || "";
					const doneItem: CloudinaryUploadItem = {
						...item,
						status: "done",
						progress: 100,
						uploadedBytes: result.bytes ?? item.sizeBytes,
						sizeBytes: result.bytes ?? item.sizeBytes,
						resourceType: result.resourceType || item.resourceType,
						secureUrl,
						publicId,
						format: result.format ?? null,
						width: result.width ?? null,
						height: result.height ?? null,
						duration: result.duration ?? null,
						media: result.media,
					};
					completedResults.push(doneItem);

					setUploadItems((prev) =>
						prev.map((entry) => (entry.uploadId === item.uploadId ? doneItem : entry)),
					);

					const savedMedia = result.media;
					if (savedMedia) {
						setMediaItems((prev) => [
							savedMedia,
							...prev.filter((m) => m.id !== savedMedia.id),
						]);
					} else {
						void refreshMedia();
					}
				} catch (err) {
					const errText = err instanceof Error ? err.message : "Upload failed";
					const failedItem: CloudinaryUploadItem = {
						...item,
						status: "error",
						error: errText,
					};
					completedResults.push(failedItem);
					setErrorMessage(errText);
					setUploadItems((prev) =>
						prev.map((entry) =>
							entry.uploadId === item.uploadId ? failedItem : entry,
						),
					);
				}
			}

			return completedResults;
		},
		[refreshMedia, refreshStatus],
	);

	const pickAndUploadFiles = useCallback(
		async (options?: { folder?: string }): Promise<CloudinaryUploadItem[]> => {
			if (!window.electronAPI?.cloudinaryPickFiles) {
				setErrorMessage("File picker is not available in this environment.");
				return [];
			}
			const picked = await window.electronAPI.cloudinaryPickFiles();
			if (!picked.success || picked.canceled || picked.files.length === 0) {
				if (picked.error) {
					setErrorMessage(picked.error);
				}
				return [];
			}
			return uploadFiles(
				picked.files.map((f) => ({
					...f,
					folder: options?.folder || "AnyRecord",
				})),
			);
		},
		[uploadFiles],
	);

	const cancelUpload = useCallback(async (uploadId: string) => {
		if (window.electronAPI?.cloudinaryCancel) {
			await window.electronAPI.cloudinaryCancel(uploadId);
		}
		setUploadItems((prev) =>
			prev.map((item) =>
				item.uploadId === uploadId ? { ...item, status: "canceled", progress: 0 } : item,
			),
		);
	}, []);

	const clearCompletedUploads = useCallback(() => {
		setUploadItems((prev) =>
			prev.filter((item) => item.status === "uploading" || item.status === "queued"),
		);
	}, []);

	const deleteMedia = useCallback(async (mediaId: string): Promise<boolean> => {
		if (!window.electronAPI?.cloudinaryDeleteMedia) return false;
		const res = await window.electronAPI.cloudinaryDeleteMedia({
			authToken: authTokenRef.current,
			mediaId,
		});
		if (res.success) {
			setMediaItems((prev) => prev.filter((m) => m.id !== mediaId));
			return true;
		}
		if (res.error) {
			setErrorMessage(res.error);
		}
		return false;
	}, []);

	const activeUploads = useMemo(
		() =>
			uploadItems.filter((item) => item.status === "uploading" || item.status === "queued"),
		[uploadItems],
	);

	const isUploading = activeUploads.length > 0;

	const overallUploadProgress = useMemo(() => {
		if (activeUploads.length === 0) return 0;
		const sum = activeUploads.reduce((acc, item) => acc + item.progress, 0);
		return Math.round(sum / activeUploads.length);
	}, [activeUploads]);

	const uiState: CloudinaryUiState = useMemo(() => {
		if (isConnecting) return "connecting";
		if (isUploading) return "uploading";
		if (errorMessage && !account.connected) return "error";
		if (account.state === "error") return "error";
		if (account.connected) return "connected";
		if (account.state === "disconnected" || account.state === "revoked") {
			return "disconnected";
		}
		return "not_connected";
	}, [isConnecting, isUploading, errorMessage, account.connected, account.state]);

	return {
		uiState,
		account,
		loadingStatus,
		isConnecting,
		isUploading,
		overallUploadProgress,
		errorMessage,
		setErrorMessage,
		uploadItems,
		mediaItems,
		loadingMedia,
		connect,
		cancelConnect,
		disconnect,
		uploadFiles,
		pickAndUploadFiles,
		cancelUpload,
		clearCompletedUploads,
		refreshStatus,
		refreshMedia,
		deleteMedia,
		cloudProjects,
		loadingCloudProjects,
		refreshCloudProjects,
		saveCloudProject,
		downloadCloudProject,
		deleteCloudProject,
	};
}
