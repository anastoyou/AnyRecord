import { Sparkle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

interface SmartCutButtonProps {
	onClick: () => void;
	disabled?: boolean;
	title?: string;
}

export function SmartCutButton({ onClick, disabled, title }: SmartCutButtonProps) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={disabled}
			onClick={onClick}
			title={title ?? "Smart Cut — Automatically remove inactive pauses"}
			className="h-8 gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-500 hover:bg-sky-500/20 hover:text-sky-400"
		>
			<Sparkle weight="fill" className="size-3.5" />
			<span>Smart Cut</span>
		</Button>
	);
}

