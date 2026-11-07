import { ProgressBar } from "@heroui/react";
import { CloudArrowUp, Copy, LinkSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import {
	type CloudinaryUploadItem,
	useCloudinaryConnection,
} from "@/lib/cloudinary/useCloudinaryConnection";
import { copyTextToClipboard } from "@/utils/clipboard";

type Props = {
	projectPath?: string | null;
	projectTitle: string;
	exportFormat?: "mp4" | "gif";
	prepareFile?: () => Promise<string | undefined>;
	preparationProgress?: number;
	onCancelPrepare?: () => void;
	onBusyChange?: (busy: boolean) => void;
	authToken?: string;
	accountId?: string;
	onRequestSignIn?: () => void;
};

export function CloudinaryShareButton({
	projectTitle,
	exportFormat = "mp4",
	prepareFile,
	preparationProgress = 0,
	onCancelPrepare,
	onBusyChange,
	authToken,
	accountId,
	onRequestSignIn,
}: Props) {
	const {
		uiState,
		account,
		loadingStatus,
		isConnecting,
		isUploading,
		overallUploadProgress,
		errorMessage,
		setErrorMessage,
		uploadItems,
		connect,
		cancelConnect,
		disconnect,
		uploadFiles,
		pickAndUploadFiles,
		cancelUpload,
	} = useCloudinaryConnection({ authToken, accountId });

	const [preparingRecording, setPreparingRecording] = useState(false);
	const [copied, setCopied] = useState(false);
	const [lastUploadedItem, setLastUploadedItem] = useState<CloudinaryUploadItem | null>(null);

	const preparedFileRef = useRef<string | undefined>(undefined);

	const isBusy = preparingRecording || isUploading;
	useEffect(() => {
		onBusyChange?.(isBusy);
	}, [isBusy, onBusyChange]);

	const discardPreparedFile = useCallback(() => {
		const preparedPath = preparedFileRef.current;
		preparedFileRef.current = undefined;
		if (preparedPath && window.electronAPI?.discardExportedTemp) {
			void window.electronAPI.discardExportedTemp(preparedPath);
		}
	}, []);

	useEffect(() => discardPreparedFile, [discardPreparedFile]);

	const handleConnect = async () => {
		if (!authToken) {
			onRequestSignIn?.();
			return;
		}
		const res = await connect();
		if (!res.success && res.error) {
			toast.error(res.error);
		}
	};

	const handleDisconnect = async () => {
		const res = await disconnect();
		if (res.success) {
			setLastUploadedItem(null);
		} else if (res.error) {
			toast.error(res.error);
		}
	};

	const handleShare = async () => {
		if (!authToken) {
			onRequestSignIn?.();
			return;
		}
		if (!account.connected) {
			await handleConnect();
			return;
		}

		setErrorMessage(null);
		setLastUploadedItem(null);
		setCopied(false);

		if (!prepareFile) {
			const results = await pickAndUploadFiles({ folder: "AnyRecord" });
			const first = results.find((r) => r.status === "done" && r.secureUrl);
			if (first?.secureUrl) {
				setLastUploadedItem(first);
				void copyTextToClipboard(first.secureUrl).then((success) => {
					if (success) {
						setCopied(true);
						toast.success("Link created and copied to clipboard!");
					} else {
						toast.success("Link created");
					}
				});
			}
			return;
		}

		setPreparingRecording(true);
		try {
			const resolvedFilePath = await prepareFile();
			if (!resolvedFilePath) {
				throw new Error("Could not prepare video for upload.");
			}
			preparedFileRef.current = resolvedFilePath;
			setPreparingRecording(false);

			const ext = exportFormat === "gif" ? "gif" : "mp4";
			const resourceType = exportFormat === "gif" ? "image" : "video";

			const results = await uploadFiles([
				{
					filePath: resolvedFilePath,
					fileName: `${projectTitle || "recording"}.${ext}`,
					resourceType,
					title: projectTitle,
					folder: "AnyRecord",
				},
			]);

			const first = results[0];
			if (first?.status === "done" && first.secureUrl) {
				setLastUploadedItem(first);
				void copyTextToClipboard(first.secureUrl).then((success) => {
					if (success) {
						setCopied(true);
						toast.success("Link created and copied to clipboard!");
					} else {
						toast.success("Link created");
					}
				});
			} else if (first?.error) {
				toast.error(first.error);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Upload failed";
			setErrorMessage(msg);
		} finally {
			setPreparingRecording(false);
			discardPreparedFile();
		}
	};

	const handleCancelActive = async () => {
		if (preparingRecording) {
			onCancelPrepare?.();
			setPreparingRecording(false);
			discardPreparedFile();
			return;
		}
		const active = uploadItems.filter(
			(item) => item.status === "uploading" || item.status === "queued",
		);
		for (const item of active) {
			await cancelUpload(item.uploadId);
		}
	};

	const copyShareUrl = async () => {
		const url = lastUploadedItem?.secureUrl;
		if (!url) return;
		const success = await copyTextToClipboard(url);
		if (success) {
			setCopied(true);
			toast.success("Link copied");
		} else {
			setCopied(false);
			toast.error("Could not copy link automatically. Please copy it manually.");
		}
	};

	const combinedProgress = preparingRecording
		? Math.max(5, Math.min(70, Math.round(preparationProgress * 0.7)))
		: Math.max(5, overallUploadProgress);

	return (
		<div className="space-y-4 px-5 pb-5">
			{account.connected && !isConnecting ? (
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span className="inline-flex items-center gap-2 truncate">
						<span className="size-2 shrink-0 rounded-full bg-emerald-500" />
						<span className="truncate font-medium text-foreground">
							{account.cloudName || "Connected"}
						</span>
					</span>
					{!isBusy && (
						<button
							type="button"
							onClick={() => void handleDisconnect()}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Disconnect
						</button>
					)}
				</div>
			) : null}

			{isBusy || isConnecting || uiState === "connecting" ? (
				<div className="space-y-2">
					<ProgressBar
						aria-label={isConnecting ? "Connecting" : "Uploading"}
						isIndeterminate={isConnecting || combinedProgress <= 5}
						value={Math.min(combinedProgress, 100)}
					>
						<ProgressBar.Track>
							<ProgressBar.Fill />
						</ProgressBar.Track>
					</ProgressBar>
					<p className="text-xs text-muted-foreground">
						{isConnecting
							? "Waiting for authorization…"
							: `${preparingRecording ? "Preparing" : "Uploading"} · ${combinedProgress}%`}
					</p>
				</div>
			) : null}

			{errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

			{lastUploadedItem?.secureUrl && !isBusy ? (
				<div className="space-y-2">
					<div className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-1.5 focus-within:border-primary/50 transition-colors">
						<input
							type="text"
							readOnly
							value={lastUploadedItem.secureUrl}
							onClick={(e) => (e.target as HTMLInputElement).select()}
							onFocus={(e) => (e.target as HTMLInputElement).select()}
							className="min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none select-all"
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => void copyShareUrl()}
							className="h-7 shrink-0 gap-1 px-2 text-xs"
						>
							{copied ? (
								<>
									<Check className="size-3.5 text-emerald-500" />
									<span className="text-emerald-500">Copied</span>
								</>
							) : (
								<>
									<Copy className="size-3.5" />
									<span>Copy</span>
								</>
							)}
						</Button>
					</div>
					<Button
						type="button"
						size="lg"
						onClick={() => void copyShareUrl()}
						className="w-full gap-2"
					>
						{copied ? (
							<Check className="h-4 w-4 text-emerald-500" />
						) : (
							<LinkSimple className="h-4 w-4" />
						)}
						{copied ? "Copied" : "Copy link"}
					</Button>
				</div>
			) : (
				<div className="flex justify-end gap-2">
					{isBusy ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => void handleCancelActive()}
						>
							Cancel
						</Button>
					) : isConnecting || uiState === "connecting" ? (
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="w-full"
							onClick={cancelConnect}
						>
							Cancel
						</Button>
					) : account.connected ? (
						<Button
							type="button"
							size="lg"
							className="w-full"
							onClick={() => void handleShare()}
						>
							<CloudArrowUp className="h-4 w-4" />
							Upload to Cloudinary
						</Button>
					) : !authToken ? (
						<Button
							type="button"
							size="lg"
							className="w-full"
							onClick={onRequestSignIn}
						>
							Sign in to connect Cloudinary
						</Button>
					) : (
						<Button
							type="button"
							size="lg"
							className="w-full"
							disabled={loadingStatus}
							onClick={() => void handleConnect()}
						>
							Connect Cloudinary
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
