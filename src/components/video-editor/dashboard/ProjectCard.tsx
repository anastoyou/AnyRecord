import { Dropdown } from "@heroui/react";
import { Cloud, Globe } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { Button } from "@/components/ui/button";
import { Check, DotsThree, FolderSimple, Plus } from "@/components/ui/icons";
import { getProjectShareLink, moveProjectShareLink } from "../cloud/projectShareLinks";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { ProjectFolderChips } from "./ProjectFolderChips";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { RawThumbnail } from "./RawRecordings";
import type { DashboardProps } from "./types";
import type { DashboardModel } from "./useDashboardModel";

type Props = Pick<
	DashboardProps & DashboardModel,
	| "accountLabel"
	| "busy"
	| "selecting"
	| "selected"
	| "toggleSelected"
	| "openEntry"
	| "run"
	| "onShareProject"
	| "onRenameProject"
	| "folders"
	| "save"
	| "assignFolder"
> & { entry: ProjectLibraryEntry; webUrl?: string; webReady?: boolean; onDelete?: () => void };
export function ProjectCard({
	accountLabel,
	webUrl,
	webReady = true,
	onDelete,
	entry,
	busy,
	selecting,
	selected,
	toggleSelected,
	openEntry,
	run,
	onShareProject,
	onRenameProject,
	folders,
	save,
	assignFolder,
}: Props) {
	const [hovering, setHovering] = useState(false);
	const [editing, setEditing] = useState(false);
	const renaming = useRef(false);
	const [name, setName] = useState(entry.name);
	const assignedFolders = folders.filter((folder) => folder.paths.includes(entry.path));
	const folder = assignedFolders[0];
	const shareUrl = getProjectShareLink(entry.path);
	const rename = () => {
		if (renaming.current) return;
		renaming.current = true;
		void run(async () => {
			if (!name.trim() || name.trim() === entry.name) {
				setEditing(false);
				return;
			}
			const target = await onRenameProject(entry.path, name.trim());
			save(
				folders.map((folder) => ({
					...folder,
					paths: folder.paths.map((path) => (path === entry.path ? target : path)),
				})),
			);
			moveProjectShareLink(entry.path, target);
			setEditing(false);
		}).finally(() => {
			renaming.current = false;
		});
	};
	return (
		<li className="group min-w-0">
			<Button
				variant="ghost"
				disabled={busy || (Boolean(webUrl) && !webReady)}
				aria-label={entry.name}
				onPointerEnter={(event) => {
					if (event.pointerType === "mouse") setHovering(true);
				}}
				onPointerLeave={() => setHovering(false)}
				onFocus={() => setHovering(true)}
				onBlur={() => setHovering(false)}
				onClick={() => (selecting ? toggleSelected(entry.path) : openEntry(entry))}
				aria-pressed={selecting ? selected.includes(entry.path) : undefined}
				className="relative block h-auto w-full min-w-0 rounded-xl p-0"
			>
				{entry.rawSource ? (
					<RawThumbnail
						entry={entry.rawSource}
						active={hovering && !selecting && !busy}
					/>
				) : (
					<ProjectThumbnail
						key={`${entry.thumbnailPath}-${entry.updatedAt}`}
						revision={entry.updatedAt}
						path={entry.thumbnailPath}
						videoSource={
							webUrl && webReady
								? new URL(`/v/${entry.path}`, webUrl).href
								: undefined
						}
						projectPath={webUrl ? undefined : entry.path}
						previewActive={!webUrl && hovering && !selecting && !busy}
					/>
				)}
				{entry.isCloud && (
					<span
						title="Synced to Cloud"
						className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5 rounded-full bg-slate-950/80 backdrop-blur-md px-2.5 py-1 text-[11px] font-medium text-sky-400 border border-sky-400/30 shadow-md"
					>
						<Cloud weight="fill" className="size-3.5 text-sky-400" />
						<span>Cloud</span>
					</span>
				)}
				{selecting && (
					<span
						className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-md ${selected.includes(entry.path) ? "bg-accent text-white" : "bg-background/90"}`}
					>
						{selected.includes(entry.path) && <Check className="size-3.5" />}
					</span>
				)}
			</Button>
			<div className="relative flex items-start justify-between gap-4 pt-5">
				<AccountAvatar label={accountLabel} className="!size-[48px]" />
				<div data-project-caption className="h-12 min-w-0 flex-1">
					{editing ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								rename();
							}}
						>
							<input
								autoFocus
								onFocus={(event) => event.currentTarget.select()}
								aria-label={entry.rawSource ? "Raw file name" : "Project name"}
								className="inline-project-name h-5 w-full pr-8 text-[12px] font-medium"
								value={name}
								disabled={busy}
								maxLength={120}
								onChange={(event) => setName(event.target.value)}
								onBlur={rename}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										setEditing(false);
									}
								}}
							/>
						</form>
					) : (
						<p
							title={entry.name}
							className="truncate pr-8 text-[12px] font-medium leading-5"
						>
							{entry.name}
						</p>
					)}
					<div className="mt-1 flex h-6 min-w-0 items-center gap-2">
						<p className="shrink-0 text-[11px] text-muted-foreground">
							{new Date(entry.updatedAt).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
							})}
						</p>
						{entry.isCloud && (
							<span
								title="Synced to Cloud"
								className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400"
							>
								<Cloud weight="bold" className="size-3" />
								Cloud
							</span>
						)}
						{webUrl && (
							<Globe
								aria-label="Web project"
								className="size-3.5 text-muted-foreground"
							/>
						)}
						{webUrl && !webReady && (
							<span className="text-xs text-muted-foreground">Incomplete upload</span>
						)}
						{!webUrl && (
							<>
								<ProjectFolderChips
									folders={assignedFolders}
									name={entry.name}
									onRemove={(id) => assignFolder(entry.path, id)}
								/>
								<Dropdown>
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Add folder to ${entry.name}`}
										className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
									>
										<Plus className="size-3" />
										Add folder
									</Button>
									<Dropdown.Popover>
										<Dropdown.Menu aria-label="Assign project folder">
											{folders.map((item) => (
												<Dropdown.Item
													key={item.id}
													id={item.id}
													textValue={item.name}
													onAction={() =>
														assignFolder(entry.path, item.id)
													}
												>
													<FolderSimple
														weight="fill"
														style={{ color: item.color }}
													/>
													{item.name}
													{item.paths.includes(entry.path) && (
														<Check className="size-3" />
													)}
												</Dropdown.Item>
											))}
											{folder && (
												<Dropdown.Item
													id="remove"
													onAction={() =>
														assignFolder(entry.path, "none")
													}
												>
													Remove from all folders
												</Dropdown.Item>
											)}
											{!folders.length && (
												<Dropdown.Item id="empty" isDisabled>
													Create a folder in the sidebar
												</Dropdown.Item>
											)}
										</Dropdown.Menu>
									</Dropdown.Popover>
								</Dropdown>
							</>
						)}
					</div>
				</div>
				<Dropdown>
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Options for ${entry.name}`}
						className="absolute right-0 top-5 size-6 min-w-6 text-muted-foreground"
					>
						<DotsThree weight="bold" className="size-5" />
					</Button>
					<Dropdown.Popover>
						<Dropdown.Menu aria-label="Project options">
							<Dropdown.Item
								id="open"
								isDisabled={Boolean(webUrl) && !webReady}
								onAction={() => openEntry(entry)}
							>
								{webUrl
									? "Open link"
									: entry.rawSource
										? "Preview file"
										: "Open project"}
							</Dropdown.Item>
							{!webUrl && (
								<>
									<Dropdown.Item
										id="rename"
										onAction={() => {
											setName(entry.name);
											requestAnimationFrame(() =>
												requestAnimationFrame(() => setEditing(true)),
											);
										}}
									>
										Rename
									</Dropdown.Item>
									{!entry.rawSource && (
										<Dropdown.Item
											id="share"
											onAction={() =>
												void run(async () => {
													if (shareUrl)
														await window.electronAPI.openExternalUrl(
															shareUrl,
														);
													else await onShareProject(entry.path);
												})
											}
										>
											{shareUrl ? "View in web" : "Share"}
										</Dropdown.Item>
									)}
									<Dropdown.Item
										aria-label={
											entry.rawSource
												? `Show ${entry.name} in folder`
												: undefined
										}
										id="reveal"
										onAction={() =>
											void run(async () => {
												await window.electronAPI.revealInFolder(entry.path);
											})
										}
									>
										Show in folder
									</Dropdown.Item>
								</>
							)}
							{onDelete && (
								<Dropdown.Item
									id="delete"
									variant="danger"
									className="text-danger"
									isDisabled={busy}
									onAction={onDelete}
								>
									{webUrl
										? "Delete recording"
										: entry.rawSource
											? "Remove from library"
											: "Delete project"}
								</Dropdown.Item>
							)}
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</li>
	);
}
