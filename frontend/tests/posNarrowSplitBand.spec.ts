// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import { getResponsiveVisibleHeaders } from "../src/posapp/composables/pos/items/useItemsTableResponsive";

// Same source-string pattern as posLayoutSplitRatio.spec.ts, for the same
// reason (Pos.vue is impractical to fully mount).
//
// Regression guard for the "keeps both panels visible, no stacking" fix:
// after the compact/stacked layout threshold was reverted back to 1100px
// (staff must always see the item selector and invoice panel side by side
// at 1100px+), windows in roughly [1100, 1272) still don't give the
// invoice panel's standard 8/12 split enough width to clear the Invoice
// Items table's real, browser-measured required-column floor (743px --
// see the note in the last test below on why "browser-measured" matters
// here specifically). 8/12 of a 1100px window is only ~733px. Widening the
// split to 9/12 (825px at 1100px) closes it, applied only in this band via
// an inline :style override so it doesn't touch the split ratio anywhere
// else. Confirmed still necessary (not made redundant by the follow-up's
// other fixes) via the same real-browser measurement: at 1100px with every
// other lever applied, the standard 8/12 split still falls short.
describe("POS layout: narrow-band split override (1100-1272px)", () => {
	it("defines useNarrowSplitBand for exactly the 1100-1272px window range, only when not already stacked", () => {
		const block = posSource.match(
			/const useNarrowSplitBand = computed\(([\s\S]*?)\);/,
		);
		expect(block).not.toBeNull();
		const body = block![1];
		expect(body).toMatch(/!useCompactPosSwitcher\.value/);
		expect(body).toMatch(/responsive\.windowWidth\.value >= 1100/);
		expect(body).toMatch(/responsive\.windowWidth\.value < 1272/);
	});

	it("widens the invoice panel to 75% (9/12) and narrows the selector to 25% (3/12) in that band", () => {
		expect(posSource).toMatch(
			/const narrowBandSelectorStyle = computed\(\s*\(\)\s*=>\s*useNarrowSplitBand\.value\s*\?\s*\{\s*flex:\s*"0 0 25%",\s*maxWidth:\s*"25%",?\s*\}\s*:\s*\{\},?\s*\);/,
		);
		expect(posSource).toMatch(
			/const narrowBandInvoiceStyle = computed\(\s*\(\)\s*=>\s*useNarrowSplitBand\.value\s*\?\s*\{\s*flex:\s*"0 0 75%",\s*maxWidth:\s*"75%",?\s*\}\s*:\s*\{\},?\s*\);/,
		);
	});

	it("binds the selector-side style override on all four selector panels, and the invoice style on the invoice panel", () => {
		const selectorComponents = [
			/<ItemsSelector context="pos" \/>/,
			/<PosOffers><\/PosOffers>/,
			/<PosCoupons><\/PosCoupons>/,
			/<Payments><\/Payments>/,
		];

		for (const componentPattern of selectorComponents) {
			const componentMatch = posSource.match(componentPattern);
			expect(componentMatch).not.toBeNull();
			const precedingSource = posSource.slice(0, componentMatch!.index!);
			const vColStart = precedingSource.lastIndexOf("<v-col");
			const attrs = precedingSource.slice(vColStart);
			expect(attrs).toMatch(/:style="narrowBandSelectorStyle"/);
		}

		const invoiceMatch = posSource.match(/<Invoice ref="invoicePanel"><\/Invoice>/);
		expect(invoiceMatch).not.toBeNull();
		const precedingInvoiceSource = posSource.slice(0, invoiceMatch!.index!);
		const invoiceVColStart = precedingInvoiceSource.lastIndexOf("<v-col");
		const invoiceAttrs = precedingInvoiceSource.slice(invoiceVColStart);
		expect(invoiceAttrs).toMatch(/:style="narrowBandInvoiceStyle"/);
	});

	it("both computeds are exposed from setup()'s return statement so the template can actually read them", () => {
		// setup()'s actual return object -- anchored on useCompactPosSwitcher,
		// which is already known to be returned there (see
		// posLayoutSplitRatio.spec.ts and the template usages above), since
		// a bare /return \{.../ match risks matching an earlier, unrelated
		// return statement in this large component.
		expect(posSource).toMatch(
			/useCompactPosSwitcher,\s*\n\s*narrowBandSelectorStyle,\s*\n\s*narrowBandInvoiceStyle,\s*\n\s*showBottomDock,/,
		);
	});

	it("the 9/12 override at the bottom of the band (1100px) clears the trimmed required-columns floor", () => {
		// The concrete claim this whole fix rests on: at the narrowest
		// window in the band, does 9/12 of it actually fit the table's
		// required columns? Ties the two independently-changed numbers
		// (split ratio here, column floor in useItemsTableResponsive.ts)
		// together in one assertion instead of trusting they happen to
		// agree. The 743px figure (175 + 116 + 80 + 84 + 90 + 84 + 66 data
		// columns + 48 expand) mirrors useItemsTableResponsive.spec.ts's own
		// REQUIRED_FLOOR -- calculateMinColumnWidth itself isn't exported,
		// so this is asserted directly rather than re-derived; if that
		// function's numbers change, both this and that file need updating
		// together. This is also, as of the real-browser-verified follow-up,
		// a genuinely measured number (Playwright against a live build),
		// not an arithmetic estimate -- the two earlier rounds each got this
		// wrong (848px, then 768px) because the CSS meant to shrink these
		// columns was silently losing to a higher-specificity Vuetify
		// default the whole time; table-layout was still auto, so real
		// column width was following header label text length, not this
		// map, until that got fixed too (see items-table-styles.css).
		const windowAtBandFloor = 1100;
		const narrowBandInvoiceContainerWidth = windowAtBandFloor * (9 / 12);
		const REQUIRED_FLOOR = 743;

		expect(narrowBandInvoiceContainerWidth).toBeGreaterThanOrEqual(REQUIRED_FLOOR);

		// And confirm the standard 8/12 split (no narrow-band override)
		// would NOT have cleared it at this same window -- proving the
		// override is actually load-bearing here, not redundant. (Verified
		// this holds even with every other lever from this follow-up
		// applied -- see the fix's own commit message for the real
		// container-width numbers measured at both ratios.)
		const standardInvoiceContainerWidth = windowAtBandFloor * (8 / 12);
		expect(standardInvoiceContainerWidth).toBeLessThan(REQUIRED_FLOOR);

		// Sanity check the floor value itself against the real function,
		// using the full header set the same way useItemsTableResponsive.spec.ts
		// does: nothing optional should fit just below the floor, at least
		// one optional column should fit once past it.
		const headers = [
			{ key: "item_name", title: "Name", required: true },
			{ key: "qty", title: "QTY", required: true },
			{ key: "price_list_rate", title: "Price List Rate", required: false },
			{ key: "discount_percentage", title: "Disc %", required: true },
			{ key: "discount_amount", title: "Disc Amt", required: true },
			{ key: "rate", title: "Rate", required: true },
			{ key: "amount", title: "Amount", required: true },
			{ key: "actions", title: "", required: true },
		];
		const belowFloorKeys = getResponsiveVisibleHeaders(
			headers,
			REQUIRED_FLOOR,
		).map((h) => h.key);
		expect(belowFloorKeys).not.toContain("price_list_rate");

		// price_list_rate (min-width 120) is the highest-priority optional
		// column, so it's the first to reappear once there's room past the
		// floor for it specifically.
		const pastFloorKeys = getResponsiveVisibleHeaders(
			headers,
			REQUIRED_FLOOR + 120,
		).map((h) => h.key);
		expect(pastFloorKeys).toContain("price_list_rate");
	});
});
