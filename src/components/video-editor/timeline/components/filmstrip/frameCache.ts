import { getRenderableVideoUrl } from "@/lib/assetPath";

// One background decoder at a time; never seek the editor's playback element.
let queue: Promise<unknown> = Promise.resolve();
const frames = new Map<string, string>();
const MAX_CACHED_FRAMES = 512;
const FRAME_QUANTIZE_MS = 50;
const POOLED_VIDEO_IDLE_MS = 4000;

let pooledVideo: HTMLVideoElement | null = null;
let pooledVideoUrl: string | null = null;
let pooledVideoLoaded = false;
let pooledVideoIdleTimer: ReturnType<typeof setTimeout> | null = null;
let pooledCanvas: HTMLCanvasElement | null = null;
let pooledContext: CanvasRenderingContext2D | null = null;

function clearPooledVideoIdleTimer() {
	if (pooledVideoIdleTimer !== null) {
		clearTimeout(pooledVideoIdleTimer);
		pooledVideoIdleTimer = null;
	}
}

function disposePooledVideo() {
	clearPooledVideoIdleTimer();
	pooledVideoLoaded = false;
	if (!pooledVideo) return;
	pooledVideo.pause();
	pooledVideo.removeAttribute("src");
	pooledVideo.load();
	pooledVideo = null;
	pooledVideoUrl = null;
}

function schedulePooledVideoDispose() {
	clearPooledVideoIdleTimer();
	pooledVideoIdleTimer = setTimeout(() => {
		disposePooledVideo();
	}, POOLED_VIDEO_IDLE_MS);
}

function getPooledCanvasContext() {
	if (!pooledCanvas) {
		pooledCanvas = document.createElement("canvas");
		pooledCanvas.width = 160;
		pooledCanvas.height = 90;
		pooledContext = pooledCanvas.getContext("2d");
	}
	return { canvas: pooledCanvas, context: pooledContext };
}

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			video.removeEventListener(event, ready);
			video.removeEventListener("error", failed);
			signal.removeEventListener("abort", failed);
		};
		const ready = () => {
			cleanup();
			resolve();
		};
		const failed = () => {
			cleanup();
			reject(new Error("Frame extraction cancelled or unavailable"));
		};
		const timeout = setTimeout(failed, 8000);
		video.addEventListener(event, ready, { once: true });
		video.addEventListener("error", failed, { once: true });
		signal.addEventListener("abort", failed, { once: true });
		if (signal.aborted) failed();
	});
}

async function getDecoderVideo(url: string, signal: AbortSignal): Promise<HTMLVideoElement> {
	clearPooledVideoIdleTimer();
	if (
		pooledVideo &&
		pooledVideoLoaded &&
		pooledVideoUrl === url &&
		pooledVideo.readyState >= 2 &&
		!pooledVideo.error
	) {
		return pooledVideo;
	}

	disposePooledVideo();
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	video.crossOrigin = "anonymous";
	pooledVideo = video;
	pooledVideoUrl = url;
	pooledVideoLoaded = false;

	const loaded = waitForVideo(video, "loadeddata", signal);
	video.src = url;
	await loaded;
	pooledVideoLoaded = true;
	return video;
}

export function extractFilmstrip(
	path: string,
	times: number[],
	signal: AbortSignal,
): Promise<string[]> {
	const job = queue.then(async () => {
		if (signal.aborted || times.length === 0) return [];
		const quantizedTimes = times.map(
			(time) => Math.round(time / FRAME_QUANTIZE_MS) * FRAME_QUANTIZE_MS,
		);
		const keys = quantizedTimes.map((time) => `${path}:${time}`);
		if (keys.every((key) => frames.has(key))) {
			return keys.map((key) => {
				const cached = frames.get(key)!;
				frames.delete(key);
				frames.set(key, cached);
				return cached;
			});
		}
		const url = await getRenderableVideoUrl(path);
		if (signal.aborted) return [];
		const { canvas, context } = getPooledCanvasContext();
		if (!context) return [];

		let hadError = false;
		try {
			const video = await getDecoderVideo(url, signal);
			if (!video.videoWidth || !video.videoHeight) return [];
			const result: string[] = [];
			for (let index = 0; index < quantizedTimes.length; index++) {
				if (signal.aborted) return [];
				const key = keys[index];
				const cached = frames.get(key);
				if (cached) {
					frames.delete(key);
					frames.set(key, cached);
					result.push(cached);
					continue;
				}
				const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 0.001 : 0;
				const time = Math.max(0, Math.min(quantizedTimes[index] / 1000, maxTime));
				if (Math.abs(video.currentTime - time) > 0.0001) {
					const sought = waitForVideo(video, "seeked", signal);
					video.currentTime = time;
					await sought;
				}
				// Some non-seekable sources silently reset to zero; don't show misleading copies.
				if (Math.abs(video.currentTime - time) > 0.12)
					throw new Error("Source does not support accurate seeking");
				const scale = Math.max(
					canvas.width / video.videoWidth,
					canvas.height / video.videoHeight,
				);
				const width = video.videoWidth * scale;
				const height = video.videoHeight * scale;
				context.drawImage(
					video,
					(canvas.width - width) / 2,
					(canvas.height - height) / 2,
					width,
					height,
				);
				const frame = canvas.toDataURL("image/jpeg", 0.7);
				frames.delete(key);
				frames.set(key, frame);
				if (frames.size > MAX_CACHED_FRAMES) frames.delete(frames.keys().next().value!);
				result.push(frame);
			}
			return result;
		} catch (error) {
			if (!signal.aborted) {
				hadError = true;
			}
			throw error;
		} finally {
			if (hadError || !pooledVideoLoaded || pooledVideo?.error) {
				disposePooledVideo();
			} else {
				schedulePooledVideoDispose();
			}
		}
	});
	queue = job.catch(() => undefined);
	return job;
}
