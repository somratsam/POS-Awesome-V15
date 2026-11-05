// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({ isRtl: false, rtlStyles: {}, rtlClasses: [] }),
}));
vi.mock("../src/offline/index", () => ({
	forceClearAllCache: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
}));
vi.mock("../src/utils/clearAllCaches", () => ({
	clearAllCaches: vi.fn(async () => undefined),
}));

import Navbar from "../src/posapp/components/Navbar.vue";

// Frappe's own signature: __(text, replace, context) -- replacements as one array.
function frappeTranslate(text: string, replace?: unknown, _context?: unknown) {
	if (!Array.isArray(replace)) return text;
	return text.replace(/\{(\d+)\}/g, (_m, i) => String(replace[Number(i)]));
}

describe("Navbar messages fill in their placeholders", () => {
	const translate = (Navbar as any).methods.__;

	afterEach(() => {
		delete (window as any).__;
	});

	it("passes the replacements to Frappe as one array", () => {
		(window as any).__ = vi.fn(frappeTranslate);
		expect(translate.call({}, "{0} offline invoice{1} synced", [2, "s"])).toBe("2 offline invoices synced");
		expect(translate.call({}, "Pending: {0}", [0])).toBe("Pending: 0");
		expect((window as any).__).toHaveBeenLastCalledWith("Pending: {0}", [0]);
	});

	it("accepts a single replacement that isn't an array", () => {
		(window as any).__ = vi.fn(frappeTranslate);
		expect(translate.call({}, "Invoice {0} submission failed", "ACC-1")).toBe("Invoice ACC-1 submission failed");
	});

	it("returns the text unchanged when Frappe's __ isn't loaded", () => {
		expect(translate.call({}, "Pending: {0}", [1])).toBe("Pending: {0}");
	});
});
