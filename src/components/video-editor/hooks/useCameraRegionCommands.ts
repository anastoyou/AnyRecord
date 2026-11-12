import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Span } from "dnd-timeline";
import type { CameraRegion } from "../timeline/core/timelineTypes";
import type { EditorEffectSection, WebcamOverlaySettings } from "../types";

interface UseCameraRegionCommandsParams {
	hasWebcam: boolean;
	webcam: WebcamOverlaySettings;
	setWebcam: Dispatch<SetStateAction<WebcamOverlaySettings>>;
	duration: number;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setSelectedGestureId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
}

export function splitCameraRegionList(
	current: CameraRegion[],
	splitMs: number,
	makeId: () => string,
): { regions: CameraRegion[]; newSelectedId: string | null } {
	const splitAtMs = Math.round(splitMs);
	const target = current.find((r) => splitAtMs > r.startMs && splitAtMs < r.endMs);
	if (!target) return { regions: current, newSelectedId: null };

	const left: CameraRegion = {
		id: makeId(),
		startMs: target.startMs,
		endMs: splitAtMs,
	};
	const right: CameraRegion = {
		id: makeId(),
		startMs: splitAtMs,
		endMs: target.endMs,
	};

	return {
		regions: current.flatMap((r) => (r.id === target.id ? [left, right] : [r])),
		newSelectedId: left.id,
	};
}

export function updateCameraRegionSpanList(
	current: CameraRegion[],
	id: string,
	span: Span,
): CameraRegion[] {
	const newStart = Math.max(0, Math.round(span.start));
	const newEnd = Math.max(newStart + 100, Math.round(span.end));

	return current.map((r) =>
		r.id === id ? { ...r, startMs: newStart, endMs: newEnd } : r,
	);
}

export function deleteCameraRegionList(current: CameraRegion[], id: string): CameraRegion[] {
	return current.filter((r) => r.id !== id);
}

export function deriveCameraRegionsFromVisibleRanges(
	hasWebcam: boolean,
	visibleRanges: WebcamOverlaySettings["visibleRanges"],
	duration: number,
): CameraRegion[] {
	if (!hasWebcam) {
		return [];
	}

	if (visibleRanges && Array.isArray(visibleRanges)) {
		return visibleRanges.map((range, index) => ({
			id: range.id || `camera-${index + 1}`,
			startMs: range.startMs,
			endMs: range.endMs,
		}));
	}

	if (duration > 0) {
		const totalMs = Math.round(duration * 1000);
		return [{ id: "camera-0", startMs: 0, endMs: totalMs }];
	}

	return [];
}

export function useCameraRegionCommands({
	hasWebcam,
	webcam,
	setWebcam,
	duration,
	setSelectedClipId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setSelectedCaptionId,
	setSelectedGestureId,
	setActiveEffectSection,
}: UseCameraRegionCommandsParams) {
	const [cameraRegions, setCameraRegions] = useState<CameraRegion[]>([]);
	const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
	const nextCameraIdRef = useRef(1);

	// Sync camera regions from webcam.visibleRanges or initialize full-duration track
	useEffect(() => {
		if (!hasWebcam) {
			setCameraRegions([]);
			setSelectedCameraId(null);
			return;
		}

		if (webcam.visibleRanges && Array.isArray(webcam.visibleRanges)) {
			const mapped = deriveCameraRegionsFromVisibleRanges(
				hasWebcam,
				webcam.visibleRanges,
				duration,
			);
			const maxExistingId = mapped.reduce((max, region) => {
				const match = /^camera-(\d+)$/.exec(region.id);
				return match ? Math.max(max, Number(match[1])) : max;
			}, 0);
			nextCameraIdRef.current = Math.max(nextCameraIdRef.current, maxExistingId + 1);
			setCameraRegions(mapped);
			setSelectedCameraId((current) =>
				current && mapped.some((region) => region.id === current) ? current : null,
			);
		} else if (duration > 0) {
			const totalMs = Math.round(duration * 1000);
			setCameraRegions((current) => {
				if (
					current.length === 1 &&
					current[0].id === "camera-0" &&
					current[0].startMs === 0 &&
					current[0].endMs === totalMs
				) {
					return current;
				}
				return [{ id: "camera-0", startMs: 0, endMs: totalMs }];
			});
			setSelectedCameraId((current) => (current === "camera-0" ? current : null));
		}
	}, [hasWebcam, webcam.visibleRanges, duration]);

	const handleCameraSplit = useCallback(
		(splitMs: number) => {
			setCameraRegions((current) => {
				const { regions: next, newSelectedId } = splitCameraRegionList(
					current,
					splitMs,
					() => `camera-${nextCameraIdRef.current++}`,
				);
				if (newSelectedId) {
					setSelectedCameraId(newSelectedId);
					setWebcam((prev) => ({
						...prev,
						visibleRanges: next.map(({ id, startMs, endMs }) => ({
							id,
							startMs,
							endMs,
						})),
					}));
				}
				return next;
			});
		},
		[setWebcam],
	);

	const handleCameraSpanChange = useCallback(
		(id: string, span: Span) => {
			setCameraRegions((current) => {
				const next = updateCameraRegionSpanList(current, id, span);

				setWebcam((prev) => ({
					...prev,
					visibleRanges: next.map(({ id: rangeId, startMs, endMs }) => ({
						id: rangeId,
						startMs,
						endMs,
					})),
				}));

				return next;
			});
		},
		[setWebcam],
	);

	const handleCameraDelete = useCallback(
		(id: string) => {
			setCameraRegions((current) => {
				const next = deleteCameraRegionList(current, id);
				setWebcam((prev) => ({
					...prev,
					visibleRanges: next.map(({ id: rangeId, startMs, endMs }) => ({
						id: rangeId,
						startMs,
						endMs,
					})),
				}));
				return next;
			});
			setSelectedCameraId((current) => (current === id ? null : current));
		},
		[setWebcam],
	);

	const handleSelectCamera = useCallback(
		(id: string | null) => {
			setSelectedCameraId(id);
			if (id) {
				setSelectedClipId(null);
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedAudioId(null);
				setSelectedCaptionId(null);
				setSelectedGestureId(null);
				setActiveEffectSection("webcam");
			}
		},
		[
			setSelectedClipId,
			setSelectedZoomId,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedGestureId,
			setActiveEffectSection,
		],
	);

	const handleRestoreCameraFullTrack = useCallback(() => {
		if (duration <= 0) return;
		const totalMs = Math.round(duration * 1000);
		const fullTrack: CameraRegion[] = [
			{ id: `camera-${nextCameraIdRef.current++}`, startMs: 0, endMs: totalMs },
		];
		setCameraRegions(fullTrack);
		setWebcam((prev) => ({
			...prev,
			visibleRanges: fullTrack.map(({ id, startMs, endMs }) => ({
				id,
				startMs,
				endMs,
			})),
		}));
	}, [duration, setWebcam]);

	return {
		cameraRegions,
		selectedCameraId,
		setSelectedCameraId,
		handleCameraSplit,
		handleCameraSpanChange,
		handleCameraDelete,
		handleSelectCamera,
		handleRestoreCameraFullTrack,
	};
}
