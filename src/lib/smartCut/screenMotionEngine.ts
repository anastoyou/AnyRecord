import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { SMART_CUT_BIN_MS } from "./smartCutTypes";

const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 90;
const DEFAULT_SAMPLE_INTERVAL_MS = 500;
const MAX_VIDEO_SEEKS = 240;

export interface VideoMotionBinsResult {
	mapd: Float32Array;
	hasSamples: boolean;
}

/**
 * Pure helper that computes Mean Absolute Pixel Difference (MAPD) in [0, 1]
 * between two RGBA image buffers using perceived luminance.
 */
export function computeFrameLuminanceMapd(
	prevRgba: Uint8ClampedArray | Uint8Array,
	currRgba: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	centerWeighted = false,
): number {
	const totalPixels = width * height;
	if (totalPixels <= 0 || prevRgba.length < totalPixels * 4 || currRgba.length < totalPixels * 4) {
		return 0;
	}

	const xMin = Math.floor(width * 0.2);
	const xMax = Math.ceil(width * 0.8);
	const yMin = Math.floor(height * 0.2);
	const yMax = Math.ceil(height * 0.8);

	let weightedDiffSum = 0;
	let weightSum = 0;

	for (let y = 0; y < height; y++) {
		const inCenterY = centerWeighted && y >= yMin && y < yMax;
		const rowOffset = y * width * 4;
		for (let x = 0; x < width; x++) {
			const idx = rowOffset + x * 4;
			const prevY =
				0.299 * prevRgba[idx] + 0.587 * prevRgba[idx + 1] + 0.114 * prevRgba[idx + 2];
			const currY =
				0.299 * currRgba[idx] + 0.587 * currRgba[idx + 1] + 0.114 * currRgba[idx + 2];

			const weight = inCenterY && x >= xMin && x < xMax ? 2.0 : 1.0;
			weightedDiffSum += (Math.abs(currY - prevY) / 255) * weight;
			weightSum += weight;
		}
	}

	return weightSum > 0 ? weightedDiffSum / weightSum : 0;
}

function seekVideoWithTimeout(
	video: HTMLVideoElement,
	timeSec: number,
	timeoutMs = 800,
): Promise<boolean> {
	return new Promise((resolve) => {
		if (Math.abs(video.currentTime - timeSec) < 0.01 && video.readyState >= 2) {
			resolve(true);
			return;
		}

		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
			resolve(ok);
		};

		const onSeeked = () => finish(true);
		const onError = () => finish(false);
		const timer = setTimeout(() => finish(false), timeoutMs);

		video.addEventListener("seeked", onSeeked, { once: true });
		video.addEventListener("error", onError, { once: true });

		try {
			video.currentTime = timeSec;
		} catch {
			finish(false);
		}
	});
}

/**
 * Samples frames from a video source at ~2 fps into a 160x90 canvas and
 * populates 100ms bin series of Mean Absolute Pixel Difference (MAPD).
 */
export async function extractVideoMotionSeries(params: {
	videoPath: string | null | undefined;
	durationMs: number;
	binCount: number;
	binMs?: number;
	centerWeighted?: boolean;
	signal?: AbortSignal;
	onProgress?: (fraction: number) => void;
}): Promise<VideoMotionBinsResult> {
	const {
		videoPath,
		durationMs,
		binCount,
		binMs = SMART_CUT_BIN_MS,
		centerWeighted = false,
		signal,
		onProgress,
	} = params;

	const mapd = new Float32Array(binCount);
	if (
		!videoPath ||
		durationMs <= 0 ||
		binCount <= 0 ||
		typeof document === "undefined"
	) {
		return { mapd, hasSamples: false };
	}

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	video.crossOrigin = "anonymous";

	const canvas = document.createElement("canvas");
	canvas.width = SAMPLE_WIDTH;
	canvas.height = SAMPLE_HEIGHT;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		return { mapd, hasSamples: false };
	}

	try {
		const resolvedUrl = await resolveMediaResourceUrl(videoPath);
		if (signal?.aborted) {
			return { mapd, hasSamples: false };
		}

		const loaded = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 3000);
			video.addEventListener(
				"loadeddata",
				() => {
					clearTimeout(timer);
					resolve(true);
				},
				{ once: true },
			);
			video.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					resolve(false);
				},
				{ once: true },
			);
			video.src = resolvedUrl;
			video.load();
		});

		if (!loaded || signal?.aborted) {
			return { mapd, hasSamples: false };
		}

		const adaptiveIntervalMs = Math.max(
			DEFAULT_SAMPLE_INTERVAL_MS,
			Math.ceil(durationMs / MAX_VIDEO_SEEKS / 100) * 100,
		);
		const totalSteps = Math.max(1, Math.ceil(durationMs / adaptiveIntervalMs));

		let prevFrame: Uint8ClampedArray | null = null;
		let prevTimeMs = 0;
		let sampleCount = 0;

		for (let step = 0; step <= totalSteps; step++) {
			if (signal?.aborted) break;
			const sampleTimeMs = Math.min(durationMs, step * adaptiveIntervalMs);
			const ok = await seekVideoWithTimeout(video, sampleTimeMs / 1000);
			if (!ok) continue;

			ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
			const imageData = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
			const currFrame = new Uint8ClampedArray(imageData.data);

			if (prevFrame !== null) {
				const diff = computeFrameLuminanceMapd(
					prevFrame,
					currFrame,
					SAMPLE_WIDTH,
					SAMPLE_HEIGHT,
					centerWeighted,
				);
				const startBin = Math.max(0, Math.floor(prevTimeMs / binMs));
				const endBin = Math.min(binCount - 1, Math.floor(sampleTimeMs / binMs));
				for (let b = startBin; b <= endBin; b++) {
					mapd[b] = Math.max(mapd[b], diff);
				}
				sampleCount++;
			}

			prevFrame = currFrame;
			prevTimeMs = sampleTimeMs;
			onProgress?.(Math.min(1, (step + 1) / (totalSteps + 1)));
		}

		return {
			mapd,
			hasSamples: sampleCount > 0,
		};
	} catch {
		return { mapd, hasSamples: false };
	} finally {
		try {
			video.pause();
			video.removeAttribute("src");
			video.load();
		} catch {
			// ignore cleanup errors
		}
	}
}

