import { neon } from "npm:@neondatabase/serverless@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createCloudinaryEdgeHandler } from "./handler.ts";
import { CloudinaryOAuthService } from "./oauth.ts";
import { NeonCloudinaryStore } from "./store.ts";

const supabase = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	{
		auth: { persistSession: false, autoRefreshToken: false },
	},
);

const databaseUrl =
	Deno.env.get("CLOUDINARY_DATABASE_URL") || Deno.env.get("NEON_DATABASE_URL") || "";
const sql = neon(databaseUrl);
const store = new NeonCloudinaryStore({
	query: (text, params) => sql.query(text, params) as Promise<Array<Record<string, unknown>>>,
});

const defaultRedirectUri =
	Deno.env.get("CLOUDINARY_REDIRECT_URI")?.trim() ||
	"http://127.0.0.1:43821/cloudinary/callback";

const oauth = new CloudinaryOAuthService(store, {
	tokenEncryptionKey: Deno.env.get("CLOUDINARY_TOKEN_KEY") ?? "",
	clientId: Deno.env.get("CLOUDINARY_CLIENT_ID") ?? undefined,
	clientSecret: Deno.env.get("CLOUDINARY_CLIENT_SECRET") ?? undefined,
	issuerOrigin: Deno.env.get("CLOUDINARY_OAUTH_ISSUER") ?? undefined,
	defaultRedirectUri,
	allowedRedirectUris: [
		defaultRedirectUri,
		"http://127.0.0.1:43821/cloudinary/callback",
		"anyrecord://cloudinary/callback",
		"anyrecord-dev://cloudinary/callback",
	],
});

Deno.serve(
	createCloudinaryEdgeHandler({
		async authenticate(token) {
			const { data, error } = await supabase.auth.getUser(token);
			return error ? null : (data.user?.id ?? null);
		},
		store,
		oauth,
	}),
);

