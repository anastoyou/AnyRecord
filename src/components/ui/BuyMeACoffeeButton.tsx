import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/anas.toyou";

/**
 * Official Buy Me a Coffee brand mug icon with steam swirls.
 */
export function BuyMeACoffeeIcon({
	className = "size-4",
	...props
}: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			className={cn("shrink-0", className)}
			{...props}
		>
			<path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-.8-1.626-.547-.618-1.32-.988-2.148-1.026-.145-.007-.291-.007-.437 0H4.99c-.93 0-1.815.426-2.39 1.15-.574.724-.784 1.666-.566 2.58l1.378 5.86c.404 1.716 1.76 3.018 3.486 3.327l.006.002.396.07c.48.085.967.129 1.455.129h3.774c.488 0 .975-.044 1.455-.129l.396-.07.006-.002c1.726-.309 3.082-1.611 3.486-3.327l.794-3.376c1.196-.046 2.228-.755 2.668-1.83.44-1.074.226-2.307-.549-3.176l.132.666-.132-.666zm-3.376 3.738c-.22.934-.959 1.642-1.9 1.81l-.396.07c-.43.076-.867.114-1.306.114H9.464c-.439 0-.876-.038-1.306-.114l-.396-.07c-.941-.168-1.68-.876-1.9-1.81L4.484 4.293c.123-.198.337-.318.572-.318h12.217c.235 0 .449.12.572.318l-.505 5.86zm3.328-3.056c-.198.483-.66.8-1.18.82l.334-1.421c.148.066.28.163.385.286.105.123.167.27.18.423-.005-.037-.021-.073-.04-.108h.321z" />
		</svg>
	);
}

export interface BuyMeACoffeeButtonProps {
	className?: string;
	size?: "xs" | "sm" | "md" | "lg" | "icon";
	showLabel?: boolean;
	label?: string;
	title?: string;
}

export function BuyMeACoffeeButton({
	className,
	size = "sm",
	showLabel = true,
	label = "Buy me a coffee",
	title = "Support AnyRecord on Buy Me a Coffee",
}: BuyMeACoffeeButtonProps) {
	const [busy, setBusy] = useState(false);

	const handleClick = async () => {
		if (busy) return;
		setBusy(true);
		try {
			if (window.electronAPI?.openExternalUrl) {
				const res = await window.electronAPI.openExternalUrl(BUY_ME_A_COFFEE_URL);
				if (!res.success) {
					window.open(BUY_ME_A_COFFEE_URL, "_blank", "noopener,noreferrer");
				}
			} else {
				window.open(BUY_ME_A_COFFEE_URL, "_blank", "noopener,noreferrer");
			}
		} catch {
			try {
				window.open(BUY_ME_A_COFFEE_URL, "_blank", "noopener,noreferrer");
			} catch {
				toast.error("Could not open Buy Me a Coffee page.");
			}
		} finally {
			setBusy(false);
		}
	};

	const sizeClasses = {
		xs: "h-7 px-2 text-[11px] gap-1.5 rounded-md",
		sm: "h-8 px-2.5 text-xs gap-1.5 rounded-lg",
		md: "h-9 px-3.5 text-xs gap-2 rounded-lg",
		lg: "h-10 px-4 text-sm gap-2 rounded-xl",
		icon: "size-8 p-0 justify-center rounded-lg",
	}[size];

	const iconSizes = {
		xs: "size-3.5",
		sm: "size-3.5",
		md: "size-4",
		lg: "size-4.5",
		icon: "size-4",
	}[size];

	return (
		<button
			type="button"
			onClick={() => void handleClick()}
			title={title}
			aria-label={label}
			disabled={busy}
			className={cn(
				"inline-flex items-center justify-center font-medium select-none transition-all duration-150",
				"bg-[#FFDD00] text-[#000000] border border-[#FFDD00]/20 shadow-sm",
				"hover:brightness-95 hover:shadow active:scale-[0.98]",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFDD00] focus-visible:ring-offset-2",
				sizeClasses,
				className,
			)}
		>
			<BuyMeACoffeeIcon className={iconSizes} />
			{showLabel && size !== "icon" && <span className="font-semibold">{label}</span>}
		</button>
	);
}
