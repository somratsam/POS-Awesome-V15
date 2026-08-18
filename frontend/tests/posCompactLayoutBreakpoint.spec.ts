// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { POS_COMPACT_LAYOUT_BREAKPOINT } from "../src/posapp/composables/core/useResponsive";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import invoiceSummarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import itemsSelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

// Regression guard for the "staff still see horizontal scroll on real
// hardware" follow-up: the Invoice Items table's required columns (Discount
// %/Amount included, which can never hide) have min-widths summing to
// ~848px. At the 8/12 split ratio, split view only clears that floor once
// the window itself is >=1272px -- so windows in [1100, 1272) used to
// render split view with a table too narrow for its own required columns,
// forcing horizontal scroll no matter what the graduated column-hiding
// logic did (it only ever controls optional columns).
//
// The fix raises the point where Pos.vue falls back to full-width stacked
// panels from 1100px to POS_COMPACT_LAYOUT_BREAKPOINT (1300px), which
// closes the gap with margin to spare. That number is used in four places
// that all have to move together -- useCompactPosSwitcher and
// showBottomDock in Pos.vue, useCompactSaleDock in InvoiceSummary.vue, and
// the reserve-bottom-dock-space check in ItemsSelector.vue -- since
// showBottomDock in particular gates the *only* UI that lets staff switch
// panels in compact mode; leaving it out of sync while the others move
// would stack the layout while hiding the way to reach the invoice panel.
describe("POS compact layout breakpoint", () => {
	it("is calibrated with real margin above the 1272px bare minimum", () => {
		expect(POS_COMPACT_LAYOUT_BREAKPOINT).toBe(1300);
		expect(POS_COMPACT_LAYOUT_BREAKPOINT).toBeGreaterThan(1272);
	});

	it("Pos.vue's useCompactPosSwitcher reads the shared constant, not a literal", () => {
		expect(posSource).toMatch(
			/const useCompactPosSwitcher = computed\(\s*\(\)\s*=>\s*responsive\.windowWidth\.value < POS_COMPACT_LAYOUT_BREAKPOINT,?\s*\);/,
		);
	});

	it("Pos.vue's showBottomDock reads the shared constant, not a literal", () => {
		const showBottomDockBlock = posSource.match(
			/const showBottomDock = computed\(([\s\S]*?)\);/,
		);
		expect(showBottomDockBlock).not.toBeNull();
		expect(showBottomDockBlock![1]).toMatch(
			/responsive\.windowWidth\.value < POS_COMPACT_LAYOUT_BREAKPOINT/,
		);
	});

	it("InvoiceSummary.vue's useCompactSaleDock reads the shared constant, not a literal", () => {
		expect(invoiceSummarySource).toMatch(
			/const useCompactSaleDock = computed\(\s*\(\)\s*=>\s*responsive\.windowWidth\.value < POS_COMPACT_LAYOUT_BREAKPOINT,?\s*\);/,
		);
	});

	it("ItemsSelector.vue's reserve-bottom-dock-space check reads the shared constant, not a literal", () => {
		expect(itemsSelectorSource).toMatch(
			/reserve-bottom-dock-space="[\s\S]*?responsive\.windowWidth\.value < POS_COMPACT_LAYOUT_BREAKPOINT[\s\S]*?"/,
		);
	});

	it("all four sites import POS_COMPACT_LAYOUT_BREAKPOINT from useResponsive", () => {
		for (const source of [posSource, invoiceSummarySource, itemsSelectorSource]) {
			expect(source).toMatch(
				/import\s*\{[^}]*\bPOS_COMPACT_LAYOUT_BREAKPOINT\b[^}]*\}\s*from\s*"[^"]*composables\/core\/useResponsive"/,
			);
		}
	});

	it("none of the four sites fell back to the old hardcoded 1100 literal", () => {
		const useCompactPosSwitcherBlock = posSource.match(
			/const useCompactPosSwitcher = computed\(([\s\S]*?)\);/,
		);
		const showBottomDockBlock = posSource.match(
			/const showBottomDock = computed\(([\s\S]*?)\);/,
		);
		const useCompactSaleDockBlock = invoiceSummarySource.match(
			/const useCompactSaleDock = computed\(([\s\S]*?)\);/,
		);
		const reserveDockSpaceBlock = itemsSelectorSource.match(
			/reserve-bottom-dock-space="([\s\S]*?)"/,
		);

		for (const block of [
			useCompactPosSwitcherBlock,
			showBottomDockBlock,
			useCompactSaleDockBlock,
			reserveDockSpaceBlock,
		]) {
			expect(block).not.toBeNull();
			expect(block![1]).not.toMatch(/windowWidth\.value < 1100\b/);
		}
	});
});
