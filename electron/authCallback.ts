import { createServer, type Server } from "node:http";
import { app, BrowserWindow, ipcMain } from "electron";

export const LOOPBACK_CALLBACK_HOST = "127.0.0.1:43821";
export const LOOPBACK_CALLBACK_ORIGIN = `http://${LOOPBACK_CALLBACK_HOST}`;
export const LOOPBACK_CLOUDINARY_REDIRECT_URI = `${LOOPBACK_CALLBACK_ORIGIN}/cloudinary/callback`;

const CALLBACK_PATH = "/callback";
const LOOPBACK_CALLBACK_PATH = "/auth/callback";
const LOOPBACK_CLOUDINARY_PATH = "/cloudinary/callback";
const MAX_CALLBACK_URL_LENGTH = 8192;
const CALLBACK_PARAMETERS = new Set(["code", "error", "error_code", "error_description"]);

export type CloudinaryCallbackPayload = {
	code?: string | null;
	state?: string | null;
	error?: string | null;
	errorDescription?: string | null;
	cloudName?: string | null;
	status?: string | null;
	reason?: string | null;
};

type CloudinaryCallbackHandler = (
	payload: CloudinaryCallbackPayload,
) => Promise<{ ok: boolean; cloudName?: string | null; message?: string }>;

let cloudinaryCallbackHandler: CloudinaryCallbackHandler | null = null;

export function registerCloudinaryCallbackListener(handler: CloudinaryCallbackHandler) {
	cloudinaryCallbackHandler = handler;
}

type AuthCallbackOptions = {
	isDev: boolean;
	focusApp: () => void;
};

function callbackHeaders(contentType: string) {
	return {
		"Cache-Control": "no-store",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
		"Content-Type": contentType,
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	};
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function renderCallbackHtml(title: string, subtitle: string, isSuccess = true): string {
	const badgeColor = isSuccess ? "#10b981" : "#f43f5e";
	return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#ededef;font:16px "Helvetica Neue",Helvetica,Arial,sans-serif}.card{max-width:440px;padding:36px;text-align:center;border:1px solid rgba(255,255,255,0.08);border-radius:16px;background:#111316}.dot{width:12px;height:12px;border-radius:999px;background:${badgeColor};margin:0 auto 16px}h1{font-size:22px;font-weight:600;margin:0 0 10px}p{color:#9ca3af;line-height:1.6;margin:0}</style><main class="card"><div class="dot"></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></main>`;
}

export function createAuthCallbackController({ isDev, focusApp }: AuthCallbackOptions) {
	const protocol = isDev ? "anyrecord-dev" : "anyrecord";
	let pendingUrl: string | null = null;
	let server: Server | null = null;

	function parseCallback(rawUrl: string): URL | null {
		if (rawUrl.length > MAX_CALLBACK_URL_LENGTH) return null;
		try {
			const url = new URL(rawUrl);
			if (
				url.protocol !== `${protocol}:` &&
				url.protocol !== "anyrecord:" &&
				url.protocol !== "anyrecord-dev:"
			) {
				return null;
			}
			if (url.hostname !== "auth" && url.hostname !== "cloudinary") return null;
			if (url.pathname !== CALLBACK_PATH || url.username || url.password) return null;
			return url;
		} catch {
			return null;
		}
	}

	function find(args: readonly string[]) {
		return args.find((arg) => parseCallback(arg) !== null) ?? null;
	}

	function dispatch(rawUrl: string) {
		const url = parseCallback(rawUrl);
		if (!url) return false;

		if (url.hostname === "cloudinary") {
			if (cloudinaryCallbackHandler) {
				void cloudinaryCallbackHandler({
					code: url.searchParams.get("code"),
					state: url.searchParams.get("state"),
					error: url.searchParams.get("error"),
					errorDescription: url.searchParams.get("error_description"),
					cloudName:
						url.searchParams.get("cloud_name") || url.searchParams.get("cloud"),
					status: url.searchParams.get("status"),
					reason: url.searchParams.get("reason"),
				});
			}
			if (app.isReady()) focusApp();
			return true;
		}

		pendingUrl = url.href;
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("auth:callback", url.href);
		}
		if (app.isReady()) focusApp();
		return true;
	}

	function startDevServer() {
		if (server) return;
		server = createServer(async (request, response) => {
			if (
				request.method !== "GET" ||
				request.headers.host !== LOOPBACK_CALLBACK_HOST ||
				(request.url?.length ?? 0) > MAX_CALLBACK_URL_LENGTH
			) {
				response.writeHead(404, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Not found");
				return;
			}

			const requestUrl = new URL(request.url ?? "/", LOOPBACK_CALLBACK_ORIGIN);

			if (requestUrl.pathname === LOOPBACK_CLOUDINARY_PATH) {
				const payload: CloudinaryCallbackPayload = {
					code: requestUrl.searchParams.get("code"),
					state: requestUrl.searchParams.get("state"),
					error: requestUrl.searchParams.get("error"),
					errorDescription: requestUrl.searchParams.get("error_description"),
					cloudName:
						requestUrl.searchParams.get("cloud_name") ||
						requestUrl.searchParams.get("cloud"),
					status: requestUrl.searchParams.get("status"),
					reason: requestUrl.searchParams.get("reason"),
				};

				if (
					!payload.code &&
					!payload.error &&
					!payload.status
				) {
					response.writeHead(400, callbackHeaders("text/plain; charset=utf-8"));
					response.end("Invalid Cloudinary OAuth callback");
					return;
				}

				if (cloudinaryCallbackHandler) {
					const result = await cloudinaryCallbackHandler(payload);
					if (app.isReady()) focusApp();
					response.writeHead(
						result.ok ? 200 : 400,
						callbackHeaders("text/html; charset=utf-8"),
					);
					response.end(
						result.ok
							? renderCallbackHtml(
									"Cloudinary Connected",
									`Your Cloudinary account${result.cloudName ? ` (${result.cloudName})` : ""} is now connected to AnyRecord. You can close this tab and return to the app.`,
									true,
								)
							: renderCallbackHtml(
									"Cloudinary Connection Failed",
									result.message ||
										"Could not complete Cloudinary authorization. Return to AnyRecord and try again.",
									false,
								),
					);
					return;
				}

				response.writeHead(503, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Cloudinary OAuth service is not ready.");
				return;
			}

			if (requestUrl.pathname !== LOOPBACK_CALLBACK_PATH) {
				response.writeHead(404, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Not found");
				return;
			}

			const appUrl = new URL(`${protocol}://auth${CALLBACK_PATH}`);
			for (const key of CALLBACK_PARAMETERS) {
				for (const value of requestUrl.searchParams.getAll(key)) {
					appUrl.searchParams.append(key, value);
				}
			}
			if (!appUrl.searchParams.has("code") && !appUrl.searchParams.has("error")) {
				response.writeHead(400, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Invalid authentication callback");
				return;
			}

			dispatch(appUrl.href);
			response.writeHead(200, callbackHeaders("text/html; charset=utf-8"));
			response.end(
				renderCallbackHtml(
					"Return to AnyRecord",
					"Your sign-in link has been received. Return to the app to finish signing in.",
					true,
				),
			);
		});
		server.on("error", (error) => {
			console.error("[auth] Could not start local callback server", error);
			server = null;
		});
		server.listen(43821, "127.0.0.1");
	}

	function close() {
		server?.close();
		server = null;
	}

	app.on("open-url", (event, url) => {
		event.preventDefault();
		dispatch(url);
	});

	ipcMain.handle("auth:get-pending-callback", () => pendingUrl);
	ipcMain.handle("auth:ack-callback", (_, url: string) => {
		if (pendingUrl === url) pendingUrl = null;
	});

	return { close, dispatch, find, protocol, startDevServer };
}
