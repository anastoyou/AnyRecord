import { Modal, SearchField, Skeleton } from "@heroui/react";
import { Cloud, DownloadSimple, FilmStrip, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
	type CloudinaryMediaItem,
	useCloudinaryConnection,
} from "@/lib/cloudinary/useCloudinaryConnection";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	authToken?: string | null;
	accountId?: string | null;
	onSelectMedia: (localPath: string) => Promise<void> | void;
};

export function CloudMediaPickerDialog({
	open,
	onOpenChange,
	authToken,
	accountId,
	onSelectMedia,
}: Props) {
	const { mediaItems, loadingMedia, refreshMedia } = useCloudinaryConnection({
		authToken,
		accountId,
	});

	const [query, setQuery] = useState("");
	const [downloadingId, setDownloadingId] = useState<string | null>(null);

	// Filter for video files (or items without image extension)
	const videoItems = useMemo(
		() =>
			mediaItems.filter((item) => {
				const isImage =
					item.resourceType === "image" ||
					/\.(png|jpe?g|gif|webp|svg)$/i.test(item.secureUrl);
				return !isImage;
			}),
		[mediaItems],
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return videoItems;
		return videoItems.filter((item) => {
			const name = (item.originalFilename || item.publicId).toLowerCase();
			return name.includes(q);
		});
	}, [videoItems, query]);

	const handleImport = async (item: CloudinaryMediaItem) => {
		if (downloadingId) return;
		setDownloadingId(item.id);
		const displayName = item.originalFilename || item.publicId || "Cloud Video";
		const toastId = toast.info(`Downloading "${displayName}" from Cloudinary...`, {
			duration: 60000,
		});

		try {
			if (!window.electronAPI?.cloudinaryDownloadMedia) {
				throw new Error("Cloud media downloading is not available in this environment.");
			}

			const res = await window.electronAPI.cloudinaryDownloadMedia({
				url: item.secureUrl,
				fileName: item.originalFilename || item.publicId,
			});

			if (!res.success || !res.localPath) {
				throw new Error(res.error || "Failed to download cloud video.");
			}

			toast.dismiss(toastId);
			toast.success(`Downloaded "${displayName}"`);

			// Insert into timeline via callback
			await onSelectMedia(res.localPath);
			onOpenChange(false);
		} catch (err) {
			toast.dismiss(toastId);
			toast.error(err instanceof Error ? err.message : "Could not import cloud video.");
		} finally {
			setDownloadingId(null);
		}
	};

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container size="lg">
					<Modal.Dialog aria-label="Select Cloud Media" className="max-w-2xl">
						<Modal.Header className="flex flex-col gap-1">
							<div className="flex items-center gap-2">
								<div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
									<Cloud weight="bold" className="size-4" />
								</div>
								<Modal.Heading className="text-base font-semibold">
									Insert Cloud Media
								</Modal.Heading>
							</div>
							<p className="text-xs text-muted-foreground">
								Select any video from your Cloudinary library to insert as a clip in
								this project.
							</p>
						</Modal.Header>

						<Modal.Body className="space-y-4 py-2">
							<div className="flex items-center gap-3">
								<SearchField
									aria-label="Search cloud videos"
									value={query}
									onChange={setQuery}
									className="flex-1"
								>
									<SearchField.Group>
										<SearchField.SearchIcon />
										<SearchField.Input placeholder="Search cloud videos..." />
										<SearchField.ClearButton />
									</SearchField.Group>
								</SearchField>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void refreshMedia()}
									disabled={loadingMedia}
									className="text-xs text-muted-foreground"
								>
									Refresh
								</Button>
							</div>

							<div className="custom-scrollbar max-h-[380px] min-h-[200px] overflow-y-auto space-y-2 pr-1">
								{loadingMedia ? (
									<div className="space-y-2">
										<Skeleton className="h-16 w-full rounded-xl" />
										<Skeleton className="h-16 w-full rounded-xl" />
										<Skeleton className="h-16 w-full rounded-xl" />
									</div>
								) : filtered.length > 0 ? (
									<div className="space-y-2">
										{filtered.map((item) => {
											const displayName =
												item.originalFilename || item.publicId;
											const isDownloading = downloadingId === item.id;
											return (
												<div
													key={item.id}
													className="group flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/60 p-2.5 transition hover:bg-card hover:border-border"
												>
													<div className="flex min-w-0 flex-1 items-center gap-3">
														<div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/5">
															{item.secureUrl ? (
																<video
																	src={item.secureUrl}
																	className="h-full w-full object-cover"
																	muted
																	preload="metadata"
																/>
															) : (
																<div className="flex h-full w-full items-center justify-center text-muted-foreground">
																	<FilmStrip className="size-5" />
																</div>
															)}
														</div>
														<div className="min-w-0 flex-1">
															<p className="truncate text-xs font-medium text-foreground">
																{displayName}
															</p>
															<div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
																<span>
																	{new Date(
																		item.createdAt,
																	).toLocaleDateString(
																		undefined,
																		{
																			month: "short",
																			day: "numeric",
																		},
																	)}
																</span>
																{item.duration ? (
																	<>
																		<span>·</span>
																		<span>
																			{Math.round(
																				item.duration,
																			)}
																			s
																		</span>
																	</>
																) : null}
																{item.bytes ? (
																	<>
																		<span>·</span>
																		<span>
																			{(
																				item.bytes /
																				1024 /
																				1024
																			).toFixed(1)}{" "}
																			MB
																		</span>
																	</>
																) : null}
															</div>
														</div>
													</div>

													<Button
														variant="secondary"
														size="sm"
														disabled={Boolean(downloadingId)}
														onClick={() => void handleImport(item)}
														className="shrink-0 gap-1.5 text-xs font-medium"
													>
														{isDownloading ? (
															<>
																<DownloadSimple className="size-3.5 animate-bounce text-sky-400" />
																<span>Importing...</span>
															</>
														) : (
															<>
																<Plus className="size-3.5" />
																<span>Insert Clip</span>
															</>
														)}
													</Button>
												</div>
											);
										})}
									</div>
								) : (
									<div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
										<FilmStrip className="size-8 text-muted-foreground/40" />
										<p className="text-sm font-medium">No cloud videos found</p>
										<p className="text-xs max-w-xs">
											Videos you upload or export to Cloudinary will show up
											here, ready to be used as clips.
										</p>
									</div>
								)}
							</div>
						</Modal.Body>

						<Modal.Footer>
							<Button
								variant="ghost"
								onClick={() => onOpenChange(false)}
								disabled={Boolean(downloadingId)}
							>
								Close
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
