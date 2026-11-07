import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns false for empty text", async () => {
		const result = await copyTextToClipboard("");
		expect(result).toBe(false);
	});

	it("uses Electron native clipboard when available", async () => {
		const copyToClipboard = vi.fn().mockResolvedValue(true);
		vi.stubGlobal("window", { electronAPI: { copyToClipboard } });

		const result = await copyTextToClipboard("https://res.cloudinary.com/demo/video.mp4");
		expect(result).toBe(true);
		expect(copyToClipboard).toHaveBeenCalledWith("https://res.cloudinary.com/demo/video.mp4");
	});

	it("falls back to navigator.clipboard if electronAPI fails or is absent", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const result = await copyTextToClipboard("https://share.anyrecord.dev/v/123");
		expect(result).toBe(true);
		expect(writeText).toHaveBeenCalledWith("https://share.anyrecord.dev/v/123");
	});

	it("falls back to document.execCommand if navigator.clipboard throws", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("Document is not focused"));
		const execCommand = vi.fn().mockReturnValue(true);
		vi.stubGlobal("window", {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		vi.stubGlobal("document", {
			createElement: vi.fn().mockReturnValue({
				style: {},
				setAttribute: vi.fn(),
				focus: vi.fn(),
				select: vi.fn(),
				setSelectionRange: vi.fn(),
			}),
			body: {
				appendChild: vi.fn(),
				removeChild: vi.fn(),
			},
			execCommand,
		});

		const result = await copyTextToClipboard("https://res.cloudinary.com/demo/video.mp4");
		expect(result).toBe(true);
		expect(execCommand).toHaveBeenCalledWith("copy");
	});
});
