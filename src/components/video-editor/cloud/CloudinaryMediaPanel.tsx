import { Dropdown, ProgressBar, Skeleton } from "@heroui/react";
import { Globe } from "@phosphor-icons/react";
import { useState } from "react";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { Cloud, DotsThree } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import {
	type CloudinaryMediaItem,
	useCloudinaryConnection,
} from "@/lib/cloudinary/useCloudinaryConnection";
import { copyTextToClipboard } from "@/utils/clipboard";
import { DashboardAnnouncements } from "../dashboard/DashboardAnnouncements";
import { DashboardFilters } from "../dashboard/DashboardFilters";
import { DashboardToolbar } from "../dashboard/DashboardToolbar";
import { LibrarySkeleton } from "../dashboard/LibrarySkeleton";

type Props = {
	authToken?: string | null;
	accountId?: string | null;
	accountLabel?: string;
	onSignIn?: () => void;
};

function MediaCardThumbnail({ item }: { item: CloudinaryMediaItem }) {
	const [loaded, setLoaded] = useState(false);
	const displayName = item.originalFilename || item.publicId;

	return (
		<div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60">
			{!loaded && <Skeleton className="absolute inset-0 rounded-xl" />}
			{item.resourceType === "image" ? (
				<img
					src={item.secureUrl}
					alt={displayName}
					loading="lazy"
					draggable={false}
					onLoad={() => setLoaded(true)}
					onError={() => setLoaded(true)}
					className="h-full w-full object-cover"
				/>
			) : (
				<video
					src={item.secureUrl}
					preload="metadata"
					muted
					playsInline
					onLoadedData={() => setLoaded(true)}
					onError={() => setLoaded(true)}
					onMouseEnter={(e) => {
						void e.currentTarget.play().catch(() => undefined);
					}}
					onMouseLeave={(e) => {
						e.currentTarget.pause();
						e.currentTarget.currentTime = 0;
					}}
					className="h-full w-full object-cover"
				/>
			)}
		</div>
	);
}

export function CloudinaryMediaPanel({ authToken, accountId, accountLabel, onSignIn }: Props) {
	const {
		account,
		loadingStatus,
		isConnecting,
		isUploading,
		errorMessage,
		uploadItems,
		mediaItems,
		loadingMedia,
		connect,
		cancelConnect,
		disconnect,
		pickAndUploadFiles,
		deleteMedia,
	} = useCloudinaryConnection({ authToken, accountId });

	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSort] = useState("recent");
	const [selected, setSelected] = useState<string[]>([]);
	const [selecting, setSelecting] = useState(false);

	const run = async (action: () => Promise<unknown>) => {
		try {
			await action();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Action failed");
		}
	};

	const handleUpload = async () => {
		const results = await pickAndUploadFiles({ folder: "AnyRecord" });
		const succeeded = results.filter((r) => r.status === "done");
		if (succeeded.length > 0) {
			toast.success(
				succeeded.length === 1
					? "Uploaded to Cloudinary"
					: `Uploaded ${succeeded.length} files`,
			);
		}
	};

	const handleCopyUrl = async (url: string) => {
		const success = await copyTextToClipboard(url);
		if (success) {
			toast.success("Link copied");
		} else {
			toast.error("Could not copy link");
		}
	};

	const handleOpen = (url: string) => {
		if (window.electronAPI?.openExternalUrl) {
			void window.electronAPI.openExternalUrl(url);
		} else {
			window.open(url, "_blank");
		}
	};

	const handleDelete = async (item: CloudinaryMediaItem) => {
		const ok = await deleteMedia(item.id);
		if (ok) {
			toast.success("Removed from shared library");
		}
	};

	const handleDownloadToRecordings = async (item: CloudinaryMediaItem) => {
		if (!window.electronAPI?.cloudinaryDownloadMedia) {
			toast.error("Download is not supported in this environment");
			return;
		}
		const toastId = toast.info("Downloading to Recordings...", { duration: 60000 });
		try {
			const res = await window.electronAPI.cloudinaryDownloadMedia({
				url: item.secureUrl,
				fileName: item.originalFilename || item.publicId,
			});
			if (!res.success || !res.fileName) {
				throw new Error(res.error || "Failed to download media");
			}
			toast.dismiss(toastId);
			toast.success(`Saved "${res.fileName}" to Recordings`);
		} catch (err) {
			toast.dismiss(toastId);
			toast.error(err instanceof Error ? err.message : "Download failed");
		}
	};

	if (!authToken) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
				<Cloud weight="fill" className="size-8 opacity-40" />
				<p>Sign in to AnyRecord to connect your Cloudinary account.</p>
				{onSignIn && (
					<Button variant="secondary" onClick={onSignIn}>
						Sign in
					</Button>
				)}
			</div>
		);
	}

	if (loadingStatus && !account.connected && !isConnecting) {
		return (
			<div className="pt-8">
				<LibrarySkeleton />
			</div>
		);
	}

	if (!account.connected) {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
				<Cloud weight="fill" className="size-8 opacity-40" />
				<p>
					{isConnecting
						? "Waiting for Cloudinary authorization…"
						: errorMessage || "Connect Cloudinary to upload and share media."}
				</p>
				{isConnecting ? (
					<Button variant="secondary" onClick={cancelConnect}>
						Cancel
					</Button>
				) : (
					<Button variant="secondary" onClick={() => void connect()}>
						Connect Cloudinary
					</Button>
				)}
			</div>
		);
	}

	const activeUploads = uploadItems.filter(
		(item) => item.status === "uploading" || item.status === "queued",
	);

	const filtered = mediaItems
		.filter((item) => {
			const title = (item.originalFilename || item.publicId).toLowerCase();
			if (!title.includes(query.trim().toLowerCase())) return false;
			if (period === "all") return true;
			const createdMs = new Date(item.createdAt).getTime();
			const cutoff = Date.now() - (period === "week" ? 7 : 30) * 86400000;
			return createdMs >= cutoff;
		})
		.sort((a, b) => {
			if (sort === "name") {
				return (a.originalFilename || a.publicId).localeCompare(
					b.originalFilename || b.publicId,
				);
			}
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});

	const placeholderEntries = filtered.map((item) => ({
		path: item.id,
		name: item.originalFilename || item.publicId,
		updatedAt: new Date(item.createdAt).getTime(),
		thumbnailPath: item.secureUrl,
		isCurrent: false,
		isInProjectsDirectory: false,
	}));

	return (
		<div className="-mx-7 lg:-mx-10">
			<DashboardAnnouncements />
			<DashboardToolbar
				query={query}
				setQuery={setQuery}
				isRaw={false}
				onImportFile={handleUpload}
				run={run}
				busy={isUploading || loadingMedia}
				actionLabel="Upload"
				action="import"
			/>
			<div className="flex items-center justify-between px-7 pb-2 text-xs text-muted-foreground lg:px-10">
				<span className="inline-flex items-center gap-2">
					<span className="size-2 rounded-full bg-emerald-500" />
					<span className="font-medium text-foreground">{account.cloudName}</span>
				</span>
				<button
					type="button"
					disabled={isUploading}
					onClick={() => void disconnect()}
					className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
				>
					Disconnect
				</button>
			</div>
			<DashboardFilters
				hideSelection
				isRaw={false}
				period={period}
				setPeriod={setPeriod}
				sort={sort}
				setSort={setSort}
				selecting={selecting}
				setSelecting={setSelecting}
				selected={selected}
				setSelected={setSelected}
				visible={placeholderEntries}
				busy={isUploading || loadingMedia}
				deleteEntries={async () => undefined}
			/>
			<div className="px-7 lg:px-10">
				{errorMessage && (
					<p role="alert" className="mb-4 text-sm text-danger">
						{errorMessage}
					</p>
				)}
				{loadingMedia && mediaItems.length === 0 && activeUploads.length === 0 ? (
					<LibrarySkeleton />
				) : filtered.length > 0 || activeUploads.length > 0 ? (
					<ul
						aria-label="Shared media"
						className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
					>
						{activeUploads.map((upload) => (
							<li key={upload.uploadId} className="min-w-0">
								<div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-default/60 p-6">
									<Skeleton className="absolute inset-0 rounded-xl" />
									<div className="relative z-10 w-full max-w-[180px] space-y-2 text-center">
										<ProgressBar
											aria-label={`Uploading ${upload.fileName}`}
											isIndeterminate={upload.progress <= 5}
											value={Math.min(upload.progress, 100)}
										>
											<ProgressBar.Track>
												<ProgressBar.Fill />
											</ProgressBar.Track>
										</ProgressBar>
										<p className="text-[11px] font-medium text-muted-foreground">
											Uploading · {upload.progress}%
										</p>
									</div>
								</div>
								<div className="relative flex items-start justify-between gap-4 pt-5">
									<AccountAvatar
										label={account.accountLabel || accountLabel}
										className="!size-[48px]"
									/>
									<div data-project-caption className="h-12 min-w-0 flex-1">
										<p className="truncate pr-8 text-[12px] font-medium leading-5">
											{upload.fileName}
										</p>
										<p className="mt-1 text-[11px] text-muted-foreground">
											Uploading…
										</p>
									</div>
								</div>
							</li>
						))}
						{filtered.map((item) => {
							const displayName = item.originalFilename || item.publicId;
							return (
								<li key={item.id} className="group min-w-0">
									<Button
										variant="ghost"
										aria-label={displayName}
										onClick={() => handleOpen(item.secureUrl)}
										className="relative block h-auto w-full min-w-0 rounded-xl p-0"
									>
										<MediaCardThumbnail item={item} />
									</Button>
									<div className="relative flex items-start justify-between gap-4 pt-5">
										<AccountAvatar
											label={account.accountLabel || accountLabel}
											className="!size-[48px]"
										/>
										<div data-project-caption className="h-12 min-w-0 flex-1">
											<p
												title={displayName}
												className="truncate pr-8 text-[12px] font-medium leading-5"
											>
												{displayName}
											</p>
											<div className="mt-1 flex h-6 min-w-0 items-center gap-2">
												<p className="shrink-0 text-[11px] text-muted-foreground">
													{new Date(item.createdAt).toLocaleDateString(
														undefined,
														{
															month: "short",
															day: "numeric",
														},
													)}
												</p>
												<Globe
													aria-label="Web media"
													className="size-3.5 text-muted-foreground"
												/>
											</div>
										</div>
										<Dropdown>
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Options for ${displayName}`}
												className="absolute right-0 top-5 size-6 min-w-6 text-muted-foreground"
											>
												<DotsThree weight="bold" className="size-5" />
											</Button>
											<Dropdown.Popover>
												<Dropdown.Menu aria-label="Media options">
													<Dropdown.Item
														id="open"
														onAction={() => handleOpen(item.secureUrl)}
													>
														Open link
													</Dropdown.Item>
													<Dropdown.Item
														id="copy"
														onAction={() =>
															void handleCopyUrl(item.secureUrl)
														}
													>
														Copy link
													</Dropdown.Item>
													<Dropdown.Item
														id="download"
														onAction={() =>
															void handleDownloadToRecordings(item)
														}
													>
														Download to Recordings
													</Dropdown.Item>
													<Dropdown.Item
														id="delete"
														variant="danger"
														className="text-danger"
														onAction={() => void handleDelete(item)}
													>
														Delete
													</Dropdown.Item>
												</Dropdown.Menu>
											</Dropdown.Popover>
										</Dropdown>
									</div>
								</li>
							);
						})}
					</ul>
				) : (
					<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
						<span aria-hidden="true" className="text-4xl">
							🦗
						</span>
						<p>
							{query || period !== "all"
								? "No matching projects"
								: "It's looking empty in here..."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
