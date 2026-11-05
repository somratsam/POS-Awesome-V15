// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	beginItemCatalogGeneration,
	getStoredItemByBarcode,
	promoteItemCatalogGeneration,
	saveItemsBulk,
	stageItemCatalogRows,
} from "../src/offline/cache";
import { db, initPromise } from "../src/offline/db";

const scope = "Test Pos_Test - S";
const otherScope = "Other Pos_Other Store";

const sweater = {
	item_code: "43649930030014",
	item_name: "SWEATER/TANK/TOP-MIDNIGHT BLUE-L",
	item_group: "BODY TOP",
	item_barcode: [{ barcode: "43649930030014" }],
};
const zeroStock = {
	item_code: "ZZ-ZERO-STOCK",
	item_name: "ZZ ZERO STOCK TEST",
	item_group: "BODY TOP",
	actual_qty: 0,
	item_barcode: [{ barcode: "99000000000031" }],
};

async function promote(rows: any[], targetScope = scope) {
	const { generation } = await beginItemCatalogGeneration(targetScope);
	await stageItemCatalogRows(rows, targetScope, generation);
	await promoteItemCatalogGeneration(targetScope, generation, { expectedCount: rows.length });
}

describe("offline scan: getStoredItemByBarcode", () => {
	beforeEach(async () => {
		await initPromise;
		if (!db.isOpen()) await db.open();
		await Promise.all([
			db.table("items").clear(),
			db.table("item_catalog_rows").clear(),
			db.table("item_catalog_state").clear(),
		]);
	});

	it("finds an item by its exact barcode in this store's active catalogue, stocked or not", async () => {
		await promote([sweater, zeroStock]);

		expect((await getStoredItemByBarcode("43649930030014", scope))?.item_code).toBe("43649930030014");
		expect((await getStoredItemByBarcode("99000000000031", scope))?.item_code).toBe("ZZ-ZERO-STOCK");
	});

	it("also matches an exact item code, ignoring case and spaces", async () => {
		await promote([zeroStock]);
		expect((await getStoredItemByBarcode("  zz-zero-stock ", scope))?.item_code).toBe("ZZ-ZERO-STOCK");
	});

	it("never matches a partial barcode", async () => {
		await promote([sweater]);
		expect(await getStoredItemByBarcode("4364993003", scope)).toBeNull();
	});

	it("only looks in this store's catalogue", async () => {
		await promote([zeroStock], otherScope);
		await promote([sweater]);
		expect(await getStoredItemByBarcode("99000000000031", scope)).toBeNull();
		expect((await getStoredItemByBarcode("99000000000031", otherScope))?.item_code).toBe("ZZ-ZERO-STOCK");
	});

	it("works on a catalogue saved before generations existed", async () => {
		await saveItemsBulk([zeroStock], scope);
		expect((await getStoredItemByBarcode("99000000000031", scope))?.item_code).toBe("ZZ-ZERO-STOCK");
	});

	it("returns null for an empty code", async () => {
		await promote([zeroStock]);
		expect(await getStoredItemByBarcode("", scope)).toBeNull();
		expect(await getStoredItemByBarcode(null, scope)).toBeNull();
	});
});
