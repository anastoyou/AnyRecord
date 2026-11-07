import { ProgressBar } from "@heroui/react";
import { Check, CloudArrowUp, CloudCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useCloudinaryConnection } from "@/lib/cloudinary/useCloudinaryConnection";
import type { EditorProjectData } from "../projectPersistence";

type Props = {
	projectDisplayName: string;
	projectData: EditorProjectData | null;
	currentSourcePath: string | null;
	captureThumbnail?: () => Promise<string | null>;
	saveLocalProject?: () => Promise<unknown>;
	refreshProjectLibrary?: () => Promise<void>;
	authToken?: string;
	accountId?: string;
};

export function CloudProjectSyncButton({
	projectDisplayName,
	projectData,
	currentSourcePath,
	captureThumbnail,
	saveLocalProject,
	refreshProjectLibrary,
	authToken,
	accountId,
}: Props) {
	const { account, saveCloudProject, cloudProjects } = useCloudinaryConnection({
		authToken,
		accountId,
	});

	const [open, setOpen] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [lastSyncedTime, setLastSyncedTime] = useState<Date | null>(null);

	const isCloudinaryConnected = Boolean(authToken && account.connected);

	// Optional: only show if connected to Google and Cloudinary
	if (!isCloudinaryConnected || !currentSourcePath) {
		return null;
	}

	const projectId = projectData?.projectId;
	const existingCloudProject =
		cloudProjects.find(
			(p) =>
				(projectId && p.projectId === projectId) ||
				p.name.trim().toLowerCase() === projectDisplayName.trim().toLowerCase(),
		) ?? null;

	const effectiveProjectId = projectId || existingCloudProject?.projectId || crypto.randomUUID();

	const displayLastSynced = lastSyncedTime
		? `Synced ${lastSyncedTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
		: existingCloudProject
			? `Synced ${new Date(existingCloudProject.updatedAt).toLocaleDateString()}`
			: "Not synced to cloud yet";

	const handleSync = async () => {
		if (!projectData) {
			toast.error("No project data to sync");
			return;
		}

		setIsSyncing(true);
		try {
			// Save local changes first if needed
			if (saveLocalProject) {
				await saveLocalProject();
			}

			let thumbnailDataUrl: string | null = null;
			if (captureThumbnail) {
				thumbnailDataUrl = await captureThumbnail().catch(() => null);
			}

			const res = await saveCloudProject({
				projectId: effectiveProjectId,
				name: projectDisplayName,
				projectData: {
					...projectData,
					projectId: effectiveProjectId,
					videoPath: currentSourcePath,
				},
				thumbnailDataUrl,
			});

			if (!res.success) {
				throw new Error(res.error || "Failed to sync project to Cloud");
			}

			setLastSyncedTime(new Date());
			await refreshProjectLibrary?.();
			toast.success("Project synced to Cloud! You can continue editing on any computer.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Cloud sync failed");
		} finally {
			setIsSyncing(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-9 shrink-0 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
					title="Sync project to Cloud"
					aria-label="Cloud sync"
				>
					{lastSyncedTime || existingCloudProject ? (
						<CloudCheck weight="fill" className="size-4 text-emerald-500" />
					) : (
						<CloudArrowUp className="size-4 text-sky-500" />
					)}
					<span className="hidden sm:inline">Cloud Sync</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={8} className="w-80 p-4">
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<CloudArrowUp className="size-5 text-sky-500 shrink-0" />
						<div>
							<h4 className="text-sm font-semibold tracking-tight">
								Cloud Project Sync
							</h4>
							<p className="text-xs text-muted-foreground">
								Continue editing this project on another computer.
							</p>
						</div>
					</div>

					<div className="rounded-lg bg-muted/50 p-2.5 text-xs space-y-1">
						<div className="flex items-center justify-between text-muted-foreground">
							<span className="truncate font-medium text-foreground">
								{projectDisplayName}
							</span>
							{existingCloudProject || lastSyncedTime ? (
								<span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
									<Check className="size-3" /> Synced
								</span>
							) : null}
						</div>
						<p className="text-[11px] text-muted-foreground">{displayLastSynced}</p>
					</div>

					{isSyncing ? (
						<div className="space-y-1.5">
							<ProgressBar isIndeterminate aria-label="Syncing to Cloud" size="sm">
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
							<p className="text-center text-[11px] text-muted-foreground">
								Uploading media & edits to Cloud…
							</p>
						</div>
					) : (
						<Button
							type="button"
							size="sm"
							className="w-full gap-1.5"
							disabled={isSyncing}
							onClick={() => void handleSync()}
						>
							<CloudArrowUp className="size-4" />
							{existingCloudProject || lastSyncedTime
								? "Update Cloud Project"
								: "Sync to Cloud"}
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
