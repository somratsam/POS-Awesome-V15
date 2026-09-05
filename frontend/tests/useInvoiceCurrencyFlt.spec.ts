// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

describe("useInvoiceCurrency flt() routes through Frappe's global flt", () => {
	beforeEach(() => {
		vi.resetModules();
		setActivePinia(createPinia());
		(window as any).__ = (value: string) => value;
		(window as any).frappe = {
			call: vi.fn(),
			datetime: { nowdate: () => "2026-04-09" },
		};
	});

	it("delegates to window.flt instead of a local .toFixed() implementation", async () => {
		// Confirms the routing itself (the actual fix), independent of any
		// specific rounding behavior: whatever window.flt returns is what
		// useInvoiceCurrency's flt() must return.
		const globalFlt = vi.fn((_value: number, _precision?: number) => 999);
		(window as any).flt = globalFlt;

		const { useInvoiceCurrency } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceCurrency"
		);
		const { flt } = useInvoiceCurrency();

		const result = flt(2.005, 2);

		expect(globalFlt).toHaveBeenCalledWith(2.005, 2);
		expect(result).toBe(999);
	});

	it("correctly rounds a value .toFixed()'s binary-representation quirk gets wrong", async () => {
		// (2.005).toFixed(2) === "2.00" in every JS engine, since 2.005 is
		// actually stored as 2.00499999999999989... -- this is exactly the
		// gap the fix closes. Mirrors Frappe's real _bankers_rounding_legacy
		// behavior for precision > 0: round the exact .5 boundary up, after
		// squashing float noise via a pre-round to 8 decimals (frappe's own
		// number_format.js _round()).
		(window as any).flt = (value: number, precision = 0) => {
			const multiplier = 10 ** precision;
			const n = Number((value * multiplier).toFixed(8));
			const floor = Math.floor(n);
			const decimal = n - floor;
			const rounded = decimal === 0.5 ? floor + 1 : Math.round(n);
			return rounded / multiplier;
		};

		const { useInvoiceCurrency } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceCurrency"
		);
		const { flt } = useInvoiceCurrency();

		expect(flt(2.005, 2)).toBe(2.01);
		expect(Number((2.005).toFixed(2))).toBe(2.0); // the bug this replaces
	});

	it("falls back to .toFixed() if window.flt is unavailable, rather than throwing", async () => {
		delete (window as any).flt;

		const { useInvoiceCurrency } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceCurrency"
		);
		const { flt } = useInvoiceCurrency();

		expect(flt(18.396, 2)).toBe(18.4);
	});
});
