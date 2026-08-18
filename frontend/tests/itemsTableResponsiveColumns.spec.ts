import { describe, expect, it } from "vitest";

import {
	buildFinalVisibleColumns,
	getResponsiveVisibleHeaders,
} from "../src/posapp/composables/pos/items/useItemsTableResponsive";

const headers = [
	{ key: "item_name", title: "Name", required: true },
	{ key: "qty", title: "QTY", required: true },
	{ key: "uom", title: "UOM" },
	{ key: "price_list_rate", title: "Price List Rate" },
	{ key: "discount_percentage", title: "Discount %" },
	{ key: "discount_amount", title: "Discount Amount" },
	{ key: "rate", title: "Rate", required: true },
	{ key: "amount", title: "Amount", required: true },
	{ key: "posa_is_offer", title: "Offer?" },
	{ key: "actions", title: "Actions", required: true },
];

describe("items table final visible columns", () => {
	it("keeps the body column order aligned with the responsive header order and appends expand", () => {
		const visible = buildFinalVisibleColumns(headers, 1200);

		expect(visible.map((column) => column.key)).toEqual([
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
			"data-table-expand",
		]);
	});

	it("brings optional columns back one at a time as width grows past the required floor", () => {
		// This header set's required columns (item_name/qty/rate/amount/
		// actions) have min-widths summing to 556px (trimmed as part of the
		// "close the remaining 1100-1272px gap without stacking" follow-up,
		// paired with tighter cell padding/density at that width so the
		// trim doesn't clip content); +48px for the expand column puts the
		// required-only floor at 604px. 600px sits just below that floor,
		// so nothing optional fits yet -- only at a width past the floor
		// does the graduated logic start admitting optional columns back
		// in, highest-priority first (price_list_rate, per
		// OPTIONAL_COLUMN_PRIORITY), one at a time as room allows.
		const belowFloor = getResponsiveVisibleHeaders(headers, 600);
		expect(belowFloor.map((column) => column.key)).toEqual([
			"item_name",
			"qty",
			"rate",
			"amount",
			"actions",
		]);

		const pastFloor = getResponsiveVisibleHeaders(headers, 750);
		const finalColumns = buildFinalVisibleColumns(headers, 750);

		expect(pastFloor.map((column) => column.key)).toEqual([
			"item_name",
			"qty",
			"price_list_rate",
			"rate",
			"amount",
			"actions",
		]);
		expect(finalColumns.slice(0, -1)).toEqual(pastFloor);
		expect(finalColumns.at(-1)?.key).toBe("data-table-expand");
	});

	it("keeps the expand column even when the responsive layout collapses optional fields", () => {
		const finalColumns = buildFinalVisibleColumns(headers, 420);

		expect(finalColumns.map((column) => column.key)).toEqual([
			"item_name",
			"qty",
			"rate",
			"amount",
			"actions",
			"data-table-expand",
		]);
	});
});
