import {
	computeCodeChallengeS256,
	decodeJwtPayload,
	decryptSecret,
	encryptSecret,
	randomToken,
	sha256Hex,
} from "./crypto.ts";
import type { CloudinaryConnectionRecord, CloudinaryStore } from "./store.ts";

export const DEFAULT_CLOUDINARY_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"asset_management",
	"upload",
];

export const DIRECT_OAUTH_ORIGIN = "https://oauth.cloudinary.com";
export const HOSTED_MCP_OAUTH_ORIGIN = "https://asset-management.mcp.cloudinary.com";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const REFRESH_LOCK_LEASE_MS = 15 * 1000;

export type CloudinaryErrorCode =
	| "NOT_CONNECTED"
	| "RECONNECT_REQUIRED"
	| "OAUTH_DENIED"
	| "OAUTH_STATE_INVALID"
	| "OAUTH_EXCHANGE_FAILED"
	| "UNSUPPORTED_FILE_TYPE"
	| "FILE_TOO_LARGE"
	| "UPLOAD_FAILED"
	| "UNAUTHORIZED";

export class CloudinaryServiceError extends Error {
	readonly code: CloudinaryErrorCode;
	readonly status: number;

	constructor(code: CloudinaryErrorCode, message: string, status = 400) {
		super(message);
		this.name = "CloudinaryServiceError";
		this.code = code;
		this.status = status;
	}
}

export interface CloudinaryOAuthConfig {
	tokenEncryptionKey: string;
	clientId?: string;
	clientSecret?: string;
	issuerOrigin?: string;
	defaultRedirectUri: string;
	allowedRedirectUris: string[];
	scopes?: string[];
	fetchImpl?: typeof fetch;
}

export interface ResolvedOAuthEndpoints {
	issuerOrigin: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userinfoEndpoint: string;
	registrationEndpoint?: string;
	revocationEndpoint?: string;
	mcpEndpoint?: string;
}

export interface ResolvedOAuthClient {
	issuerOrigin: string;
	clientId: string;
	clientSecret: string | null;
	endpoints: ResolvedOAuthEndpoints;
}

export interface PublicConnectionStatus {
	connected: boolean;
	state: "not_connected" | "connected" | "revoked";
	cloudName: string | null;
	accountLabel: string | null;
	connectedAt: string | null;
	scopes: string[];
	lastError: string | null;
}

export function resolveOAuthEndpoints(
	config: Pick<CloudinaryOAuthConfig, "clientId" | "issuerOrigin">,
): ResolvedOAuthEndpoints {
	const rawOrigin =
		config.issuerOrigin?.trim().replace(/\/+$/, "") ||
		(config.clientId?.trim() ? DIRECT_OAUTH_ORIGIN : HOSTED_MCP_OAUTH_ORIGIN);

	if (rawOrigin === DIRECT_OAUTH_ORIGIN) {
		return {
			issuerOrigin: DIRECT_OAUTH_ORIGIN,
			authorizationEndpoint: `${DIRECT_OAUTH_ORIGIN}/oauth2/auth`,
			tokenEndpoint: `${DIRECT_OAUTH_ORIGIN}/oauth2/token`,
			userinfoEndpoint: `${DIRECT_OAUTH_ORIGIN}/userinfo`,
			revocationEndpoint: `${DIRECT_OAUTH_ORIGIN}/oauth2/revoke`,
		};
	}

	return {
		issuerOrigin: rawOrigin,
		authorizationEndpoint: `${rawOrigin}/authorize`,
		tokenEndpoint: `${rawOrigin}/token`,
		userinfoEndpoint: `${rawOrigin}/userinfo`,
		registrationEndpoint: `${rawOrigin}/register`,
		mcpEndpoint: `${rawOrigin}/mcp`,
	};
}

export function extractCloudNameFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.endsWith("cloudinary.com")) return null;
		const segments = parsed.pathname.split("/").filter(Boolean);
		if (segments.length >= 2 && /^[a-z0-9_-]{2,64}$/i.test(segments[0])) {
			return segments[0];
		}
	} catch {
		// ignore malformed URL
	}
	return null;
}

function pickString(
	obj: Record<string, unknown> | null | undefined,
	keys: string[],
): string | null {
	if (!obj) return null;
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

export class CloudinaryOAuthService {
	private readonly store: CloudinaryStore;
	private readonly config: CloudinaryOAuthConfig;
	private readonly fetchImpl: typeof fetch;

	constructor(store: CloudinaryStore, config: CloudinaryOAuthConfig) {
		this.store = store;
		this.config = config;
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	async resolveClient(issuerOverride?: string): Promise<ResolvedOAuthClient> {
		const endpoints = resolveOAuthEndpoints({
			clientId: this.config.clientId,
			issuerOrigin: issuerOverride || this.config.issuerOrigin,
		});

		const explicitClientId = this.config.clientId?.trim();
		if (explicitClientId) {
			return {
				issuerOrigin: endpoints.issuerOrigin,
				clientId: explicitClientId,
				clientSecret: this.config.clientSecret?.trim() || null,
				endpoints,
			};
		}

		const redirects = Array.from(
			new Set([this.config.defaultRedirectUri, ...this.config.allowedRedirectUris]),
		)
			.filter(Boolean)
			.sort();
		const clientKey = `${endpoints.issuerOrigin}|${await sha256Hex(redirects.join(","))}`;
		const cached = await this.store.getOAuthClient(clientKey);
		if (cached) {
			const secret = cached.clientSecretEnc
				? await decryptSecret(
						cached.clientSecretEnc,
						this.config.tokenEncryptionKey,
						clientKey,
					)
				: null;
			return {
				issuerOrigin: endpoints.issuerOrigin,
				clientId: cached.clientId,
				clientSecret: secret,
				endpoints,
			};
		}

		if (!endpoints.registrationEndpoint) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				"CLOUDINARY_CLIENT_ID is not configured and dynamic client registration is unavailable.",
				500,
			);
		}

		const scopes = this.config.scopes ?? DEFAULT_CLOUDINARY_SCOPES;
		const response = await this.fetchImpl(endpoints.registrationEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				client_name: "AnyRecord",
				redirect_uris: redirects,
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "client_secret_post",
				scope: scopes.join(" "),
			}),
		});

		if (!response.ok) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				`Failed to register Cloudinary OAuth client (${response.status}).`,
				502,
			);
		}

		const registered = (await response.json()) as Record<string, unknown>;
		const clientId = pickString(registered, ["client_id"]);
		const clientSecret = pickString(registered, ["client_secret"]);
		if (!clientId) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				"Cloudinary OAuth registration did not return a client_id.",
				502,
			);
		}

		const clientSecretEnc = clientSecret
			? await encryptSecret(clientSecret, this.config.tokenEncryptionKey, clientKey)
			: null;

		await this.store.saveOAuthClient({
			clientKey,
			issuerOrigin: endpoints.issuerOrigin,
			clientId,
			clientSecretEnc,
			redirectUris: redirects,
			scopes,
		});

		return {
			issuerOrigin: endpoints.issuerOrigin,
			clientId,
			clientSecret,
			endpoints,
		};
	}

	async getPublicStatus(userId: string): Promise<PublicConnectionStatus> {
		const conn = await this.store.getConnection(userId);
		if (!conn) {
			return {
				connected: false,
				state: "not_connected",
				cloudName: null,
				accountLabel: null,
				connectedAt: null,
				scopes: [],
				lastError: null,
			};
		}
		const isConnected = conn.status !== "revoked";
		return {
			connected: isConnected,
			state: isConnected ? "connected" : "revoked",
			cloudName: conn.cloudName,
			accountLabel: conn.accountLabel,
			connectedAt: conn.connectedAt.toISOString(),
			scopes: conn.scopes,
			lastError: conn.lastError,
		};
	}

	async startOAuth(input: {
		userId: string;
		returnTarget?: "app" | "dev";
		redirectUri?: string;
		loginHint?: string | null;
	}): Promise<{ authorizeUrl: string; state: string }> {
		const client = await this.resolveClient();
		const redirectUri = input.redirectUri?.trim() || this.config.defaultRedirectUri;
		if (
			this.config.allowedRedirectUris.length > 0 &&
			!this.config.allowedRedirectUris.includes(redirectUri) &&
			redirectUri !== this.config.defaultRedirectUri
		) {
			throw new CloudinaryServiceError(
				"OAUTH_STATE_INVALID",
				"Unapproved OAuth redirect URI.",
				400,
			);
		}

		const state = randomToken(32);
		const stateHash = await sha256Hex(state);
		const codeVerifier = randomToken(32);
		const codeChallenge = await computeCodeChallengeS256(codeVerifier);
		const codeVerifierEnc = await encryptSecret(
			codeVerifier,
			this.config.tokenEncryptionKey,
			input.userId,
		);

		await this.store.createOAuthState({
			stateHash,
			userId: input.userId,
			codeVerifierEnc,
			returnTarget: input.returnTarget ?? "app",
			redirectUri,
			issuerOrigin: client.issuerOrigin,
			expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
		});

		const scopes = this.config.scopes ?? DEFAULT_CLOUDINARY_SCOPES;
		const url = new URL(client.endpoints.authorizationEndpoint);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", client.clientId);
		url.searchParams.set("redirect_uri", redirectUri);
		url.searchParams.set("scope", scopes.join(" "));
		url.searchParams.set("state", state);
		url.searchParams.set("code_challenge", codeChallenge);
		url.searchParams.set("code_challenge_method", "S256");
		if (input.loginHint?.trim()) {
			url.searchParams.set("login_hint", input.loginHint.trim());
		}

		return {
			authorizeUrl: url.toString(),
			state,
		};
	}

	async completeOAuthCallback(input: {
		code?: string | null;
		state?: string | null;
		error?: string | null;
		errorDescription?: string | null;
		cloudNameHint?: string | null;
	}): Promise<{
		userId: string;
		returnTarget: "app" | "dev";
		status: PublicConnectionStatus;
	}> {
		const rawState = input.state?.trim();
		if (!rawState) {
			throw new CloudinaryServiceError(
				"OAUTH_STATE_INVALID",
				"Missing OAuth state parameter.",
				400,
			);
		}

		const stateHash = await sha256Hex(rawState);
		const stateRecord = await this.store.consumeOAuthState(stateHash);
		if (!stateRecord) {
			throw new CloudinaryServiceError(
				"OAUTH_STATE_INVALID",
				"This Cloudinary authorization link has expired or was already used. Please try connecting again.",
				400,
			);
		}

		if (input.error) {
			const desc = input.errorDescription?.trim() || input.error;
			throw new CloudinaryServiceError(
				"OAUTH_DENIED",
				`Cloudinary authorization was not completed: ${desc}`,
				400,
			);
		}

		const code = input.code?.trim();
		if (!code) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				"Cloudinary did not return an authorization code.",
				400,
			);
		}

		const codeVerifier = await decryptSecret(
			stateRecord.codeVerifierEnc,
			this.config.tokenEncryptionKey,
			stateRecord.userId,
		);

		const client = await this.resolveClient(stateRecord.issuerOrigin || undefined);
		const redirectUri = stateRecord.redirectUri || this.config.defaultRedirectUri;

		const params = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: client.clientId,
			code_verifier: codeVerifier,
		});
		if (client.clientSecret) {
			params.set("client_secret", client.clientSecret);
		}

		const tokenResponse = await this.fetchImpl(client.endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: params.toString(),
		});

		const tokenBody = (await tokenResponse.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		if (!tokenResponse.ok) {
			const errDetail =
				pickString(tokenBody, ["error_description", "error", "message"]) ||
				`Token exchange failed (${tokenResponse.status})`;
			throw new CloudinaryServiceError("OAUTH_EXCHANGE_FAILED", errDetail, 502);
		}

		const accessToken = pickString(tokenBody, ["access_token"]);
		if (!accessToken) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				"Cloudinary token response did not include an access_token.",
				502,
			);
		}
		const refreshToken = pickString(tokenBody, ["refresh_token"]);
		const idToken = pickString(tokenBody, ["id_token"]);
		const expiresInSec =
			typeof tokenBody.expires_in === "number" && Number.isFinite(tokenBody.expires_in)
				? Math.max(60, tokenBody.expires_in)
				: 300;
		const scopeStr =
			pickString(tokenBody, ["scope"]) ||
			(this.config.scopes ?? DEFAULT_CLOUDINARY_SCOPES).join(" ");
		const scopes = scopeStr
			.split(/[\s,]+/)
			.map((s) => s.trim())
			.filter(Boolean);

		const discovered = await this.discoverAccountProfile({
			accessToken,
			idToken,
			tokenBody,
			cloudNameHint: input.cloudNameHint ?? null,
			endpoints: client.endpoints,
		});

		const accessTokenEnc = await encryptSecret(
			accessToken,
			this.config.tokenEncryptionKey,
			stateRecord.userId,
		);
		const refreshTokenEnc = refreshToken
			? await encryptSecret(refreshToken, this.config.tokenEncryptionKey, stateRecord.userId)
			: null;

		const connection = await this.store.upsertConnection({
			userId: stateRecord.userId,
			cloudName: discovered.cloudName,
			accountLabel: discovered.accountLabel,
			subject: discovered.subject,
			issuerOrigin: client.issuerOrigin,
			scopes,
			accessTokenEnc,
			refreshTokenEnc,
			accessExpiresAt: new Date(Date.now() + expiresInSec * 1000),
		});

		return {
			userId: stateRecord.userId,
			returnTarget: stateRecord.returnTarget,
			status: {
				connected: true,
				state: "connected",
				cloudName: connection.cloudName,
				accountLabel: connection.accountLabel,
				connectedAt: connection.connectedAt.toISOString(),
				scopes: connection.scopes,
				lastError: null,
			},
		};
	}

	private async discoverAccountProfile(input: {
		accessToken: string;
		idToken: string | null;
		tokenBody: Record<string, unknown>;
		cloudNameHint: string | null;
		endpoints: ResolvedOAuthEndpoints;
	}): Promise<{
		cloudName: string;
		accountLabel: string | null;
		subject: string | null;
	}> {
		const idClaims = input.idToken ? decodeJwtPayload(input.idToken) : null;
		const accessClaims = decodeJwtPayload(input.accessToken);

		let cloudName =
			input.cloudNameHint?.trim() ||
			pickString(input.tokenBody, [
				"cloud_name",
				"cloudName",
				"sub_account",
				"product_environment",
			]) ||
			pickString(idClaims, [
				"cloud_name",
				"cloudName",
				"sub_account",
				"sub_account_name",
				"cname",
			]) ||
			pickString(accessClaims, [
				"cloud_name",
				"cloudName",
				"sub_account",
				"sub_account_name",
				"cname",
			]);

		let accountLabel =
			pickString(idClaims, ["email", "name", "preferred_username"]) ||
			pickString(accessClaims, ["email", "name", "preferred_username"]) ||
			pickString(input.tokenBody, ["email", "name", "username"]);

		let subject =
			pickString(idClaims, ["sub"]) ||
			pickString(accessClaims, ["sub"]) ||
			pickString(input.tokenBody, ["sub", "user_id"]);

		if (!cloudName || !accountLabel) {
			try {
				const userinfoRes = await this.fetchImpl(input.endpoints.userinfoEndpoint, {
					headers: {
						Authorization: `Bearer ${input.accessToken}`,
						Accept: "application/json",
					},
				});
				if (userinfoRes.ok) {
					const info = (await userinfoRes.json()) as Record<string, unknown>;
					cloudName =
						cloudName ||
						pickString(info, [
							"cloud_name",
							"cloudName",
							"sub_account",
							"sub_account_name",
							"cname",
						]);
					accountLabel =
						accountLabel ||
						pickString(info, ["email", "name", "preferred_username"]);
					subject = subject || pickString(info, ["sub", "id"]);
				}
			} catch {
				// Best-effort userinfo lookup
			}
		}

		if (!cloudName && input.endpoints.mcpEndpoint) {
			cloudName = await this.discoverCloudNameViaMcp(
				input.endpoints.mcpEndpoint,
				input.accessToken,
			);
		}

		return {
			cloudName: cloudName || "connected-cloud",
			accountLabel: accountLabel || cloudName || "Cloudinary Account",
			subject,
		};
	}

	private async discoverCloudNameViaMcp(
		mcpEndpoint: string,
		accessToken: string,
	): Promise<string | null> {
		try {
			const response = await this.fetchImpl(mcpEndpoint, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: {
						name: "list-images",
						arguments: { maxResults: 1 },
					},
				}),
			});
			if (!response.ok) return null;
			const text = await response.text();
			const urlMatch = text.match(/https:\/\/res\.cloudinary\.com\/([a-z0-9_-]{2,64})\//i);
			if (urlMatch?.[1]) {
				return urlMatch[1];
			}
		} catch {
			// Ignore discovery errors; cloud_name will be populated on first upload
		}
		return null;
	}

	/**
	 * Returns a valid decrypted access token for `userId`, automatically
	 * refreshing and rotating the single-use refresh token when needed.
	 */
	async getValidAccessToken(
		userId: string,
		options?: { forceRefresh?: boolean },
	): Promise<{
		connection: CloudinaryConnectionRecord;
		accessToken: string;
		issuerOrigin: string;
		endpoints: ResolvedOAuthEndpoints;
	}> {
		const conn = await this.store.getConnection(userId);
		if (!conn) {
			throw new CloudinaryServiceError(
				"NOT_CONNECTED",
				"Connect your Cloudinary account before uploading media.",
				404,
			);
		}
		if (conn.status === "revoked") {
			throw new CloudinaryServiceError(
				"RECONNECT_REQUIRED",
				conn.lastError ||
					"Your Cloudinary session has expired or was revoked. Please reconnect your account.",
				409,
			);
		}

		const client = await this.resolveClient(conn.issuerOrigin || undefined);
		const needsRefresh =
			Boolean(options?.forceRefresh) ||
			conn.accessExpiresAt.getTime() <= Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;

		if (!needsRefresh) {
			const accessToken = await decryptSecret(
				conn.accessTokenEnc,
				this.config.tokenEncryptionKey,
				userId,
			);
			return {
				connection: conn,
				accessToken,
				issuerOrigin: client.issuerOrigin,
				endpoints: client.endpoints,
			};
		}

		return this.refreshAccessToken(userId, conn, client);
	}

	private async refreshAccessToken(
		userId: string,
		initialConn: CloudinaryConnectionRecord,
		client: ResolvedOAuthClient,
	): Promise<{
		connection: CloudinaryConnectionRecord;
		accessToken: string;
		issuerOrigin: string;
		endpoints: ResolvedOAuthEndpoints;
	}> {
		let locked = await this.store.acquireRefreshLock(userId, REFRESH_LOCK_LEASE_MS);
		if (!locked) {
			// Another request is refreshing this user's single-use refresh token.
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				const latest = await this.store.getConnection(userId);
				if (!latest) {
					throw new CloudinaryServiceError(
						"NOT_CONNECTED",
						"Cloudinary account is no longer connected.",
						404,
					);
				}
				if (latest.status === "revoked") {
					throw new CloudinaryServiceError(
						"RECONNECT_REQUIRED",
						latest.lastError || "Please reconnect your Cloudinary account.",
						409,
					);
				}
				if (latest.tokenVersion > initialConn.tokenVersion) {
					const accessToken = await decryptSecret(
						latest.accessTokenEnc,
						this.config.tokenEncryptionKey,
						userId,
					);
					return {
						connection: latest,
						accessToken,
						issuerOrigin: client.issuerOrigin,
						endpoints: client.endpoints,
					};
				}
			}
			locked = await this.store.acquireRefreshLock(userId, REFRESH_LOCK_LEASE_MS);
		}

		const targetConn = locked ?? initialConn;
		if (!targetConn.refreshTokenEnc) {
			await this.store.markConnectionRevoked(
				userId,
				"Cloudinary access token expired and no refresh token is available. Please reconnect.",
			);
			throw new CloudinaryServiceError(
				"RECONNECT_REQUIRED",
				"Your Cloudinary session expired. Please reconnect your account.",
				409,
			);
		}

		const refreshToken = await decryptSecret(
			targetConn.refreshTokenEnc,
			this.config.tokenEncryptionKey,
			userId,
		);

		const params = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: client.clientId,
		});
		if (client.clientSecret) {
			params.set("client_secret", client.clientSecret);
		}

		const response = await this.fetchImpl(client.endpoints.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: params.toString(),
		});

		const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
		if (!response.ok) {
			const errorCode = pickString(body, ["error"]);
			const errorDesc =
				pickString(body, ["error_description", "message", "error"]) ||
				`Token refresh failed (${response.status})`;
			if (
				response.status === 400 ||
				response.status === 401 ||
				errorCode === "invalid_grant"
			) {
				await this.store.markConnectionRevoked(
					userId,
					"Cloudinary authorization expired or was revoked. Please reconnect.",
				);
				throw new CloudinaryServiceError(
					"RECONNECT_REQUIRED",
					"Your Cloudinary authorization expired or was revoked. Please reconnect.",
					409,
				);
			}
			throw new CloudinaryServiceError("OAUTH_EXCHANGE_FAILED", errorDesc, 502);
		}

		const newAccessToken = pickString(body, ["access_token"]);
		if (!newAccessToken) {
			throw new CloudinaryServiceError(
				"OAUTH_EXCHANGE_FAILED",
				"Cloudinary refresh did not return a new access_token.",
				502,
			);
		}

		const newRefreshToken = pickString(body, ["refresh_token"]);
		const expiresInSec =
			typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
				? Math.max(60, body.expires_in)
				: 300;

		const accessTokenEnc = await encryptSecret(
			newAccessToken,
			this.config.tokenEncryptionKey,
			userId,
		);
		const refreshTokenEnc = newRefreshToken
			? await encryptSecret(newRefreshToken, this.config.tokenEncryptionKey, userId)
			: null;

		const updated = await this.store.updateTokensCas({
			userId,
			expectedTokenVersion: targetConn.tokenVersion,
			accessTokenEnc,
			refreshTokenEnc,
			accessExpiresAt: new Date(Date.now() + expiresInSec * 1000),
		});

		const finalConn = updated ?? (await this.store.getConnection(userId)) ?? targetConn;
		const finalAccessToken = updated
			? newAccessToken
			: await decryptSecret(finalConn.accessTokenEnc, this.config.tokenEncryptionKey, userId);

		return {
			connection: finalConn,
			accessToken: finalAccessToken,
			issuerOrigin: client.issuerOrigin,
			endpoints: client.endpoints,
		};
	}

	async disconnect(userId: string): Promise<void> {
		const conn = await this.store.getConnection(userId);
		if (conn) {
			try {
				const client = await this.resolveClient(conn.issuerOrigin || undefined);
				if (client.endpoints.revocationEndpoint) {
					const tokenEnc = conn.refreshTokenEnc || conn.accessTokenEnc;
					const token = await decryptSecret(
						tokenEnc,
						this.config.tokenEncryptionKey,
						userId,
					);
					const params = new URLSearchParams({
						token,
						client_id: client.clientId,
					});
					if (client.clientSecret) {
						params.set("client_secret", client.clientSecret);
					}
					await this.fetchImpl(client.endpoints.revocationEndpoint, {
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: params.toString(),
					});
				}
			} catch {
				// Best-effort revocation; always remove local/DB connection row.
			}
		}
		await this.store.deleteConnection(userId);
	}
}

