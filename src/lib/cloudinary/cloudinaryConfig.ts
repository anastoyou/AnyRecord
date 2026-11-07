import { saveAppSetting } from "@/lib/appSettings";

const LEGACY_CLOUDINARY_STORAGE_KEY = "anyrecord.cloudinary.config";

/**
 * Purges any legacy client-side Cloudinary config from local storage / app settings.
 * All Cloudinary OAuth credentials and connection state are stored encrypted in
 * Neon PostgreSQL (`cloudinary_connections`) associated with the authenticated user.
 */
export function purgeLegacyCloudinaryConfig(): void {
	try {
		saveAppSetting(LEGACY_CLOUDINARY_STORAGE_KEY, null);
	} catch {
		// ignore
	}
	if (typeof window !== "undefined" && window.localStorage) {
		try {
			window.localStorage.removeItem(LEGACY_CLOUDINARY_STORAGE_KEY);
		} catch {
			// ignore
		}
	}
}
