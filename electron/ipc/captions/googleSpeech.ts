import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import {
	parseSilenceIntervals,
	type SilenceInterval,
} from "./silence";

const execFileAsync = promisify(execFile);

async function detectSilenceIntervals(options: { ffmpegPath: string; wavPath: string }) {
	// Try sensitive silence detection so natural speech pauses (>= 250ms) are detected
	for (const noiseDb of [-28, -24, -32]) {
		try {
			const { stderr } = await execFileAsync(
				options.ffmpegPath,
				[
					"-hide_banner",
					"-nostats",
					"-i",
					options.wavPath,
					"-af",
					`silencedetect=noise=${noiseDb}dB:d=0.25`,
					"-f",
					"null",
					"-",
				],
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 },
			);
			const silences = parseSilenceIntervals(stderr ?? "");
			if (silences.length > 0) return silences;
		} catch {
			// Try next threshold
		}
	}
	return [];
}

export const GOOGLE_SPEECH_LANG_MAP: Record<string, string> = {
	ml: "ml-IN",
	en: "en-US",
	es: "es-ES",
	fr: "fr-FR",
	de: "de-DE",
	it: "it-IT",
	pt: "pt-BR",
	zh: "zh-CN",
	ja: "ja-JP",
	ko: "ko-KR",
	ru: "ru-RU",
	hi: "hi-IN",
	ta: "ta-IN",
	te: "te-IN",
	nl: "nl-NL",
	ar: "ar-SA",
	tr: "tr-TR",
	vi: "vi-VN",
	auto: "en-US",
};

interface SpeechSegment {
	startMs: number;
	endMs: number;
}

/**
 * Segment audio timeline into distinct phrase chunks (max 3.5s), splitting at natural silence pauses.
 */
export function buildSpeechSegments(
	totalDurationMs: number,
	silences: SilenceInterval[],
	maxChunkDurationMs = 3_500,
	minChunkDurationMs = 400,
): SpeechSegment[] {
	if (totalDurationMs <= 0) return [];

	const speechSegments: SpeechSegment[] = [];
	let currentStartMs = 0;

	// Invert silences to find distinct speech regions
	for (const silence of silences) {
		const speechEnd = Math.min(silence.startMs, totalDurationMs);
		if (speechEnd > currentStartMs + minChunkDurationMs) {
			// Break long speech blocks into chunks <= maxChunkDurationMs
			let chunkStart = currentStartMs;
			while (chunkStart < speechEnd) {
				const chunkEnd = Math.min(chunkStart + maxChunkDurationMs, speechEnd);
				if (chunkEnd - chunkStart >= minChunkDurationMs) {
					speechSegments.push({ startMs: Math.round(chunkStart), endMs: Math.round(chunkEnd) });
				}
				chunkStart = chunkEnd;
			}
		}
		currentStartMs = Math.max(currentStartMs, silence.endMs);
		if (currentStartMs >= totalDurationMs) break;
	}

	if (currentStartMs < totalDurationMs - minChunkDurationMs) {
		let chunkStart = currentStartMs;
		while (chunkStart < totalDurationMs) {
			const chunkEnd = Math.min(chunkStart + maxChunkDurationMs, totalDurationMs);
			if (chunkEnd - chunkStart >= minChunkDurationMs) {
				speechSegments.push({ startMs: Math.round(chunkStart), endMs: Math.round(chunkEnd) });
			}
			chunkStart = chunkEnd;
		}
	}

	// Fallback if no segments generated (e.g. continuous speech or noisy audio)
	if (speechSegments.length === 0 && totalDurationMs >= minChunkDurationMs) {
		let chunkStart = 0;
		while (chunkStart < totalDurationMs) {
			const chunkEnd = Math.min(chunkStart + maxChunkDurationMs, totalDurationMs);
			speechSegments.push({ startMs: Math.round(chunkStart), endMs: Math.round(chunkEnd) });
			chunkStart = chunkEnd;
		}
	}

	return speechSegments;
}

export function parseGoogleSpeechResponse(responseText: string): string | null {
	if (!responseText || !responseText.trim()) return null;

	const lines = responseText.split(/\r?\n/).filter(Boolean);
	let bestTranscript: string | null = null;

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			const results = parsed.result;
			if (Array.isArray(results)) {
				for (const res of results) {
					const alternatives = res.alternative;
					if (Array.isArray(alternatives) && alternatives.length > 0) {
						const transcript = alternatives[0]?.transcript;
						if (typeof transcript === "string" && transcript.trim()) {
							bestTranscript = transcript.trim();
						}
					}
				}
			}
		} catch {
			// Skip invalid JSON lines (Google returns header lines before results)
		}
	}

	return bestTranscript;
}

const GOOGLE_SPEECH_CHROMIUM_KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";

export async function transcribeChunkWithGoogleSpeech(
	flacBuffer: Buffer,
	languageCode: string,
): Promise<string | null> {
	const bcp47 = GOOGLE_SPEECH_LANG_MAP[languageCode] || languageCode || "en-US";
	const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=${encodeURIComponent(
		bcp47,
	)}&key=${GOOGLE_SPEECH_CHROMIUM_KEY}&maxresults=1&pfilter=2`;

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "audio/x-flac; rate=16000",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			},
			body: new Uint8Array(flacBuffer),
		});

		if (!response.ok) {
			console.warn(`[google-speech] HTTP ${response.status} from speech recognition endpoint`);
			return null;
		}

		const responseText = await response.text();
		return parseGoogleSpeechResponse(responseText);
	} catch (error) {
		console.warn("[google-speech] Request error:", error);
		return null;
	}
}

export async function getAudioDurationMs(ffmpegPath: string, wavPath: string): Promise<number> {
	try {
		const { stdout, stderr } = await execFileAsync(ffmpegPath, ["-i", wavPath]);
		const output = `${stdout}\n${stderr}`;
		const match = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
		if (match) {
			const hours = Number.parseFloat(match[1]);
			const minutes = Number.parseFloat(match[2]);
			const seconds = Number.parseFloat(match[3]);
			return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
		}
	} catch (error: unknown) {
		// ffmpeg exits with code 1 when given only -i, but still prints Duration to stderr
		const output = String((error as { stderr?: string })?.stderr || "");
		const match = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
		if (match) {
			const hours = Number.parseFloat(match[1]);
			const minutes = Number.parseFloat(match[2]);
			const seconds = Number.parseFloat(match[3]);
			return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
		}
	}
	return 0;
}

export async function generateCaptionsWithGoogleSpeech(options: {
	wavPath: string;
	ffmpegPath: string;
	language?: string;
}): Promise<CaptionCuePayload[]> {
	const { wavPath, ffmpegPath, language = "ml" } = options;
	const durationMs = await getAudioDurationMs(ffmpegPath, wavPath);
	if (durationMs <= 0) {
		return [];
	}

	let silences: SilenceInterval[] = [];
	try {
		silences = await detectSilenceIntervals({ ffmpegPath, wavPath });
	} catch {
		silences = [];
	}

	const segments = buildSpeechSegments(durationMs, silences);
	if (segments.length === 0) {
		return [];
	}

	const cues: CaptionCuePayload[] = [];
	const tempDir = app.getPath("temp");

	// Transcribe segments with controlled concurrency
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const durationSec = (segment.endMs - segment.startMs) / 1000;
		const startSec = segment.startMs / 1000;

		const chunkFlacPath = path.join(
			tempDir,
			`anyrecord-google-speech-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.flac`,
		);

		try {
			// Extract FLAC chunk at 16kHz mono
			await execFileAsync(ffmpegPath, [
				"-y",
				"-ss",
				startSec.toFixed(3),
				"-t",
				durationSec.toFixed(3),
				"-i",
				wavPath,
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"flac",
				chunkFlacPath,
			]);

			const flacBuffer = await fs.readFile(chunkFlacPath);
			const transcript = await transcribeChunkWithGoogleSpeech(flacBuffer, language);

			if (transcript && transcript.trim()) {
				const cleanText = transcript.trim();
				const wordsRaw = cleanText.split(/\s+/).filter(Boolean);
				const wordCount = wordsRaw.length;
				const segDuration = segment.endMs - segment.startMs;
				const wordDuration = wordCount > 0 ? segDuration / wordCount : segDuration;

				const words: CaptionWordPayload[] = wordsRaw.map((word, wordIndex) => ({
					text: word,
					startMs: Math.round(segment.startMs + wordIndex * wordDuration),
					endMs: Math.round(segment.startMs + (wordIndex + 1) * wordDuration),
					leadingSpace: wordIndex > 0,
				}));

				cues.push({
					id: `cue-${cues.length + 1}`,
					startMs: segment.startMs,
					endMs: segment.endMs,
					text: cleanText,
					words,
				});
			}
		} catch (error) {
			console.warn(`[google-speech] Error processing chunk ${i}:`, error);
		} finally {
			await fs.rm(chunkFlacPath, { force: true }).catch(() => {
				/* ignore cleanup error */
			});
		}
	}

	return cues;
}
