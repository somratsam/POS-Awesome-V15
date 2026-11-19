import { describe, expect, it } from "vitest";
import { createScannedItemMemory, SCANNED_ITEM_TTL_MS } from "../src/posapp/composables/pos/items/scannedItemMemory";
import { mayBeScaleBarcode, normalizeScaleBarcodeSettings } from "../src/posapp/utils/scaleBarcode";

describe("scannedItemMemory", () => {
	const item = { item_code: "A", actual_qty: 3 };

	it("recalls a copy within the same scope", () => {
		const m = createScannedItemMemory();
		m.remember("123", "s", item, 1000);
		const got = m.recall("123", "s", 2000);
		expect(got).toEqual(item);
		expect(got).not.toBe(item);
		got!.actual_qty = 0;
		expect(m.recall("123", "s", 2000)!.actual_qty).toBe(3);
	});

	it("misses in another scope, after expiry, and for unknown codes", () => {
		const m = createScannedItemMemory();
		m.remember("123", "s", item, 1000);
		expect(m.recall("123", "other", 1000)).toBeNull();
		m.remember("123", "s", item, 1000);
		expect(m.recall("123", "s", 1000 + SCANNED_ITEM_TTL_MS + 1)).toBeNull();
		expect(m.recall("999", "s", 1000)).toBeNull();
	});

	it("ignores items without an item_code and keeps at most the limit", () => {
		const m = createScannedItemMemory(SCANNED_ITEM_TTL_MS, 2);
		m.remember("x", "s", { item_name: "no code" });
		expect(m.size()).toBe(0);
		m.remember("1", "s", item);
		m.remember("2", "s", item);
		m.remember("3", "s", item);
		expect(m.size()).toBe(2);
		expect(m.recall("1", "s")).toBeNull();
		expect(m.recall("3", "s")).not.toBeNull();
	});
});

describe("mayBeScaleBarcode (same rule as barcode.py _parse_scale_barcode_data)", () => {
	it("is false when the item-code position isn't set (no scale barcodes)", () => {
		expect(mayBeScaleBarcode(normalizeScaleBarcodeSettings({}), "30410232030045")).toBe(false);
		expect(mayBeScaleBarcode(normalizeScaleBarcodeSettings({ prefix: "21" }), "2100012")).toBe(false);
	});

	it("with a prefix: only codes starting with it", () => {
		const s = normalizeScaleBarcodeSettings({ prefix: "21", item_code_starting_digit: 3, item_code_total_digits: 5 });
		expect(mayBeScaleBarcode(s, "2100012001500")).toBe(true);
		expect(mayBeScaleBarcode(s, "30410232030045")).toBe(false);
	});

	it("without a prefix but with an item-code position: every code may be one", () => {
		const s = normalizeScaleBarcodeSettings({ item_code_starting_digit: 1, item_code_total_digits: 5 });
		expect(mayBeScaleBarcode(s, "30410232030045")).toBe(true);
	});
});
