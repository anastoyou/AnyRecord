import { describe, expect, it } from "vitest";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";

// Helper function implementing the matching logic from useProjectLibraryController
function mergeLocalAndCloudProjects(
	localEntries: ProjectLibraryEntry[],
	cloudProjects: Array<{
		projectId: string;
		name: string;
		thumbnailUrl: string | null;
		updatedAt: string;
	}>,
): ProjectLibraryEntry[] {
	const cloudProjectsById = new Map<string, (typeof cloudProjects)[number]>();
	const cloudProjectsByName = new Map<string, (typeof cloudProjects)[number]>();

	for (const p of cloudProjects) {
		if (p.projectId) {
			cloudProjectsById.set(p.projectId, p);
		}
		if (p.name) {
			cloudProjectsByName.set(p.name.trim().toLowerCase(), p);
		}
	}

	const matchedCloudIds = new Set<string>();

	const mergedLocal: ProjectLibraryEntry[] = localEntries.map((entry) => {
		const matchedCloud =
			(entry.projectId ? cloudProjectsById.get(entry.projectId) : undefined) ??
			cloudProjectsByName.get(entry.name.trim().toLowerCase());

		if (matchedCloud) {
			matchedCloudIds.add(matchedCloud.projectId);
			return {
				...entry,
				thumbnailPath: entry.thumbnailPath || matchedCloud.thumbnailUrl || null,
				isCloud: true,
				cloudProjectId: matchedCloud.projectId,
			};
		}

		return entry;
	});

	const remoteCloudEntries: ProjectLibraryEntry[] = cloudProjects
		.filter((p) => !matchedCloudIds.has(p.projectId))
		.map((p) => ({
			name: p.name,
			path: `cloud://${p.projectId}`,
			updatedAt: new Date(p.updatedAt).getTime(),
			thumbnailPath: p.thumbnailUrl || null,
			isCurrent: false,
			isInProjectsDirectory: false,
			isCloud: true,
			cloudProjectId: p.projectId,
		}));

	return [...mergedLocal, ...remoteCloudEntries].sort(
		(a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
	);
}

describe("Project Library Cloud Integration", () => {
	it("marks local projects as isCloud when matched by projectId without duplication", () => {
		const local: ProjectLibraryEntry[] = [
			{
				path: "/Users/demo/Projects/ProjectA.recordly",
				name: "Project A",
				updatedAt: 1000,
				thumbnailPath: "/thumb/a.jpg",
				isCurrent: false,
				isInProjectsDirectory: true,
				projectId: "uuid-a",
			},
		];

		const cloud = [
			{
				projectId: "uuid-a",
				name: "Project A",
				thumbnailUrl: "https://cloudinary.com/a.jpg",
				updatedAt: "2026-11-06T10:00:00Z",
			},
		];

		const result = mergeLocalAndCloudProjects(local, cloud);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("/Users/demo/Projects/ProjectA.recordly");
		expect(result[0].isCloud).toBe(true);
		expect(result[0].cloudProjectId).toBe("uuid-a");
	});

	it("marks local projects as isCloud when matched by project name case-insensitively", () => {
		const local: ProjectLibraryEntry[] = [
			{
				path: "/Users/demo/Projects/Demo.recordly",
				name: "My Awesome Video",
				updatedAt: 2000,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
		];

		const cloud = [
			{
				projectId: "uuid-awesome",
				name: "my awesome video",
				thumbnailUrl: "https://cloudinary.com/thumb.jpg",
				updatedAt: "2026-11-06T12:00:00Z",
			},
		];

		const result = mergeLocalAndCloudProjects(local, cloud);

		expect(result).toHaveLength(1);
		expect(result[0].isCloud).toBe(true);
		expect(result[0].cloudProjectId).toBe("uuid-awesome");
		expect(result[0].thumbnailPath).toBe("https://cloudinary.com/thumb.jpg");
	});

	it("adds remote-only cloud projects from other computers with cloud:// protocol", () => {
		const local: ProjectLibraryEntry[] = [
			{
				path: "/Users/demo/Projects/LocalOnly.recordly",
				name: "Local Only",
				updatedAt: 1000,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
		];

		const cloud = [
			{
				projectId: "uuid-computer-b",
				name: "Recorded on Laptop B",
				thumbnailUrl: "https://cloudinary.com/laptop.jpg",
				updatedAt: "2026-11-06T14:00:00Z",
			},
		];

		const result = mergeLocalAndCloudProjects(local, cloud);

		expect(result).toHaveLength(2);

		// Sorted by updatedAt descending: cloud project (2026) is first
		expect(result[0].name).toBe("Recorded on Laptop B");
		expect(result[0].path).toBe("cloud://uuid-computer-b");
		expect(result[0].isCloud).toBe(true);
		expect(result[0].cloudProjectId).toBe("uuid-computer-b");

		// Local project remains without isCloud
		expect(result[1].name).toBe("Local Only");
		expect(result[1].isCloud).toBeUndefined();
	});
});

