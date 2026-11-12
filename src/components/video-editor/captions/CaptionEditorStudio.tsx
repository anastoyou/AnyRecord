import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ClosedCaptioning,
	MagicWand,
	Trash,
	Plus,
	Palette,
	Check,
	MagnifyingGlass,
	TextT,
	BoundingBox,
	CaretDown,
	FilmStrip,
} from "@/components/ui/icons";
import type {
	AutoCaptionSettings,
	CaptionCue,
	CaptionEngine,
	CaptionAlignment,
	CaptionBackgroundStyle,
	CaptionAnimationStyle,
	CaptionAnimationScope,
	CaptionTextTransform,
} from "../types";
import {
	CAPTION_FONT_CATEGORIES,
	ALL_CAPTION_FONTS,
	type CaptionFontOption,
	ensureCaptionFontLoaded,
	preloadPopularCaptionFonts,
} from "./captionFonts";
import {
	INSTAGRAM_REELS_PRESETS,
	getCustomCaptionPresets,
	saveCustomCaptionPreset,
	deleteCustomCaptionPreset,
} from "./captionPresets";
import type { CaptionPreset } from "./captionTypes";
import { CAPTION_ANIMATIONS } from "./captionAnimations";
import { ColorControl } from "@/components/ui/color-picker";
import { SliderControl } from "../SliderControl";
import CaptionListPanel from "../CaptionListPanel";
import { AddCustomFontDialog } from "../AddCustomFontDialog";
import { type CustomFont, getCustomFonts } from "@/lib/customFonts";
import "./captionAnimations.css";

interface CaptionEditorStudioProps {
	settings: AutoCaptionSettings;
	onUpdateSettings: (updates: Partial<AutoCaptionSettings>) => void;
	cues: CaptionCue[];
	currentTimeMs?: number;
	selectedCaptionId?: string | null;
	isGeneratingCaptions?: boolean;
	whisperModelPath?: string | null;
	whisperModelDownloadStatus?: string;
	whisperModelDownloadProgress?: number;
	selectedModelName?: string | null;
	onGenerateAutoCaptions?: () => void;
	onClearAutoCaptions?: () => void;
	onPickWhisperModel?: () => void;
	onDownloadWhisperSmallModel?: () => void;
	onDeleteWhisperSmallModel?: () => void;
	onBeginCaptionEdit?: (id: string) => void;
	onCaptionTextEdit?: (id: string, text: string) => void;
	onCaptionRetime?: (id: string, span: { startMs: number; endMs: number }) => void;
	onCaptionSplit?: (id: string, atMs: number) => void;
	onCaptionMerge?: (idA: string, idB: string) => void;
	onCaptionDelete?: (id: string) => void;
}

const QUICK_COLORS = [
	{ name: "White", value: "#FFFFFF" },
	{ name: "Neon Yellow", value: "#FFE600" },
	{ name: "Neon Green", value: "#00FF88" },
	{ name: "Cyan", value: "#00F0FF" },
	{ name: "Hot Pink", value: "#FF007F" },
	{ name: "Flame Orange", value: "#FF5722" },
	{ name: "Gold", value: "#F59E0B" },
	{ name: "Purple Glow", value: "#A855F7" },
	{ name: "Slate Dark", value: "#0F172A" },
	{ name: "Pitch Black", value: "#000000" },
];

const LANGUAGE_OPTIONS = [
	{ value: "auto", label: "Auto-detect" },
	{ value: "ml", label: "Malayalam (മലയാളം)" },
	{ value: "en", label: "English" },
	{ value: "hi", label: "Hindi (हिन्दी)" },
	{ value: "ta", label: "Tamil (தமிழ்)" },
	{ value: "te", label: "Telugu (తెలుగు)" },
	{ value: "ar", label: "Arabic (العربية)" },
	{ value: "es", label: "Spanish (Español)" },
	{ value: "fr", label: "French (Français)" },
	{ value: "de", label: "German (Deutsch)" },
	{ value: "ja", label: "Japanese (日本語)" },
	{ value: "ko", label: "Korean (한국어)" },
	{ value: "zh", label: "Chinese (中文)" },
	{ value: "pt", label: "Portuguese (Português)" },
	{ value: "ru", label: "Russian (Русский)" },
];

export const CaptionEditorStudio: React.FC<CaptionEditorStudioProps> = ({
	settings,
	onUpdateSettings,
	cues,
	currentTimeMs = 0,
	selectedCaptionId = null,
	isGeneratingCaptions = false,
	whisperModelPath,
	whisperModelDownloadStatus,
	whisperModelDownloadProgress,
	selectedModelName,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onPickWhisperModel,
	onDownloadWhisperSmallModel,
	onDeleteWhisperSmallModel,
	onBeginCaptionEdit,
	onCaptionTextEdit,
	onCaptionRetime,
	onCaptionSplit,
	onCaptionMerge,
	onCaptionDelete,
}) => {
	const [activeTab, setActiveTab] = useState<string>("presets");
	const [fontSearch, setFontSearch] = useState("");
	const [selectedFontCategory, setSelectedFontCategory] = useState("all");
	const [customPresets, setCustomPresets] = useState<CaptionPreset[]>([]);
	const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
	const [newPresetName, setNewPresetName] = useState("");
	const [isSavingPreset, setIsSavingPreset] = useState(false);
	const [animCategoryFilter, setAnimCategoryFilter] = useState("all");
	const [isCuesExpanded, setIsCuesExpanded] = useState(true);

	const activeCueId =
		selectedCaptionId ||
		cues.find((c) => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs)?.id ||
		cues[0]?.id ||
		null;

	useEffect(() => {
		preloadPopularCaptionFonts();
		setCustomPresets(getCustomCaptionPresets());
		setCustomFonts(getCustomFonts());
	}, []);

	// Load Google Font when settings.fontFamily updates
	useEffect(() => {
		const matched = ALL_CAPTION_FONTS.find(
			(f) => f.fontFamily === settings.fontFamily || f.name === settings.fontFamily,
		);
		if (matched?.googleFont) {
			ensureCaptionFontLoaded(matched.googleFont);
		}
	}, [settings.fontFamily]);

	const allPresets = useMemo(() => {
		return [...customPresets, ...INSTAGRAM_REELS_PRESETS];
	}, [customPresets]);

	const allAvailableFonts: CaptionFontOption[] = useMemo(() => {
		const customOptions: CaptionFontOption[] = customFonts.map((cf) => ({
			id: cf.id,
			name: cf.name,
			fontFamily: cf.fontFamily,
			category: "custom",
			sampleText: cf.name,
		}));
		return [...ALL_CAPTION_FONTS, ...customOptions];
	}, [customFonts]);

	const filteredFonts = useMemo(() => {
		return allAvailableFonts.filter((font) => {
			const matchesCategory =
				selectedFontCategory === "all" || font.category === selectedFontCategory;
			const matchesSearch =
				!fontSearch ||
				font.name.toLowerCase().includes(fontSearch.toLowerCase()) ||
				font.category.toLowerCase().includes(fontSearch.toLowerCase());
			return matchesCategory && matchesSearch;
		});
	}, [allAvailableFonts, selectedFontCategory, fontSearch]);

	const filteredAnimations = useMemo(() => {
		if (animCategoryFilter === "all") return CAPTION_ANIMATIONS;
		return CAPTION_ANIMATIONS.filter((a) => a.category === animCategoryFilter);
	}, [animCategoryFilter]);

	const applyPreset = (preset: CaptionPreset) => {
		onUpdateSettings({
			fontFamily: preset.fontFamily,
			fontSize: preset.fontSize,
			fontWeight: preset.fontWeight,
			letterSpacing: preset.letterSpacing,
			lineHeight: preset.lineHeight,
			textTransform: preset.textTransform,
			fontStyle: preset.fontStyle,
			textDecoration: preset.textDecoration,
			textOpacity: preset.textOpacity,
			textColor: preset.textColor,
			inactiveTextColor: preset.inactiveTextColor,
			activeWordColor: preset.activeWordColor,
			keywordColor: preset.keywordColor,
			gradientText: preset.gradientText,
			stroke: { ...preset.stroke },
			shadow: { ...preset.shadow },
			alignment: preset.alignment,
			verticalPosition: preset.verticalPosition,
			bottomOffset: preset.bottomOffset,
			backgroundStyle: preset.backgroundStyle,
			backgroundColor: preset.backgroundColor,
			backgroundOpacity: preset.backgroundOpacity,
			boxRadius: preset.boxRadius,
			paddingX: preset.paddingX,
			paddingY: preset.paddingY,
			animationStyle: preset.animationStyle,
			animationDurationMs: preset.animationDurationMs,
			animationScope: preset.animationScope,
			animationSpeed: preset.animationSpeed,
			activePresetId: preset.id,
		});

		const matched = ALL_CAPTION_FONTS.find((f) => f.fontFamily === preset.fontFamily);
		if (matched?.googleFont) {
			ensureCaptionFontLoaded(matched.googleFont);
		}
	};

	const handleSaveCustomPreset = () => {
		if (!newPresetName.trim()) return;
		const newPreset: CaptionPreset = {
			id: `custom-${Date.now()}`,
			name: newPresetName.trim(),
			category: "custom",
			fontFamily: settings.fontFamily,
			fontSize: settings.fontSize,
			fontWeight: settings.fontWeight ?? 700,
			letterSpacing: settings.letterSpacing ?? 0,
			lineHeight: settings.lineHeight ?? 1.25,
			textTransform: settings.textTransform ?? "none",
			fontStyle: settings.fontStyle ?? "normal",
			textDecoration: settings.textDecoration ?? "none",
			textOpacity: settings.textOpacity ?? 1,
			textColor: settings.textColor,
			inactiveTextColor: settings.inactiveTextColor,
			activeWordColor: settings.activeWordColor ?? "#FFE600",
			keywordColor: settings.keywordColor ?? "#00F0FF",
			gradientText: settings.gradientText ?? null,
			stroke: settings.stroke ?? { color: "#000000", width: 0 },
			shadow: settings.shadow ?? { color: "#000000", blur: 4, opacity: 0.6, offsetX: 0, offsetY: 2 },
			alignment: settings.alignment ?? "center",
			verticalPosition: settings.verticalPosition ?? "bottom",
			bottomOffset: settings.bottomOffset,
			backgroundStyle: settings.backgroundStyle ?? "rounded",
			backgroundColor: settings.backgroundColor ?? "#000000",
			backgroundOpacity: settings.backgroundOpacity,
			boxRadius: settings.boxRadius,
			paddingX: settings.paddingX ?? 16,
			paddingY: settings.paddingY ?? 10,
			animationStyle: settings.animationStyle,
			animationDurationMs: settings.animationDurationMs ?? 250,
			animationScope: settings.animationScope ?? "word",
			animationSpeed: settings.animationSpeed ?? 1,
			isCustom: true,
		};
		const updated = saveCustomCaptionPreset(newPreset);
		setCustomPresets(updated);
		setNewPresetName("");
		setIsSavingPreset(false);
	};

	const handleDeletePreset = (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		const updated = deleteCustomCaptionPreset(id);
		setCustomPresets(updated);
	};

	const tabs = [
		{ id: "presets", label: "Presets", icon: MagicWand },
		{ id: "typography", label: "Typography", icon: TextT },
		{ id: "colors", label: "Colors", icon: Palette },
		{ id: "animations", label: "Motion", icon: FilmStrip },
		{ id: "layout", label: "Layout", icon: BoundingBox },
	];

	return (
		<div className="flex flex-col gap-3 font-sans pb-6">
			{/* TOP SECTION: SPEECH & CUES */}
			<div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-3 shadow-xs">
				{/* Header & Main Toggle */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<ClosedCaptioning className="size-4" weight="bold" />
						</div>
						<div>
							<div className="flex items-center gap-2">
								<span className="text-xs font-semibold text-foreground">Speech & Cues</span>
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
									{cues.length} {cues.length === 1 ? "cue" : "cues"}
								</span>
							</div>
							<span className="text-[11px] text-muted-foreground">
								{settings.enabled ? "Captions displayed on video" : "Captions hidden"}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[11px] text-muted-foreground font-medium">Visible</span>
						<Switch
							aria-label="Toggle Video Captions"
							checked={settings.enabled}
							onCheckedChange={(enabled) => onUpdateSettings({ enabled })}
						/>
					</div>
				</div>

				{/* Engine & Language Row */}
				<div className="grid grid-cols-2 gap-2.5">
					<div className="flex flex-col gap-1">
						<label className="text-[11px] font-medium text-muted-foreground">Engine</label>
						<Select
							value={settings.engine || "google"}
							onValueChange={(val) => onUpdateSettings({ engine: val as CaptionEngine })}
						>
							<SelectTrigger className="h-8 text-xs bg-background/50">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="google">Google Speech</SelectItem>
								<SelectItem value="whisper">Whisper (Offline)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-col gap-1">
						<label className="text-[11px] font-medium text-muted-foreground">Language</label>
						<Select
							value={settings.language || "auto"}
							onValueChange={(val) => onUpdateSettings({ language: String(val) })}
						>
							<SelectTrigger className="h-8 text-xs bg-background/50">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{LANGUAGE_OPTIONS.map((lang) => (
									<SelectItem key={lang.value} value={lang.value}>
										{lang.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{/* Whisper Offline Model Panel */}
				{settings.engine === "whisper" && (
					<div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-2.5">
						<div className="flex items-center justify-between text-xs">
							<span className="text-[11px] font-medium text-foreground">Whisper Model</span>
							<span className="text-[10px] font-mono text-muted-foreground truncate max-w-[150px]">
								{selectedModelName || "Not loaded"}
							</span>
						</div>

						{whisperModelDownloadStatus && (
							<div className="text-[10px] text-muted-foreground">
								Status: {whisperModelDownloadStatus}
								{typeof whisperModelDownloadProgress === "number" &&
									` (${Math.round(whisperModelDownloadProgress)}%)`}
							</div>
						)}

						<div className="flex flex-wrap gap-1.5 pt-0.5">
							{onPickWhisperModel && (
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs flex-1 px-2"
									onClick={onPickWhisperModel}
								>
									Choose File
								</Button>
							)}
							{onDownloadWhisperSmallModel && !whisperModelPath && (
								<Button
									variant="secondary"
									size="sm"
									className="h-7 text-xs flex-1 px-2"
									onClick={onDownloadWhisperSmallModel}
								>
									Download
								</Button>
							)}
							{onDeleteWhisperSmallModel && whisperModelPath && (
								<Button
									variant="outline"
									size="sm"
									className="h-7 text-xs text-destructive hover:bg-destructive/10 px-2"
									onClick={onDeleteWhisperSmallModel}
								>
									Delete
								</Button>
							)}
						</div>

						<div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
							<div className="flex flex-col">
								<span className="text-[11px] font-medium text-foreground">Translate to English</span>
								<span className="text-[10px] text-muted-foreground">Translate non-English audio</span>
							</div>
							<Switch
								aria-label="Translate to English"
								checked={settings.translate ?? false}
								onCheckedChange={(translate: boolean) => onUpdateSettings({ translate })}
							/>
						</div>
					</div>
				)}

				{/* Primary Generate / Clear Actions */}
				<div className="flex items-center gap-2">
					{onGenerateAutoCaptions && (
						<Button
							size="sm"
							className="h-8 flex-1 font-semibold text-xs shadow-xs"
							onClick={onGenerateAutoCaptions}
							disabled={isGeneratingCaptions}
						>
							{isGeneratingCaptions
								? "Generating Captions..."
								: cues.length > 0
									? "Regenerate Captions"
									: "Generate Captions"}
						</Button>
					)}

					{onClearAutoCaptions && cues.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="h-8 px-3 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40"
							onClick={onClearAutoCaptions}
						>
							Clear
						</Button>
					)}
				</div>

				{/* Caption Segments Collapsible Panel */}
				{cues.length > 0 && (
					<div className="flex flex-col gap-2 pt-2 border-t border-border/40">
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setIsCuesExpanded(!isCuesExpanded)}
								className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
							>
								<span>Caption Segments</span>
								<span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
									{cues.length}
								</span>
								<CaretDown
									className={`size-3 text-muted-foreground transition-transform duration-200 ${isCuesExpanded ? "rotate-180" : ""
										}`}
								/>
							</button>

							{activeCueId && (
								<span className="text-[10px] text-muted-foreground font-mono">
									Segment {cues.findIndex((c) => c.id === activeCueId) + 1} of {cues.length}
								</span>
							)}
						</div>

						{isCuesExpanded && (
							<div className="flex flex-col gap-2">
								{/* Segment quick-select scroll pills */}
								<div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
									{cues.map((c, idx) => {
										const isSelected = c.id === activeCueId;
										return (
											<button
												key={c.id}
												type="button"
												onClick={() => onBeginCaptionEdit?.(c.id)}
												className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] whitespace-nowrap transition-colors border ${isSelected
														? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
														: "bg-secondary/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/70"
													}`}
											>
												<span className="opacity-70 font-mono text-[10px]">#{idx + 1}</span>
												<span className="max-w-[110px] truncate">{c.text || "(empty)"}</span>
											</button>
										);
									})}
								</div>

								{/* Selected Cue Editor */}
								{activeCueId && (
									<div className="rounded-xl border border-border/50 bg-background/50 p-2.5">
										<CaptionListPanel
											cues={cues}
											selectedCaptionId={activeCueId}
											currentTimeMs={currentTimeMs}
											onBeginCaptionEdit={onBeginCaptionEdit ?? (() => { /* no-op */ })}
											onCaptionTextEdit={onCaptionTextEdit ?? (() => { /* no-op */ })}
											onCaptionRetime={onCaptionRetime ?? (() => { /* no-op */ })}
											onCaptionSplit={onCaptionSplit ?? (() => { /* no-op */ })}
											onCaptionMerge={onCaptionMerge ?? (() => { /* no-op */ })}
											onCaptionDelete={onCaptionDelete ?? (() => { /* no-op */ })}
										/>
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</div>

			{/* STYLING TABS (Minimal Segmented Control) */}
			<div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-secondary/35 border border-border/50 text-xs">
				{tabs.map((tab) => {
					const Icon = tab.icon;
					const isSelected = activeTab === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={`flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-lg text-xs font-medium transition-all ${isSelected
									? "bg-background text-foreground shadow-xs font-semibold"
									: "text-muted-foreground hover:text-foreground hover:bg-background/40"
								}`}
						>
							<Icon className="size-3.5" />
							<span>{tab.label}</span>
						</button>
					);
				})}
			</div>

			{/* TAB 1: PRESETS */}
			{activeTab === "presets" && (
				<div className="flex flex-col gap-3 pt-1">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-foreground">
							Instagram Reels Presets
						</span>
						<Button
							size="sm"
							variant="outline"
							className="h-7 gap-1 px-2 text-[11px]"
							onClick={() => setIsSavingPreset(!isSavingPreset)}
						>
							<Plus className="size-3" />
							<span>Save Current Style</span>
						</Button>
					</div>

					{isSavingPreset && (
						<div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
							<input
								placeholder="Preset name (e.g. My Viral Glow)"
								value={newPresetName}
								onChange={(e) => setNewPresetName(e.target.value)}
								className="h-7 flex-1 rounded bg-background px-2 text-xs border border-border outline-none focus:border-primary"
							/>
							<Button
								size="sm"
								className="h-7 px-3 text-xs"
								onClick={handleSaveCustomPreset}
								disabled={!newPresetName.trim()}
							>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-2 text-xs"
								onClick={() => setIsSavingPreset(false)}
							>
								Cancel
							</Button>
						</div>
					)}

					<div className="grid grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
						{allPresets.map((preset) => {
							const isSelected = settings.activePresetId === preset.id;
							return (
								<button
									key={preset.id}
									type="button"
									onClick={() => applyPreset(preset)}
									className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border p-2.5 text-left transition-all hover:scale-[1.02] ${isSelected
											? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/30"
											: "border-border/70 bg-card/60 hover:border-border hover:bg-card/90"
										}`}
								>
									{/* Top Header */}
									<div className="flex items-center justify-between gap-1">
										<span className="truncate text-xs font-bold text-foreground">
											{preset.name}
										</span>
										{preset.isCustom && (
											<button
												type="button"
												aria-label="Delete preset"
												onClick={(e) => handleDeletePreset(preset.id, e)}
												className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
											>
												<Trash className="size-3" />
											</button>
										)}
									</div>

									{/* Visual Live Preview Card */}
									<div className="my-2 flex h-14 w-full items-center justify-center rounded-lg bg-black/80 px-2 py-1 overflow-hidden">
										<div
											style={{
												fontFamily: preset.fontFamily,
												fontSize: "13px",
												fontWeight: preset.fontWeight,
												letterSpacing: `${preset.letterSpacing}px`,
												textTransform: preset.textTransform,
												color: preset.textColor,
												textShadow: preset.shadow
													? `${preset.shadow.offsetX}px ${preset.shadow.offsetY}px ${preset.shadow.blur}px ${preset.shadow.color}`
													: undefined,
												backgroundColor:
													preset.backgroundStyle === "none"
														? "transparent"
														: preset.backgroundColor,
												opacity: 1,
												borderRadius: `${Math.min(12, preset.boxRadius)}px`,
												padding: "3px 6px",
											}}
											className="truncate text-center"
										>
											<span>Viral </span>
											<span style={{ color: preset.activeWordColor }}>
												Caption
											</span>
										</div>
									</div>

									{/* Footer Meta */}
									<div className="flex items-center justify-between text-[10px] text-muted-foreground">
										<span className="capitalize">{preset.category}</span>
										{isSelected && (
											<span className="flex items-center gap-1 font-semibold text-primary">
												<Check className="size-3" /> Active
											</span>
										)}
									</div>
								</button>
							);
						})}
					</div>
				</div>
			)}

			{/* TAB 2: TYPOGRAPHY & FONT */}
			{activeTab === "typography" && (
				<div className="flex flex-col gap-4 pt-1">
					{/* Search & Category Header */}
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<div className="relative flex-1">
								<MagnifyingGlass className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
								<input
									placeholder="Search fonts (e.g. Montserrat, Noto, Bebas)..."
									value={fontSearch}
									onChange={(e) => setFontSearch(e.target.value)}
									className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
								/>
							</div>
							<AddCustomFontDialog
								onFontAdded={(font) => {
									setCustomFonts(getCustomFonts());
									onUpdateSettings({ fontFamily: font.fontFamily });
								}}
							/>
						</div>

						{/* Font Category Chips */}
						<div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
							<button
								type="button"
								onClick={() => setSelectedFontCategory("all")}
								className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${selectedFontCategory === "all"
										? "bg-primary text-primary-foreground"
										: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
									}`}
							>
								All
							</button>
							{CAPTION_FONT_CATEGORIES.map((cat) => (
								<button
									key={cat.id}
									type="button"
									onClick={() => setSelectedFontCategory(cat.id)}
									className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${selectedFontCategory === cat.id
											? "bg-primary text-primary-foreground"
											: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
										}`}
								>
									{cat.label}
								</button>
							))}
						</div>
					</div>

					{/* Font Selector Cards Grid */}
					<div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
						{filteredFonts.map((font) => {
							const isCurrent =
								settings.fontFamily.includes(font.name) ||
								settings.fontFamily === font.fontFamily;
							return (
								<button
									key={font.id}
									type="button"
									onClick={() => {
										onUpdateSettings({ fontFamily: font.fontFamily });
										if (font.googleFont) {
											ensureCaptionFontLoaded(font.googleFont);
										}
									}}
									className={`flex flex-col items-start justify-between rounded-lg border p-2 text-left transition-all ${isCurrent
											? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
											: "border-border/60 bg-card/40 hover:bg-card/90"
										}`}
								>
									<div className="truncate text-xs font-semibold text-foreground">
										{font.name}
									</div>
									<div
										style={{ fontFamily: font.fontFamily }}
										className="mt-1 truncate text-sm text-foreground/80"
									>
										{font.sampleText || "Ag റെക്കോർഡ്‌ലി"}
									</div>
								</button>
							);
						})}
					</div>

					{/* Sliders: Size, Weight, Spacing, Line Height */}
					<div className="space-y-3 pt-2 border-t border-border/40">
						<SliderControl
							label="Font Size"
							value={settings.fontSize}
							min={14}
							max={90}
							step={1}
							onChange={(fontSize) => onUpdateSettings({ fontSize })}
							formatValue={(v) => `${Math.round(v)}px`}
						/>

						{/* Font Weight */}
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs font-medium text-foreground">Font Weight</span>
							<Select
								value={String(settings.fontWeight ?? 700)}
								onValueChange={(val) => onUpdateSettings({ fontWeight: Number(val) })}
							>
								<SelectTrigger className="h-8 w-32 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="400">Regular (400)</SelectItem>
									<SelectItem value="500">Medium (500)</SelectItem>
									<SelectItem value="600">Semi-Bold (600)</SelectItem>
									<SelectItem value="700">Bold (700)</SelectItem>
									<SelectItem value="800">Extra-Bold (800)</SelectItem>
									<SelectItem value="900">Black (900)</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Text Transform */}
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs font-medium text-foreground">Capitalization</span>
							<div className="flex gap-1">
								{(
									[
										{ id: "none", label: "Aa" },
										{ id: "uppercase", label: "AA" },
										{ id: "lowercase", label: "aa" },
										{ id: "capitalize", label: "Abc" },
									] as const
								).map((item) => (
									<button
										key={item.id}
										type="button"
										onClick={() =>
											onUpdateSettings({ textTransform: item.id as CaptionTextTransform })
										}
										className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${(settings.textTransform ?? "none") === item.id
												? "bg-primary text-primary-foreground"
												: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
											}`}
									>
										{item.label}
									</button>
								))}
							</div>
						</div>

						<SliderControl
							label="Letter Spacing"
							value={settings.letterSpacing ?? 0}
							min={-2}
							max={12}
							step={0.5}
							onChange={(letterSpacing) => onUpdateSettings({ letterSpacing })}
							formatValue={(v) => `${v.toFixed(1)}px`}
						/>

						<SliderControl
							label="Line Height"
							value={settings.lineHeight ?? 1.25}
							min={0.9}
							max={2.2}
							step={0.05}
							onChange={(lineHeight) => onUpdateSettings({ lineHeight })}
							formatValue={(v) => `${v.toFixed(2)}×`}
						/>
					</div>

					{/* Stroke & Outline */}
					<div className="space-y-3 pt-2 border-t border-border/40">
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold text-foreground">
								Text Stroke / Outline
							</span>
							<ColorControl
								compact
								label="Stroke Color"
								value={settings.stroke?.color ?? "#000000"}
								onChange={(color: string) =>
									onUpdateSettings({
										stroke: {
											color,
											width: settings.stroke?.width ?? 2,
										},
									})
								}
							/>
						</div>
						<SliderControl
							label="Stroke Width"
							value={settings.stroke?.width ?? 0}
							min={0}
							max={10}
							step={0.5}
							onChange={(width) =>
								onUpdateSettings({
									stroke: {
										color: settings.stroke?.color ?? "#000000",
										width,
									},
								})
							}
							formatValue={(v) => `${v.toFixed(1)}px`}
						/>
					</div>

					{/* Text Shadow */}
					<div className="space-y-3 pt-2 border-t border-border/40">
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold text-foreground">
								Text Shadow / Glow
							</span>
							<ColorControl
								compact
								label="Shadow Color"
								value={settings.shadow?.color ?? "#000000"}
								onChange={(color: string) =>
									onUpdateSettings({
										shadow: {
											color,
											blur: settings.shadow?.blur ?? 6,
											opacity: settings.shadow?.opacity ?? 0.7,
											offsetX: settings.shadow?.offsetX ?? 0,
											offsetY: settings.shadow?.offsetY ?? 2,
										},
									})
								}
							/>
						</div>
						<SliderControl
							label="Shadow Blur"
							value={settings.shadow?.blur ?? 4}
							min={0}
							max={30}
							step={1}
							onChange={(blur) =>
								onUpdateSettings({
									shadow: {
										color: settings.shadow?.color ?? "#000000",
										blur,
										opacity: settings.shadow?.opacity ?? 0.7,
										offsetX: settings.shadow?.offsetX ?? 0,
										offsetY: settings.shadow?.offsetY ?? 2,
									},
								})
							}
							formatValue={(v) => `${Math.round(v)}px`}
						/>
					</div>
				</div>
			)}

			{/* TAB 3: COLORS & BACKGROUND */}
			{activeTab === "colors" && (
				<div className="flex flex-col gap-4 pt-1">
					{/* Text Colors */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<div>
								<div className="text-xs font-semibold text-foreground">
									Main Text Color
								</div>
								<div className="text-[11px] text-muted-foreground">
									Base spoken text color
								</div>
							</div>
							<ColorControl
								compact
								label="Text Color"
								value={settings.textColor}
								onChange={(textColor: string) => onUpdateSettings({ textColor })}
							/>
						</div>

						{/* Quick Color Swatches */}
						<div className="flex flex-wrap gap-1.5">
							{QUICK_COLORS.map((c) => (
								<button
									key={c.value}
									type="button"
									title={c.name}
									onClick={() => onUpdateSettings({ textColor: c.value })}
									className={`size-6 rounded-full border border-white/20 transition-transform hover:scale-110 ${settings.textColor.toLowerCase() === c.value.toLowerCase()
											? "ring-2 ring-primary ring-offset-2 ring-offset-background"
											: ""
										}`}
									style={{ backgroundColor: c.value }}
								/>
							))}
						</div>

						{/* Active Word Color */}
						<div className="flex items-center justify-between pt-2 border-t border-border/40">
							<div>
								<div className="text-xs font-semibold text-foreground">
									Active Spoken Word Highlight
								</div>
								<div className="text-[11px] text-muted-foreground">
									Color of word currently spoken
								</div>
							</div>
							<ColorControl
								compact
								label="Active Word Color"
								value={settings.activeWordColor ?? "#FFE600"}
								onChange={(activeWordColor: string) => onUpdateSettings({ activeWordColor })}
							/>
						</div>

						{/* Quick Highlight Swatches */}
						<div className="flex flex-wrap gap-1.5">
							{QUICK_COLORS.slice(1, 8).map((c) => (
								<button
									key={c.value}
									type="button"
									title={c.name}
									onClick={() => onUpdateSettings({ activeWordColor: c.value })}
									className={`size-6 rounded-full border border-white/20 transition-transform hover:scale-110 ${(settings.activeWordColor ?? "").toLowerCase() ===
											c.value.toLowerCase()
											? "ring-2 ring-primary ring-offset-2 ring-offset-background"
											: ""
										}`}
									style={{ backgroundColor: c.value }}
								/>
							))}
						</div>
					</div>

					{/* Caption Background Styles */}
					<div className="space-y-3 pt-3 border-t border-border/40">
						<span className="text-xs font-semibold text-foreground">
							Background Shape & Style
						</span>
						<div className="grid grid-cols-4 gap-1.5">
							{(
								[
									{ id: "none", label: "None" },
									{ id: "pill", label: "Pill" },
									{ id: "rounded", label: "Rounded" },
									{ id: "box", label: "Box" },
									{ id: "wordBadge", label: "Badge" },
									{ id: "fullWidth", label: "Full Bar" },
									{ id: "semiDark", label: "Semi-Dark" },
									{ id: "transparent", label: "Glass" },
								] as const
							).map((bg) => {
								const isCurrent =
									(settings.backgroundStyle ?? "rounded") === bg.id;
								return (
									<button
										key={bg.id}
										type="button"
										onClick={() =>
											onUpdateSettings({
												backgroundStyle: bg.id as CaptionBackgroundStyle,
											})
										}
										className={`rounded-lg border p-2 text-center text-xs font-semibold transition-all ${isCurrent
												? "border-primary bg-primary/15 text-primary ring-1 ring-primary"
												: "border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary"
											}`}
									>
										{bg.label}
									</button>
								);
							})}
						</div>

						<div className="flex items-center justify-between pt-1">
							<span className="text-xs font-medium text-foreground">
								Background Color
							</span>
							<ColorControl
								compact
								label="Background Color"
								value={settings.backgroundColor ?? "#000000"}
								onChange={(backgroundColor: string) =>
									onUpdateSettings({ backgroundColor })
								}
							/>
						</div>

						<SliderControl
							label="Background Opacity"
							value={settings.backgroundOpacity}
							min={0}
							max={1}
							step={0.05}
							onChange={(backgroundOpacity) =>
								onUpdateSettings({ backgroundOpacity })
							}
							formatValue={(v) => `${Math.round(v * 100)}%`}
						/>

						<SliderControl
							label="Corner Radius"
							value={settings.boxRadius}
							min={0}
							max={40}
							step={1}
							onChange={(boxRadius) => onUpdateSettings({ boxRadius })}
							formatValue={(v) => `${Math.round(v)}px`}
						/>
					</div>
				</div>
			)}

			{/* TAB 4: ANIMATIONS & MOTION */}
			{activeTab === "animations" && (
				<div className="flex flex-col gap-4 pt-1">
					{/* Filter tabs */}
					<div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
						{(
							[
								{ id: "all", label: "All" },
								{ id: "signature", label: "Reels Viral" },
								{ id: "entrance", label: "Entrance" },
								{ id: "emphasis", label: "Emphasis" },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setAnimCategoryFilter(tab.id)}
								className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${animCategoryFilter === tab.id
										? "bg-primary text-primary-foreground"
										: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
									}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					{/* Animation Cards Gallery */}
					<div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
						{filteredAnimations.map((anim) => {
							const isSelected = settings.animationStyle === anim.id;
							return (
								<button
									key={anim.id}
									type="button"
									onClick={() =>
										onUpdateSettings({
											animationStyle: anim.id as CaptionAnimationStyle,
										})
									}
									className={`group flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${isSelected
											? "border-primary bg-primary/10 ring-2 ring-primary/40 shadow-sm"
											: "border-border/60 bg-card/40 hover:bg-card/90"
										}`}
								>
									<div className="truncate text-xs font-bold text-foreground">
										{anim.name}
									</div>
									<div className="my-2 flex h-9 w-full items-center justify-center rounded-md bg-black/60 overflow-hidden">
										<span
											className={`text-xs font-bold text-primary ${anim.previewClass}`}
										>
											Aa Motion
										</span>
									</div>
									<div className="truncate text-[10px] text-muted-foreground">
										{anim.description}
									</div>
								</button>
							);
						})}
					</div>

					{/* Animation Scope */}
					<div className="space-y-3 pt-2 border-t border-border/40">
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs font-semibold text-foreground">
								Animation Scope
							</span>
							<div className="flex gap-1">
								{(
									[
										{ id: "caption", label: "Entire Line" },
										{ id: "word", label: "Per Word" },
										{ id: "character", label: "Per Char" },
									] as const
								).map((scope) => (
									<button
										key={scope.id}
										type="button"
										onClick={() =>
											onUpdateSettings({
												animationScope: scope.id as CaptionAnimationScope,
											})
										}
										className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${(settings.animationScope ?? "word") === scope.id
												? "bg-primary text-primary-foreground"
												: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
											}`}
									>
										{scope.label}
									</button>
								))}
							</div>
						</div>

						<SliderControl
							label="Animation Duration"
							value={settings.animationDurationMs ?? 250}
							min={100}
							max={1200}
							step={50}
							onChange={(animationDurationMs) =>
								onUpdateSettings({ animationDurationMs })
							}
							formatValue={(v) => `${Math.round(v)}ms`}
						/>
					</div>
				</div>
			)}

			{/* TAB 5: LAYOUT & SAFE AREA */}
			{activeTab === "layout" && (
				<div className="flex flex-col gap-4 pt-1">
					{/* Alignment */}
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-foreground">
							Horizontal Alignment
						</span>
						<div className="flex gap-1">
							{(
								[
									{ id: "left", label: "Left" },
									{ id: "center", label: "Center" },
									{ id: "right", label: "Right" },
								] as const
							).map((align) => (
								<button
									key={align.id}
									type="button"
									onClick={() =>
										onUpdateSettings({
											alignment: align.id as CaptionAlignment,
										})
									}
									className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${(settings.alignment ?? "center") === align.id
											? "bg-primary text-primary-foreground"
											: "bg-secondary/60 text-muted-foreground hover:bg-secondary"
										}`}
								>
									{align.label}
								</button>
							))}
						</div>
					</div>

					{/* Instagram Reels Safe Area Guides Toggle */}
					<div className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3">
						<div className="flex flex-col gap-0.5">
							<span className="text-xs font-semibold text-cyan-300">
								Instagram Reels Safe Zone Guides
							</span>
							<span className="text-[11px] text-cyan-400/80">
								Displays 9:16 headers and action button safe margins
							</span>
						</div>
						<Switch
							aria-label="Toggle Reels Safe Area Guides"
							checked={settings.showSafeGuides ?? false}
							onCheckedChange={(showSafeGuides: boolean) =>
								onUpdateSettings({ showSafeGuides })
							}
						/>
					</div>

					<SliderControl
						label="Vertical Offset from Bottom"
						value={settings.bottomOffset}
						min={0}
						max={45}
						step={1}
						onChange={(bottomOffset) => onUpdateSettings({ bottomOffset })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>

					<SliderControl
						label="Max Caption Width"
						value={settings.maxWidth}
						min={35}
						max={95}
						step={1}
						onChange={(maxWidth) => onUpdateSettings({ maxWidth })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>

					<SliderControl
						label="Max Visible Lines / Rows"
						value={settings.maxRows}
						min={1}
						max={4}
						step={1}
						onChange={(maxRows) => onUpdateSettings({ maxRows: Math.round(maxRows) })}
						formatValue={(v) => `${Math.round(v)} lines`}
					/>
				</div>
			)}
		</div>
	);
};
