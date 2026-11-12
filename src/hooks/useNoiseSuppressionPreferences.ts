import { useCallback, useEffect, useState } from "react";
import {
	clampSuppressionLevel,
	DEFAULT_NOISE_SUPPRESSION_ENABLED,
	DEFAULT_NOISE_SUPPRESSION_LEVEL,
	DEFAULT_NOISE_SUPPRESSION_MODEL,
	type NoiseSuppressionModel,
} from "@/lib/audio/noiseSuppressionEngine";

export const NOISE_SUPPRESSION_PREFS_STORAGE_KEY = "anyrecord.noiseSuppressionPreferences.v1";
const NOISE_SUPPRESSION_PREFS_CHANGE_EVENT = "anyrecord:noise-suppression-prefs-changed";

export interface NoiseSuppressionPreferences {
	/** Enable AI noise suppression on live microphone recording */
	enabled: boolean;
	/** Noise reduction strength (0 - 100%) */
	level: number;
	/** AI model: "deepfilternet" (48kHz) or "dtln" (16kHz low CPU) */
	model: NoiseSuppressionModel;
	/** Enable noise removal for webcam audio */
	webcamNoiseSuppressionEnabled: boolean;
	/** Webcam noise reduction strength (0 - 100%, synced with level by default) */
	webcamNoiseSuppressionLevel: number;
}

export const DEFAULT_NOISE_SUPPRESSION_PREFERENCES: NoiseSuppressionPreferences = {
	enabled: DEFAULT_NOISE_SUPPRESSION_ENABLED,
	level: DEFAULT_NOISE_SUPPRESSION_LEVEL,
	model: DEFAULT_NOISE_SUPPRESSION_MODEL,
	webcamNoiseSuppressionEnabled: true,
	webcamNoiseSuppressionLevel: DEFAULT_NOISE_SUPPRESSION_LEVEL,
};

export function normalizeNoiseSuppressionPreferences(
	raw: Partial<NoiseSuppressionPreferences> | null | undefined,
): NoiseSuppressionPreferences {
	if (!raw || typeof raw !== "object") {
		return { ...DEFAULT_NOISE_SUPPRESSION_PREFERENCES };
	}

	const enabled =
		typeof raw.enabled === "boolean"
			? raw.enabled
			: DEFAULT_NOISE_SUPPRESSION_PREFERENCES.enabled;
	const level = clampSuppressionLevel(
		typeof raw.level === "number" ? raw.level : DEFAULT_NOISE_SUPPRESSION_PREFERENCES.level,
	);
	const model: NoiseSuppressionModel =
		raw.model === "dtln" || raw.model === "deepfilternet"
			? raw.model
			: DEFAULT_NOISE_SUPPRESSION_PREFERENCES.model;
	const webcamNoiseSuppressionEnabled =
		typeof raw.webcamNoiseSuppressionEnabled === "boolean"
			? raw.webcamNoiseSuppressionEnabled
			: enabled;
	const webcamNoiseSuppressionLevel = clampSuppressionLevel(
		typeof raw.webcamNoiseSuppressionLevel === "number"
			? raw.webcamNoiseSuppressionLevel
			: level,
	);

	return {
		enabled,
		level,
		model,
		webcamNoiseSuppressionEnabled,
		webcamNoiseSuppressionLevel,
	};
}

export function loadNoiseSuppressionPreferences(): NoiseSuppressionPreferences {
	if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
		return { ...DEFAULT_NOISE_SUPPRESSION_PREFERENCES };
	}
	try {
		const raw = window.localStorage.getItem(NOISE_SUPPRESSION_PREFS_STORAGE_KEY);
		if (!raw) {
			return { ...DEFAULT_NOISE_SUPPRESSION_PREFERENCES };
		}
		return normalizeNoiseSuppressionPreferences(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_NOISE_SUPPRESSION_PREFERENCES };
	}
}

export function saveNoiseSuppressionPreferences(
	patch: Partial<NoiseSuppressionPreferences>,
): NoiseSuppressionPreferences {
	const current = loadNoiseSuppressionPreferences();
	const next = normalizeNoiseSuppressionPreferences({
		...current,
		...patch,
	});
	if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
		try {
			window.localStorage.setItem(NOISE_SUPPRESSION_PREFS_STORAGE_KEY, JSON.stringify(next));
			window.dispatchEvent(
				new CustomEvent<NoiseSuppressionPreferences>(
					NOISE_SUPPRESSION_PREFS_CHANGE_EVENT,
					{ detail: next },
				),
			);
		} catch {
			// Ignore storage quota errors
		}
	}
	return next;
}

export function useNoiseSuppressionPreferences() {
	const [preferences, setPreferencesState] = useState<NoiseSuppressionPreferences>(() =>
		loadNoiseSuppressionPreferences(),
	);

	useEffect(() => {
		const handleCustomUpdate = (event: Event) => {
			const customEvent = event as CustomEvent<NoiseSuppressionPreferences>;
			if (customEvent.detail) {
				setPreferencesState(normalizeNoiseSuppressionPreferences(customEvent.detail));
			} else {
				setPreferencesState(loadNoiseSuppressionPreferences());
			}
		};

		const handleStorageUpdate = (event: StorageEvent) => {
			if (event.key === NOISE_SUPPRESSION_PREFS_STORAGE_KEY) {
				setPreferencesState(loadNoiseSuppressionPreferences());
			}
		};

		window.addEventListener(NOISE_SUPPRESSION_PREFS_CHANGE_EVENT, handleCustomUpdate);
		window.addEventListener("storage", handleStorageUpdate);
		return () => {
			window.removeEventListener(NOISE_SUPPRESSION_PREFS_CHANGE_EVENT, handleCustomUpdate);
			window.removeEventListener("storage", handleStorageUpdate);
		};
	}, []);

	const updatePreferences = useCallback((patch: Partial<NoiseSuppressionPreferences>) => {
		const updated = saveNoiseSuppressionPreferences(patch);
		setPreferencesState(updated);
		return updated;
	}, []);

	const setEnabled = useCallback(
		(enabled: boolean) => {
			updatePreferences({
				enabled,
				webcamNoiseSuppressionEnabled: enabled,
			});
		},
		[updatePreferences],
	);

	const setLevel = useCallback(
		(level: number) => {
			const clamped = clampSuppressionLevel(level);
			updatePreferences({
				level: clamped,
				webcamNoiseSuppressionLevel: clamped,
			});
		},
		[updatePreferences],
	);

	const setModel = useCallback(
		(model: NoiseSuppressionModel) => {
			updatePreferences({ model });
		},
		[updatePreferences],
	);

	const setWebcamNoiseSuppressionEnabled = useCallback(
		(webcamNoiseSuppressionEnabled: boolean) => {
			updatePreferences({ webcamNoiseSuppressionEnabled });
		},
		[updatePreferences],
	);

	const setWebcamNoiseSuppressionLevel = useCallback(
		(webcamNoiseSuppressionLevel: number) => {
			updatePreferences({
				webcamNoiseSuppressionLevel: clampSuppressionLevel(webcamNoiseSuppressionLevel),
			});
		},
		[updatePreferences],
	);

	return {
		preferences,
		updatePreferences,
		setEnabled,
		setLevel,
		setModel,
		setWebcamNoiseSuppressionEnabled,
		setWebcamNoiseSuppressionLevel,
	};
}

