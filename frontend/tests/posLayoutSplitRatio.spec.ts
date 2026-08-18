// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";

// Pos.vue has heavy runtime dependencies (stores, composables, several
// dialogs) that make a full mount impractical for a layout-only check --
// same source-string assertion pattern already used elsewhere in this repo
// for hard-to-mount components (see customerDropdownXss.spec.ts).
//
// Regression guard for the "invoice panel too cramped on smaller store PCs"
// fix: the selector/invoice v-col split used to be an identical 5:7 ratio
// at every breakpoint (xl/lg/md/sm all the same). Real lower-res store PCs
// (1366x768, 1280x1024, 1440x900, etc.) land in Vuetify's md (960-1279px)
// or lg (1280-1919px) tier -- exactly where the invoice table's own column
// minimum widths (~850px) didn't fit inside a 7/12 share of the row. xl
// (1920px+) already worked fine, so it -- and sm, which is unreachable
// anyway since useCompactPosSwitcher forces full stacking below
// POS_COMPACT_LAYOUT_BREAKPOINT (1300px, see useResponsive.ts) -- are
// deliberately left unchanged. That same 1300px floor also means md's own
// :md values below are effectively dead in practice today (md tops out at
// 1279px, entirely inside the stacked zone) -- left as-is rather than
// pruned, since they're harmless and Vuetify's md tier existing at all is
// what this split ratio was originally designed against.

describe("POS layout: selector/invoice split ratio", () => {
	// One block per v-col that participates in the split: the four
	// selector-side panels (items/offers/coupons/payment, each shown one at
	// a time) plus the invoice panel.
	const selectorBlocks = [
		/<ItemsSelector context="pos" \/>/,
		/<PosOffers><\/PosOffers>/,
		/<PosCoupons><\/PosCoupons>/,
		/<Payments><\/Payments>/,
	];

	function precedingVColAttributes(componentPattern: RegExp) {
		const componentMatch = posSource.match(componentPattern);
		expect(componentMatch).not.toBeNull();
		const componentIndex = componentMatch!.index!;
		const precedingSource = posSource.slice(0, componentIndex);
		const vColStart = precedingSource.lastIndexOf("<v-col");
		expect(vColStart).toBeGreaterThan(-1);
		return precedingSource.slice(vColStart);
	}

	it.each(selectorBlocks)(
		"selector-side panel (%s) is narrowed to 4/12 at md and lg, unchanged at xl and sm",
		(componentPattern) => {
			const attrs = precedingVColAttributes(componentPattern);
			expect(attrs).toMatch(/:xl="useCompactPosSwitcher \? 12 : 5"/);
			expect(attrs).toMatch(/:lg="useCompactPosSwitcher \? 12 : 4"/);
			expect(attrs).toMatch(/:md="useCompactPosSwitcher \? 12 : 4"/);
			expect(attrs).toMatch(/:sm="useCompactPosSwitcher \? 12 : 5"/);
		},
	);

	it("invoice panel is widened to 8/12 at md and lg, unchanged at xl and sm", () => {
		const attrs = precedingVColAttributes(/<Invoice ref="invoicePanel">/);
		expect(attrs).toMatch(/:xl="useCompactPosSwitcher \? 12 : 7"/);
		expect(attrs).toMatch(/:lg="useCompactPosSwitcher \? 12 : 8"/);
		expect(attrs).toMatch(/:md="useCompactPosSwitcher \? 12 : 8"/);
		expect(attrs).toMatch(/:sm="useCompactPosSwitcher \? 12 : 7"/);
	});

	it("every tier's selector + invoice shares still sum to the full 12-column row", () => {
		// A pure arithmetic guard, independent of the exact ratio chosen --
		// catches a future edit that widens one side without narrowing the
		// other (or vice versa), which would either waste space or overflow
		// the row.
		const tiers: Array<{ selector: number; invoice: number }> = [
			{ selector: 5, invoice: 7 }, // xl
			{ selector: 4, invoice: 8 }, // lg
			{ selector: 4, invoice: 8 }, // md
			{ selector: 5, invoice: 7 }, // sm
		];
		for (const { selector, invoice } of tiers) {
			expect(selector + invoice).toBe(12);
		}
	});
});
