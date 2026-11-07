-- Cloudinary OAuth connections and uploaded media metadata.
--
-- Only the backend service (Supabase Edge Function / Electron Main Process)
-- connects to this database. It derives the AnyRecord user id from a verified
-- session and scopes every query by that id; frontend code never receives
-- database credentials or raw tokens.

create table if not exists cloudinary_oauth_clients (
	-- Keyed by OAuth authorization server origin + redirect URI set hash.
	client_key text primary key,
	issuer_origin text not null,
	client_id text not null,
	client_secret_enc text,
	redirect_uris text[] not null default '{}',
	scopes text[] not null default '{}',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists cloudinary_oauth_states (
	-- SHA-256 of the random `state` value. The raw state only exists in the
	-- authorization URL, so a database leak cannot be replayed against the callback.
	state_hash text primary key,
	user_id uuid not null,
	-- PKCE verifier, AES-256-GCM encrypted and bound to user_id.
	code_verifier_enc text not null,
	return_target text not null check (return_target in ('app', 'dev')),
	redirect_uri text,
	issuer_origin text,
	expires_at timestamptz not null,
	created_at timestamptz not null default now()
);

alter table cloudinary_oauth_states
	add column if not exists redirect_uri text,
	add column if not exists issuer_origin text;

create index if not exists cloudinary_oauth_states_expires_idx
	on cloudinary_oauth_states (expires_at);
create index if not exists cloudinary_oauth_states_user_idx
	on cloudinary_oauth_states (user_id);

create table if not exists cloudinary_connections (
	id uuid primary key default gen_random_uuid(),
	-- One Cloudinary product environment per AnyRecord user.
	user_id uuid not null unique,
	cloud_name text not null,
	account_label text,
	subject text,
	issuer_origin text,
	scopes text[] not null default '{}',
	-- Tokens are AES-256-GCM encrypted with additional data bound to user_id.
	access_token_enc text not null,
	refresh_token_enc text,
	access_expires_at timestamptz not null,
	-- Incremented on every token write. Used for optimistic concurrency.
	token_version integer not null default 1,
	-- Short lease so only one request refreshes a single-use refresh token.
	refresh_lock_until timestamptz,
	status text not null default 'active' check (status in ('active', 'revoked')),
	last_error text,
	connected_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table cloudinary_connections
	add column if not exists issuer_origin text;

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
);

create index if not exists cloudinary_media_user_created_idx
	on cloudinary_media (user_id, created_at desc);
