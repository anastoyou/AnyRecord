import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import { Button } from "@/components/ui/button";
import {
	ArrowCounterClockwise,
	ArrowLeft,
	MicrophoneIcon,
	PauseIcon,
	PlayIcon,
} from "@/components/ui/icons";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useNoiseSuppressionPreferences } from "@/hooks/useNoiseSuppressionPreferences";
import {
	createNoiseSuppressionSession,
	type NoiseSuppressionMeterLevels,
	type NoiseSuppressionSession,
} from "@/lib/audio/noiseSuppressionEngine";
import styles from "../LaunchWindow.module.css";

export const LIVE_AUDIO_SETTINGS_POPOVER_ID = "live-audio-settings";
const MAX_TEST_DURATION_MS = 8000;

export interface LiveAudioSettingsPanelProps {
	open: boolean;
	onBack: () => void;
	microphoneEnabled: boolean;
	onEnableMicrophone?: () => void;
	microphoneDeviceId?: string;
}

export function LiveAudioSettingsPanel({
	open,
	onBack,
	microphoneEnabled,
	onEnableMicrophone,
	microphoneDeviceId,
}: LiveAudioSettingsPanelProps) {
	const { preferences, setEnabled, setLevel } = useNoiseSuppressionPreferences();

	const [levels, setLevels] = useState<NoiseSuppressionMeterLevels>({
		inputLevel: 0,
		outputLevel: 0,
		reductionAmount: 0,
	});
	const [isRecordingTest, setIsRecordingTest] = useState(false);
	const [testElapsedMs, setTestElapsedMs] = useState(0);
	const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
	const [isPlayingTest, setIsPlayingTest] = useState(false);
	const [testPlaybackProgress, setTestPlaybackProgress] = useState(0);

	const sessionRef = useRef<NoiseSuppressionSession | null>(null);
	const rawStreamRef = useRef<MediaStream | null>(null);
	const testRecorderRef = useRef<MediaRecorder | null>(null);
	const testChunksRef = useRef<Blob[]>([]);
	const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const testAudioRef = useRef<HTMLAudioElement | null>(null);
	const rafRef = useRef<number | null>(null);

	const stopTestPlayback = useCallback(() => {
		if (testAudioRef.current) {
			testAudioRef.current.pause();
			testAudioRef.current.currentTime = 0;
		}
		setIsPlayingTest(false);
		setTestPlaybackProgress(0);
	}, []);

	const stopTestRecording = useCallback(() => {
		if (testTimerRef.current) {
			clearInterval(testTimerRef.current);
			testTimerRef.current = null;
		}
		const recorder = testRecorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			try {
				recorder.requestData();
			} catch {
				// ignore
			}
			recorder.stop();
		}
		setIsRecordingTest(false);
	}, []);

	useEffect(() => {
		if (!open) {
			stopTestRecording();
			stopTestPlayback();
		}
	}, [open, stopTestPlayback, stopTestRecording]);

	useEffect(() => {
		return () => {
			if (testAudioUrl) {
				URL.revokeObjectURL(testAudioUrl);
			}
		};
	}, [testAudioUrl]);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;

		const startLiveSession = async () => {
			try {
				const rawStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
						channelCount: { ideal: 1 },
						sampleRate: { ideal: 48000 },
						echoCancellation: true,
						noiseSuppression: false,
						autoGainControl: false,
					},
					video: false,
				});

				if (cancelled) {
					rawStream.getTracks().forEach((t) => t.stop());
					return;
				}

				rawStreamRef.current = rawStream;

				const session = await createNoiseSuppressionSession(rawStream, {
					enabled: preferences.enabled,
					level: preferences.level,
					model: preferences.model,
				});

				if (cancelled) {
					session.dispose();
					rawStream.getTracks().forEach((t) => t.stop());
					return;
				}

				sessionRef.current = session;

				const updateMeters = () => {
					if (cancelled || !sessionRef.current) return;
					setLevels(sessionRef.current.getLevels());
					rafRef.current = requestAnimationFrame(updateMeters);
				};
				rafRef.current = requestAnimationFrame(updateMeters);
			} catch {
				// Ignore mic access errors in preview meter
			}
		};

		void startLiveSession();

		return () => {
			cancelled = true;
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			if (testRecorderRef.current && testRecorderRef.current.state !== "inactive") {
				try {
					testRecorderRef.current.stop();
				} catch {
					// ignore
				}
			}
			sessionRef.current?.dispose();
			sessionRef.current = null;
			if (rawStreamRef.current) {
				rawStreamRef.current.getTracks().forEach((t) => t.stop());
				rawStreamRef.current = null;
			}
			setLevels({ inputLevel: 0, outputLevel: 0, reductionAmount: 0 });
		};
	}, [open, microphoneDeviceId, preferences.model]);

	useEffect(() => {
		if (!sessionRef.current) return;
		sessionRef.current.setEnabled(preferences.enabled);
		sessionRef.current.setSuppressionLevel(preferences.level);
	}, [preferences.enabled, preferences.level]);

	const handleStartTestRecording = useCallback(() => {
		const session = sessionRef.current;
		if (!session) return;

		if (!microphoneEnabled) {
			onEnableMicrophone?.();
		}

		stopTestPlayback();
		if (testAudioUrl) {
			URL.revokeObjectURL(testAudioUrl);
			setTestAudioUrl(null);
		}

		testChunksRef.current = [];
		const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
			? "audio/webm;codecs=opus"
			: undefined;

		try {
			const recorder = new MediaRecorder(
				session.outputStream,
				mimeType ? { mimeType, audioBitsPerSecond: 128_000 } : undefined,
			);
			testRecorderRef.current = recorder;

			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					testChunksRef.current.push(event.data);
				}
			};

			recorder.onstop = () => {
				if (testChunksRef.current.length === 0) return;
				const blob = new Blob(testChunksRef.current, {
					type: recorder.mimeType || "audio/webm",
				});
				testChunksRef.current = [];
				const nextUrl = URL.createObjectURL(blob);
				setTestAudioUrl(nextUrl);
			};

			const startedAt = Date.now();
			setTestElapsedMs(0);
			setIsRecordingTest(true);
			recorder.start(100);

			testTimerRef.current = setInterval(() => {
				const elapsed = Date.now() - startedAt;
				if (elapsed >= MAX_TEST_DURATION_MS) {
					stopTestRecording();
				} else {
					setTestElapsedMs(elapsed);
				}
			}, 100);
		} catch {
			setIsRecordingTest(false);
		}
	}, [microphoneEnabled, onEnableMicrophone, stopTestPlayback, stopTestRecording, testAudioUrl]);

	const handleTogglePlayTest = useCallback(() => {
		if (!testAudioUrl) return;

		if (isPlayingTest && testAudioRef.current) {
			testAudioRef.current.pause();
			setIsPlayingTest(false);
			return;
		}

		let audio = testAudioRef.current;
		if (!audio || audio.src !== testAudioUrl) {
			audio = new Audio(testAudioUrl);
			testAudioRef.current = audio;
			audio.ontimeupdate = () => {
				if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
					setTestPlaybackProgress(Math.min(100, (audio.currentTime / audio.duration) * 100));
				}
			};
			audio.onended = () => {
				setIsPlayingTest(false);
				setTestPlaybackProgress(0);
			};
		}

		void audio
			.play()
			.then(() => {
				setIsPlayingTest(true);
			})
			.catch(() => {
				setIsPlayingTest(false);
			});
	}, [isPlayingTest, testAudioUrl]);

	const effectivePercent = preferences.enabled ? preferences.level : 0;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={onBack}
						aria-label="Back"
					>
						<ArrowLeft size={14} />
					</Button>
					<span className={styles.ddLabel} style={{ padding: 0 }}>
						Noise suppression
					</span>
				</div>
				<Switch
					aria-label="Noise suppression"
					checked={preferences.enabled}
					onCheckedChange={(checked) => {
						setEnabled(checked);
						if (checked && preferences.level === 0) {
							setLevel(75);
						}
					}}
				/>
			</div>

			<div className="flex flex-col gap-1.5 px-2">
				<div className="flex items-center justify-between text-xs">
					<span className="text-[var(--launch-text-muted)]">Level</span>
					<span className="tabular-nums text-foreground">{effectivePercent}%</span>
				</div>
				<Slider
					aria-label="Noise suppression level"
					value={[effectivePercent]}
					min={0}
					max={100}
					step={1}
					onValueChange={(values) => {
						const val = values[0] ?? 0;
						if (val === 0) {
							setEnabled(false);
							setLevel(0);
						} else {
							if (!preferences.enabled) setEnabled(true);
							setLevel(val);
						}
					}}
				/>
			</div>

			<div className="flex items-center gap-2.5 px-2 py-1">
				<MicrophoneIcon size={15} className="shrink-0 text-[var(--launch-text-muted)]" />
				<AudioLevelMeter level={levels.outputLevel} className="flex-1" />
			</div>

			{isRecordingTest ? (
				<Button
					variant="ghost"
					className="w-full justify-between px-2.5 text-xs"
					onClick={stopTestRecording}
				>
					<span className="flex items-center gap-2">
						<span className="size-2 rounded-full bg-red-500 animate-pulse" />
						<span>Stop</span>
					</span>
					<span className="tabular-nums text-[var(--launch-text-muted)]">
						{(testElapsedMs / 1000).toFixed(1)}s
					</span>
				</Button>
			) : testAudioUrl ? (
				<div className="flex items-center gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						className="gap-1.5 px-2.5 text-xs shrink-0"
						onClick={handleTogglePlayTest}
					>
						{isPlayingTest ? (
							<>
								<PauseIcon size={13} weight="fill" />
								<span>Pause</span>
							</>
						) : (
							<>
								<PlayIcon size={13} weight="fill" />
								<span>Play</span>
							</>
						)}
					</Button>
					<AudioLevelMeter level={testPlaybackProgress} className="flex-1" />
					<Button
						variant="ghost"
						size="icon"
						iconSize="sm"
						onClick={handleStartTestRecording}
						title="Retest"
					>
						<ArrowCounterClockwise size={14} />
					</Button>
				</div>
			) : (
				<Button
					variant="ghost"
					className="w-full justify-start gap-3 text-xs"
					onClick={handleStartTestRecording}
				>
					<MicrophoneIcon size={16} />
					<span>Test</span>
				</Button>
			)}
		</div>
	);
}
