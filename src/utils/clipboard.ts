/**
 * Copies text to the clipboard with resilient fallback strategies:
 * 1. Electron native clipboard (reliable across background/unfocused windows and sandboxes)
 * 2. Modern browser Clipboard API (navigator.clipboard)
 * 3. Fallback textarea with document.execCommand("copy")
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	if (!text) return false;

	// 1. Electron native clipboard API (most reliable in Electron desktop environment)
	if (typeof window !== "undefined" && window.electronAPI?.copyToClipboard) {
		try {
			const success = await window.electronAPI.copyToClipboard(text);
			if (success) return true;
		} catch {
			// Fall through to browser methods
		}
	}

	// 2. Modern browser Clipboard API
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to DOM fallback
		}
	}

	// 3. Document execCommand fallback (works even when document focus is tricky)
	if (typeof document !== "undefined") {
		try {
			const textArea = document.createElement("textarea");
			textArea.value = text;
			textArea.style.position = "fixed";
			textArea.style.top = "0";
			textArea.style.left = "0";
			textArea.style.width = "2em";
			textArea.style.height = "2em";
			textArea.style.padding = "0";
			textArea.style.border = "none";
			textArea.style.outline = "none";
			textArea.style.boxShadow = "none";
			textArea.style.background = "transparent";
			textArea.setAttribute("readonly", "");
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();
			textArea.setSelectionRange(0, text.length);
			const successful = document.execCommand("copy");
			document.body.removeChild(textArea);
			if (successful) return true;
		} catch {
			// All methods exhausted
		}
	}

	return false;
}

