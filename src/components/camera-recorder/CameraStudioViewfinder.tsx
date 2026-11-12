import {
	ArrowClockwise,
	DotsThreeVerticalIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	VideoCamera,
	XIcon,
} from "@/components/ui/icons";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import type { CameraAspectRatio } from "@/hooks/useScreenRecorder";
import styles from "./CameraStudioViewfinder.module.css";

export interface CameraStudioViewfinderProps {
	webcamDeviceId?: string;
	aspectRatio: CameraAspectRatio;
	onAspectRatioChange: (ratio: CameraAspectRatio) => void;
	mirrored: boolean;
	onToggleMirrored: () => void;
	microphoneEnabled: boolean;
	microphoneDeviceId?: string;
	recording: boolean;
	paused: boolean;
	elapsed: number;
	formatTime?: (ms: number) => string;
	onClose?: () => void;
	onStreamChange?: (stream: MediaStream | null) => void;
	className?: string;
}

export function CameraStudioViewfinder({
	webcamDeviceId,
	aspectRatio,
	onAspectRatioChange,
	mirrored,
	onToggleMirrored,
	microphoneEnabled,
	microphoneDeviceId,
	recording,
	paused,
	elapsed,
	formatTime,
	onClose,
	onStreamChange,
}: CameraStudioViewfinderProps) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const isDraggingRef = useRef(false);
	const dragStartRef = useRef<{
		x: number;
		y: number;
		originX: number;
		originY: number;
	} | null>(null);

	const { level: audioLevel } = useAudioLevelMeter({
		enabled: microphoneEnabled,
		deviceId: microphoneDeviceId,
	});

	// Get dimensions based on aspect ratio
	const getDimensions = () => {
		switch (aspectRatio) {
			case "9:16":
				return { width: 330, height: 586 };
			case "1:1":
				return { width: 440, height: 440 };
			case "4:3":
				return { width: 520, height: 390 };
			case "16:9":
			default:
				return { width: 560, height: 315 };
		}
	};

	const { width: videoWidth, height: videoHeight } = getDimensions();

	// Acquire local webcam stream for the viewfinder
	useEffect(() => {
		let cancelled = false;
		let streamInstance: MediaStream | null = null;

		const startCamera = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
							deviceId: { exact: webcamDeviceId },
							width: { ideal: 1920 },
							height: { ideal: 1080 },
						}
						: { width: { ideal: 1920 }, height: { ideal: 1080 } },
					audio: false,
				});

				if (cancelled) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}

				streamInstance = stream;
				onStreamChange?.(stream);

				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					void videoRef.current.play().catch(() => undefined);
				}
			} catch (err) {
				console.error("[CameraStudio] Failed to access camera:", err);
			}
		};

		void startCamera();

		return () => {
			cancelled = true;
			onStreamChange?.(null);
			if (streamInstance) {
				streamInstance.getTracks().forEach((track) => track.stop());
			}
			if (videoRef.current) {
				videoRef.current.srcObject = null;
			}
		};
	}, [webcamDeviceId]);

	// Dragging handlers for movable camera section
	const handleHeaderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest("button")) return;
		e.preventDefault();
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		isDraggingRef.current = true;
		dragStartRef.current = {
			x: e.clientX,
			y: e.clientY,
			originX: offset.x,
			originY: offset.y,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const handleHeaderPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!isDraggingRef.current || !dragStartRef.current) return;
		const deltaX = e.clientX - dragStartRef.current.x;
		const deltaY = e.clientY - dragStartRef.current.y;
		setOffset({
			x: dragStartRef.current.originX + deltaX,
			y: dragStartRef.current.originY + deltaY,
		});
	};

	const handleHeaderPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (isDraggingRef.current) {
			isDraggingRef.current = false;
			dragStartRef.current = null;
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {
				/* ignore releasePointerCapture error */
			}
		}
	};

	// Color for audio meter
	const getAudioMeterColor = (val: number) => {
		if (val > 80) return "#ef4444"; // red
		if (val > 50) return "#eab308"; // yellow
		return "#10b981"; // green
	};

	return (
		<div
			className={styles.studioContainer}
			style={{
				width: videoWidth + 2,
				transform: `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0)`,
			}}
		>
			{/* Movable Studio Viewfinder Header */}
			<div
				className={styles.studioHeader}
				onPointerDown={handleHeaderPointerDown}
				onPointerMove={handleHeaderPointerMove}
				onPointerUp={handleHeaderPointerUp}
				onPointerCancel={handleHeaderPointerUp}
				title="Drag to reposition Camera Studio"
			>
				<div className={styles.studioTitle}>
					<div className="flex items-center text-muted-foreground mr-0.5">
						<DotsThreeVerticalIcon weight="fill" size={16} />
					</div>
					<VideoCamera weight="fill" className="size-4 text-accent" />
					<span>Camera Studio</span>
					{recording && (
						<div className={styles.recordingBadge}>
							<div className={styles.recDot} />
							<span>
								{paused
									? "PAUSED"
									: formatTime
										? formatTime(elapsed)
										: `${Math.floor(elapsed / 1000)}s`}
							</span>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2">
					{/* Mirror Toggle */}
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={onToggleMirrored}
						title={mirrored ? "Mirrored (Click to unmirror)" : "Unmirrored (Click to mirror)"}
					>
						<ArrowClockwise
							className={`size-3.5 ${mirrored ? "text-accent" : "text-muted-foreground"}`}
						/>
					</Button>

					{/* Close Viewfinder */}
					{onClose && !recording && (
						<Button
							variant="ghost"
							size="icon"
							className="size-7 text-muted-foreground hover:text-foreground"
							onClick={onClose}
							title="Close Viewfinder"
						>
							<XIcon className="size-3.5" />
						</Button>
					)}
				</div>
			</div>

			{/* Video Canvas / Viewfinder */}
			<div
				className={styles.viewfinderWrapper}
				style={{ width: videoWidth, height: videoHeight }}
			>
				<video
					ref={videoRef}
					autoPlay
					playsInline
					muted
					className={styles.videoElement}
					style={{
						transform: mirrored ? "scaleX(-1)" : "none",
					}}
				/>
			</div>

			{/* Studio Viewfinder Footer */}
			<div className={styles.studioFooter}>
				{/* Aspect Ratio Selector */}
				<div className={styles.aspectRatios}>
					{(["16:9", "9:16", "1:1", "4:3"] as CameraAspectRatio[]).map((ratio) => (
						<button
							key={ratio}
							type="button"
							className={`${styles.aspectButton} ${aspectRatio === ratio ? styles.aspectButtonActive : ""}`}
							onClick={() => onAspectRatioChange(ratio)}
							title={`Aspect Ratio: ${ratio}`}
						>
							{ratio === "9:16" ? "9:16" : ratio}
						</button>
					))}
				</div>

				{/* Audio VU Level Meter */}
				<div className={styles.audioMeterWrapper}>
					{microphoneEnabled ? (
						<MicrophoneIcon className="size-3.5 text-accent" />
					) : (
						<MicrophoneSlashIcon className="size-3.5 text-muted-foreground" />
					)}
					<div className={styles.audioMeterBar}>
						<div
							className={styles.audioMeterFill}
							style={{
								width: `${microphoneEnabled ? Math.min(100, Math.max(4, audioLevel)) : 0}%`,
								backgroundColor: getAudioMeterColor(audioLevel),
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
export default CameraStudioViewfinder;
