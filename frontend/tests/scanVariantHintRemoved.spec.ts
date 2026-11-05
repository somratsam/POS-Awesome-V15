import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const itemsDir = resolve(__dirname, "../src/posapp/components/pos/items");

describe("'Other sizes/colors may be available' popup is gone from the sale screen", () => {
	it("the popup component no longer exists", () => {
		expect(existsSync(resolve(itemsDir, "ScanVariantHint.vue"))).toBe(false);
	});

	it("ItemsSelector neither renders it nor wires its VIEW button", () => {
		const source = readFileSync(resolve(itemsDir, "ItemsSelector.vue"), "utf8");
		expect(source).not.toContain("ScanVariantHint");
		expect(source).not.toContain("viewScanVariantHint");
		expect(source).not.toContain("may be available");
	});

	it("the Check Stock button (sizes, colours and stock) is still on the sale screen", () => {
		const source = readFileSync(resolve(itemsDir, "ItemsSelector.vue"), "utf8");
		expect(source).toContain("showStockLookupButton");
		expect(source).toContain("openStockLookup");
	});
});
