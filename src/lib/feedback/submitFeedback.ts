import { recordlyAuth } from "@/lib/auth/recordlyAuth";

export class FeedbackError extends Error {}

export function feedbackErrorMessage(error: unknown) {
	return error instanceof FeedbackError
		? error.message
		: "Could not send feedback. Please try again.";
}

const submissionErrors: Record<string, string> = {
	SIGN_IN_REQUIRED: "Please sign in again to send feedback.",
	INVALID_FEEDBACK: "Check your subject and description, then try again.",
	INVALID_ATTACHMENTS: "Attach up to 5 nonempty files totaling 10 MB or less.",
	FEEDBACK_LIMIT: "You’ve reached today’s feedback limit. Please try again tomorrow.",
};

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
export function validateAttachments(files: File[]) {
	if (files.length > MAX_FILES) return "Attach up to 5 files.";
	if (files.some((file) => file.size === 0)) return "Empty files cannot be attached.";
	if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
		return "Attachments must total 10 MB or less.";
	return null;
}
export interface SubmitFeedbackOptions {
	title: string;
	subject: string;
	message: string;
	files?: File[];
	logs?: string | null;
	email?: string | null;
	userName?: string | null;
	authToken?: string | null;
}

export async function submitFeedback(input: SubmitFeedbackOptions) {
	if (typeof window !== "undefined" && window.electronAPI?.submitUserFeedback) {
		const filesMeta =
			input.files && input.files.length > 0
				? input.files.map((f) => ({ name: f.name, size: f.size, type: f.type }))
				: undefined;

		const res = await window.electronAPI.submitUserFeedback({
			subject: input.title.trim() || input.subject || "User Feedback",
			message: input.message.trim(),
			category: input.subject || "general",
			userEmail: input.email ?? null,
			userName: input.userName ?? null,
			authToken: input.authToken ?? null,
			diagnostics: {
				logs: input.logs ?? null,
				files: filesMeta,
				submittedAt: new Date().toISOString(),
			},
		});

		if (!res.success) {
			throw new FeedbackError(res.error || "Could not save feedback. Please try again.");
		}
		return;
	}

	const client = recordlyAuth;
	if (!client)
		throw new FeedbackError("Feedback is unavailable until account services are configured.");
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) throw new FeedbackError("Please sign in again to send feedback.");
	const files = input.files ?? [];
	const validation = validateAttachments(files);
	if (validation) throw new FeedbackError(validation);
	const body = new FormData();
	body.set("title", input.title.trim());
	body.set("subject", input.subject);
	body.set("message", input.message.trim());
	if (input.logs !== null && input.logs !== undefined) body.set("logs", input.logs);
	for (const file of files) body.append("files", file);
	const result = await client.functions.invoke("submit-feedback", { body, timeout: 60_000 });
	if (result.error) {
		const response = result.error.context;
		if (response instanceof Response) {
			if (response.status === 401) throw new FeedbackError(submissionErrors.SIGN_IN_REQUIRED);
			const payload = await response.json().catch(() => null);
			if (payload?.code && Object.keys(submissionErrors).includes(payload.code)) {
				throw new FeedbackError(submissionErrors[payload.code]);
			}
		}
		throw result.error;
	}
	if (result.data?.success !== true) throw new Error("Feedback submission was not confirmed");
}
