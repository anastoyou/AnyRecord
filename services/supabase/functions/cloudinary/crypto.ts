const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(encoded: string): Uint8Array {
	const padded = encoded
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function randomToken(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(input));
	const bytes = new Uint8Array(digest);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeCodeChallengeS256(codeVerifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(codeVerifier));
	return toBase64Url(new Uint8Array(digest));
}

async function deriveAesGcmKey(keyMaterial: string): Promise<CryptoKey> {
	const trimmed = keyMaterial.trim();
	if (!trimmed) {
		throw new Error("CLOUDINARY_TOKEN_KEY is required for token encryption.");
	}
	const rawDigest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(trimmed));
	return crypto.subtle.importKey("raw", rawDigest, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

/**
 * Encrypts a secret string with AES-256-GCM, binding the ciphertext to `aad`
 * (e.g., the owning `user_id`) so it cannot be transplanted across users.
 */
export async function encryptSecret(
	plaintext: string,
	keyMaterial: string,
	aad: string,
): Promise<string> {
	const key = await deriveAesGcmKey(keyMaterial);
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
			additionalData: TEXT_ENCODER.encode(aad),
		},
		key,
		TEXT_ENCODER.encode(plaintext),
	);
	return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
	payload: string,
	keyMaterial: string,
	aad: string,
): Promise<string> {
	const parts = payload.split(".");
	if (parts.length !== 3 || parts[0] !== "v1") {
		throw new Error("Unsupported encrypted token format.");
	}
	const iv = fromBase64Url(parts[1]);
	const ciphertext = fromBase64Url(parts[2]);
	const key = await deriveAesGcmKey(keyMaterial);
	const ivBuffer = new Uint8Array(iv.byteLength);
	ivBuffer.set(iv);
	const cipherBuffer = new Uint8Array(ciphertext.byteLength);
	cipherBuffer.set(ciphertext);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: ivBuffer,
			additionalData: TEXT_ENCODER.encode(aad),
		},
		key,
		cipherBuffer,
	);
	return TEXT_DECODER.decode(plaintext);
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const decoded = TEXT_DECODER.decode(fromBase64Url(parts[1]));
		const parsed = JSON.parse(decoded);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

