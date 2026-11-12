import path from "node:path";
import { expect, it, vi } from "vitest";
import { trashLibraryProjects } from "./trashProjects";

const pA = path.resolve("/private/tmp/a.recordly");
const pB = path.resolve("/private/tmp/b.recordly");
const pTxt = path.resolve("/private/tmp/private.txt");

it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects([pA, pTxt], {
			list: async () => ({ entries: [{ path: pA }] }),
			trash,
			thumbnailPath: (p) => p + ".png",
		}),
	).rejects.toThrow("not in the library");
	expect(trash).not.toHaveBeenCalled();
});
it("trashes only selected project files, deduplicates paths, and reports partial failures", async () => {
	const trash = vi.fn(async (p: string) => {
		if (p.endsWith("b.recordly")) throw Error("locked");
	});
	const result = await trashLibraryProjects(
		[pA, pA, pB],
		{
			list: async () => ({
				entries: [{ path: pA }, { path: pB }],
			}),
			trash,
			thumbnailPath: (p) => p + ".missing.png",
		},
	);
	expect(result.deleted).toEqual([pA]);
	expect(result.errors).toEqual(["Could not trash b.recordly"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([
		pA,
		pB,
	]);
});
