// @vitest-environment jsdom
// Money is shown like Frappe's own format: "OMR 0.000", with a space between
// the currency symbol and the amount (never "OMR0.000").

import { describe, expect, it, vi } from "vitest";
import format, { joinMoney } from "../src/posapp/format";

vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ({ posProfile: null }) }));

const SOURCES = import.meta.glob("../src/posapp/**/*.{vue,ts}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("money format: a space after the currency symbol", () => {
	it("joinMoney puts one space between symbol and amount", () => {
		expect(joinMoney("OMR", "0.000")).toBe("OMR 0.000");
		expect(joinMoney("OMR", "405.300")).toBe("OMR 405.300");
		expect(`−${joinMoney("OMR", "2.000")}`).toBe("−OMR 2.000");
		expect(joinMoney("OMR ", "1.000")).toBe("OMR 1.000");
	});

	it("joinMoney leaves just the amount when the symbol is hidden", () => {
		expect(joinMoney("", "1.000")).toBe("1.000");
		expect(joinMoney(null, "1.000")).toBe("1.000");
		expect(joinMoney(undefined, 5)).toBe("5");
	});

	it("the shared formatCurrency(value, currency) gives OMR 1,234.500", () => {
		vi.stubGlobal("get_currency_symbol", (c: string) => c);
		const ctx = { currency_precision: 3, currencySymbol: (c: string) => c };
		const out = (format as any).methods.formatCurrency.call(ctx, 1234.5, "OMR");
		expect(out).toMatch(/^OMR \S/);
		expect(out).not.toMatch(/OMR\d/);
	});

	it("no template or script glues a currency symbol straight onto an amount", () => {
		const offenders: string[] = [];
		const patterns = [
			// {{ currencySymbol(x) }}{{ formatCurrency(y) }} -- also when split over two lines
			/currencySymbol\((?:[^()]|\([^()]*\))*\)\s*\}\}\{\{\s*format/,
			/currencySymbol\((?:[^()]|\([^()]*\))*\)\s*\n\s*\}\}\{\{\s*format/,
			// `${symbol}${amount}` in script
			/\$\{[^}]*(?:currencySymbol|symbol)\([^}]*\)\}\$\{[^}]*format/i,
			/\$\{symbol\}\$\{format/,
		];
		for (const [file, text] of Object.entries(SOURCES)) {
			if (patterns.some((re) => re.test(text))) offenders.push(file);
		}
		expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
		expect(offenders, offenders.join(", ")).toEqual([]);
	});
});
