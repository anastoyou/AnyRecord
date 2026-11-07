import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import {
	decryptSecret,
	encryptSecret,
} from "../../../services/supabase/functions/cloudinary/crypto";
import {
	CloudinaryOAuthService,
	CloudinaryServiceError,
	extractCloudNameFromUrl,
	type PublicConnectionStatus,
} from "../../../services/supabase/functions/cloudinary/oauth";
import {
	type CloudinaryMediaRecord,
	NeonCloudinaryStore,
} from "../../../services/supabase/functions/cloudinary/store";
import {
	type CloudinaryCallbackPayload,
	LOOPBACK_CLOUDINARY_REDIRECT_URI,
	registerCloudinaryCallbackListener,
} from "../../authCallback";
import { isOwnedExportPath } from "../export/exportStream";
import { getProjectsDir, isAllowedLocalReadPath } from "../project/manager";
import { currentProjectPath } from "../state";
import { approveUserPath, getRecordingsDir } from "../utils";

const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB chunks for direct large uploads
const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const CHUNK_RETRY_ATTEMPTS = 3;

const DEFAULT_NEON_DATABASE_URL =
	"postgresql://neondb_owner:npg_5PrGnuIT4Did@ep-odd-smoke-a13hiwg1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const DEFAULT_TOKEN_KEY =
	"ar_cld_k1_9f4b7e2a8c6d1f0e3b5a7c9d2e4f6a8b0c1d3e5f7a9b2c4d6e8f0a1b3c5d7e9f";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv"]);

const activeUploads = new Map<string, AbortController>();
const verifiedAuthTokenCache = new Map<
	string,
	{ userId: string; email: string | null; expiresAt: number }
>();

let cachedEnv: Record<string, string> | null = null;

function loadDotEnvVars(): Record<string, string> {
	if (cachedEnv) return cachedEnv;
	const parsed: Record<string, string> = {};
	const candidates = [
		path.resolve(process.cwd(), ".env"),
		app?.getAppPath ? path.resolve(app.getAppPath(), ".env") : "",
	].filter(Boolean);

	for (const filePath of candidates) {
		try {
			if (!existsSync(filePath)) continue;
			const content = readFileSync(filePath, "utf8");
			for (const rawLine of content.split(/\r?\n/)) {
				const line = rawLine.trim();
				if (!line || line.startsWith("#")) continue;
				const eqIdx = line.indexOf("=");
				if (eqIdx <= 0) continue;
				const key = line.slice(0, eqIdx).trim();
				let value = line.slice(eqIdx + 1).trim();
				if (
					(value.startsWith('"') && value.endsWith('"')) ||
					(value.startsWith("'") && value.endsWith("'"))
				) {
					value = value.slice(1, -1);
				}
				if (!(key in parsed)) {
					parsed[key] = value;
				}
			}
		} catch {
			// Ignore unreadable .env files
		}
	}
	cachedEnv = parsed;
	return parsed;
}

function getEnvVar(name: string): string | undefined {
	const fromProcess = process.env[name]?.trim();
	if (fromProcess) return fromProcess;
	const fromDotEnv = loadDotEnvVars()[name]?.trim();
	return fromDotEnv || undefined;
}

let serviceInstance: {
	store: NeonCloudinaryStore;
	oauth: CloudinaryOAuthService;
	schemaReady: Promise<void>;
} | null = null;

async function ensureNeonSchema(
	query: (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>,
): Promise<void> {
	await query(`
		create table if not exists cloudinary_oauth_clients (
			client_key text primary key,
			issuer_origin text not null,
			client_id text not null,
			client_secret_enc text,
			redirect_uris text[] not null default '{}',
			scopes text[] not null default '{}',
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		)
	`);
	await query(`
		create table if not exists cloudinary_oauth_states (
			state_hash text primary key,
			user_id uuid not null,
			code_verifier_enc text not null,
			return_target text not null check (return_target in ('app', 'dev')),
			redirect_uri text,
			issuer_origin text,
			expires_at timestamptz not null,
			created_at timestamptz not null default now()
		)
	`);
	await query(`
		create table if not exists cloudinary_connections (
			id uuid primary key default gen_random_uuid(),
			user_id uuid not null unique,
			cloud_name text not null,
			account_label text,
			subject text,
			issuer_origin text,
			scopes text[] not null default '{}',
			access_token_enc text not null,
			refresh_token_enc text,
			access_expires_at timestamptz not null,
			token_version integer not null default 1,
			refresh_lock_until timestamptz,
			status text not null default 'active' check (status in ('active', 'revoked')),
			last_error text,
			connected_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		)
	`);
	await query(`
		create table if not exists cloudinary_media (
			id uuid primary key default gen_random_uuid(),
			user_id uuid not null,
			connection_id uuid references cloudinary_connections (id) on delete set null,
			cloud_name text not null,
			public_id text not null,
			resource_type text not null check (resource_type in ('image', 'video')),
			format text,
			bytes bigint,
			width integer,
			height integer,
			duration double precision,
			secure_url text not null,
			original_filename text,
			title text,
			created_at timestamptz not null default now(),
			unique (user_id, cloud_name, resource_type, public_id)
		)
	`);
	await query(`
		create table if not exists cloudinary_cloud_projects (
			id uuid primary key default gen_random_uuid(),
			user_id uuid not null,
			project_id text not null,
			name text not null,
			video_url text not null,
			video_public_id text,
			thumbnail_url text,
			project_data jsonb not null,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			unique (user_id, project_id)
		)
	`);
	await query(`
		create index if not exists idx_cloudinary_cloud_projects_user on cloudinary_cloud_projects (user_id, updated_at desc)
	`);
	await query(`
		create table if not exists user_feedback (
			id uuid primary key default gen_random_uuid(),
			user_id text,
			user_email text,
			user_name text,
			subject text not null,
			message text not null,
			category text not null default 'general',
			diagnostics jsonb,
			status text not null default 'new',
			created_at timestamptz not null default now()
		)
	`);
	await query(`
		create index if not exists idx_user_feedback_created_at on user_feedback (created_at desc)
	`);
}

function getCloudinaryBackend() {
	if (serviceInstance) return serviceInstance;

	const databaseUrl =
		getEnvVar("CLOUDINARY_DATABASE_URL") ||
		getEnvVar("NEON_DATABASE_URL") ||
		DEFAULT_NEON_DATABASE_URL;
	const tokenEncryptionKey = getEnvVar("CLOUDINARY_TOKEN_KEY") || DEFAULT_TOKEN_KEY;
	const sql = neon(databaseUrl);
	const queryFn = (text: string, params?: unknown[]) =>
		sql.query(text, params) as Promise<Array<Record<string, unknown>>>;

	const store = new NeonCloudinaryStore({ query: queryFn });
	const oauth = new CloudinaryOAuthService(store, {
		tokenEncryptionKey,
		clientId: getEnvVar("CLOUDINARY_CLIENT_ID"),
		clientSecret: getEnvVar("CLOUDINARY_CLIENT_SECRET"),
		issuerOrigin: getEnvVar("CLOUDINARY_OAUTH_ISSUER"),
		defaultRedirectUri: LOOPBACK_CLOUDINARY_REDIRECT_URI,
		allowedRedirectUris: [
			LOOPBACK_CLOUDINARY_REDIRECT_URI,
			"anyrecord://cloudinary/callback",
			"anyrecord-dev://cloudinary/callback",
		],
	});

	const schemaReady = ensureNeonSchema(queryFn).catch((err) => {
		console.error("[cloudinary] Failed to ensure Neon schema:", err);
	});

	serviceInstance = { store, oauth, schemaReady };
	return serviceInstance;
}

let cachedLocalDeviceUserId: string | null = null;

async function getOrCreateLocalDeviceUserId(): Promise<string> {
	if (cachedLocalDeviceUserId) return cachedLocalDeviceUserId;
	const userDataDir = app.getPath("userData");
	const identityPath = path.join(userDataDir, "cloudinary-user-identity.json");

	try {
		const raw = await fs.readFile(identityPath, "utf8");
		const parsed = JSON.parse(raw) as { encrypted?: string; plain?: string };
		if (parsed.encrypted && safeStorage?.isEncryptionAvailable()) {
			const decrypted = safeStorage.decryptString(Buffer.from(parsed.encrypted, "base64"));
			if (/^[0-9a-f-]{36}$/i.test(decrypted)) {
				cachedLocalDeviceUserId = decrypted;
				return decrypted;
			}
		}
		if (parsed.plain && /^[0-9a-f-]{36}$/i.test(parsed.plain)) {
			cachedLocalDeviceUserId = parsed.plain;
			return parsed.plain;
		}
	} catch {
		// Create a new local user identity below
	}

	const newUserId = crypto.randomUUID();
	cachedLocalDeviceUserId = newUserId;
	try {
		await fs.mkdir(userDataDir, { recursive: true });
		const payload = safeStorage?.isEncryptionAvailable()
			? { encrypted: safeStorage.encryptString(newUserId).toString("base64") }
			: { plain: newUserId };
		await fs.writeFile(identityPath, JSON.stringify(payload), "utf8");
	} catch {
		// Keep in-memory UUID if disk write fails
	}
	return newUserId;
}

/**
 * Resolves the authenticated AnyRecord user UUID.
 * - If a Supabase `authToken` is supplied, verifies it against Supabase Auth
 *   so each user account is strictly isolated to their own `user_id`.
 * - If no `authToken` is supplied (desktop user not signed into Supabase),
 *   uses a persistent OS-user-scoped UUID stored via Electron `safeStorage`.
 */
export async function resolveAuthenticatedUser(
	authToken?: unknown,
): Promise<{ userId: string; email: string | null }> {
	if (typeof authToken === "string" && authToken.trim().length > 0) {
		const token = authToken.trim();
		const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
		const cached = verifiedAuthTokenCache.get(tokenHash);
		if (cached && cached.expiresAt > Date.now()) {
			return { userId: cached.userId, email: cached.email };
		}

		const supabaseUrl = getEnvVar("VITE_SUPABASE_URL");
		const supabaseKey = getEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY");
		if (supabaseUrl && supabaseKey) {
			const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
				headers: {
					Authorization: `Bearer ${token}`,
					apikey: supabaseKey,
				},
			});
			if (!response.ok) {
				throw new CloudinaryServiceError(
					"UNAUTHORIZED",
					"Your AnyRecord sign-in session has expired. Please sign in again.",
					401,
				);
			}
			const user = (await response.json()) as { id?: unknown; email?: unknown };
			if (typeof user.id === "string" && /^[0-9a-f-]{36}$/i.test(user.id)) {
				const email =
					typeof user.email === "string" && user.email.trim() ? user.email.trim() : null;
				verifiedAuthTokenCache.set(tokenHash, {
					userId: user.id,
					email,
					expiresAt: Date.now() + 60_000,
				});
				return { userId: user.id, email };
			}
		}
		throw new CloudinaryServiceError(
			"UNAUTHORIZED",
			"Could not verify AnyRecord user session.",
			401,
		);
	}

	throw new CloudinaryServiceError(
		"UNAUTHORIZED",
		"Please sign in to AnyRecord before connecting Cloudinary.",
		401,
	);
}

export async function adoptLocalDeviceConnectionIfNeeded(userId: string): Promise<void> {
	try {
		const localUserId = await getOrCreateLocalDeviceUserId();
		if (!localUserId || localUserId === userId) return;

		const backend = getCloudinaryBackend();
		await backend.schemaReady;

		const existingForUser = await backend.store.getConnection(userId);
		if (existingForUser && existingForUser.status !== "revoked") return;

		const localConn = await backend.store.getConnection(localUserId);
		if (!localConn || localConn.status === "revoked") return;

		const tokenEncryptionKey = getEnvVar("CLOUDINARY_TOKEN_KEY") || DEFAULT_TOKEN_KEY;
		const plainAccess = await decryptSecret(
			localConn.accessTokenEnc,
			tokenEncryptionKey,
			localUserId,
		);
		const plainRefresh = localConn.refreshTokenEnc
			? await decryptSecret(localConn.refreshTokenEnc, tokenEncryptionKey, localUserId)
			: null;

		const newAccessEnc = await encryptSecret(plainAccess, tokenEncryptionKey, userId);
		const newRefreshEnc = plainRefresh
			? await encryptSecret(plainRefresh, tokenEncryptionKey, userId)
			: null;

		const migrated = await backend.store.upsertConnection({
			userId,
			cloudName: localConn.cloudName,
			accountLabel: localConn.accountLabel,
			subject: localConn.subject,
			issuerOrigin: localConn.issuerOrigin || "",
			scopes: localConn.scopes,
			accessTokenEnc: newAccessEnc,
			refreshTokenEnc: newRefreshEnc,
			accessExpiresAt: localConn.accessExpiresAt,
		});

		const localMedia = await backend.store.listMedia(localUserId, 200);
		for (const item of localMedia) {
			await backend.store.upsertMedia({
				userId,
				connectionId: migrated.id,
				cloudName: item.cloudName,
				publicId: item.publicId,
				resourceType: item.resourceType,
				format: item.format,
				bytes: item.bytes,
				width: item.width,
				height: item.height,
				duration: item.duration,
				secureUrl: item.secureUrl,
				originalFilename: item.originalFilename,
				title: item.title,
			});
			await backend.store.deleteMedia(localUserId, item.id);
		}

		await backend.store.deleteConnection(localUserId);
	} catch {
		// Ignore adoption errors; user can still connect via OAuth
	}
}

export async function resolveAuthenticatedUserId(authToken?: unknown): Promise<string> {
	const resolved = await resolveAuthenticatedUser(authToken);
	if (typeof authToken === "string" && authToken.trim().length > 0) {
		await adoptLocalDeviceConnectionIfNeeded(resolved.userId);
	}
	return resolved.userId;
}

export function detectMediaResourceType(
	filePath: string,
	headerBytes: Uint8Array,
): { resourceType: "image" | "video"; mimeType: string } {
	const ext = path.extname(filePath).toLowerCase();

	// Magic-byte verification
	const isJpeg =
		headerBytes.length >= 3 &&
		headerBytes[0] === 0xff &&
		headerBytes[1] === 0xd8 &&
		headerBytes[2] === 0xff;
	const isPng =
		headerBytes.length >= 8 &&
		headerBytes[0] === 0x89 &&
		headerBytes[1] === 0x50 &&
		headerBytes[2] === 0x4e &&
		headerBytes[3] === 0x47;
	const isGif =
		headerBytes.length >= 6 &&
		headerBytes[0] === 0x47 &&
		headerBytes[1] === 0x49 &&
		headerBytes[2] === 0x46 &&
		headerBytes[3] === 0x38;
	const isRiffWebp =
		headerBytes.length >= 12 &&
		headerBytes[0] === 0x52 &&
		headerBytes[1] === 0x49 &&
		headerBytes[2] === 0x46 &&
		headerBytes[3] === 0x46 &&
		headerBytes[8] === 0x57 &&
		headerBytes[9] === 0x45 &&
		headerBytes[10] === 0x42 &&
		headerBytes[11] === 0x50;
	const isEbml =
		headerBytes.length >= 4 &&
		headerBytes[0] === 0x1a &&
		headerBytes[1] === 0x45 &&
		headerBytes[2] === 0xdf &&
		headerBytes[3] === 0xa3;
	const isFtyp =
		headerBytes.length >= 8 &&
		headerBytes[4] === 0x66 &&
		headerBytes[5] === 0x74 &&
		headerBytes[6] === 0x79 &&
		headerBytes[7] === 0x70;
	const ftypBrand =
		isFtyp && headerBytes.length >= 12
			? Buffer.from(headerBytes.subarray(8, 12)).toString("ascii")
			: "";

	if (IMAGE_EXTENSIONS.has(ext)) {
		if (isJpeg) return { resourceType: "image", mimeType: "image/jpeg" };
		if (isPng) return { resourceType: "image", mimeType: "image/png" };
		if (isGif) return { resourceType: "image", mimeType: "image/gif" };
		if (isRiffWebp) return { resourceType: "image", mimeType: "image/webp" };
		if (isFtyp && (ftypBrand === "avif" || ftypBrand === "avis")) {
			return { resourceType: "image", mimeType: "image/avif" };
		}
	}

	if (VIDEO_EXTENSIONS.has(ext)) {
		if (isFtyp) {
			return {
				resourceType: "video",
				mimeType: ext === ".mov" ? "video/quicktime" : "video/mp4",
			};
		}
		if (isEbml) {
			return {
				resourceType: "video",
				mimeType: ext === ".mkv" ? "video/x-matroska" : "video/webm",
			};
		}
	}

	throw new CloudinaryServiceError(
		"UNSUPPORTED_FILE_TYPE",
		`Unsupported or corrupted media file "${path.basename(filePath)}". Allowed formats: JPG, PNG, GIF, WebP, AVIF, MP4, MOV, WebM, MKV.`,
		400,
	);
}

function broadcastStatusChanged(payload: {
	ok: boolean;
	status?: PublicConnectionStatus;
	error?: string;
}) {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("cloudinary-status-changed", payload);
		}
	}
}

function parseMcpToolResponseText(rawBody: string): Record<string, unknown> {
	const trimmed = rawBody.trim();
	const jsonCandidates: string[] = [];
	if (trimmed.startsWith("{")) {
		jsonCandidates.push(trimmed);
	} else {
		for (const line of trimmed.split(/\r?\n/)) {
			if (line.startsWith("data:")) {
				const dataStr = line.slice("data:".length).trim();
				if (dataStr.startsWith("{")) {
					jsonCandidates.push(dataStr);
				}
			}
		}
	}

	for (const candidate of jsonCandidates) {
		try {
			const rpc = JSON.parse(candidate) as {
				error?: { message?: string };
				result?: {
					isError?: boolean;
					content?: Array<{ type?: string; text?: string }>;
				};
			};
			if (rpc.error?.message) {
				throw new Error(rpc.error.message);
			}
			const textContent = rpc.result?.content?.find(
				(item) => typeof item.text === "string",
			)?.text;
			if (rpc.result?.isError) {
				throw new Error(textContent || "Cloudinary upload failed.");
			}
			if (textContent) {
				const parsedInner = JSON.parse(textContent) as unknown;
				if (
					Array.isArray(parsedInner) &&
					parsedInner.length > 0 &&
					typeof parsedInner[0] === "object" &&
					parsedInner[0] !== null
				) {
					return parsedInner[0] as Record<string, unknown>;
				}
				if (typeof parsedInner === "object" && parsedInner !== null) {
					return parsedInner as Record<string, unknown>;
				}
			}
		} catch (err) {
			if (err instanceof Error && !(err instanceof SyntaxError)) {
				throw err;
			}
		}
	}
	throw new Error("Unexpected response from Cloudinary upload service.");
}

async function uploadViaMcpGateway(options: {
	mcpEndpoint: string;
	accessToken: string;
	filePath: string;
	fileSize: number;
	resourceType: "image" | "video";
	mimeType: string;
	folder: string;
	title: string;
	uploadId?: string;
	signal: AbortSignal;
	sendProgress: (uploadedBytes: number) => void;
}): Promise<Record<string, unknown>> {
	options.sendProgress(Math.round(options.fileSize * 0.05));

	// 1. Request signed Upload API parameters via Cloudinary's official `sign-upload` MCP tool
	const signResponse = await fetch(options.mcpEndpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name: "sign-upload",
				arguments: {
					uploads: [
						{
							folder: options.folder,
							tags: "anyrecord",
							use_filename: true,
							unique_filename: true,
						},
					],
				},
			},
		}),
		signal: options.signal,
	});

	if (signResponse.status === 401 || signResponse.status === 403) {
		throw new CloudinaryServiceError(
			"RECONNECT_REQUIRED",
			"Cloudinary rejected the access token (401).",
			401,
		);
	}

	if (signResponse.ok) {
		const rawSignText = await signResponse.text();
		const signed = parseMcpToolResponseText(rawSignText);
		const uploadParams =
			signed.upload_params && typeof signed.upload_params === "object"
				? (signed.upload_params as Record<string, unknown>)
				: null;
		const apiKey = typeof signed.api_key === "string" ? signed.api_key : "";
		const signature = typeof signed.signature === "string" ? signed.signature : "";
		const host =
			typeof signed.host === "string" && signed.host.trim()
				? signed.host.trim()
				: "api.cloudinary.com";
		const cloudName = typeof signed.cloud_name === "string" ? signed.cloud_name.trim() : "";

		if (uploadParams && apiKey && signature && cloudName) {
			const uploadEndpoint = `https://${host}/v1_1/${encodeURIComponent(cloudName)}/${options.resourceType}/upload`;
			const fileHandle = await fs.open(options.filePath, "r");
			try {
				if (options.fileSize <= CHUNK_SIZE) {
					options.sendProgress(Math.round(options.fileSize * 0.15));
					const fileBuffer = await fileHandle.readFile();
					const formData = new FormData();
					for (const [k, v] of Object.entries(uploadParams)) {
						if (v !== undefined && v !== null) {
							formData.append(k, String(v));
						}
					}
					formData.append("api_key", apiKey);
					formData.append("signature", signature);
					const fileBlob = new Blob([fileBuffer], { type: options.mimeType });
					formData.append("file", fileBlob, path.basename(options.filePath));

					const uploadRes = await fetch(uploadEndpoint, {
						method: "POST",
						body: formData,
						signal: options.signal,
					});
					const json = (await uploadRes.json().catch(() => ({}))) as Record<
						string,
						unknown
					>;
					if (!uploadRes.ok) {
						const errMsg =
							json &&
							typeof json.error === "object" &&
							json.error &&
							"message" in json.error
								? String((json.error as { message: unknown }).message)
								: `Cloudinary upload failed (${uploadRes.status}).`;
						throw new Error(errMsg);
					}
					options.sendProgress(options.fileSize);
					return json;
				}

				// Chunked signed upload for files > 20 MB
				const totalChunks = Math.ceil(options.fileSize / CHUNK_SIZE);
				const uniqueUploadId = (options.uploadId || crypto.randomUUID()).replace(/-/g, "");
				let finalResult: Record<string, unknown> | null = null;

				for (let i = 0; i < totalChunks; i++) {
					if (options.signal.aborted) {
						throw new Error("Upload canceled");
					}
					const start = i * CHUNK_SIZE;
					const end = Math.min(start + CHUNK_SIZE, options.fileSize);
					const chunkLength = end - start;
					const chunkBuffer = Buffer.alloc(chunkLength);
					await fileHandle.read(chunkBuffer, 0, chunkLength, start);
					const contentRange = `bytes ${start}-${end - 1}/${options.fileSize}`;

					const formData = new FormData();
					for (const [k, v] of Object.entries(uploadParams)) {
						if (v !== undefined && v !== null) {
							formData.append(k, String(v));
						}
					}
					formData.append("api_key", apiKey);
					formData.append("signature", signature);
					const chunkBlob = new Blob([chunkBuffer], {
						type: "application/octet-stream",
					});
					formData.append("file", chunkBlob, path.basename(options.filePath));

					const uploadRes = await fetch(uploadEndpoint, {
						method: "POST",
						headers: {
							"Content-Range": contentRange,
							"X-Unique-Upload-Id": uniqueUploadId,
						},
						body: formData,
						signal: options.signal,
					});
					const json = (await uploadRes.json().catch(() => ({}))) as Record<
						string,
						unknown
					>;
					if (!uploadRes.ok) {
						const errMsg =
							json &&
							typeof json.error === "object" &&
							json.error &&
							"message" in json.error
								? String((json.error as { message: unknown }).message)
								: `Cloudinary chunked upload failed (${uploadRes.status}).`;
						throw new Error(errMsg);
					}
					options.sendProgress(end);
					if (i === totalChunks - 1) {
						finalResult = json;
					}
				}

				if (!finalResult) {
					throw new Error("No final response received from Cloudinary chunked upload.");
				}
				return finalResult;
			} finally {
				await fileHandle.close();
			}
		}
	}

	// 2. Fallback: `upload-asset` tool with snake_case `resource_type` and `upload_request`
	const fileBuffer = await fs.readFile(options.filePath);
	if (options.signal.aborted) {
		throw new Error("Upload canceled");
	}
	options.sendProgress(Math.round(options.fileSize * 0.35));

	const dataUri = `data:${options.mimeType};base64,${fileBuffer.toString("base64")}`;
	const response = await fetch(options.mcpEndpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method: "tools/call",
			params: {
				name: "upload-asset",
				arguments: {
					resource_type: options.resourceType,
					upload_request: {
						file: dataUri,
						folder: options.folder,
						display_name: options.title || path.basename(options.filePath),
						tags: "anyrecord",
						use_filename: true,
						unique_filename: true,
					},
				},
			},
		}),
		signal: options.signal,
	});

	if (response.status === 401 || response.status === 403) {
		throw new CloudinaryServiceError(
			"RECONNECT_REQUIRED",
			"Cloudinary rejected the access token (401).",
			401,
		);
	}

	const rawText = await response.text();
	if (!response.ok) {
		throw new Error(`Cloudinary upload failed (${response.status}): ${rawText.slice(0, 200)}`);
	}

	const resultData = parseMcpToolResponseText(rawText);
	options.sendProgress(options.fileSize);
	return resultData;
}

async function uploadViaDirectRestApi(options: {
	cloudName: string;
	getAccessToken: (forceRefresh?: boolean) => Promise<string>;
	filePath: string;
	fileSize: number;
	resourceType: "image" | "video";
	mimeType: string;
	folder: string;
	title: string;
	uploadId: string;
	signal: AbortSignal;
	sendProgress: (uploadedBytes: number) => void;
}): Promise<Record<string, unknown>> {
	const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(options.cloudName)}/${options.resourceType}/upload`;
	const fileHandle = await fs.open(options.filePath, "r");

	try {
		if (options.fileSize <= CHUNK_SIZE) {
			options.sendProgress(0);
			const fileBuffer = await fileHandle.readFile();
			let accessToken = await options.getAccessToken(false);

			for (let attempt = 0; attempt < 2; attempt++) {
				const formData = new FormData();
				const fileBlob = new Blob([fileBuffer], { type: options.mimeType });
				formData.append("file", fileBlob, path.basename(options.filePath));
				formData.append("timestamp", String(Math.floor(Date.now() / 1000)));
				if (options.folder) formData.append("folder", options.folder);
				formData.append("tags", "anyrecord");
				if (options.title) formData.append("context", `caption=${options.title}`);

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
					body: formData,
					signal: options.signal,
				});

				if (response.status === 401 && attempt === 0) {
					accessToken = await options.getAccessToken(true);
					continue;
				}

				const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
				if (!response.ok) {
					const errorMsg =
						json &&
						typeof json.error === "object" &&
						json.error &&
						"message" in json.error
							? String((json.error as { message: unknown }).message)
							: `Cloudinary upload failed (${response.status}).`;
					if (response.status === 401 || response.status === 403) {
						throw new CloudinaryServiceError("RECONNECT_REQUIRED", errorMsg, 401);
					}
					throw new Error(errorMsg);
				}

				options.sendProgress(options.fileSize);
				return json;
			}
			throw new Error("Cloudinary upload failed after token refresh.");
		}

		// Chunked upload for files > 20 MB
		const totalChunks = Math.ceil(options.fileSize / CHUNK_SIZE);
		const uniqueUploadId = options.uploadId.replace(/-/g, "");
		let resultData: Record<string, unknown> | null = null;

		for (let i = 0; i < totalChunks; i++) {
			if (options.signal.aborted) {
				throw new Error("Upload canceled");
			}

			const start = i * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, options.fileSize);
			const chunkLength = end - start;
			const chunkBuffer = Buffer.alloc(chunkLength);
			await fileHandle.read(chunkBuffer, 0, chunkLength, start);
			const contentRange = `bytes ${start}-${end - 1}/${options.fileSize}`;

			let chunkSucceeded = false;
			let forceRefresh = false;

			for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
				const accessToken = await options.getAccessToken(forceRefresh);
				forceRefresh = false;

				const formData = new FormData();
				const chunkBlob = new Blob([chunkBuffer], {
					type: "application/octet-stream",
				});
				formData.append("file", chunkBlob, path.basename(options.filePath));
				formData.append("timestamp", String(Math.floor(Date.now() / 1000)));
				if (options.folder) formData.append("folder", options.folder);
				formData.append("tags", "anyrecord");
				if (options.title) formData.append("context", `caption=${options.title}`);

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
						"Content-Range": contentRange,
						"X-Unique-Upload-Id": uniqueUploadId,
					},
					body: formData,
					signal: options.signal,
				});

				if (response.status === 401 && attempt < CHUNK_RETRY_ATTEMPTS) {
					forceRefresh = true;
					continue;
				}

				const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
				if (!response.ok) {
					const isRetryable =
						response.status === 408 ||
						response.status === 429 ||
						response.status >= 500;
					if (isRetryable && attempt < CHUNK_RETRY_ATTEMPTS) {
						await new Promise((r) => setTimeout(r, 400 * attempt));
						continue;
					}
					const errorMsg =
						json &&
						typeof json.error === "object" &&
						json.error &&
						"message" in json.error
							? String((json.error as { message: unknown }).message)
							: `Cloudinary chunked upload failed (${response.status}).`;
					throw new Error(errorMsg);
				}

				options.sendProgress(end);
				if (i === totalChunks - 1) {
					resultData = json;
				}
				chunkSucceeded = true;
				break;
			}

			if (!chunkSucceeded) {
				throw new Error("Cloudinary chunk upload failed after retries.");
			}
		}

		if (!resultData) {
			throw new Error("No final response received from Cloudinary chunked upload.");
		}
		return resultData;
	} finally {
		await fileHandle.close();
	}
}

export function registerCloudinaryHandlers() {
	registerCloudinaryCallbackListener(async (payload: CloudinaryCallbackPayload) => {
		try {
			const backend = getCloudinaryBackend();
			await backend.schemaReady;

			if (payload.status === "connected") {
				return { ok: true, cloudName: payload.cloudName };
			}
			if (payload.status === "error") {
				const reason = payload.reason || "Authorization failed.";
				broadcastStatusChanged({ ok: false, error: reason });
				return { ok: false, message: reason };
			}

			const completed = await backend.oauth.completeOAuthCallback({
				code: payload.code,
				state: payload.state,
				error: payload.error,
				errorDescription: payload.errorDescription,
				cloudNameHint: payload.cloudName,
			});

			broadcastStatusChanged({ ok: true, status: completed.status });
			return { ok: true, cloudName: completed.status.cloudName };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Cloudinary authorization failed.";
			broadcastStatusChanged({ ok: false, error: message });
			return { ok: false, message };
		}
	});

	ipcMain.handle("cloudinary-status", async (_event, input?: { authToken?: unknown }) => {
		try {
			if (!input?.authToken) {
				return {
					success: true,
					status: {
						connected: false,
						state: "not_connected" as const,
						cloudName: null,
						accountLabel: null,
						connectedAt: null,
						scopes: [],
						lastError: null,
					},
				};
			}
			const backend = getCloudinaryBackend();
			await backend.schemaReady;
			const userId = await resolveAuthenticatedUserId(input.authToken);
			const status = await backend.oauth.getPublicStatus(userId);
			return { success: true, status };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	let lastOAuthLaunchTime = 0;
	let lastOAuthState: string | null = null;

	ipcMain.handle(
		"cloudinary-oauth-start",
		async (_event, input?: { authToken?: unknown; loginHint?: unknown }) => {
			try {
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const { userId, email } = await resolveAuthenticatedUser(input?.authToken);
				const loginHint =
					typeof input?.loginHint === "string" && input.loginHint.trim()
						? input.loginHint.trim()
						: email;
				const { authorizeUrl, state } = await backend.oauth.startOAuth({
					userId,
					returnTarget: process.env["VITE_DEV_SERVER_URL"] ? "dev" : "app",
					redirectUri: LOOPBACK_CLOUDINARY_REDIRECT_URI,
					loginHint,
				});

				const parsed = new URL(authorizeUrl);
				if (
					parsed.protocol !== "https:" ||
					(!parsed.hostname.endsWith("cloudinary.com") &&
						parsed.hostname !== "oauth.cloudinary.com")
				) {
					throw new Error("Refusing to open untrusted OAuth authorization URL.");
				}

				// Guard against accidental double-clicks or duplicate triggers spawning multiple tabs
				const now = Date.now();
				if (now - lastOAuthLaunchTime < 3500 && lastOAuthState) {
					console.warn("[cloudinary] Throttling duplicate OAuth browser launch within 3.5s window");
					return { success: true, state: lastOAuthState };
				}
				lastOAuthLaunchTime = now;
				lastOAuthState = state;

				await shell.openExternal(authorizeUrl);
				return { success: true, state };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle("cloudinary-disconnect", async (_event, input?: { authToken?: unknown }) => {
		try {
			if (!input?.authToken) {
				return {
					success: true,
					status: {
						connected: false,
						state: "not_connected" as const,
						cloudName: null,
						accountLabel: null,
						connectedAt: null,
						scopes: [],
						lastError: null,
					},
				};
			}
			const backend = getCloudinaryBackend();
			await backend.schemaReady;
			const userId = await resolveAuthenticatedUserId(input.authToken);
			await backend.oauth.disconnect(userId);
			const status = await backend.oauth.getPublicStatus(userId);
			broadcastStatusChanged({ ok: true, status });
			return { success: true, status };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle("cloudinary-pick-files", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select images or videos to upload to Cloudinary",
				properties: ["openFile", "multiSelections"],
				filters: [
					{
						name: "Images & Videos",
						extensions: [
							"jpg",
							"jpeg",
							"png",
							"gif",
							"webp",
							"avif",
							"mp4",
							"mov",
							"webm",
							"mkv",
						],
					},
					{
						name: "Images",
						extensions: ["jpg", "jpeg", "png", "gif", "webp", "avif"],
					},
					{
						name: "Videos",
						extensions: ["mp4", "mov", "webm", "mkv"],
					},
				],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: true, canceled: true, files: [] };
			}

			const files: Array<{
				filePath: string;
				fileName: string;
				name: string;
				sizeBytes: number;
				size: number;
				resourceType: "image" | "video";
			}> = [];

			for (const filePath of result.filePaths) {
				approveUserPath(filePath);
				const stat = await fs.stat(filePath);
				if (!stat.isFile()) continue;
				const ext = path.extname(filePath).toLowerCase();
				const resourceType = IMAGE_EXTENSIONS.has(ext) ? "image" : "video";
				const baseName = path.basename(filePath);
				files.push({
					filePath,
					fileName: baseName,
					name: baseName,
					sizeBytes: stat.size,
					size: stat.size,
					resourceType,
				});
			}

			return { success: true, canceled: false, files };
		} catch (error) {
			return {
				success: false,
				files: [],
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	async function uploadMediaFileToCloudinary(options: {
		backend: { store: NeonCloudinaryStore; oauth: CloudinaryOAuthService };
		userId: string;
		filePath: string;
		fileSize: number;
		resourceType: "image" | "video";
		mimeType: string;
		folder: string;
		title: string;
		uploadId?: string;
		signal?: AbortSignal;
		sendProgress?: (uploadedBytes: number) => void;
	}): Promise<{
		secureUrl: string;
		publicId: string;
		secure_url: string;
		public_id: string;
		raw: Record<string, unknown>;
	}> {
		const initialTokenInfo = await options.backend.oauth.getValidAccessToken(options.userId);
		const { connection, endpoints } = initialTokenInfo;
		const uploadId = options.uploadId || crypto.randomUUID();
		const signal = options.signal || new AbortController().signal;
		const sendProgress =
			options.sendProgress ||
			(() => {
				/* no-op */
			});

		let resultData: Record<string, unknown>;

		const canTryDirectRest =
			Boolean(connection.cloudName) &&
			connection.cloudName !== "connected-cloud" &&
			!endpoints.mcpEndpoint;

		if (canTryDirectRest) {
			resultData = await uploadViaDirectRestApi({
				cloudName: connection.cloudName,
				getAccessToken: async (forceRefresh) => {
					const refreshed = await options.backend.oauth.getValidAccessToken(
						options.userId,
						{
							forceRefresh,
						},
					);
					return refreshed.accessToken;
				},
				filePath: options.filePath,
				fileSize: options.fileSize,
				resourceType: options.resourceType,
				mimeType: options.mimeType,
				folder: options.folder,
				title: options.title,
				uploadId,
				signal,
				sendProgress,
			});
		} else if (endpoints.mcpEndpoint) {
			try {
				resultData = await uploadViaMcpGateway({
					mcpEndpoint: endpoints.mcpEndpoint,
					accessToken: initialTokenInfo.accessToken,
					filePath: options.filePath,
					fileSize: options.fileSize,
					resourceType: options.resourceType,
					mimeType: options.mimeType,
					folder: options.folder,
					title: options.title,
					uploadId,
					signal,
					sendProgress,
				});
			} catch (err) {
				if (err instanceof CloudinaryServiceError && err.code === "RECONNECT_REQUIRED") {
					const refreshed = await options.backend.oauth.getValidAccessToken(
						options.userId,
						{
							forceRefresh: true,
						},
					);
					resultData = await uploadViaMcpGateway({
						mcpEndpoint: endpoints.mcpEndpoint,
						accessToken: refreshed.accessToken,
						filePath: options.filePath,
						fileSize: options.fileSize,
						resourceType: options.resourceType,
						mimeType: options.mimeType,
						folder: options.folder,
						title: options.title,
						uploadId,
						signal,
						sendProgress,
					});
				} else {
					throw err;
				}
			}
		} else {
			resultData = await uploadViaDirectRestApi({
				cloudName: connection.cloudName,
				getAccessToken: async (forceRefresh) => {
					const refreshed = await options.backend.oauth.getValidAccessToken(
						options.userId,
						{
							forceRefresh,
						},
					);
					return refreshed.accessToken;
				},
				filePath: options.filePath,
				fileSize: options.fileSize,
				resourceType: options.resourceType,
				mimeType: options.mimeType,
				folder: options.folder,
				title: options.title,
				uploadId,
				signal,
				sendProgress,
			});
		}

		const secureUrl =
			typeof resultData.secure_url === "string"
				? resultData.secure_url
				: typeof resultData.url === "string"
					? resultData.url
					: "";
		const publicId = typeof resultData.public_id === "string" ? resultData.public_id : "";

		if (!secureUrl || !publicId) {
			throw new Error(
				"Cloudinary upload succeeded but did not return a secure_url and public_id.",
			);
		}

		return {
			secureUrl,
			publicId,
			secure_url: secureUrl,
			public_id: publicId,
			raw: resultData,
		};
	}

	ipcMain.handle(
		"cloudinary-upload",
		async (
			event,
			input: {
				filePath?: unknown;
				folder?: unknown;
				title?: unknown;
				uploadId?: unknown;
				authToken?: unknown;
			},
		) => {
			let uploadId: string | undefined;
			try {
				if (typeof input?.filePath !== "string" || input.filePath.trim().length === 0) {
					throw new Error(
						"Select or export a media file before uploading to Cloudinary.",
					);
				}

				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input?.authToken);

				const folder =
					typeof input.folder === "string" && input.folder.trim()
						? input.folder.trim()
						: "AnyRecord";
				const title =
					typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";

				uploadId =
					typeof input.uploadId === "string" && /^[a-f0-9-]{36}$/i.test(input.uploadId)
						? input.uploadId
						: crypto.randomUUID();

				const controller = new AbortController();
				activeUploads.set(uploadId, controller);

				const requestedPath = path.resolve(input.filePath);
				const resolvedPath = await fs.realpath(requestedPath);
				const isAnyRecordExport =
					isOwnedExportPath(requestedPath) || isOwnedExportPath(resolvedPath);
				if (!isAnyRecordExport && !isAllowedLocalReadPath(resolvedPath)) {
					throw new Error("This file is outside AnyRecord's approved media locations.");
				}

				const stat = await fs.stat(resolvedPath);
				if (!stat.isFile()) {
					throw new Error("The media file could not be found.");
				}
				const fileSize = stat.size;
				if (fileSize <= 0) {
					throw new Error("Cannot upload an empty file.");
				}

				// Read first 16 bytes for magic-byte file type validation
				const headerHandle = await fs.open(resolvedPath, "r");
				const headerBuf = Buffer.alloc(Math.min(16, fileSize));
				try {
					await headerHandle.read(headerBuf, 0, headerBuf.length, 0);
				} finally {
					await headerHandle.close();
				}

				const { resourceType, mimeType } = detectMediaResourceType(resolvedPath, headerBuf);
				const maxBytes = resourceType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
				if (fileSize > maxBytes) {
					const maxMb = Math.round(maxBytes / (1024 * 1024));
					throw new CloudinaryServiceError(
						"FILE_TOO_LARGE",
						`"${path.basename(resolvedPath)}" exceeds the maximum ${resourceType} size limit (${maxMb} MB).`,
						400,
					);
				}

				const sendProgress = (uploadedBytes: number) => {
					if (event.sender.isDestroyed()) return;
					event.sender.send("cloudinary-upload-progress", {
						uploadId,
						uploadedBytes,
						totalBytes: fileSize,
					});
				};

				const initialTokenInfo = await backend.oauth.getValidAccessToken(userId);
				const { connection } = initialTokenInfo;

				const {
					secureUrl,
					publicId,
					raw: resultData,
				} = await uploadMediaFileToCloudinary({
					backend,
					userId,
					filePath: resolvedPath,
					fileSize,
					resourceType,
					mimeType,
					folder,
					title: title || path.basename(resolvedPath, path.extname(resolvedPath)),
					uploadId,
					signal: controller.signal,
					sendProgress,
				});

				const detectedCloudName =
					extractCloudNameFromUrl(secureUrl) || connection.cloudName;
				if (detectedCloudName && detectedCloudName !== connection.cloudName) {
					await backend.store.updateCloudName(userId, detectedCloudName);
					const updatedStatus = await backend.oauth.getPublicStatus(userId);
					broadcastStatusChanged({ ok: true, status: updatedStatus });
				}

				const mediaRecord: CloudinaryMediaRecord = await backend.store.upsertMedia({
					userId,
					connectionId: connection.id,
					cloudName: detectedCloudName,
					publicId,
					resourceType,
					format: typeof resultData.format === "string" ? resultData.format : null,
					bytes: typeof resultData.bytes === "number" ? resultData.bytes : fileSize,
					width: typeof resultData.width === "number" ? resultData.width : null,
					height: typeof resultData.height === "number" ? resultData.height : null,
					duration: typeof resultData.duration === "number" ? resultData.duration : null,
					secureUrl,
					originalFilename: path.basename(resolvedPath),
					title: title || path.basename(resolvedPath, path.extname(resolvedPath)),
				});

				return {
					success: true,
					uploadId,
					url: secureUrl,
					secureUrl,
					publicId,
					resourceType,
					format: mediaRecord.format ?? undefined,
					bytes: mediaRecord.bytes ?? fileSize,
					width: mediaRecord.width ?? undefined,
					height: mediaRecord.height ?? undefined,
					duration: mediaRecord.duration ?? undefined,
					cloudName: detectedCloudName,
					media: mediaRecord,
				};
			} catch (error) {
				const isCanceled =
					(error instanceof Error && error.name === "AbortError") ||
					(error instanceof Error && error.message.toLowerCase().includes("cancel"));
				const code = error instanceof CloudinaryServiceError ? error.code : undefined;
				return {
					success: false,
					uploadId,
					canceled: isCanceled,
					code,
					error: error instanceof Error ? error.message : String(error),
				};
			} finally {
				if (uploadId) activeUploads.delete(uploadId);
			}
		},
	);

	ipcMain.handle("cloudinary-cancel", async (_event, uploadId: string) => {
		if (typeof uploadId === "string" && activeUploads.has(uploadId)) {
			activeUploads.get(uploadId)?.abort();
			activeUploads.delete(uploadId);
			return { success: true };
		}
		return { success: false };
	});

	ipcMain.handle(
		"cloudinary-list-media",
		async (_event, input?: { authToken?: unknown; limit?: unknown }) => {
			try {
				if (!input?.authToken) {
					return { success: true, media: [] };
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);
				const limit =
					typeof input?.limit === "number" && Number.isFinite(input.limit)
						? input.limit
						: 50;
				const media = await backend.store.listMedia(userId, limit);
				return { success: true, media };
			} catch (error) {
				return {
					success: false,
					media: [],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	async function deleteAssetFromCloudinary(options: {
		backend: { store: NeonCloudinaryStore; oauth: CloudinaryOAuthService };
		userId: string;
		publicId: string;
		resourceType?: "image" | "video" | "raw";
	}): Promise<{ ok: boolean; error?: string }> {
		if (!options.publicId || !options.publicId.trim()) {
			return { ok: true };
		}
		try {
			const tokenInfo = await options.backend.oauth.getValidAccessToken(options.userId);
			const { endpoints } = tokenInfo;

			if (endpoints.mcpEndpoint) {
				const cleanPublicId = options.publicId.trim();
				const searchPayload = {
					jsonrpc: "2.0",
					id: crypto.randomUUID(),
					method: "tools/call",
					params: {
						name: "search-assets",
						arguments: {
							request: {
								expression: `public_id="${cleanPublicId}"`,
								max_results: 1,
							},
						},
					},
				};

				let searchRes = await fetch(endpoints.mcpEndpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${tokenInfo.accessToken}`,
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
					},
					body: JSON.stringify(searchPayload),
				});

				if (searchRes.status === 401) {
					const refreshed = await options.backend.oauth.getValidAccessToken(
						options.userId,
						{
							forceRefresh: true,
						},
					);
					tokenInfo.accessToken = refreshed.accessToken;
					searchRes = await fetch(endpoints.mcpEndpoint, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${tokenInfo.accessToken}`,
							"Content-Type": "application/json",
							Accept: "application/json, text/event-stream",
						},
						body: JSON.stringify(searchPayload),
					});
				}

				if (searchRes.ok) {
					const searchBody = await searchRes.text();
					const parsedSearch = parseMcpToolResponseText(searchBody);
					const resources = parsedSearch?.resources as
						| Array<{ asset_id?: string }>
						| undefined;
					const foundAssetId = resources?.[0]?.asset_id;

					if (foundAssetId) {
						const delPayload = {
							jsonrpc: "2.0",
							id: crypto.randomUUID(),
							method: "tools/call",
							params: {
								name: "delete-asset",
								arguments: {
									request: {
										asset_id: foundAssetId,
										invalidate: true,
									},
								},
							},
						};

						const delRes = await fetch(endpoints.mcpEndpoint, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${tokenInfo.accessToken}`,
								"Content-Type": "application/json",
								Accept: "application/json, text/event-stream",
							},
							body: JSON.stringify(delPayload),
						});

						if (delRes.ok) {
							console.log(
								"[cloudinary] Successfully deleted asset from Cloudinary:",
								cleanPublicId,
							);
							return { ok: true };
						}
					}
				}
			} else if (tokenInfo.connection.cloudName) {
				const resourceType = options.resourceType || "video";
				const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(tokenInfo.connection.cloudName)}/${resourceType}/destroy`;
				const formData = new FormData();
				formData.append("public_id", options.publicId.trim());
				formData.append("timestamp", String(Math.floor(Date.now() / 1000)));
				await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${tokenInfo.accessToken}`,
					},
					body: formData,
				});
				return { ok: true };
			}
		} catch (err) {
			console.warn("[cloudinary] Warning: could not delete asset from Cloudinary:", err);
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		return { ok: true };
	}

	ipcMain.handle(
		"cloudinary-delete-media",
		async (_event, input?: { authToken?: unknown; mediaId?: unknown }) => {
			try {
				if (typeof input?.mediaId !== "string" || !input.mediaId.trim()) {
					throw new Error("Media ID is required.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input?.authToken);
				const deleted = await backend.store.deleteMedia(userId, input.mediaId.trim());
				if (!deleted) {
					throw new Error("Media item not found or belongs to another account.");
				}

				if (deleted.publicId) {
					void deleteAssetFromCloudinary({
						backend,
						userId,
						publicId: deleted.publicId,
						resourceType: deleted.resourceType,
					});
				}

				return { success: true, deleted };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-save-cloud-project",
		async (
			_event,
			input?: {
				authToken?: unknown;
				projectId?: unknown;
				name?: unknown;
				projectData?: unknown;
				thumbnailDataUrl?: unknown;
			},
		) => {
			try {
				if (!input?.authToken) {
					throw new Error("Sign in to AnyRecord to sync projects to cloud.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);

				const rawProject = input.projectData as Record<string, unknown> | undefined;
				if (!rawProject || typeof rawProject !== "object") {
					throw new Error("Valid project data is required.");
				}

				const projectId =
					typeof input.projectId === "string" && input.projectId.trim()
						? input.projectId.trim()
						: typeof rawProject.projectId === "string" && rawProject.projectId.trim()
							? String(rawProject.projectId).trim()
							: crypto.randomUUID();

				const projectName =
					typeof input.name === "string" && input.name.trim()
						? input.name.trim()
						: `Project ${projectId.slice(0, 8)}`;

				let videoUrl = typeof rawProject.videoPath === "string" ? rawProject.videoPath : "";
				let videoPublicId: string | null = null;

				const existingProject = await backend.store.getCloudProject(userId, projectId);
				if (existingProject?.videoUrl) {
					videoUrl = existingProject.videoUrl;
					videoPublicId = existingProject.videoPublicId;
				}

				if (videoUrl.startsWith("file://") || !videoUrl.startsWith("http")) {
					let localPath = videoUrl.startsWith("file://")
						? decodeURIComponent(new URL(videoUrl).pathname)
						: videoUrl;
					if (process.platform === "win32" && localPath.startsWith("/")) {
						localPath = localPath.slice(1);
					}

					if (existsSync(localPath)) {
						const fileStat = await fs.stat(localPath);
						const fileSize = fileStat.size;

						const { secureUrl, publicId } = await uploadMediaFileToCloudinary({
							backend,
							userId,
							filePath: localPath,
							fileSize,
							resourceType: "video",
							mimeType: "video/mp4",
							folder: "AnyRecord/projects",
							title: projectName,
						});

						videoUrl = secureUrl;
						videoPublicId = publicId;
					}
				}

				if (!videoUrl || !videoUrl.startsWith("http")) {
					throw new Error(
						"Could not upload or resolve cloud video URL for this project.",
					);
				}

				const thumbnailUrl =
					typeof input.thumbnailDataUrl === "string" &&
					input.thumbnailDataUrl.startsWith("data:")
						? input.thumbnailDataUrl
						: videoUrl.replace(/\.[^.]+$/, ".jpg");

				const saved = await backend.store.upsertCloudProject({
					userId,
					projectId,
					name: projectName,
					videoUrl,
					videoPublicId,
					thumbnailUrl,
					projectData: {
						...rawProject,
						projectId,
						videoPath: videoUrl,
					},
				});

				if (currentProjectPath && existsSync(currentProjectPath)) {
					try {
						const currentContent = await fs.readFile(currentProjectPath, "utf8");
						const parsed = JSON.parse(currentContent);
						parsed.projectId = projectId;
						await fs.writeFile(
							currentProjectPath,
							JSON.stringify(parsed, null, 2),
							"utf8",
						);
					} catch (patchErr) {
						console.warn("Could not patch local project with projectId:", patchErr);
					}
				}

				return { success: true, project: saved };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-list-cloud-projects",
		async (_event, input?: { authToken?: unknown }) => {
			try {
				if (!input?.authToken) {
					return { success: true, projects: [] };
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);
				const projects = await backend.store.listCloudProjects(userId);
				return { success: true, projects };
			} catch (error) {
				return {
					success: false,
					projects: [],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-download-cloud-project",
		async (_event, input?: { authToken?: unknown; projectId?: unknown }) => {
			try {
				if (!input?.authToken) {
					throw new Error("Sign in to AnyRecord to open cloud projects.");
				}
				if (typeof input.projectId !== "string" || !input.projectId.trim()) {
					throw new Error("Project ID is required.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);
				const cloudProject = await backend.store.getCloudProject(
					userId,
					input.projectId.trim(),
				);
				if (!cloudProject) {
					throw new Error("Cloud project not found.");
				}

				const userDataDir = app.getPath("userData");
				const cloudCacheDir = path.join(userDataDir, "cloud-projects");
				await fs.mkdir(cloudCacheDir, { recursive: true });

				const localVideoPath = path.join(cloudCacheDir, `${cloudProject.projectId}.mp4`);
				if (!existsSync(localVideoPath)) {
					const videoRes = await fetch(cloudProject.videoUrl);
					if (!videoRes.ok) {
						throw new Error(`Failed to download project video (${videoRes.status})`);
					}
					const arrayBuf = await videoRes.arrayBuffer();
					await fs.writeFile(localVideoPath, Buffer.from(arrayBuf));
				}

				const projectsDir = await getProjectsDir();
				await fs.mkdir(projectsDir, { recursive: true });

				const safeName =
					cloudProject.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() ||
					cloudProject.projectId;
				const localProjectPath = path.join(projectsDir, `${safeName}.recordly`);

				const localProjectData = {
					...cloudProject.projectData,
					projectId: cloudProject.projectId,
					videoPath: localVideoPath,
				};

				await fs.writeFile(
					localProjectPath,
					JSON.stringify(localProjectData, null, 2),
					"utf8",
				);

				return {
					success: true,
					localProjectPath,
					projectData: localProjectData,
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-delete-cloud-project",
		async (_event, input?: { authToken?: unknown; projectId?: unknown }) => {
			try {
				if (!input?.authToken) {
					throw new Error("Sign in required.");
				}
				if (typeof input.projectId !== "string" || !input.projectId.trim()) {
					throw new Error("Project ID is required.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);

				const project = await backend.store.getCloudProject(userId, input.projectId.trim());

				if (project?.videoPublicId) {
					void deleteAssetFromCloudinary({
						backend,
						userId,
						publicId: project.videoPublicId,
						resourceType: "video",
					});
				}

				const deleted = await backend.store.deleteCloudProject(
					userId,
					input.projectId.trim(),
				);
				return { success: deleted };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-rename-cloud-project",
		async (_event, input?: { authToken?: unknown; projectId?: unknown; name?: unknown }) => {
			try {
				if (!input?.authToken) throw new Error("Sign in required.");
				if (typeof input.projectId !== "string" || !input.projectId.trim()) {
					throw new Error("Project ID is required.");
				}
				if (typeof input.name !== "string" || !input.name.trim()) {
					throw new Error("Project name is required.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;
				const userId = await resolveAuthenticatedUserId(input.authToken);
				const updated = await backend.store.renameCloudProject(
					userId,
					input.projectId.trim(),
					input.name.trim(),
				);
				return { success: updated };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"cloudinary-download-media",
		async (_event, input?: { url?: unknown; fileName?: unknown }) => {
			try {
				if (typeof input?.url !== "string" || !input.url.startsWith("http")) {
					throw new Error("Valid media URL is required.");
				}
				const recordingsDir = await getRecordingsDir();
				await fs.mkdir(recordingsDir, { recursive: true });

				const rawName =
					typeof input.fileName === "string" && input.fileName.trim()
						? input.fileName.trim()
						: path.basename(new URL(input.url).pathname);
				const cleanBase =
					rawName
						.replace(/\.[^.]+$/, "")
						.replace(/[^a-zA-Z0-9_\- ]/g, "_")
						.trim() || `cloud-media-${Date.now().toString(36)}`;
				const ext = path.extname(rawName) || ".mp4";

				let candidateName = `${cleanBase}${ext}`;
				let localPath = path.join(recordingsDir, candidateName);
				let counter = 1;
				while (existsSync(localPath)) {
					candidateName = `${cleanBase} (${counter})${ext}`;
					localPath = path.join(recordingsDir, candidateName);
					counter++;
				}

				const res = await fetch(input.url);
				if (!res.ok) {
					throw new Error(`Failed to download media (${res.status})`);
				}
				const arrayBuf = await res.arrayBuffer();
				await fs.writeFile(localPath, Buffer.from(arrayBuf));

				approveUserPath(localPath);

				return { success: true, localPath, fileName: candidateName };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"submit-user-feedback",
		async (
			_event,
			input?: {
				authToken?: unknown;
				userEmail?: unknown;
				userName?: unknown;
				subject?: unknown;
				message?: unknown;
				category?: unknown;
				diagnostics?: unknown;
			},
		) => {
			try {
				if (typeof input?.subject !== "string" || !input.subject.trim()) {
					throw new Error("Subject is required.");
				}
				if (typeof input?.message !== "string" || !input.message.trim()) {
					throw new Error("Message is required.");
				}
				const backend = getCloudinaryBackend();
				await backend.schemaReady;

				let userId: string | null = null;
				if (typeof input?.authToken === "string" && input.authToken.trim()) {
					try {
						userId = await resolveAuthenticatedUserId(input.authToken);
					} catch {
						userId = null;
					}
				}

				const record = await backend.store.saveFeedback({
					userId,
					userEmail:
						typeof input?.userEmail === "string" ? input.userEmail.trim() : null,
					userName:
						typeof input?.userName === "string" ? input.userName.trim() : null,
					subject: input.subject.trim(),
					message: input.message.trim(),
					category:
						typeof input?.category === "string" ? input.category.trim() : "general",
					diagnostics: input?.diagnostics as Record<string, unknown> | null,
				});

				return { success: true, feedbackId: record.id, createdAt: record.createdAt };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);
}
