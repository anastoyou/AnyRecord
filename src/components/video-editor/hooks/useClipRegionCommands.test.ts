import { describe, expect, it, vi } from "vitest";
import type { ClipRegion } from "../types";
import { useClipRegionCommands } from "./useClipRegionCommands";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
}));

describe("clip split selection", () => {
	it("selects the middle section after two cuts so Delete removes it", () => {
		let clips: ClipRegion[] = [{ id: "original", startMs: 0, endMs: 3_000, speed: 1 }];
		let selectedClipId: string | null = null;
		const nextClipIdRef = { current: 1 };
		const setClipRegions = (value: ClipRegion[] | ((current: ClipRegion[]) => ClipRegion[])) => {
			clips = typeof value === "function" ? value(clips) : value;
		};
		const setSelectedClipId = (value: string | null) => {
			selectedClipId = value;
		};
		const commands = () =>
			useClipRegionCommands({
				clipRegions: clips,
				selectedClipId,
				sourceDurationMs: 3_000,
				nextClipIdRef,
				setClipRegions,
				setSelectedClipId,
				setZoomRegions: () => {},
				setAnnotationRegions: () => {},
				setAudioRegions: () => {},
				setSelectedZoomId: () => {},
				setSelectedAnnotationId: () => {},
				setSelectedAudioId: () => {},
				setSelectedCaptionId: () => {},
				setActiveEffectSection: () => {},
				t: (key) => key,
			});

		commands().handleClipSplit(1_000);
		expect(clips[0].id).toBe("clip-1");
		selectedClipId = clips[1].id;
		commands().handleClipSplit(2_000);
		expect(selectedClipId).toBe(clips[1].id);
		commands().handleClipDelete(selectedClipId!);
		expect(clips).toMatchObject([
			{ startMs: 0, endMs: 1_000 },
			{ startMs: 1_000, endMs: 2_000, sourceStartMs: 2_000 },
		]);
	});

	it("applies Smart Cut candidates and packs remaining clips non-destructively", () => {
		let clips: ClipRegion[] = [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 }];
		let selectedClipId: string | null = null;
		const nextClipIdRef = { current: 2 };
		const setClipRegions = (value: ClipRegion[] | ((current: ClipRegion[]) => ClipRegion[])) => {
			clips = typeof value === "function" ? value(clips) : value;
		};
		const setSelectedClipId = (value: string | null) => {
			selectedClipId = value;
		};
		const commands = () =>
			useClipRegionCommands({
				clipRegions: clips,
				selectedClipId,
				sourceDurationMs: 10_000,
				nextClipIdRef,
				setClipRegions,
				setSelectedClipId,
				setZoomRegions: () => {},
				setAnnotationRegions: () => {},
				setAudioRegions: () => {},
				setSelectedZoomId: () => {},
				setSelectedAnnotationId: () => {},
				setSelectedAudioId: () => {},
				setSelectedCaptionId: () => {},
				setActiveEffectSection: () => {},
				t: (key) => key,
			});

		const outcome = commands().handleApplySmartCut([
			{
				id: "smart-cut-1",
				sourceStartMs: 2_000,
				sourceEndMs: 6_000,
				timelineStartMs: 2_000,
				timelineEndMs: 6_000,
				durationMs: 4_000,
				enabled: true,
			},
		]);

		expect(outcome).toEqual({
			appliedCutCount: 1,
			removedDurationMs: 4_000,
		});
		expect(clips).toMatchObject([
			{ startMs: 0, endMs: 2_000, sourceStartMs: 0 },
			{ startMs: 2_000, endMs: 6_000, sourceStartMs: 6_000 },
		]);
	});
});
