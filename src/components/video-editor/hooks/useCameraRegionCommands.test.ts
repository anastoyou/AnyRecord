import { describe, expect, it } from "vitest";
import {
	deleteCameraRegionList,
	deriveCameraRegionsFromVisibleRanges,
	splitCameraRegionList,
	updateCameraRegionSpanList,
} from "./useCameraRegionCommands";

describe("useCameraRegionCommands helpers", () => {
	it("initializes full-duration camera region when visibleRanges is undefined", () => {
		expect(deriveCameraRegionsFromVisibleRanges(true, undefined, 12)).toEqual([
			{ id: "camera-0", startMs: 0, endMs: 12000 },
		]);
	});

	it("restores full-duration camera region after splitting, deleting, and undoing back to undefined visibleRanges", () => {
		const initial = deriveCameraRegionsFromVisibleRanges(true, undefined, 10);
		let nextId = 1;
		const { regions: afterSplit } = splitCameraRegionList(
			initial,
			4000,
			() => `camera-${nextId++}`,
		);
		expect(afterSplit).toEqual([
			{ id: "camera-1", startMs: 0, endMs: 4000 },
			{ id: "camera-2", startMs: 4000, endMs: 10000 },
		]);

		const afterDelete = deleteCameraRegionList(afterSplit, "camera-1");
		expect(afterDelete).toEqual([{ id: "camera-2", startMs: 4000, endMs: 10000 }]);

		// Undoing back to initial state where webcam.visibleRanges is undefined
		const afterUndoToInitial = deriveCameraRegionsFromVisibleRanges(true, undefined, 10);
		expect(afterUndoToInitial).toEqual([{ id: "camera-0", startMs: 0, endMs: 10000 }]);
	});

	it("updates camera region span with minimum duration guard", () => {
		const updated = updateCameraRegionSpanList(
			[{ id: "camera-1", startMs: 0, endMs: 5000 }],
			"camera-1",
			{ start: 1000, end: 1020 },
		);
		expect(updated).toEqual([{ id: "camera-1", startMs: 1000, endMs: 1100 }]);
	});
});
