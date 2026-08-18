import { describe, expect, it } from "vitest";

import {
	getResponsiveVisibleHeaders,
	type TableHeader,
} from "../src/posapp/composables/pos/items/useItemsTableResponsive";

// Mirrors useInvoiceItems.ts's actual available_columns (post fix: Discount
// %/Amount are required, matching what staff asked for). Required column
// min-widths (item_name 200, qty 116, discount_percentage 82,
// discount_amount 82, rate 92, amount 88, actions 60 -- trimmed from their
// original wider values as part of the "close the remaining 1100-1272px
// gap without stacking" follow-up, paired with tighter cell padding/density
// at that width so the trim doesn't clip content) sum to 720px + the
// table's own 48px expand column = 768px floor; price_list_rate (120)
// takes it to 888, uom (80, no entry in useItemsTableResponsive's own
// width map so it falls to that function's 80px default) to 968,
// posa_is_offer (70) to 1038.
const ALL_HEADERS: TableHeader[] = [
	{ title: "Name", key: "item_name", required: true },
	{ title: "QTY", key: "qty", required: true },
	{ title: "UOM", key: "uom", required: false },
	{ title: "Price List Rate", key: "price_list_rate", required: false },
	{ title: "Discount %", key: "discount_percentage", required: true },
	{ title: "Discount Amount", key: "discount_amount", required: true },
	{ title: "Rate", key: "rate", required: true },
	{ title: "Amount", key: "amount", required: true },
	{ title: "Offer?", key: "posa_is_offer", required: false },
	{ title: "Actions", key: "actions", required: true },
];

const REQUIRED_FLOOR = 768;
const PLUS_PRICE_LIST_RATE = 888;
const PLUS_UOM = 968;
const PLUS_POSA_IS_OFFER = 1038;

function visibleKeys(width: number) {
	return getResponsiveVisibleHeaders(ALL_HEADERS, width).map((h) => h.key);
}

describe("useItemsTableResponsive: graduated column hiding", () => {
	it("shows only required columns below the required-only floor", () => {
		const keys = visibleKeys(REQUIRED_FLOOR - 1);
		expect(keys).toEqual(
			expect.arrayContaining([
				"item_name",
				"qty",
				"discount_percentage",
				"discount_amount",
				"rate",
				"amount",
				"actions",
			]),
		);
		expect(keys).not.toContain("price_list_rate");
		expect(keys).not.toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds price_list_rate first once there's room for it", () => {
		const keys = visibleKeys(PLUS_PRICE_LIST_RATE);
		expect(keys).toContain("price_list_rate");
		expect(keys).not.toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds uom next, after price_list_rate", () => {
		const keys = visibleKeys(PLUS_UOM);
		expect(keys).toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds posa_is_offer last, once everything fits", () => {
		const keys = visibleKeys(PLUS_POSA_IS_OFFER);
		expect(keys).toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).toContain("posa_is_offer");
	});

	it("never hides Discount % or Discount Amount, at any width including the narrowest realistic one", () => {
		// The narrowest width this table will ever actually render at in
		// practice: useCompactPosSwitcher fully stacks the layout below
		// 1100px, so this is a synthetic worst case below even that --
		// discount columns still must never disappear.
		for (const width of [0, 1, 200, 449, 450, 700, REQUIRED_FLOOR - 1]) {
			const keys = visibleKeys(width);
			expect(keys).toContain("discount_percentage");
			expect(keys).toContain("discount_amount");
		}
	});

	it("shows everything when width is not yet measured (0), matching the pre-layout fallback", () => {
		const keys = visibleKeys(0);
		expect(keys).toEqual(
			expect.arrayContaining([
				"item_name",
				"qty",
				"uom",
				"price_list_rate",
				"discount_percentage",
				"discount_amount",
				"rate",
				"amount",
				"posa_is_offer",
				"actions",
			]),
		);
	});

	it("only offers optional columns that were actually passed in (respects prior user/profile selection)", () => {
		// If price_list_rate was already deselected by the caller (not in
		// the headers array at all), the graduated logic must not invent
		// it back just because there's room -- it only ever adds back
		// columns that were candidates in the first place.
		const withoutPriceListRate = ALL_HEADERS.filter(
			(h) => h.key !== "price_list_rate",
		);
		const keys = getResponsiveVisibleHeaders(
			withoutPriceListRate,
			PLUS_POSA_IS_OFFER,
		).map((h) => h.key);
		expect(keys).not.toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).toContain("posa_is_offer");
	});
});
