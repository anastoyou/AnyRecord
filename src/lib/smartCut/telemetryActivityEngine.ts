import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { SMART_CUT_BIN_MS } from "./smartCutTypes";

const KEYPRESS_DECAY_MS = 1500;

export interface TelemetryActivityBinsResult {
	mouseDisplacement: Float32Array;
	mouseClickActive: Uint8Array;
	textCursorActive: Uint8Array;
	keyboardActive: Uint8Array;
}

function isClickEvent(type: CursorTelemetryPoint["interactionType"]): boolean {
	return (
		type === "click" ||
		type === "double-click" ||
		type === "right-click" ||
		type === "middle-click" ||
		type === "mouseup"
	);
}

/**
 * Parses cursor and keyboard telemetry into discrete 100ms activity bins.
 */
export function analyzeTelemetryActivityBins(
	telemetry: CursorTelemetryPoint[],
	binCount: number,
	binMs: number = SMART_CUT_BIN_MS,
): TelemetryActivityBinsResult {
	const mouseDisplacement = new Float32Array(binCount);
	const mouseClickActive = new Uint8Array(binCount);
	const textCursorActive = new Uint8Array(binCount);
	const keyboardActive = new Uint8Array(binCount);

	if (!telemetry || telemetry.length === 0 || binCount <= 0) {
		return {
			mouseDisplacement,
			mouseClickActive,
			textCursorActive,
			keyboardActive,
		};
	}

	const sorted = [...telemetry]
		.filter((pt) => Number.isFinite(pt.timeMs) && pt.timeMs >= 0)
		.sort((a, b) => a.timeMs - b.timeMs);

	const keypressDecayBins = Math.ceil(KEYPRESS_DECAY_MS / binMs);

	let prevCx: number | null = null;
	let prevCy: number | null = null;
	let prevTimeMs: number | null = null;

	for (const pt of sorted) {
		const bin = Math.floor(pt.timeMs / binMs);
		if (bin < 0 || bin >= binCount) continue;

		if (isClickEvent(pt.interactionType)) {
			mouseClickActive[bin] = 1;
		}

		if (pt.cursorType === "text") {
			textCursorActive[bin] = 1;
		}

		if (pt.interactionType === "keypress") {
			const endBin = Math.min(binCount - 1, bin + keypressDecayBins);
			for (let k = bin; k <= endBin; k++) {
				keyboardActive[k] = 1;
			}
		}

		if (
			Number.isFinite(pt.cx) &&
			Number.isFinite(pt.cy) &&
			pt.interactionType !== "keypress"
		) {
			if (
				prevCx !== null &&
				prevCy !== null &&
				prevTimeMs !== null &&
				pt.timeMs - prevTimeMs <= 1000
			) {
				const dist = Math.hypot(pt.cx - prevCx, pt.cy - prevCy);
				mouseDisplacement[bin] += dist;
			}
			prevCx = pt.cx;
			prevCy = pt.cy;
			prevTimeMs = pt.timeMs;
		}
	}

	return {
		mouseDisplacement,
		mouseClickActive,
		textCursorActive,
		keyboardActive,
	};
}

