import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

vi.mock("../src/offline/index", () => ({
	saveItems: vi.fn(async () => {}),
	savePriceListItems: vi.fn(async () => {}),
}));

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({
		show: vi.fn(),
	}),
}));

const itemServiceMocks = vi.hoisted(() => ({
	getItemsFromBarcodeData: vi.fn(),
}));

vi.mock("../src/posapp/services/itemService", () => ({
	default: {
		getItemsFromBarcodeData: itemServiceMocks.getItemsFromBarcodeData,
	},
}));

import { useScanProcessor } from "../src/posapp/composables/pos/items/useScanProcessor";

const createScannableItem = (overrides: Record<string, any> = {}) => ({
	item_code: "ITEM-SCAN",
	item_name: "Scannable Item",
	available_qty: 5,
	actual_qty: 5,
	qty: 1,
	rate: 10,
	price_list_rate: 10,
	base_rate: 10,
	base_price_list_rate: 10,
	is_stock_item: 1,
	allow_negative_stock: 0,
	has_serial_no: 0,
	has_batch_no: 0,
	...overrides,
});

const makeContext = (
	options: {
		deferStockValidationToPayment?: boolean;
		allowNegativeStock?: boolean;
	} = {},
) => {
	const addItem = vi.fn(async () => {});

	return {
		items: ref<any[]>([]),
		pos_profile: ref({
			name: "Test Pos",
			currency: "USD",
			warehouse: "Main Warehouse",
			company: "Test Co",
			posa_search_serial_no: 1,
			posa_search_batch_no: 0,
		}),
		active_price_list: ref("Standard Selling"),
		customer_price_list: ref<string | null>(null),
		itemDetailFetcher: {
			update_items_details: vi.fn(async () => {}),
		},
		itemAddition: {
			addItem,
		},
		barcodeIndex: {
			ensureBarcodeIndex: vi.fn(() => new Map()),
			lookupItemByBarcode: vi.fn(() => null),
			replaceBarcodeIndex: vi.fn(),
			indexItem: vi.fn(),
			searchItemsByCode: vi.fn(() => []),
			resetBarcodeIndex: vi.fn(),
		},
		scannerInput: {
			ensureScaleBarcodeSettings: vi.fn(async () => {}),
			updateScaleBarcodeSettings: vi.fn(),
			getScaleBarcodePrefix: vi.fn(() => ""),
			scaleBarcodeMatches: vi.fn(() => false),
			playScanTone: vi.fn(),
			scannerLocked: ref(false),
			scanErrorDialog: ref(false),
			scanErrorMessage: ref(""),
			scanErrorCode: ref(""),
			scanErrorDetails: ref(""),
			scanVariantHint: ref<any>(null),
		},
		searchCache: ref(new Map()),
		eventBus: {
			emit: vi.fn(),
		},
		format_number: (value: unknown) => String(value ?? ""),
		float_precision: computed(() => 2),
		hide_qty_decimals: computed(() => false),
		blockSaleBeyondAvailableQty: computed(() => false),
		deferStockValidationToPayment: computed(
			() => options.deferStockValidationToPayment ?? false,
		),
		currency_precision: computed(() => 2),
		exchange_rate: computed(() => 1),
		format_currency: (value: number) => String(value),
		ratePrecision: () => 2,
		customer: ref(null),
		stock_settings: ref({
			allow_negative_stock: options.allowNegativeStock === false ? 0 : 1,
		}),
		search_from_scanner_ref: ref(false),
		addItem,
	};
};

describe("useScanProcessor serial scan handling", () => {
	beforeEach(() => {
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).frappe = {
			call: vi.fn(async ({ method }: { method: string }) => {
				if (method === "posawesome.posawesome.api.items.parse_scale_barcode") {
					return { message: null };
				}
				return { message: null };
			}),
			show_alert: vi.fn(),
		};
		itemServiceMocks.getItemsFromBarcodeData.mockReset();
		itemServiceMocks.getItemsFromBarcodeData.mockResolvedValue(null);
	});

	it("adds item and auto-sets serial when scanned code matches serial_no_data locally", async () => {
		const ctx = makeContext();
		ctx.items.value = [
			{
				item_code: "ITEM-LOCAL",
				item_name: "Local Item",
				has_serial_no: 1,
				has_batch_no: 1,
				serial_no_data: [
					{ serial_no: "SER-LOCAL-001", batch_no: "BATCH-LOCAL-1" },
				],
				batch_no_data: [{ batch_no: "BATCH-LOCAL-1", batch_qty: 2 }],
				available_qty: 5,
				rate: 10,
				price_list_rate: 10,
				base_rate: 10,
				base_price_list_rate: 10,
			},
		];

		const { processScannedItem } = useScanProcessor(ctx as any);
		await processScannedItem("SER-LOCAL-001");

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		const addedItem = ctx.itemAddition.addItem.mock.calls[0][0];
		expect(addedItem.item_code).toBe("ITEM-LOCAL");
		expect(addedItem.to_set_serial_no).toBe("SER-LOCAL-001");
		expect(addedItem.to_set_batch_no).toBe("BATCH-LOCAL-1");
	});

	it("resolves serial scan via server, fetches item by resolved item_code, and auto-sets serial", async () => {
		const ctx = makeContext();

		(globalThis as any).frappe.call = vi.fn(
			async ({ method, args }: { method: string; args: any }) => {
				if (method === "posawesome.posawesome.api.items.parse_scale_barcode") {
					return { message: null };
				}
				if (
					method ===
					"posawesome.posawesome.api.items.search_serial_or_batch_or_barcode_number"
				) {
					expect(args.search_value).toBe("SER-SERVER-002");
					expect(args.search_serial_no).toBe(1);
					return {
						message: {
							item_code: "ITEM-SERVER",
							serial_no: "SER-SERVER-002",
						},
					};
				}
				if (method === "posawesome.posawesome.api.items.get_item_detail") {
					// Once search_serial_or_batch_or_barcode_number resolves a
					// real item_code, searchCode is no longer a raw barcode --
					// get_items_from_barcode() (an Item Barcode table lookup)
					// would not find it by item_code, so this must go through
					// get_item_detail() instead, same as the scale-barcode path.
					expect(JSON.parse(args.item)).toEqual(
						expect.objectContaining({ item_code: "ITEM-SERVER" }),
					);
					return {
						message: {
							item_code: "ITEM-SERVER",
							item_name: "Server Item",
							has_serial_no: 1,
							has_batch_no: 0,
							serial_no_data: [],
							available_qty: 5,
							rate: 20,
							price_list_rate: 20,
							base_rate: 20,
							base_price_list_rate: 20,
						},
					};
				}
				return { message: null };
			},
		);

		const { processScannedItem } = useScanProcessor(ctx as any);
		await processScannedItem("SER-SERVER-002");

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		const addedItem = ctx.itemAddition.addItem.mock.calls[0][0];
		expect(addedItem.item_code).toBe("ITEM-SERVER");
		expect(addedItem.to_set_serial_no).toBe("SER-SERVER-002");
	});

	it("resolves a plain scanned barcode via get_items_from_barcode, not the filtered catalog search", async () => {
		// Regression test for the actual bug: a scanned barcode belonging to a
		// variant item must resolve even when the POS Profile has Hide Variants
		// Items on. get_items() would silently exclude it (that's the whole
		// reason this endpoint exists); get_items_from_barcode() must not.
		const ctx = makeContext();
		itemServiceMocks.getItemsFromBarcodeData.mockResolvedValueOnce({
			item_code: "35740232030014",
			item_name: "HAT-CAP-BLACK-58",
			barcode: "35740232030014",
			rate: 48.6,
			price_list_rate: 48.6,
			uom: "Nos",
			currency: "OMR",
			has_variants: 0,
			variant_of: "3574023203",
			item_group: "ACCESSORIES",
			is_stock_item: 1,
			has_serial_no: 0,
			has_batch_no: 0,
		});

		const { processScannedItem } = useScanProcessor(ctx as any);
		await processScannedItem("35740232030014");

		expect(itemServiceMocks.getItemsFromBarcodeData).toHaveBeenCalledWith({
			selling_price_list: "Standard Selling",
			currency: "USD",
			barcode: "35740232030014",
			pos_profile: "Test Pos",
		});
		// The generic catalog search must never be reached for a plain barcode scan.
		expect((globalThis as any).frappe.call).not.toHaveBeenCalledWith(
			expect.objectContaining({
				method: "posawesome.posawesome.api.items.get_items",
			}),
		);
		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		const addedItem = ctx.itemAddition.addItem.mock.calls[0][0];
		expect(addedItem.item_code).toBe("35740232030014");
		expect(addedItem.variant_of).toBe("3574023203");
	});

	it("blocks scanned items with insufficient stock for invoice flow", async () => {
		const ctx = makeContext({
			deferStockValidationToPayment: false,
			allowNegativeStock: false,
		});
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ available_qty: 0, actual_qty: 0 }),
			"ITEM-SCAN",
		);

		expect(ctx.itemAddition.addItem).not.toHaveBeenCalled();
		expect(ctx.scannerInput.scanErrorDialog.value).toBe(true);
		expect(ctx.scannerInput.scanErrorCode.value).toBe("ITEM-SCAN");
		expect(ctx.scannerInput.scanErrorDetails.value).toContain(
			"Adjust the quantity",
		);
	});

	it("allows scanned items with insufficient stock for order flow when stock validation is deferred", async () => {
		const ctx = makeContext({ deferStockValidationToPayment: true });
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ available_qty: 0, actual_qty: 0 }),
			"ITEM-SCAN",
		);

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		expect(ctx.scannerInput.scanErrorDialog.value).toBe(false);
	});

	it("allows scanned items with insufficient stock for quotation flow when stock validation is deferred", async () => {
		const ctx = makeContext({ deferStockValidationToPayment: true });
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ available_qty: 0, actual_qty: 0 }),
			"ITEM-SCAN",
		);

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		expect(ctx.scannerInput.scanErrorDialog.value).toBe(false);
	});

	it("uses the standard barcode uom even when legacy posa_uom is populated", async () => {
		const ctx = makeContext();
		(globalThis as any).frappe.call = vi.fn(
			async ({ method, args }: { method: string; args: any }) => {
				if (
					method ===
					"posawesome.posawesome.api.items.get_price_for_uom"
				) {
					expect(args).toMatchObject({
						item_code: "ITEM-SCAN",
						price_list: "Standard Selling",
						uom: "Box",
					});
					return { message: 120 };
				}
				return { message: null };
			},
		);

		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);
		await addScannedItemToInvoice(
			createScannableItem({
				stock_uom: "Nos",
				item_barcode: [{ barcode: "BOX-001", uom: "Box", posa_uom: "Nos" }],
				item_uoms: [
					{ uom: "Nos", conversion_factor: 1 },
					{ uom: "Box", conversion_factor: 12 },
				],
			}),
			"BOX-001",
		);

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		const addedItem = ctx.itemAddition.addItem.mock.calls[0][0];
		expect(addedItem.uom).toBe("Box");
		expect(addedItem.rate).toBe(120);
		expect(addedItem.conversion_factor).toBe(12);
	});

	it("sets the scan-variant hint after scan-adding an item that belongs to a variant family", async () => {
		const ctx = makeContext();
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({
				item_code: "ITEM-BLUE-M",
				item_name: "Style 123 - Blue - Medium",
				variant_of: "STYLE-123",
			}),
			"BARCODE-BLUE-M",
		);

		expect(ctx.scannerInput.scanVariantHint.value).toEqual({
			itemCode: "ITEM-BLUE-M",
			itemName: "Style 123 - Blue - Medium",
			variantOf: "STYLE-123",
		});
	});

	it("does not set a scan-variant hint for a plain (non-variant) item, and clears a stale one from an earlier scan", async () => {
		const ctx = makeContext();
		ctx.scannerInput.scanVariantHint.value = {
			itemCode: "ITEM-BLUE-M",
			itemName: "Style 123 - Blue - Medium",
			variantOf: "STYLE-123",
		};
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ item_code: "ITEM-PLAIN", variant_of: undefined }),
			"BARCODE-PLAIN",
		);

		expect(ctx.scannerInput.scanVariantHint.value).toBeNull();
	});

	it("replaces the scan-variant hint (not accumulates) when a second variant item is scanned", async () => {
		const ctx = makeContext();
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ item_code: "ITEM-BLUE-M", variant_of: "STYLE-123" }),
			"BARCODE-BLUE-M",
		);
		await addScannedItemToInvoice(
			createScannableItem({ item_code: "ITEM-RED-L", variant_of: "STYLE-999" }),
			"BARCODE-RED-L",
		);

		expect(ctx.scannerInput.scanVariantHint.value).toMatchObject({
			itemCode: "ITEM-RED-L",
			variantOf: "STYLE-999",
		});
	});

	it("still adds a variant item to the invoice normally -- the hint is additive, not a gate", async () => {
		const ctx = makeContext();
		const { addScannedItemToInvoice } = useScanProcessor(ctx as any);

		await addScannedItemToInvoice(
			createScannableItem({ item_code: "ITEM-BLUE-M", variant_of: "STYLE-123" }),
			"BARCODE-BLUE-M",
		);

		expect(ctx.itemAddition.addItem).toHaveBeenCalledTimes(1);
		expect(ctx.itemAddition.addItem.mock.calls[0][0].item_code).toBe("ITEM-BLUE-M");
	});
});
