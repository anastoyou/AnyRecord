import {
	CloudinaryOAuthService,
	CloudinaryServiceError,
	extractCloudNameFromUrl,
} from "./oauth.ts";
import type { CloudinaryStore } from "./store.ts";

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Content-Type": "application/json",
};

export interface CloudinaryEdgeDependencies {
	authenticate(bearerToken: string): Promise<string | null>;
	store: CloudinaryStore;
	oauth: CloudinaryOAuthService;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: CORS_HEADERS,
	});
}

function extractBearerToken(request: Request): string | null {
	const header = request.headers.get("authorization") ?? "";
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

export function createCloudinaryEdgeHandler(deps: CloudinaryEdgeDependencies) {
	return async function handle(request: Request): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(request.url);
		const pathname = url.pathname.replace(/^\/functions\/v1\/cloudinary/, "") || "/";

		try {
			// Public OAuth callback endpoint (GET redirect from Cloudinary)
			if (request.method === "GET" && pathname === "/oauth/callback") {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");
				const errorDescription = url.searchParams.get("error_description");
				const cloudNameHint = url.searchParams.get("cloud_name");

				try {
					const result = await deps.oauth.completeOAuthCallback({
						code,
						state,
						error,
						errorDescription,
						cloudNameHint,
					});
					const scheme = result.returnTarget === "dev" ? "anyrecord-dev" : "anyrecord";
					const deepLink = `${scheme}://cloudinary/callback?status=connected&cloud=${encodeURIComponent(result.status.cloudName ?? "")}`;
					return new Response(null, {
						status: 302,
						headers: {
							Location: deepLink,
							"Cache-Control": "no-store",
						},
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : "OAuth connection failed";
					const deepLink = `anyrecord://cloudinary/callback?status=error&reason=${encodeURIComponent(message)}`;
					return new Response(null, {
						status: 302,
						headers: {
							Location: deepLink,
							"Cache-Control": "no-store",
						},
					});
				}
			}

			// All other endpoints require a verified user token
			const bearer = extractBearerToken(request);
			if (!bearer) {
				return jsonResponse(
					{ error: "Sign in required.", code: "UNAUTHORIZED" },
					401,
				);
			}
			const userId = await deps.authenticate(bearer);
			if (!userId) {
				return jsonResponse(
					{ error: "Invalid or expired session.", code: "UNAUTHORIZED" },
					401,
				);
			}

			if (request.method === "GET" && pathname === "/status") {
				const status = await deps.oauth.getPublicStatus(userId);
				return jsonResponse({ status });
			}

			if (request.method === "POST" && pathname === "/oauth/start") {
				const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
				const returnTarget = body.returnTarget === "dev" ? "dev" : "app";
				const redirectUri =
					typeof body.redirectUri === "string" ? body.redirectUri : undefined;
				const loginHint =
					typeof body.loginHint === "string" ? body.loginHint : undefined;
				const started = await deps.oauth.startOAuth({
					userId,
					returnTarget,
					redirectUri,
					loginHint,
				});
				return jsonResponse(started);
			}

			if (request.method === "POST" && pathname === "/oauth/callback") {
				const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
				const completed = await deps.oauth.completeOAuthCallback({
					code: typeof body.code === "string" ? body.code : null,
					state: typeof body.state === "string" ? body.state : null,
					error: typeof body.error === "string" ? body.error : null,
					errorDescription:
						typeof body.errorDescription === "string" ? body.errorDescription : null,
					cloudNameHint:
						typeof body.cloudName === "string" ? body.cloudName : null,
				});
				if (completed.userId !== userId) {
					throw new CloudinaryServiceError(
						"OAUTH_STATE_INVALID",
						"This OAuth session belongs to a different user account.",
						403,
					);
				}
				return jsonResponse({ status: completed.status });
			}

			if (request.method === "POST" && pathname === "/token") {
				const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
				const forceRefresh = Boolean(body.forceRefresh);
				const tokenInfo = await deps.oauth.getValidAccessToken(userId, { forceRefresh });
				return jsonResponse({
					cloudName: tokenInfo.connection.cloudName,
					accessToken: tokenInfo.accessToken,
					expiresAt: tokenInfo.connection.accessExpiresAt.toISOString(),
					issuerOrigin: tokenInfo.issuerOrigin,
				});
			}

			if (request.method === "POST" && pathname === "/disconnect") {
				await deps.oauth.disconnect(userId);
				const status = await deps.oauth.getPublicStatus(userId);
				return jsonResponse({ status });
			}

			if (request.method === "GET" && pathname === "/media") {
				const limitParam = Number(url.searchParams.get("limit") ?? "50");
				const items = await deps.store.listMedia(
					userId,
					Number.isFinite(limitParam) ? limitParam : 50,
				);
				return jsonResponse({ media: items });
			}

			if (request.method === "POST" && pathname === "/media") {
				const body = (await request.json()) as Record<string, unknown>;
				const publicId = typeof body.publicId === "string" ? body.publicId.trim() : "";
				const secureUrl = typeof body.secureUrl === "string" ? body.secureUrl.trim() : "";
				const resourceType = body.resourceType === "image" ? "image" : "video";
				if (!publicId || !secureUrl) {
					return jsonResponse(
						{ error: "publicId and secureUrl are required.", code: "UPLOAD_FAILED" },
						400,
					);
				}
				const conn = await deps.store.getConnection(userId);
				const urlCloudName = extractCloudNameFromUrl(secureUrl);
				const cloudName =
					urlCloudName ||
					(typeof body.cloudName === "string" && body.cloudName.trim()) ||
					conn?.cloudName ||
					"connected-cloud";

				if (conn && urlCloudName && conn.cloudName === "connected-cloud") {
					await deps.store.updateCloudName(userId, urlCloudName);
				}

				const saved = await deps.store.upsertMedia({
					userId,
					connectionId: conn?.id ?? null,
					cloudName,
					publicId,
					resourceType,
					format: typeof body.format === "string" ? body.format : null,
					bytes: typeof body.bytes === "number" ? body.bytes : null,
					width: typeof body.width === "number" ? body.width : null,
					height: typeof body.height === "number" ? body.height : null,
					duration: typeof body.duration === "number" ? body.duration : null,
					secureUrl,
					originalFilename:
						typeof body.originalFilename === "string" ? body.originalFilename : null,
					title: typeof body.title === "string" ? body.title : null,
				});
				return jsonResponse({ media: saved }, 201);
			}

			if (request.method === "DELETE" && pathname.startsWith("/media/")) {
				const mediaId = pathname.slice("/media/".length).trim();
				if (!mediaId) {
					return jsonResponse({ error: "Missing media id." }, 400);
				}
				const deleted = await deps.store.deleteMedia(userId, mediaId);
				if (!deleted) {
					return jsonResponse({ error: "Media item not found." }, 404);
				}
				return jsonResponse({ deleted });
			}

			return jsonResponse({ error: "Not found" }, 404);
		} catch (error) {
			if (error instanceof CloudinaryServiceError) {
				return jsonResponse({ error: error.message, code: error.code }, error.status);
			}
			return jsonResponse(
				{
					error: error instanceof Error ? error.message : "Internal server error",
					code: "UPLOAD_FAILED",
				},
				500,
			);
		}
	};
}

