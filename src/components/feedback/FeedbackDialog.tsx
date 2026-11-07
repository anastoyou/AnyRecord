import { Button, Description, Form, Input, Label, TextArea, TextField } from "@heroui/react";
import { useRef, useState } from "react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { BuyMeACoffeeButton } from "@/components/ui/BuyMeACoffeeButton";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ChatDots, File, X } from "@/components/ui/icons";
import { feedbackDiagnostics } from "@/lib/feedback/diagnostics";
import {
	feedbackErrorMessage,
	submitFeedback,
	validateAttachments,
} from "@/lib/feedback/submitFeedback";

export function FeedbackDialog({
	className,
	showLabel = true,
	onSignIn,
	authToken,
}: {
	className?: string;
	showLabel?: boolean;
	onSignIn?: () => void;
	authToken?: string | null;
}) {
	const auth = useRecordlyAuth();
	const [open, setOpen] = useState(false);
	const [subject, setSubject] = useState("");
	const [message, setMessage] = useState("");
	const [guestEmail, setGuestEmail] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const sendingRef = useRef(false);
	const picker = useRef<HTMLInputElement>(null);

	const canSubmitWithoutAuth =
		typeof window !== "undefined" && Boolean(window.electronAPI?.submitUserFeedback);
	const isAllowed = Boolean(auth.user || canSubmitWithoutAuth);

	function addFiles(incoming: File[]) {
		const next = [...files, ...incoming];
		const issue = validateAttachments(next);
		if (issue) {
			setError(issue);
			return;
		}
		setFiles(next);
		setError("");
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (sendingRef.current) return;
				setOpen(value);
				if (value) setSent(false);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" className={className} aria-label="Feedback">
					<ChatDots className="size-4" />
					{showLabel && "Feedback"}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{sent ? "Thanks for your feedback" : "Send feedback"}</DialogTitle>
				</DialogHeader>
				{sent ? (
					<div className="flex flex-col gap-4 text-center py-2">
						<div className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
							Your feedback has been saved. Thank you for helping improve AnyRecord!
						</div>
						<div className="flex flex-col items-center gap-2 pt-2 border-t border-border/40">
							<p className="text-xs text-muted-foreground">
								Want to support development?
							</p>
							<BuyMeACoffeeButton size="md" className="w-full justify-center" />
						</div>
						<Button onPress={() => setOpen(false)}>Done</Button>
					</div>
				) : !isAllowed ? (
					<div className="flex flex-col gap-4">
						<Description>Sign in to send feedback.</Description>
						{onSignIn ? (
							<Button
								onPress={() => {
									setOpen(false);
									onSignIn();
								}}
							>
								Sign in
							</Button>
						) : (
							<Description>Open Home to sign in.</Description>
						)}
					</div>
				) : (
					<Form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (sendingRef.current) return;
							if (!subject.trim() || !message.trim()) {
								setError("Add a subject and description.");
								return;
							}
							sendingRef.current = true;
							setSending(true);
							setError("");
							try {
								await submitFeedback({
									title: subject,
									subject: "general",
									message,
									files,
									email: auth.user?.email || guestEmail || undefined,
									userName: auth.user?.user_metadata?.full_name || undefined,
									authToken,
									logs: feedbackDiagnostics(),
								});
								setSent(true);
								setSubject("");
								setMessage("");
								setGuestEmail("");
								setFiles([]);
							} catch (error) {
								setError(feedbackErrorMessage(error));
							} finally {
								sendingRef.current = false;
								setSending(false);
							}
						}}
					>
						<TextField
							name="subject"
							isRequired
							isDisabled={sending}
							value={subject}
							onChange={(value) => {
								setSubject(value);
								setError("");
							}}
							className="w-full"
						>
							<Label>Subject</Label>
							<Input maxLength={160} placeholder="What’s on your mind?" />
						</TextField>
						<TextField
							name="description"
							isRequired
							isDisabled={sending}
							value={message}
							onChange={(value) => {
								setMessage(value);
								setError("");
							}}
							className="w-full"
						>
							<Label>Description</Label>
							<TextArea
								maxLength={10000}
								rows={5}
								className="resize-y"
								placeholder="Tell us more…"
								onPaste={(event) => {
									const pasted = Array.from(event.clipboardData.files);
									if (pasted.length) {
										event.preventDefault();
										addFiles(pasted);
									}
								}}
							/>
						</TextField>
						<input
							ref={picker}
							type="file"
							multiple
							hidden
							disabled={sending}
							aria-label="Attach files"
							onChange={(event) => {
								addFiles(Array.from(event.target.files ?? []));
								event.target.value = "";
							}}
						/>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="self-start"
							isDisabled={sending}
							onPress={() => picker.current?.click()}
						>
							<File className="size-4" />
							Attach files
						</Button>
						{files.length > 0 && (
							<div className="flex flex-col gap-1">
								{files.map((file, index) => (
									<div
										key={`${file.name}-${index}`}
										className="flex items-center gap-2 text-sm"
									>
										<span className="min-w-0 flex-1 truncate">{file.name}</span>
										<Button
											type="button"
											isIconOnly
											size="sm"
											variant="ghost"
											isDisabled={sending}
											aria-label={`Remove ${file.name}`}
											onPress={() =>
												setFiles(files.filter((_, i) => i !== index))
											}
										>
											<X className="size-3" />
										</Button>
									</div>
								))}
							</div>
						)}
						<Description className="text-xs">
							Diagnostics will be sent along with your feedback.
						</Description>
						{error && (
							<Description role="alert" className="text-danger">
								{error}
							</Description>
						)}
						<div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
							<span className="text-xs text-muted-foreground">Support creator</span>
							<BuyMeACoffeeButton size="xs" />
						</div>
						<Button type="submit" isDisabled={sending} className="w-full">
							{sending ? "Sending…" : "Send feedback"}
						</Button>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
}
