import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import electron from "vite-plugin-electron/simple";

function crossPlatformNoiseSuppressionVitePlugin(): Plugin {
	const distDir = path.resolve(__dirname, "node_modules/@workadventure/noise-suppression/dist");
	const deepFilterPrefix = "/__workadventure_noise_suppression/deepfilternet/";
	const dtlnAssets = [
		{
			expression: 'new URL("assets/audio-worklet-processor.js", import.meta.url).href',
			devUrl: "/node_modules/@workadventure/noise-suppression/dist/assets/audio-worklet-processor.js",
			filePath: path.join(distDir, "assets/audio-worklet-processor.js"),
			contentType: "text/javascript",
		},
	];
	const deepFilterAssets = [
		{
			expression: 'new URL("assets/deepfilternet-worklet-processor.js", import.meta.url).href',
			devUrl: `${deepFilterPrefix}worklet-processor.js`,
			filePath: path.join(distDir, "assets/deepfilternet-worklet-processor.js"),
			contentType: "text/javascript",
		},
		{
			expression: 'new URL("assets/deepfilternet/df_bg.wasm", import.meta.url).href',
			devUrl: `${deepFilterPrefix}df_bg.wasm`,
			filePath: path.join(distDir, "assets/deepfilternet/df_bg.wasm"),
			contentType: "application/wasm",
		},
		{
			expression: 'new URL("assets/deepfilternet/DeepFilterNet3_onnx.tar.gz", import.meta.url).href',
			devUrl: `${deepFilterPrefix}DeepFilterNet3_onnx.tar.gz`,
			filePath: path.join(distDir, "assets/deepfilternet/DeepFilterNet3_onnx.tar.gz"),
			contentType: "application/gzip",
		},
	];

	return {
		name: "noise-suppression-audio-worklet",
		apply: "serve",
		config() {
			return {
				optimizeDeps: {
					exclude: [
						"@workadventure/noise-suppression",
						"@workadventure/noise-suppression/audio-worklet",
						"@workadventure/noise-suppression/deepfilternet",
					],
				},
			};
		},
		configureServer(server) {
			for (const asset of [...dtlnAssets, ...deepFilterAssets]) {
				server.middlewares.use(asset.devUrl, (_req, res, next) => {
					res.statusCode = 200;
					res.setHeader("Content-Type", asset.contentType);
					res.setHeader("Cache-Control", "no-cache");
					const stream = fs.createReadStream(asset.filePath);
					stream.on("error", next);
					stream.pipe(res);
				});
			}
		},
		transform(code, id) {
			const cleanId = id.replace(/\\/g, "/").split("?")[0] ?? "";
			const replacements = cleanId.endsWith(
				"/@workadventure/noise-suppression/dist/audio-worklet.js",
			)
				? dtlnAssets
				: cleanId.endsWith("/@workadventure/noise-suppression/dist/deepfilternet.js")
					? deepFilterAssets
					: null;
			if (!replacements) {
				return null;
			}
			let rewritten = code;
			for (const item of replacements) {
				if (rewritten.includes(item.expression)) {
					rewritten = rewritten.replace(item.expression, JSON.stringify(item.devUrl));
				}
			}
			return { code: rewritten, map: null };
		},
	};
}

function electronMainCjsOutputPlugin(): Plugin {
	return {
		name: "anyrecord-electron-main-cjs-output",
		enforce: "post",
		config(config) {
			// Vite mergeConfig concatenates lib.formats with the plugin's ESM default.
			config.build ??= {};
			const build = config.build;
			const lib = build.lib;
			if (lib && typeof lib === "object") {
				lib.formats = ["cjs"];
				lib.fileName = (_format, entryName) => `${entryName}.cjs`;
			}

			build.rollupOptions ??= {};
			const rollupOptions = build.rollupOptions;
			const cjsOutput = {
				format: "cjs" as const,
				inlineDynamicImports: true,
				entryFileNames: "[name].cjs",
				chunkFileNames: "[name]-[hash].cjs",
			};

			rollupOptions.output = Array.isArray(rollupOptions.output)
				? rollupOptions.output.map((output) => ({ ...output, ...cjsOutput }))
				: { ...(rollupOptions.output ?? {}), ...cjsOutput };
		},
	};
}

function electronMainCjsGuardPlugin(): Plugin {
	return {
		name: "anyrecord-electron-main-cjs-guard",
		closeBundle() {
			const scriptPath = path.resolve(__dirname, "scripts/smoke-electron-main-cjs.mjs");
			const result = spawnSync(process.execPath, [scriptPath], {
				cwd: __dirname,
				encoding: "utf8",
			});

			if (result.status !== 0) {
				const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
				throw new Error(
					`Electron main CJS smoke failed after Vite build.${details ? `\n${details}` : ""}`,
				);
			}
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	return {
		plugins: [
			react(),
			crossPlatformNoiseSuppressionVitePlugin(),
			...(mode === "ui" ||
			process.env.ANYRECORD_RENDERER_ONLY === "1" ||
			process.env.RECORDLY_RENDERER_ONLY === "1"
				? []
				: [
						electron({
							main: {
								// Shortcut of `build.lib.entry`.
								entry: "electron/main.ts",
								vite: {
									define: {
										"process.env.VITE_SUPABASE_URL": JSON.stringify(
											process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
										),
										"process.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
											process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
												env.VITE_SUPABASE_PUBLISHABLE_KEY ||
												"",
										),
										"process.env.CLOUDINARY_DATABASE_URL": JSON.stringify(
											process.env.CLOUDINARY_DATABASE_URL || env.CLOUDINARY_DATABASE_URL || "",
										),
										"process.env.NEON_DATABASE_URL": JSON.stringify(
											process.env.NEON_DATABASE_URL || env.NEON_DATABASE_URL || "",
										),
										"process.env.CLOUDINARY_TOKEN_KEY": JSON.stringify(
											process.env.CLOUDINARY_TOKEN_KEY || env.CLOUDINARY_TOKEN_KEY || "",
										),
										"process.env.CLOUDINARY_CLIENT_ID": JSON.stringify(
											process.env.CLOUDINARY_CLIENT_ID || env.CLOUDINARY_CLIENT_ID || "",
										),
										"process.env.CLOUDINARY_CLIENT_SECRET": JSON.stringify(
											process.env.CLOUDINARY_CLIENT_SECRET || env.CLOUDINARY_CLIENT_SECRET || "",
										),
										"process.env.CLOUDINARY_OAUTH_ISSUER": JSON.stringify(
											process.env.CLOUDINARY_OAUTH_ISSUER || env.CLOUDINARY_OAUTH_ISSUER || "",
										),
									},
									build: {
										lib: {
											entry: "electron/main.ts",
											formats: ["cjs"],
											fileName: (_format, entryName) => `${entryName}.cjs`,
										},
									rollupOptions: {
										external: ["ffmpeg-static", "uiohook-napi"],
										output: {
											format: "cjs",
											inlineDynamicImports: true,
											entryFileNames: "[name].cjs",
											chunkFileNames: "[name]-[hash].cjs",
										},
									},
								},
								plugins: [
									electronMainCjsOutputPlugin(),
									electronMainCjsGuardPlugin(),
								],
							},
						},
						preload: {
							// Shortcut of `build.rollupOptions.input`.
							// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
							input: path.join(__dirname, "electron/preload.ts"),
						},
						// Polyfill the Electron and Node.js API for the renderer process.
						// If you want to use Node.js in the renderer process, enable `nodeIntegration` in the main process.
						// See https://github.com/electron-vite/vite-plugin-electron-renderer
						renderer:
							process.env.NODE_ENV === "test"
								? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
									undefined
								: {},
					}),
				]),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	optimizeDeps: {
		entries: ["index.html"],
		// React Aria imports this CommonJS shim through its ESM collection modules.
		include: ["use-sync-external-store/shim"],
		exclude: [
			"react-icons/bs",
			"react-icons/fa",
			"react-icons/fa6",
			"react-icons/fi",
			"react-icons/md",
			"react-icons/rx",
		],
	},
	build: {
		target: "esnext",
		minify: "terser",
		terserOptions: {
			compress: {
				drop_console: true,
				drop_debugger: true,
				pure_funcs: ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
};
});
