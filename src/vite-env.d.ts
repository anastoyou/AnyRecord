/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

declare module "@mediapipe/tasks-vision" {
	// biome-ignore lint/suspicious/noExplicitAny: external untyped mediapipe package
	export const FilesetResolver: any;
	// biome-ignore lint/suspicious/noExplicitAny: external untyped mediapipe package
	export const HandLandmarker: any;
	// biome-ignore lint/suspicious/noExplicitAny: external untyped mediapipe package
	export type HandLandmarker = any;
	// biome-ignore lint/suspicious/noExplicitAny: external untyped mediapipe package
	export type FilesetResolver = any;
}
