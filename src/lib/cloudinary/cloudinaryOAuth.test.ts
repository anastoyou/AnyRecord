import { describe, expect, it } from "vitest";
import { detectMediaResourceType } from "../../../electron/ipc/register/cloudinary";
import {
	computeCodeChallengeS256,
	decryptSecret,
	encryptSecret,
	randomToken,
	sha256Hex,
} from "../../../services/supabase/functions/cloudinary/crypto";
import { createCloudinaryEdgeHandler } from "../../../services/supabase/functions/cloudinary/handler";
import { CloudinaryOAuthService } from "../../../services/supabase/functions/cloudinary/oauth";
import { InMemoryCloudinaryStore } from "../../../services/supabase/functions/cloudinary/store";

const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DEFAULT_REDIRECT = "http://127.0.0.1:43821/cloudinary/callback";

function buildFakeJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.signature`;
}

describe("Cloudinary OAuth 2.0 & Multi-User Integration", () => {
	it("encrypts tokens with AES-256-GCM bound to user_id and rejects cross-user decryption", async () => {
		const secretToken = "cl_refresh_token_secret_12345";
		const cipher = await encryptSecret(secretToken, TEST_MASTER_KEY, "user-alice");
		expect(cipher).not.toContain(secretToken);

		const decrypted = await decryptSecret(cipher, TEST_MASTER_KEY, "user-alice");
		expect(decrypted).toBe(secretToken);

		await expect(decryptSecret(cipher, TEST_MASTER_KEY, "user-bob")).rejects.toThrow();
	});

	it("generates RFC 7636 PKCE S256 verifier and challenge", async () => {
		const verifier = randomToken(32);
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		const challenge = await computeCodeChallengeS256(verifier);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		const hashHex = await sha256Hex("test-state");
		expect(hashHex).toHaveLength(64);
	});

	it("completes OAuth 2.0 flow, enforces single-use state, and discovers user cloud_name", async () => {
		const store = new InMemoryCloudinaryStore();
		const jwtToken = buildFakeJwt({
			sub: "cld-user-1",
			email: "alice@example.com",
			name: "Alice",
			cloud_name: "alice-personal-cloud",
		});

		const mockFetch: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/register")) {
				return new Response(
					JSON.stringify({
						client_id: "dyn_client_1",
						client_secret: "dyn_secret_1",
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.endsWith("/token")) {
				return new Response(
					JSON.stringify({
						access_token: jwtToken,
						refresh_token: "refresh_v1",
						token_type: "Bearer",
						expires_in: 300,
						scope: "openid profile email offline_access upload asset_management",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.endsWith("/userinfo")) {
				return new Response(
					JSON.stringify({
						sub: "cld-user-1",
						email: "alice@example.com",
						name: "Alice",
						cloud_name: "alice-personal-cloud",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("Not found", { status: 404 });
		};

		const service = new CloudinaryOAuthService(store, {
			tokenEncryptionKey: TEST_MASTER_KEY,
			defaultRedirectUri: DEFAULT_REDIRECT,
			allowedRedirectUris: [DEFAULT_REDIRECT],
			fetchImpl: mockFetch,
		});

		const started = await service.startOAuth({
			userId: "user-alice",
			redirectUri: DEFAULT_REDIRECT,
		});
		expect(started.authorizeUrl).toContain("/authorize");
		expect(started.state).toBeTruthy();

		// Complete callback
		const completed = await service.completeOAuthCallback({
			state: started.state,
			code: "auth_code_123",
		});

		expect(completed.userId).toBe("user-alice");
		expect(completed.status.state).toBe("connected");
		expect(completed.status.cloudName).toBe("alice-personal-cloud");
		expect(completed.status.accountLabel).toContain("alice@example.com");

		// Replaying the same state must fail
		await expect(
			service.completeOAuthCallback({
				state: started.state,
				code: "auth_code_123",
			}),
		).rejects.toThrow(/expired|invalid|already/i);
	});

	it("automatically refreshes expired access tokens and rotates single-use refresh tokens", async () => {
		const store = new InMemoryCloudinaryStore();
		let refreshCalls = 0;

		const initialJwt = buildFakeJwt({
			sub: "cld-user-1",
			email: "alice@example.com",
			cloud_name: "alice-cloud",
		});
		const refreshedJwt = buildFakeJwt({
			sub: "cld-user-1",
			email: "alice@example.com",
			cloud_name: "alice-cloud",
		});

		const mockFetch: typeof fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/oauth2/token")) {
				const body = String(init?.body ?? "");
				if (body.includes("grant_type=authorization_code")) {
					return new Response(
						JSON.stringify({
							access_token: initialJwt,
							refresh_token: "refresh_token_1",
							expires_in: 1, // expires immediately within 60s safety window
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (body.includes("grant_type=refresh_token")) {
					refreshCalls += 1;
					expect(body).toContain("refresh_token=refresh_token_1");
					return new Response(
						JSON.stringify({
							access_token: refreshedJwt,
							refresh_token: "refresh_token_2",
							expires_in: 300,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
			}
			return new Response("Not found", { status: 404 });
		};

		const service = new CloudinaryOAuthService(store, {
			tokenEncryptionKey: TEST_MASTER_KEY,
			clientId: "custom_client_id",
			clientSecret: "custom_client_secret",
			defaultRedirectUri: DEFAULT_REDIRECT,
			allowedRedirectUris: [DEFAULT_REDIRECT],
			fetchImpl: mockFetch,
		});

		const started = await service.startOAuth({
			userId: "user-alice",
			redirectUri: DEFAULT_REDIRECT,
		});
		await service.completeOAuthCallback({
			state: started.state,
			code: "code_abc",
		});

		// Request valid access token -> triggers refresh because expires_in=1 is inside the 60s buffer
		const credentials = await service.getValidAccessToken("user-alice");
		expect(refreshCalls).toBe(1);
		expect(credentials.accessToken).toBe(refreshedJwt);
		expect(credentials.connection.cloudName).toBe("alice-cloud");

		const conn = await store.getConnection("user-alice");
		expect(conn?.tokenVersion).toBe(2);
	});

	it("marks connection as revoked when refresh token returns invalid_grant", async () => {
		const store = new InMemoryCloudinaryStore();
		const initialJwt = buildFakeJwt({
			sub: "cld-user-1",
			cloud_name: "alice-cloud",
		});

		const mockFetch: typeof fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/oauth2/token")) {
				const body = String(init?.body ?? "");
				if (body.includes("grant_type=authorization_code")) {
					return new Response(
						JSON.stringify({
							access_token: initialJwt,
							refresh_token: "revoked_refresh_token",
							expires_in: 1,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: "Refresh token has been revoked",
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("Not found", { status: 404 });
		};

		const service = new CloudinaryOAuthService(store, {
			tokenEncryptionKey: TEST_MASTER_KEY,
			clientId: "custom_client_id",
			defaultRedirectUri: DEFAULT_REDIRECT,
			allowedRedirectUris: [DEFAULT_REDIRECT],
			fetchImpl: mockFetch,
		});

		const started = await service.startOAuth({
			userId: "user-alice",
			redirectUri: DEFAULT_REDIRECT,
		});
		await service.completeOAuthCallback({
			state: started.state,
			code: "code_abc",
		});

		await expect(service.getValidAccessToken("user-alice")).rejects.toThrow(/revoked|expired/i);

		const status = await service.getPublicStatus("user-alice");
		expect(status.state).toBe("revoked");
	});

	it("strictly isolates connections and media records between multiple users", async () => {
		const store = new InMemoryCloudinaryStore();

		await store.upsertMedia({
			userId: "user-alice",
			connectionId: null,
			cloudName: "alice-cloud",
			publicId: "AnyRecord/alice-video-1",
			resourceType: "video",
			secureUrl: "https://res.cloudinary.com/alice-cloud/video/upload/v1/alice-video-1.mp4",
			format: "mp4",
			bytes: 2048000,
			width: 1920,
			height: 1080,
			duration: 12.5,
			originalFilename: "alice-demo.mp4",
			title: "Alice Demo",
		});

		const bobMedia = await store.upsertMedia({
			userId: "user-bob",
			connectionId: null,
			cloudName: "bob-cloud",
			publicId: "AnyRecord/bob-image-1",
			resourceType: "image",
			secureUrl: "https://res.cloudinary.com/bob-cloud/image/upload/v1/bob-image-1.png",
			format: "png",
			bytes: 51200,
			width: 800,
			height: 600,
			duration: null,
			originalFilename: "bob-screenshot.png",
			title: "Bob Screenshot",
		});

		const aliceList = await store.listMedia("user-alice");
		const bobList = await store.listMedia("user-bob");

		expect(aliceList).toHaveLength(1);
		expect(aliceList[0].cloudName).toBe("alice-cloud");
		expect(bobList).toHaveLength(1);
		expect(bobList[0].cloudName).toBe("bob-cloud");

		// Alice cannot delete Bob's media
		const deletedByAlice = await store.deleteMedia("user-alice", bobMedia.id);
		expect(deletedByAlice).toBeNull();

		// Bob can delete his own media
		const deletedByBob = await store.deleteMedia("user-bob", bobMedia.id);
		expect(deletedByBob?.id).toBe(bobMedia.id);
		expect(await store.listMedia("user-bob")).toHaveLength(0);
	});

	it("serves HTTP handler endpoints with per-user authentication", async () => {
		const store = new InMemoryCloudinaryStore();
		const oauth = new CloudinaryOAuthService(store, {
			tokenEncryptionKey: TEST_MASTER_KEY,
			clientId: "cid",
			defaultRedirectUri: DEFAULT_REDIRECT,
			allowedRedirectUris: [DEFAULT_REDIRECT],
		});

		const handler = createCloudinaryEdgeHandler({
			authenticate: async (token) => (token === "token-user-a" ? "user-a" : null),
			store,
			oauth,
		});

		const res = await handler(
			new Request("https://example.com/functions/v1/cloudinary/status", {
				method: "GET",
				headers: { Authorization: "Bearer token-user-a" },
			}),
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: { state: string; cloudName: string | null };
		};
		expect(body.status.state).toBe("not_connected");
		expect(body.status.cloudName).toBeNull();
	});

	it("validates image and video magic bytes and rejects invalid files", () => {
		const pngHeader = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		]);
		expect(detectMediaResourceType("photo.png", pngHeader)?.resourceType).toBe("image");

		const jpegHeader = Buffer.from([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		]);
		expect(detectMediaResourceType("photo.jpg", jpegHeader)?.resourceType).toBe("image");

		const mp4Header = Buffer.from([
			0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
		]);
		expect(detectMediaResourceType("clip.mp4", mp4Header)?.resourceType).toBe("video");

		const fakeMp4WithTextBytes = Buffer.from("<!DOCTYPE html><html></html>");
		expect(() => detectMediaResourceType("spoofed.mp4", fakeMp4WithTextBytes)).toThrow(
			/Unsupported or corrupted/i,
		);
	});

	it("stores user feedback with metadata and diagnostics in database table", async () => {
		const store = new InMemoryCloudinaryStore();
		const feedback = await store.saveFeedback({
			userId: "user-feedback-test",
			userEmail: "tester@example.com",
			userName: "Tester",
			subject: "Export suggestion",
			message: "Would love 4K 60fps export option",
			category: "feature",
			diagnostics: { version: "1.4.0", os: "win32" },
		});

		expect(feedback.id).toBeDefined();
		expect(feedback.userId).toBe("user-feedback-test");
		expect(feedback.userEmail).toBe("tester@example.com");
		expect(feedback.subject).toBe("Export suggestion");
		expect(feedback.message).toBe("Would love 4K 60fps export option");
		expect(feedback.category).toBe("feature");
		expect(feedback.status).toBe("new");
		expect(feedback.diagnostics).toEqual({ version: "1.4.0", os: "win32" });

		const list = await store.listFeedback(10);
		expect(list.length).toBe(1);
		expect(list[0].id).toBe(feedback.id);
	});
});
