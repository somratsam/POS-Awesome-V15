import { describe, expect, it } from "vitest";

import {
	getVariantCardDisplayQty,
	isVariantCardOutOfStock,
	getVariantCardAvailableQty,
	getVariantCardBarcode,
	isVariantCardUnavailable,
} from "../src/posapp/utils/variantCard";

describe("variant card presentation", () => {
	it("prefers the barcode matching the variant stock UOM", () => {
		expect(
			getVariantCardBarcode({
				stock_uom: "Each",
				item_barcode: [
					{ barcode: "BOX-001", uom: "Box" },
					{ barcode: "EA-001", uom: "Each" },
				],
			}),
		).toBe("EA-001");
	});

	it("supports legacy barcode arrays and missing barcode data", () => {
		expect(getVariantCardBarcode({ barcodes: ["LEGACY-001"] })).toBe(
			"LEGACY-001",
		);
		expect(getVariantCardBarcode({})).toBe("");
	});

	it("uses reserved availability before warehouse actual quantity", () => {
		expect(
			getVariantCardAvailableQty({ available_qty: 2, actual_qty: 5 }),
		).toBe(2);
		expect(getVariantCardAvailableQty({ actual_qty: "3.5" })).toBe(3.5);
		expect(getVariantCardAvailableQty({})).toBeNull();
	});

	it("disables zero-stock variants when stock policy blocks the sale", () => {
		const item = { item_code: "VAR-001", is_stock_item: 1, actual_qty: 0 };

		expect(
			isVariantCardUnavailable(item, {}, { allow_negative_stock: 0 }),
		).toBe(true);
		expect(
			isVariantCardUnavailable(item, {}, { allow_negative_stock: 1 }),
		).toBe(false);
		expect(
			isVariantCardUnavailable(
				item,
				{ posa_display_items_in_stock: 1 },
				{ allow_negative_stock: 1 },
			),
		).toBe(true);
	});

	it("keeps non-stock and unknown legacy variants selectable", () => {
		expect(
			isVariantCardUnavailable(
				{ is_stock_item: 0, actual_qty: 0 },
				{},
				{},
			),
		).toBe(false);
		expect(isVariantCardUnavailable({ is_stock_item: 1 }, {}, {})).toBe(
			false,
		);
	});
});

describe("variant card display below zero (Check Stock and the size picker)", () => {
	it("shows 0, never a negative number", () => {
		expect(getVariantCardDisplayQty({ actual_qty: -2 })).toBe(0);
		expect(getVariantCardDisplayQty({ actual_qty: 0 })).toBe(0);
		expect(getVariantCardDisplayQty({ actual_qty: 7 })).toBe(7);
		expect(getVariantCardDisplayQty({ available_qty: -1, actual_qty: 5 })).toBe(0);
		expect(getVariantCardDisplayQty({})).toBeNull();
	});

	it("marks 0 and below as Out of Stock", () => {
		expect(isVariantCardOutOfStock({ actual_qty: -2 })).toBe(true);
		expect(isVariantCardOutOfStock({ actual_qty: 0 })).toBe(true);
		expect(isVariantCardOutOfStock({ actual_qty: 1 })).toBe(false);
		expect(isVariantCardOutOfStock({})).toBe(false);
	});

	it("leaves whether a card can be picked to the real stock rules", () => {
		const below = { actual_qty: -2, is_stock_item: 1 };
		expect(isVariantCardOutOfStock(below)).toBe(true);
		expect(
			isVariantCardUnavailable(below, { posa_block_sale_beyond_available_qty: 0 }, { allow_negative_stock: 1 }),
		).toBe(false);
		expect(
			isVariantCardUnavailable(below, { posa_block_sale_beyond_available_qty: 1 }, { allow_negative_stock: 0 }),
		).toBe(true);
	});
});
