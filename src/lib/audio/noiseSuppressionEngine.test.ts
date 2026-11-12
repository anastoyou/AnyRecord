import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clampSuppressionLevel,
	computeAnalyserRmsLevel,
	computeDryWetGains,
	computeWorkletLatencySeconds,
} from "./noiseSuppressionEngine";
import {
	DEFAULT_NOISE_SUPPRESSION_PREFERENCES,
	loadNoiseSuppressionPreferences,
	normalizeNoiseSuppressionPreferences,
	saveNoiseSuppressionPreferences,
} from "@/hooks/useNoiseSuppressionPreferences";

describe("noiseSuppressionEngine helpers", () => {
	describe("clampSuppressionLevel", () => {
		it("clamps levels to the 0..100 integer range", () => {
			expect(clampSuppressionLevel(-15)).toBe(0);
			expect(clampSuppressionLevel(0)).toBe(0);
			expect(clampSuppressionLevel(42.6)).toBe(43);
			expect(clampSuppressionLevel(100)).toBe(100);
			expect(clampSuppressionLevel(150)).toBe(100);
			expect(clampSuppressionLevel(Number.NaN)).toBe(75);
		});
	});

	describe("computeDryWetGains", () => {
		it("returns 100% dry and 0% wet when disabled", () => {
			expect(computeDryWetGains(false, 80)).toEqual({
				dryGain: 1,
				wetGain: 0,
				highPassHz: 20,
				speechAttenuationDb: 12,
				pauseAttenuationDb: 12,
			});
		});

		it("returns 100% dry and 0% wet when level is 0", () => {
			expect(computeDryWetGains(true, 0)).toEqual({
				dryGain: 1,
				wetGain: 0,
				highPassHz: 20,
				speechAttenuationDb: 12,
				pauseAttenuationDb: 12,
			});
		});

		it("computes complementary dry/wet gains for partial suppression", () => {
			const gains = computeDryWetGains(true, 75);
			expect(gains.wetGain).toBeCloseTo(0.75, 5);
			expect(gains.dryGain).toBeCloseTo(0.25, 5);
			expect(gains.highPassHz).toBeGreaterThan(80);
		});

		it("returns 0% dry and 100% wet at 100% suppression", () => {
			expect(computeDryWetGains(true, 100)).toEqual({
				dryGain: 0,
				wetGain: 1,
				highPassHz: 110,
				speechAttenuationDb: 45,
				pauseAttenuationDb: 65,
			});
		});
	});

	describe("computeWorkletLatencySeconds", () => {
		it("returns lookahead latency for DeepFilterNet3 (48kHz)", () => {
			expect(computeWorkletLatencySeconds("deepfilternet", true)).toBeCloseTo(0.0707, 4);
			expect(computeWorkletLatencySeconds("deepfilternet", false)).toBeCloseTo(0.0407, 4);
		});

		it("returns 32ms lookahead latency for DTLN (16kHz)", () => {
			expect(computeWorkletLatencySeconds("dtln")).toBeCloseTo(0.032, 5);
		});
	});

	describe("computeAnalyserRmsLevel", () => {
		it("returns 0 for silent frequency bins", () => {
			const samples = new Uint8Array(128).fill(0);
			expect(computeAnalyserRmsLevel(samples)).toBe(0);
		});

		it("computes normalized level for active voice signal", () => {
			const samples = new Uint8Array(128).fill(96);
			const level = computeAnalyserRmsLevel(samples);
			expect(level).toBeGreaterThan(50);
			expect(level).toBeLessThanOrEqual(100);
		});
	});
});

describe("useNoiseSuppressionPreferences", () => {
	const store = new Map<string, string>();

	beforeEach(() => {
		store.clear();
		vi.stubGlobal("window", {
			localStorage: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => {
					store.set(key, value);
				},
			},
			dispatchEvent: vi.fn(),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns defaults when storage is empty or invalid", () => {
		expect(loadNoiseSuppressionPreferences()).toEqual(DEFAULT_NOISE_SUPPRESSION_PREFERENCES);
		expect(normalizeNoiseSuppressionPreferences(null)).toEqual(
			DEFAULT_NOISE_SUPPRESSION_PREFERENCES,
		);
	});

	it("normalizes and persists noise suppression preferences", () => {
		const saved = saveNoiseSuppressionPreferences({
			enabled: true,
			level: 85,
			model: "dtln",
			webcamNoiseSuppressionEnabled: false,
			webcamNoiseSuppressionLevel: 40,
		});
		expect(saved).toEqual({
			enabled: true,
			level: 85,
			model: "dtln",
			webcamNoiseSuppressionEnabled: false,
			webcamNoiseSuppressionLevel: 40,
		});
		expect(loadNoiseSuppressionPreferences()).toEqual(saved);
	});
});
