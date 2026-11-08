import {
	ArrowCounterClockwise,
	Check,
	Clock,
	Cursor,
	Microphone,
	Monitor,
	Scissors,
	Sparkle,
	SpinnerGap,
	Webcam,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type {
	SmartCutAnalysisResult,
	SmartCutCandidate,
	SmartCutOptions,
	SmartCutSensitivity,
} from "@/lib/smartCut/smartCutTypes";

type SettingsTab = "timing" | "audio" | "input" | "screen" | "webcam";

interface SmartCutDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	options: SmartCutOptions;
	onUpdateOptions: (patch: Partial<SmartCutOptions>) => void;
	onResetOptions: () => void;
	analyzing: boolean;
	progress: number;
	stageLabel: string;
	result: SmartCutAnalysisResult | null;
	onToggleCut: (cutId: string) => void;
	onPreviewCut: (cut: SmartCutCandidate) => void;
	onReanalyze: () => void;
	onApplyCuts: () => void;
}

function formatMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0:00";
	const totalSec = Math.max(0, Math.round(ms / 1000));
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatSecShort(ms: number): string {
	const sec = ms / 1000;
	return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
}

const SENSITIVITY_LEVELS: { id: SmartCutSensitivity; label: string }[] = [
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
];

export function SmartCutDialog({
	open,
	onOpenChange,
	options,
	onUpdateOptions,
	onResetOptions,
	analyzing,
	progress,
	stageLabel,
	result,
	onToggleCut,
	onPreviewCut,
	onReanalyze,
	onApplyCuts,
}: SmartCutDialogProps) {
	const [activeTab, setActiveTab] = useState<SettingsTab>("timing");

	const enabledCutsCount = useMemo(
		() => (result ? result.cuts.filter((c) => c.enabled).length : 0),
		[result],
	);

	const savedPercent = useMemo(() => {
		if (!result || result.originalDurationMs <= 0) return 0;
		return Math.min(99, Math.round((result.totalSavedMs / result.originalDurationMs) * 100));
	}, [result]);

	const timelineBars = useMemo(() => {
		const barCount = 72;
		if (!result || result.activityScores.length === 0) {
			return new Array<number>(barCount).fill(0.15);
		}
		const scores = result.activityScores;
		const bars: number[] = [];
		for (let i = 0; i < barCount; i++) {
			const start = Math.floor((i * scores.length) / barCount);
			const end = Math.max(start + 1, Math.floor(((i + 1) * scores.length) / barCount));
			let maxScore = 0;
			for (let j = start; j < end && j < scores.length; j++) {
				if (scores[j] > maxScore) maxScore = scores[j];
			}
			bars.push(Math.max(0.12, maxScore));
		}
		return bars;
	}, [result]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg gap-4 p-5">
				<DialogHeader className="space-y-1">
					<div className="flex items-center justify-between">
						<DialogTitle className="flex items-center gap-2 text-base font-semibold">
							<Sparkle weight="fill" className="size-4 text-sky-500" />
							<span>Smart Cut</span>
						</DialogTitle>
						{result && !analyzing && (
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span>
									{formatMs(result.originalDurationMs)} →{" "}
									<strong className="font-medium text-foreground">
										{formatMs(result.estimatedDurationMs)}
									</strong>
								</span>
								{result.totalSavedMs > 0 && (
									<span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-500">
										-{formatSecShort(result.totalSavedMs)} ({savedPercent}%)
									</span>
								)}
							</div>
						)}
					</div>
					<DialogDescription className="text-xs text-muted-foreground">
						Detect and remove inactive pauses using speech, mouse, keyboard, screen, and webcam signals.
					</DialogDescription>
				</DialogHeader>

				{/* Mini-Timeline & Cut Preview */}
				<div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/20 p-3">
					{analyzing ? (
						<div className="flex h-20 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
							<div className="flex items-center gap-2 text-foreground">
								<SpinnerGap className="size-4 animate-spin text-sky-500" />
								<span>{stageLabel || "Analyzing recording…"}</span>
								<span className="tabular-nums text-muted-foreground">
									{Math.round(progress * 100)}%
								</span>
							</div>
							<div className="h-1 w-48 overflow-hidden rounded-full bg-default/40">
								<div
									className="h-full bg-sky-500 transition-all duration-150"
									style={{ width: `${Math.max(5, Math.round(progress * 100))}%` }}
								/>
							</div>
						</div>
					) : (
						<>
							<div className="relative flex h-12 items-end gap-[2px] overflow-hidden rounded-lg bg-background/60 px-2 py-1.5">
								{timelineBars.map((height, idx) => (
									<div
										key={idx}
										className="flex-1 rounded-full bg-foreground/25 transition-all"
										style={{ height: `${Math.round(height * 100)}%` }}
									/>
								))}
								{result &&
									result.originalDurationMs > 0 &&
									result.cuts.map((cut) => {
										const leftPct =
											(cut.timelineStartMs / result.originalDurationMs) * 100;
										const widthPct = Math.max(
											0.8,
											(cut.durationMs / result.originalDurationMs) * 100,
										);
										return (
											<button
												key={cut.id}
												type="button"
												onClick={() => onPreviewCut(cut)}
												title={`Cut ${formatMs(cut.timelineStartMs)} – ${formatMs(cut.timelineEndMs)} (-${formatSecShort(cut.durationMs)})`}
												className={`absolute inset-y-0 transition-opacity ${
													cut.enabled
														? "border-x border-rose-500/70 bg-rose-500/35 hover:bg-rose-500/50"
														: "border-x border-muted-foreground/30 bg-muted-foreground/15 opacity-50"
												}`}
												style={{
													left: `${leftPct}%`,
													width: `${widthPct}%`,
												}}
											/>
										);
									})}
							</div>

							{result && result.cuts.length > 0 ? (
								<div className="custom-scrollbar flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pt-0.5">
									{result.cuts.map((cut) => (
										<div
											key={cut.id}
											className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
												cut.enabled
													? "border-rose-500/30 bg-rose-500/10 text-foreground"
													: "border-border/50 bg-transparent text-muted-foreground opacity-60"
											}`}
										>
											<button
												type="button"
												onClick={() => onToggleCut(cut.id)}
												className={`flex size-3.5 items-center justify-center rounded border ${
													cut.enabled
														? "border-rose-500 bg-rose-500 text-white"
														: "border-muted-foreground/50"
												}`}
												aria-label="Toggle cut"
											>
												{cut.enabled && <Check weight="bold" className="size-2.5" />}
											</button>
											<button
												type="button"
												onClick={() => onPreviewCut(cut)}
												className="tabular-nums hover:underline"
											>
												{formatMs(cut.timelineStartMs)}–{formatMs(cut.timelineEndMs)}
											</button>
											<span className="text-[10px] text-muted-foreground">
												-{formatSecShort(cut.durationMs)}
											</span>
										</div>
									))}
								</div>
							) : (
								<p className="py-1 text-center text-xs text-muted-foreground">
									No inactive pauses found with current settings.
								</p>
							)}
						</>
					)}
				</div>

				{/* 5-Section Minimal Tab Navigation */}
				<div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/40 p-1">
					{(
						[
							{ id: "timing", label: "Timing", icon: Clock },
							{ id: "audio", label: "Audio", icon: Microphone },
							{ id: "input", label: "Input", icon: Cursor },
							{ id: "screen", label: "Screen", icon: Monitor },
							{ id: "webcam", label: "Webcam", icon: Webcam },
						] as const
					).map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => setActiveTab(id)}
							className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
								activeTab === id
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<Icon className="size-3.5" />
							<span>{label}</span>
						</button>
					))}
				</div>

				{/* Tab Content */}
				<div className="min-h-[176px] space-y-3.5 px-0.5 text-xs">
					{activeTab === "timing" && (
						<>
							<div className="space-y-1.5">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Minimum inactivity duration</span>
									<span className="font-medium tabular-nums">
										{options.minInactivitySec.toFixed(1)}s
									</span>
								</div>
								<Slider
									min={1.0}
									max={15.0}
									step={0.5}
									value={[options.minInactivitySec]}
									onValueChange={([v]) =>
										v !== undefined && onUpdateOptions({ minInactivitySec: v })
									}
								/>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Pre-cut padding</span>
										<span className="font-medium tabular-nums">
											{options.prePaddingSec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={0.1}
										max={2.0}
										step={0.1}
										value={[options.prePaddingSec]}
										onValueChange={([v]) =>
											v !== undefined && onUpdateOptions({ prePaddingSec: v })
										}
									/>
								</div>

								<div className="space-y-1.5">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Post-cut padding</span>
										<span className="font-medium tabular-nums">
											{options.postPaddingSec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={0.1}
										max={2.5}
										step={0.1}
										value={[options.postPaddingSec]}
										onValueChange={([v]) =>
											v !== undefined && onUpdateOptions({ postPaddingSec: v })
										}
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Min segment to keep</span>
										<span className="font-medium tabular-nums">
											{options.minKeepSegmentSec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={0.3}
										max={3.0}
										step={0.1}
										value={[options.minKeepSegmentSec]}
										onValueChange={([v]) =>
											v !== undefined && onUpdateOptions({ minKeepSegmentSec: v })
										}
									/>
								</div>

								<div className="space-y-1.5">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Merge nearby gaps</span>
										<span className="font-medium tabular-nums">
											{options.mergeGapSec.toFixed(1)}s
										</span>
									</div>
									<Slider
										min={0.0}
										max={2.0}
										step={0.1}
										value={[options.mergeGapSec]}
										onValueChange={([v]) =>
											v !== undefined && onUpdateOptions({ mergeGapSec: v })
										}
									/>
								</div>
							</div>
						</>
					)}

					{activeTab === "audio" && (
						<>
							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Speech protection (VAD)</p>
									<p className="text-[11px] text-muted-foreground">
										Never cut segments where voice or speech is active
									</p>
								</div>
								<Switch
									checked={options.speechProtectionEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ speechProtectionEnabled: checked })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Audio silence detection</p>
									<p className="text-[11px] text-muted-foreground">
										Analyze audio energy to detect silent intervals
									</p>
								</div>
								<Switch
									checked={options.audioSilenceEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ audioSilenceEnabled: checked })
									}
								/>
							</div>

							<div className="space-y-1.5">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Silence threshold</span>
									<span className="font-medium tabular-nums">
										{options.silenceThresholdDb} dB
									</span>
								</div>
								<Slider
									min={-60}
									max={-18}
									step={1}
									disabled={!options.audioSilenceEnabled}
									value={[options.silenceThresholdDb]}
									onValueChange={([v]) =>
										v !== undefined && onUpdateOptions({ silenceThresholdDb: v })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Use caption cues</p>
									<p className="text-[11px] text-muted-foreground">
										Protect transcribed word timestamps when captions exist
									</p>
								</div>
								<Switch
									checked={options.useAutoCaptions}
									onCheckedChange={(checked) =>
										onUpdateOptions({ useAutoCaptions: checked })
									}
								/>
							</div>
						</>
					)}

					{activeTab === "input" && (
						<>
							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Mouse activity detection</p>
									<p className="text-[11px] text-muted-foreground">
										Preserve cursor movement and clicks
									</p>
								</div>
								<Switch
									checked={options.mouseActivityEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ mouseActivityEnabled: checked })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Movement sensitivity</span>
								<div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
									{SENSITIVITY_LEVELS.map((lvl) => (
										<button
											key={lvl.id}
											type="button"
											disabled={!options.mouseActivityEnabled}
											onClick={() => onUpdateOptions({ mouseSensitivity: lvl.id })}
											className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
												options.mouseSensitivity === lvl.id
													? "bg-background text-foreground shadow-sm"
													: "text-muted-foreground hover:text-foreground"
											}`}
										>
											{lvl.label}
										</button>
									))}
								</div>
							</div>

							<div className="space-y-1.5">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Click protection window</span>
									<span className="font-medium tabular-nums">
										{options.clickProtectionSec.toFixed(1)}s
									</span>
								</div>
								<Slider
									min={0.3}
									max={2.5}
									step={0.1}
									disabled={!options.mouseActivityEnabled}
									value={[options.clickProtectionSec]}
									onValueChange={([v]) =>
										v !== undefined && onUpdateOptions({ clickProtectionSec: v })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Keyboard activity detection</p>
									<p className="text-[11px] text-muted-foreground">
										Preserve silent typing and coding bursts
									</p>
								</div>
								<Switch
									checked={options.keyboardActivityEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ keyboardActivityEnabled: checked })
									}
								/>
							</div>
						</>
					)}

					{activeTab === "screen" && (
						<>
							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Screen activity detection</p>
									<p className="text-[11px] text-muted-foreground">
										Preserve scrolling, page loads, and visual transitions
									</p>
								</div>
								<Switch
									checked={options.screenActivityEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ screenActivityEnabled: checked })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Visual change sensitivity</span>
								<div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
									{SENSITIVITY_LEVELS.map((lvl) => (
										<button
											key={lvl.id}
											type="button"
											disabled={!options.screenActivityEnabled}
											onClick={() => onUpdateOptions({ screenSensitivity: lvl.id })}
											className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
												options.screenSensitivity === lvl.id
													? "bg-background text-foreground shadow-sm"
													: "text-muted-foreground hover:text-foreground"
											}`}
										>
											{lvl.label}
										</button>
									))}
								</div>
							</div>
						</>
					)}

					{activeTab === "webcam" && (
						<>
							<div className="flex items-center justify-between">
								<div>
									<p className="font-medium text-foreground">Webcam movement detection</p>
									<p className="text-[11px] text-muted-foreground">
										Use camera motion as a supporting signal when silent
									</p>
								</div>
								<Switch
									checked={options.webcamActivityEnabled}
									onCheckedChange={(checked) =>
										onUpdateOptions({ webcamActivityEnabled: checked })
									}
								/>
							</div>

							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">Signal priority</span>
								<div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
									{(
										[
											{ id: "supporting", label: "Supporting" },
											{ id: "ignored", label: "Ignored" },
										] as const
									).map((role) => (
										<button
											key={role.id}
											type="button"
											disabled={!options.webcamActivityEnabled}
											onClick={() => onUpdateOptions({ webcamRole: role.id })}
											className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
												options.webcamRole === role.id
													? "bg-background text-foreground shadow-sm"
													: "text-muted-foreground hover:text-foreground"
											}`}
										>
											{role.label}
										</button>
									))}
								</div>
							</div>
						</>
					)}
				</div>

				<DialogFooter className="flex items-center justify-between sm:justify-between">
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onResetOptions}
							className="h-8 gap-1 px-2 text-xs text-muted-foreground"
						>
							<ArrowCounterClockwise className="size-3.5" />
							<span>Reset</span>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={analyzing}
							onClick={onReanalyze}
							className="h-8 px-2 text-xs text-muted-foreground"
						>
							Re-scan
						</Button>
					</div>

					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => onOpenChange(false)}
							className="h-8 text-xs"
						>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={analyzing || enabledCutsCount === 0}
							onClick={onApplyCuts}
							className="h-8 gap-1.5 px-3 text-xs font-medium"
						>
							<Scissors className="size-3.5" />
							<span>
								Apply Smart Cut
								{enabledCutsCount > 0 ? ` (${enabledCutsCount})` : ""}
							</span>
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

