export type CloudinaryConnectionStatus = "active" | "revoked";

export interface CloudinaryOAuthClientRecord {
	clientKey: string;
	issuerOrigin: string;
	clientId: string;
	clientSecretEnc: string | null;
	redirectUris: string[];
	scopes: string[];
}

export interface CloudinaryOAuthStateRecord {
	stateHash: string;
	userId: string;
	codeVerifierEnc: string;
	returnTarget: "app" | "dev";
	redirectUri: string;
	issuerOrigin: string;
	expiresAt: Date;
}

export interface CloudinaryConnectionRecord {
	id: string;
	userId: string;
	cloudName: string;
	accountLabel: string | null;
	subject: string | null;
	issuerOrigin: string | null;
	scopes: string[];
	accessTokenEnc: string;
	refreshTokenEnc: string | null;
	accessExpiresAt: Date;
	tokenVersion: number;
	refreshLockUntil: Date | null;
	status: CloudinaryConnectionStatus;
	lastError: string | null;
	connectedAt: Date;
	updatedAt: Date;
}

export interface CloudinaryMediaRecord {
	id: string;
	userId: string;
	connectionId: string | null;
	cloudName: string;
	publicId: string;
	resourceType: "image" | "video";
	format: string | null;
	bytes: number | null;
	width: number | null;
	height: number | null;
	duration: number | null;
	secureUrl: string;
	originalFilename: string | null;
	title: string | null;
	createdAt: string;
}

export interface CloudProjectRecord {
	id: string;
	userId: string;
	projectId: string;
	name: string;
	videoUrl: string;
	videoPublicId: string | null;
	thumbnailUrl: string | null;
	projectData: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertCloudProjectInput {
	userId: string;
	projectId: string;
	name: string;
	videoUrl: string;
	videoPublicId?: string | null;
	thumbnailUrl?: string | null;
	projectData: Record<string, unknown>;
}

export interface UserFeedbackRecord {
	id: string;
	userId: string | null;
	userEmail: string | null;
	userName: string | null;
	subject: string;
	message: string;
	category: string;
	diagnostics: Record<string, unknown> | null;
	status: string;
	createdAt: string;
}

export interface SaveUserFeedbackInput {
	userId?: string | null;
	userEmail?: string | null;
	userName?: string | null;
	subject: string;
	message: string;
	category?: string | null;
	diagnostics?: Record<string, unknown> | string | null;
}

export interface UpsertCloudinaryConnectionInput {
	userId: string;
	cloudName: string;
	accountLabel: string | null;
	subject: string | null;
	issuerOrigin: string;
	scopes: string[];
	accessTokenEnc: string;
	refreshTokenEnc: string | null;
	accessExpiresAt: Date;
}

export interface UpsertCloudinaryMediaInput {
	userId: string;
	connectionId: string | null;
	cloudName: string;
	publicId: string;
	resourceType: "image" | "video";
	format?: string | null;
	bytes?: number | null;
	width?: number | null;
	height?: number | null;
	duration?: number | null;
	secureUrl: string;
	originalFilename?: string | null;
	title?: string | null;
}

export interface CloudinaryStore {
	getOAuthClient(clientKey: string): Promise<CloudinaryOAuthClientRecord | null>;
	saveOAuthClient(record: CloudinaryOAuthClientRecord): Promise<void>;
	createOAuthState(record: CloudinaryOAuthStateRecord): Promise<void>;
	consumeOAuthState(stateHash: string): Promise<CloudinaryOAuthStateRecord | null>;
	getConnection(userId: string): Promise<CloudinaryConnectionRecord | null>;
	upsertConnection(input: UpsertCloudinaryConnectionInput): Promise<CloudinaryConnectionRecord>;
	updateCloudName(userId: string, cloudName: string): Promise<void>;
	acquireRefreshLock(userId: string, leaseMs: number): Promise<CloudinaryConnectionRecord | null>;
	updateTokensCas(input: {
		userId: string;
		expectedTokenVersion: number;
		accessTokenEnc: string;
		refreshTokenEnc: string | null;
		accessExpiresAt: Date;
		cloudName?: string;
	}): Promise<CloudinaryConnectionRecord | null>;
	markConnectionRevoked(userId: string, errorMessage: string): Promise<void>;
	deleteConnection(userId: string): Promise<boolean>;
	upsertMedia(input: UpsertCloudinaryMediaInput): Promise<CloudinaryMediaRecord>;
	listMedia(userId: string, limit?: number): Promise<CloudinaryMediaRecord[]>;
	deleteMedia(userId: string, mediaId: string): Promise<CloudinaryMediaRecord | null>;
	upsertCloudProject(input: UpsertCloudProjectInput): Promise<CloudProjectRecord>;
	listCloudProjects(userId: string): Promise<CloudProjectRecord[]>;
	getCloudProject(userId: string, projectId: string): Promise<CloudProjectRecord | null>;
	deleteCloudProject(userId: string, projectId: string): Promise<boolean>;
	renameCloudProject(userId: string, projectId: string, newName: string): Promise<boolean>;
	saveFeedback(input: SaveUserFeedbackInput): Promise<UserFeedbackRecord>;
	listFeedback(limit?: number): Promise<UserFeedbackRecord[]>;
}

export interface SqlExecutor {
	query(queryText: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

function toDate(value: unknown): Date {
	if (value instanceof Date) return value;
	if (typeof value === "string" || typeof value === "number") return new Date(value);
	return new Date(0);
}

function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	return [];
}

function mapConnectionRow(row: Record<string, unknown>): CloudinaryConnectionRecord {
	return {
		id: String(row.id),
		userId: String(row.user_id),
		cloudName: String(row.cloud_name),
		accountLabel: typeof row.account_label === "string" ? row.account_label : null,
		subject: typeof row.subject === "string" ? row.subject : null,
		issuerOrigin: typeof row.issuer_origin === "string" ? row.issuer_origin : null,
		scopes: toStringArray(row.scopes),
		accessTokenEnc: String(row.access_token_enc),
		refreshTokenEnc: typeof row.refresh_token_enc === "string" ? row.refresh_token_enc : null,
		accessExpiresAt: toDate(row.access_expires_at),
		tokenVersion: Number(row.token_version ?? 1),
		refreshLockUntil: row.refresh_lock_until ? toDate(row.refresh_lock_until) : null,
		status: row.status === "revoked" ? "revoked" : "active",
		lastError: typeof row.last_error === "string" ? row.last_error : null,
		connectedAt: toDate(row.connected_at),
		updatedAt: toDate(row.updated_at),
	};
}

function mapMediaRow(row: Record<string, unknown>): CloudinaryMediaRecord {
	return {
		id: String(row.id),
		userId: String(row.user_id),
		connectionId: typeof row.connection_id === "string" ? row.connection_id : null,
		cloudName: String(row.cloud_name),
		publicId: String(row.public_id),
		resourceType: row.resource_type === "image" ? "image" : "video",
		format: typeof row.format === "string" ? row.format : null,
		bytes: row.bytes !== null && row.bytes !== undefined ? Number(row.bytes) : null,
		width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
		height: row.height !== null && row.height !== undefined ? Number(row.height) : null,
		duration: row.duration !== null && row.duration !== undefined ? Number(row.duration) : null,
		secureUrl: String(row.secure_url),
		originalFilename: typeof row.original_filename === "string" ? row.original_filename : null,
		title: typeof row.title === "string" ? row.title : null,
		createdAt: toDate(row.created_at).toISOString(),
	};
}

function mapCloudProjectRow(row: Record<string, unknown>): CloudProjectRecord {
	return {
		id: String(row.id),
		userId: String(row.user_id),
		projectId: String(row.project_id),
		name: String(row.name),
		videoUrl: String(row.video_url),
		videoPublicId: row.video_public_id ? String(row.video_public_id) : null,
		thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
		projectData:
			typeof row.project_data === "object" && row.project_data !== null
				? (row.project_data as Record<string, unknown>)
				: JSON.parse(String(row.project_data || "{}")),
		createdAt: toDate(row.created_at).toISOString(),
		updatedAt: toDate(row.updated_at).toISOString(),
	};
}

function mapUserFeedbackRow(row: Record<string, unknown>): UserFeedbackRecord {
	let diagnostics: Record<string, unknown> | null = null;
	if (typeof row.diagnostics === "object" && row.diagnostics !== null) {
		diagnostics = row.diagnostics as Record<string, unknown>;
	} else if (typeof row.diagnostics === "string" && row.diagnostics.trim()) {
		try {
			diagnostics = JSON.parse(row.diagnostics);
		} catch {
			diagnostics = { raw: row.diagnostics };
		}
	}
	return {
		id: String(row.id),
		userId: row.user_id ? String(row.user_id) : null,
		userEmail: row.user_email ? String(row.user_email) : null,
		userName: row.user_name ? String(row.user_name) : null,
		subject: String(row.subject),
		message: String(row.message),
		category: String(row.category || "general"),
		diagnostics,
		status: String(row.status || "new"),
		createdAt: toDate(row.created_at).toISOString(),
	};
}

export class NeonCloudinaryStore implements CloudinaryStore {
	private readonly sql: SqlExecutor;

	constructor(sql: SqlExecutor) {
		this.sql = sql;
	}

	async getOAuthClient(clientKey: string): Promise<CloudinaryOAuthClientRecord | null> {
		const rows = await this.sql.query(
			`SELECT client_key, issuer_origin, client_id, client_secret_enc, redirect_uris, scopes
			 FROM cloudinary_oauth_clients
			 WHERE client_key = $1`,
			[clientKey],
		);
		const row = rows[0];
		if (!row) return null;
		return {
			clientKey: String(row.client_key),
			issuerOrigin: String(row.issuer_origin),
			clientId: String(row.client_id),
			clientSecretEnc:
				typeof row.client_secret_enc === "string" ? row.client_secret_enc : null,
			redirectUris: toStringArray(row.redirect_uris),
			scopes: toStringArray(row.scopes),
		};
	}

	async saveOAuthClient(record: CloudinaryOAuthClientRecord): Promise<void> {
		await this.sql.query(
			`INSERT INTO cloudinary_oauth_clients (
				client_key, issuer_origin, client_id, client_secret_enc, redirect_uris, scopes, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, now())
			ON CONFLICT (client_key) DO UPDATE SET
				issuer_origin = EXCLUDED.issuer_origin,
				client_id = EXCLUDED.client_id,
				client_secret_enc = EXCLUDED.client_secret_enc,
				redirect_uris = EXCLUDED.redirect_uris,
				scopes = EXCLUDED.scopes,
				updated_at = now()`,
			[
				record.clientKey,
				record.issuerOrigin,
				record.clientId,
				record.clientSecretEnc,
				record.redirectUris,
				record.scopes,
			],
		);
	}

	async createOAuthState(record: CloudinaryOAuthStateRecord): Promise<void> {
		await this.sql.query(`DELETE FROM cloudinary_oauth_states WHERE expires_at <= now()`);
		await this.sql.query(
			`INSERT INTO cloudinary_oauth_states (
				state_hash, user_id, code_verifier_enc, return_target, redirect_uri, issuer_origin, expires_at
			) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)`,
			[
				record.stateHash,
				record.userId,
				record.codeVerifierEnc,
				record.returnTarget,
				record.redirectUri,
				record.issuerOrigin,
				record.expiresAt.toISOString(),
			],
		);
	}

	async consumeOAuthState(stateHash: string): Promise<CloudinaryOAuthStateRecord | null> {
		const rows = await this.sql.query(
			`DELETE FROM cloudinary_oauth_states
			 WHERE state_hash = $1 AND expires_at > now()
			 RETURNING state_hash, user_id, code_verifier_enc, return_target, redirect_uri, issuer_origin, expires_at`,
			[stateHash],
		);
		const row = rows[0];
		if (!row) return null;
		return {
			stateHash: String(row.state_hash),
			userId: String(row.user_id),
			codeVerifierEnc: String(row.code_verifier_enc),
			returnTarget: row.return_target === "dev" ? "dev" : "app",
			redirectUri: typeof row.redirect_uri === "string" ? row.redirect_uri : "",
			issuerOrigin: typeof row.issuer_origin === "string" ? row.issuer_origin : "",
			expiresAt: toDate(row.expires_at),
		};
	}

	async getConnection(userId: string): Promise<CloudinaryConnectionRecord | null> {
		const rows = await this.sql.query(
			`SELECT * FROM cloudinary_connections WHERE user_id = $1::uuid`,
			[userId],
		);
		const row = rows[0];
		return row ? mapConnectionRow(row) : null;
	}

	async upsertConnection(
		input: UpsertCloudinaryConnectionInput,
	): Promise<CloudinaryConnectionRecord> {
		const rows = await this.sql.query(
			`INSERT INTO cloudinary_connections (
				user_id, cloud_name, account_label, subject, issuer_origin, scopes,
				access_token_enc, refresh_token_enc, access_expires_at,
				token_version, refresh_lock_until, status, last_error, connected_at, updated_at
			) VALUES (
				$1::uuid, $2, $3, $4, $5, $6,
				$7, $8, $9,
				1, NULL, 'active', NULL, now(), now()
			)
			ON CONFLICT (user_id) DO UPDATE SET
				cloud_name = EXCLUDED.cloud_name,
				account_label = EXCLUDED.account_label,
				subject = EXCLUDED.subject,
				issuer_origin = EXCLUDED.issuer_origin,
				scopes = EXCLUDED.scopes,
				access_token_enc = EXCLUDED.access_token_enc,
				refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, cloudinary_connections.refresh_token_enc),
				access_expires_at = EXCLUDED.access_expires_at,
				token_version = cloudinary_connections.token_version + 1,
				refresh_lock_until = NULL,
				status = 'active',
				last_error = NULL,
				connected_at = now(),
				updated_at = now()
			RETURNING *`,
			[
				input.userId,
				input.cloudName,
				input.accountLabel,
				input.subject,
				input.issuerOrigin,
				input.scopes,
				input.accessTokenEnc,
				input.refreshTokenEnc,
				input.accessExpiresAt.toISOString(),
			],
		);
		return mapConnectionRow(rows[0]);
	}

	async updateCloudName(userId: string, cloudName: string): Promise<void> {
		await this.sql.query(
			`UPDATE cloudinary_connections
			 SET cloud_name = $2, updated_at = now()
			 WHERE user_id = $1::uuid`,
			[userId, cloudName],
		);
	}

	async acquireRefreshLock(
		userId: string,
		leaseMs: number,
	): Promise<CloudinaryConnectionRecord | null> {
		const lockUntil = new Date(Date.now() + leaseMs).toISOString();
		const rows = await this.sql.query(
			`UPDATE cloudinary_connections
			 SET refresh_lock_until = $2, updated_at = now()
			 WHERE user_id = $1::uuid
			   AND (refresh_lock_until IS NULL OR refresh_lock_until < now())
			 RETURNING *`,
			[userId, lockUntil],
		);
		const row = rows[0];
		return row ? mapConnectionRow(row) : null;
	}

	async updateTokensCas(input: {
		userId: string;
		expectedTokenVersion: number;
		accessTokenEnc: string;
		refreshTokenEnc: string | null;
		accessExpiresAt: Date;
		cloudName?: string;
	}): Promise<CloudinaryConnectionRecord | null> {
		const rows = await this.sql.query(
			`UPDATE cloudinary_connections
			 SET access_token_enc = $3,
			     refresh_token_enc = COALESCE($4, refresh_token_enc),
			     access_expires_at = $5,
			     cloud_name = COALESCE($6, cloud_name),
			     token_version = token_version + 1,
			     refresh_lock_until = NULL,
			     status = 'active',
			     last_error = NULL,
			     updated_at = now()
			 WHERE user_id = $1::uuid AND token_version = $2
			 RETURNING *`,
			[
				input.userId,
				input.expectedTokenVersion,
				input.accessTokenEnc,
				input.refreshTokenEnc,
				input.accessExpiresAt.toISOString(),
				input.cloudName ?? null,
			],
		);
		const row = rows[0];
		return row ? mapConnectionRow(row) : null;
	}

	async markConnectionRevoked(userId: string, errorMessage: string): Promise<void> {
		await this.sql.query(
			`UPDATE cloudinary_connections
			 SET status = 'revoked',
			     last_error = $2,
			     refresh_lock_until = NULL,
			     updated_at = now()
			 WHERE user_id = $1::uuid`,
			[userId, errorMessage.slice(0, 500)],
		);
	}

	async deleteConnection(userId: string): Promise<boolean> {
		const rows = await this.sql.query(
			`DELETE FROM cloudinary_connections WHERE user_id = $1::uuid RETURNING id`,
			[userId],
		);
		return rows.length > 0;
	}

	async upsertMedia(input: UpsertCloudinaryMediaInput): Promise<CloudinaryMediaRecord> {
		const rows = await this.sql.query(
			`INSERT INTO cloudinary_media (
				user_id, connection_id, cloud_name, public_id, resource_type,
				format, bytes, width, height, duration, secure_url, original_filename, title
			) VALUES (
				$1::uuid, $2::uuid, $3, $4, $5,
				$6, $7, $8, $9, $10, $11, $12, $13
			)
			ON CONFLICT (user_id, cloud_name, resource_type, public_id) DO UPDATE SET
				connection_id = EXCLUDED.connection_id,
				format = EXCLUDED.format,
				bytes = EXCLUDED.bytes,
				width = EXCLUDED.width,
				height = EXCLUDED.height,
				duration = EXCLUDED.duration,
				secure_url = EXCLUDED.secure_url,
				original_filename = COALESCE(EXCLUDED.original_filename, cloudinary_media.original_filename),
				title = COALESCE(EXCLUDED.title, cloudinary_media.title)
			RETURNING *`,
			[
				input.userId,
				input.connectionId,
				input.cloudName,
				input.publicId,
				input.resourceType,
				input.format ?? null,
				input.bytes ?? null,
				input.width ?? null,
				input.height ?? null,
				input.duration ?? null,
				input.secureUrl,
				input.originalFilename ?? null,
				input.title ?? null,
			],
		);
		return mapMediaRow(rows[0]);
	}

	async listMedia(userId: string, limit = 50): Promise<CloudinaryMediaRecord[]> {
		const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
		const rows = await this.sql.query(
			`SELECT * FROM cloudinary_media
			 WHERE user_id = $1::uuid
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[userId, boundedLimit],
		);
		return rows.map(mapMediaRow);
	}

	async deleteMedia(userId: string, mediaId: string): Promise<CloudinaryMediaRecord | null> {
		const rows = await this.sql.query(
			`DELETE FROM cloudinary_media
			 WHERE id = $1::uuid AND user_id = $2::uuid
			 RETURNING *`,
			[mediaId, userId],
		);
		const row = rows[0];
		return row ? mapMediaRow(row) : null;
	}

	async upsertCloudProject(input: UpsertCloudProjectInput): Promise<CloudProjectRecord> {
		const rows = await this.sql.query(
			`
			INSERT INTO cloudinary_cloud_projects (
				user_id, project_id, name, video_url, video_public_id, thumbnail_url, project_data, updated_at
			) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, now())
			ON CONFLICT (user_id, project_id) DO UPDATE SET
				name = EXCLUDED.name,
				video_url = EXCLUDED.video_url,
				video_public_id = COALESCE(EXCLUDED.video_public_id, cloudinary_cloud_projects.video_public_id),
				thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, cloudinary_cloud_projects.thumbnail_url),
				project_data = EXCLUDED.project_data,
				updated_at = now()
			RETURNING id, user_id, project_id, name, video_url, video_public_id, thumbnail_url, project_data, created_at, updated_at
			`,
			[
				input.userId,
				input.projectId,
				input.name,
				input.videoUrl,
				input.videoPublicId ?? null,
				input.thumbnailUrl ?? null,
				JSON.stringify(input.projectData),
			],
		);
		return mapCloudProjectRow(rows[0]);
	}

	async listCloudProjects(userId: string): Promise<CloudProjectRecord[]> {
		const rows = await this.sql.query(
			`
			SELECT id, user_id, project_id, name, video_url, video_public_id, thumbnail_url, project_data, created_at, updated_at
			FROM cloudinary_cloud_projects
			WHERE user_id = $1::uuid
			ORDER BY updated_at DESC
			`,
			[userId],
		);
		return rows.map(mapCloudProjectRow);
	}

	async getCloudProject(userId: string, projectId: string): Promise<CloudProjectRecord | null> {
		const rows = await this.sql.query(
			`
			SELECT id, user_id, project_id, name, video_url, video_public_id, thumbnail_url, project_data, created_at, updated_at
			FROM cloudinary_cloud_projects
			WHERE user_id = $1::uuid AND project_id = $2
			LIMIT 1
			`,
			[userId, projectId],
		);
		return rows[0] ? mapCloudProjectRow(rows[0]) : null;
	}

	async deleteCloudProject(userId: string, projectId: string): Promise<boolean> {
		const rows = await this.sql.query(
			`DELETE FROM cloudinary_cloud_projects WHERE user_id = $1::uuid AND project_id = $2 RETURNING id`,
			[userId, projectId],
		);
		return rows.length > 0;
	}

	async renameCloudProject(userId: string, projectId: string, newName: string): Promise<boolean> {
		const rows = await this.sql.query(
			`UPDATE cloudinary_cloud_projects
			 SET name = $3, updated_at = NOW()
			 WHERE user_id = $1::uuid AND project_id = $2
			 RETURNING id`,
			[userId, projectId, newName],
		);
		return rows.length > 0;
	}

	async saveFeedback(input: SaveUserFeedbackInput): Promise<UserFeedbackRecord> {
		const diagnosticsJson = input.diagnostics
			? typeof input.diagnostics === "string"
				? input.diagnostics
				: JSON.stringify(input.diagnostics)
			: null;
		const rows = await this.sql.query(
			`
			INSERT INTO user_feedback (
				user_id, user_email, user_name, subject, message, category, diagnostics, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
			RETURNING id, user_id, user_email, user_name, subject, message, category, diagnostics, status, created_at
			`,
			[
				input.userId || null,
				input.userEmail || null,
				input.userName || null,
				input.subject.trim(),
				input.message.trim(),
				input.category || "general",
				diagnosticsJson,
			],
		);
		return mapUserFeedbackRow(rows[0]);
	}

	async listFeedback(limit = 50): Promise<UserFeedbackRecord[]> {
		const rows = await this.sql.query(
			`
			SELECT id, user_id, user_email, user_name, subject, message, category, diagnostics, status, created_at
			FROM user_feedback
			ORDER BY created_at DESC
			LIMIT $1
			`,
			[limit],
		);
		return rows.map(mapUserFeedbackRow);
	}
}

export class InMemoryCloudinaryStore implements CloudinaryStore {
	private readonly clients = new Map<string, CloudinaryOAuthClientRecord>();
	private readonly states = new Map<string, CloudinaryOAuthStateRecord>();
	private readonly connections = new Map<string, CloudinaryConnectionRecord>();
	private readonly media = new Map<string, CloudinaryMediaRecord>();
	private readonly cloudProjects = new Map<string, CloudProjectRecord>();
	private readonly feedback = new Map<string, UserFeedbackRecord>();

	async getOAuthClient(clientKey: string): Promise<CloudinaryOAuthClientRecord | null> {
		return this.clients.get(clientKey) ?? null;
	}

	async saveOAuthClient(record: CloudinaryOAuthClientRecord): Promise<void> {
		this.clients.set(record.clientKey, { ...record });
	}

	async createOAuthState(record: CloudinaryOAuthStateRecord): Promise<void> {
		const now = Date.now();
		for (const [key, existing] of this.states.entries()) {
			if (existing.expiresAt.getTime() <= now) {
				this.states.delete(key);
			}
		}
		this.states.set(record.stateHash, { ...record });
	}

	async consumeOAuthState(stateHash: string): Promise<CloudinaryOAuthStateRecord | null> {
		const existing = this.states.get(stateHash);
		this.states.delete(stateHash);
		if (!existing || existing.expiresAt.getTime() <= Date.now()) {
			return null;
		}
		return existing;
	}

	async getConnection(userId: string): Promise<CloudinaryConnectionRecord | null> {
		const existing = this.connections.get(userId);
		return existing ? { ...existing } : null;
	}

	async upsertConnection(
		input: UpsertCloudinaryConnectionInput,
	): Promise<CloudinaryConnectionRecord> {
		const existing = this.connections.get(input.userId);
		const now = new Date();
		const next: CloudinaryConnectionRecord = {
			id: existing?.id ?? crypto.randomUUID(),
			userId: input.userId,
			cloudName: input.cloudName,
			accountLabel: input.accountLabel,
			subject: input.subject,
			issuerOrigin: input.issuerOrigin,
			scopes: [...input.scopes],
			accessTokenEnc: input.accessTokenEnc,
			refreshTokenEnc: input.refreshTokenEnc ?? existing?.refreshTokenEnc ?? null,
			accessExpiresAt: input.accessExpiresAt,
			tokenVersion: (existing?.tokenVersion ?? 0) + 1,
			refreshLockUntil: null,
			status: "active",
			lastError: null,
			connectedAt: now,
			updatedAt: now,
		};
		this.connections.set(input.userId, next);
		return { ...next };
	}

	async updateCloudName(userId: string, cloudName: string): Promise<void> {
		const existing = this.connections.get(userId);
		if (existing) {
			existing.cloudName = cloudName;
			existing.updatedAt = new Date();
		}
	}

	async acquireRefreshLock(
		userId: string,
		leaseMs: number,
	): Promise<CloudinaryConnectionRecord | null> {
		const existing = this.connections.get(userId);
		if (!existing) return null;
		const now = Date.now();
		if (existing.refreshLockUntil && existing.refreshLockUntil.getTime() > now) {
			return null;
		}
		existing.refreshLockUntil = new Date(now + leaseMs);
		existing.updatedAt = new Date(now);
		return { ...existing };
	}

	async updateTokensCas(input: {
		userId: string;
		expectedTokenVersion: number;
		accessTokenEnc: string;
		refreshTokenEnc: string | null;
		accessExpiresAt: Date;
		cloudName?: string;
	}): Promise<CloudinaryConnectionRecord | null> {
		const existing = this.connections.get(input.userId);
		if (!existing || existing.tokenVersion !== input.expectedTokenVersion) {
			return null;
		}
		existing.accessTokenEnc = input.accessTokenEnc;
		if (input.refreshTokenEnc) {
			existing.refreshTokenEnc = input.refreshTokenEnc;
		}
		existing.accessExpiresAt = input.accessExpiresAt;
		if (input.cloudName) {
			existing.cloudName = input.cloudName;
		}
		existing.tokenVersion += 1;
		existing.refreshLockUntil = null;
		existing.status = "active";
		existing.lastError = null;
		existing.updatedAt = new Date();
		return { ...existing };
	}

	async markConnectionRevoked(userId: string, errorMessage: string): Promise<void> {
		const existing = this.connections.get(userId);
		if (existing) {
			existing.status = "revoked";
			existing.lastError = errorMessage;
			existing.refreshLockUntil = null;
			existing.updatedAt = new Date();
		}
	}

	async deleteConnection(userId: string): Promise<boolean> {
		return this.connections.delete(userId);
	}

	async upsertMedia(input: UpsertCloudinaryMediaInput): Promise<CloudinaryMediaRecord> {
		for (const existing of this.media.values()) {
			if (
				existing.userId === input.userId &&
				existing.cloudName === input.cloudName &&
				existing.resourceType === input.resourceType &&
				existing.publicId === input.publicId
			) {
				existing.connectionId = input.connectionId;
				existing.format = input.format ?? null;
				existing.bytes = input.bytes ?? null;
				existing.width = input.width ?? null;
				existing.height = input.height ?? null;
				existing.duration = input.duration ?? null;
				existing.secureUrl = input.secureUrl;
				existing.originalFilename = input.originalFilename ?? existing.originalFilename;
				existing.title = input.title ?? existing.title;
				return { ...existing };
			}
		}
		const record: CloudinaryMediaRecord = {
			id: crypto.randomUUID(),
			userId: input.userId,
			connectionId: input.connectionId,
			cloudName: input.cloudName,
			publicId: input.publicId,
			resourceType: input.resourceType,
			format: input.format ?? null,
			bytes: input.bytes ?? null,
			width: input.width ?? null,
			height: input.height ?? null,
			duration: input.duration ?? null,
			secureUrl: input.secureUrl,
			originalFilename: input.originalFilename ?? null,
			title: input.title ?? null,
			createdAt: new Date().toISOString(),
		};
		this.media.set(record.id, record);
		return { ...record };
	}

	async listMedia(userId: string, limit = 50): Promise<CloudinaryMediaRecord[]> {
		return Array.from(this.media.values())
			.filter((item) => item.userId === userId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, limit);
	}

	async deleteMedia(userId: string, mediaId: string): Promise<CloudinaryMediaRecord | null> {
		const existing = this.media.get(mediaId);
		if (!existing || existing.userId !== userId) return null;
		this.media.delete(mediaId);
		return { ...existing };
	}

	async upsertCloudProject(input: UpsertCloudProjectInput): Promise<CloudProjectRecord> {
		const existingKey = `${input.userId}:${input.projectId}`;
		const existing = this.cloudProjects.get(existingKey);
		const record: CloudProjectRecord = {
			id: existing?.id ?? crypto.randomUUID(),
			userId: input.userId,
			projectId: input.projectId,
			name: input.name,
			videoUrl: input.videoUrl,
			videoPublicId: input.videoPublicId ?? existing?.videoPublicId ?? null,
			thumbnailUrl: input.thumbnailUrl ?? existing?.thumbnailUrl ?? null,
			projectData: input.projectData,
			createdAt: existing?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.cloudProjects.set(existingKey, record);
		return { ...record };
	}

	async listCloudProjects(userId: string): Promise<CloudProjectRecord[]> {
		return Array.from(this.cloudProjects.values())
			.filter((p) => p.userId === userId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async getCloudProject(userId: string, projectId: string): Promise<CloudProjectRecord | null> {
		const existing = this.cloudProjects.get(`${userId}:${projectId}`);
		return existing ? { ...existing } : null;
	}

	async deleteCloudProject(userId: string, projectId: string): Promise<boolean> {
		return this.cloudProjects.delete(`${userId}:${projectId}`);
	}

	async renameCloudProject(userId: string, projectId: string, newName: string): Promise<boolean> {
		const existingKey = `${userId}:${projectId}`;
		const existing = this.cloudProjects.get(existingKey);
		if (!existing) return false;
		existing.name = newName;
		existing.updatedAt = new Date().toISOString();
		return true;
	}

	async saveFeedback(input: SaveUserFeedbackInput): Promise<UserFeedbackRecord> {
		const record: UserFeedbackRecord = {
			id: crypto.randomUUID(),
			userId: input.userId ?? null,
			userEmail: input.userEmail ?? null,
			userName: input.userName ?? null,
			subject: input.subject.trim(),
			message: input.message.trim(),
			category: input.category ?? "general",
			diagnostics:
				typeof input.diagnostics === "string"
					? JSON.parse(input.diagnostics)
					: (input.diagnostics ?? null),
			status: "new",
			createdAt: new Date().toISOString(),
		};
		this.feedback.set(record.id, record);
		return { ...record };
	}

	async listFeedback(limit = 50): Promise<UserFeedbackRecord[]> {
		return Array.from(this.feedback.values())
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, limit);
	}
}
