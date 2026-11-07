import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUY_ME_A_COFFEE_URL, BuyMeACoffeeButton, BuyMeACoffeeIcon } from "./BuyMeACoffeeButton";

describe("BuyMeACoffeeButton", () => {
	it("targets the requested URL", () => {
		expect(BUY_ME_A_COFFEE_URL).toBe("https://buymeacoffee.com/anas.toyou");
	});

	it("renders button markup with official BMC yellow background and coffee icon", () => {
		const html = renderToStaticMarkup(<BuyMeACoffeeButton />);
		expect(html).toContain("bg-[#FFDD00]");
		expect(html).toContain("text-[#000000]");
		expect(html).toContain("Buy me a coffee");
		expect(html).toContain("<svg");
	});

	it("supports icon-only mode", () => {
		const html = renderToStaticMarkup(<BuyMeACoffeeButton size="icon" />);
		expect(html).toContain("<svg");
		expect(html).not.toContain("<span>Buy me a coffee</span>");
	});

	it("renders the standalone BuyMeACoffeeIcon svg", () => {
		const html = renderToStaticMarkup(<BuyMeACoffeeIcon className="custom-coffee-icon" />);
		expect(html).toContain("<svg");
		expect(html).toContain("custom-coffee-icon");
		expect(html).toContain('viewBox="0 0 24 24"');
	});
});
