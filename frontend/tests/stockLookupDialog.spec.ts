// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, defineComponent, h, nextTick, ref } from "vue";

const toastSpies = vi.hoisted(() => ({ show: vi.fn() }));
const offlineSpies = vi.hoisted(() => ({
	isOffline: vi.fn(() => false),
	saveItems: vi.fn(async () => {}),
	savePriceListItems: vi.fn(async () => {}),
}));

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastSpies.show }),
}));

vi.mock("../src/offline/index", () => ({
	isOffline: offlineSpies.isOffline,
	saveItems: offlineSpies.saveItems,
	savePriceListItems: offlineSpies.savePriceListItems,
}));

vi.mock("../src/posapp/services/itemService", () => ({
	default: { getItemsFromBarcodeData: vi.fn(async () => null) },
}));

import StockLookupDialog from "../src/posapp/components/pos/items/StockLookupDialog.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { useScannerInput } from "../src/posapp/composables/pos/items/useScannerInput";
import { useScanProcessor } from "../src/posapp/composables/pos/items/useScanProcessor";
import {
	isStockLookupScanActive,
	resetStockLookupScanRoute,
} from "../src/posapp/composables/pos/items/stockLookupScanRoute";

// --- Vuetify stubs ---------------------------------------------------------
// VDialog: renders its content only while modelValue is true, and exposes
// the exact contract Vuetify uses for Esc and outside-click closes -- an
// update:modelValue(false) emit -- via two test buttons.
const VDialogStub = defineComponent({
	name: "VDialog",
	props: { modelValue: { type: Boolean, default: false } },
	emits: ["update:modelValue", "after-leave"],
	setup(props, { slots, emit }) {
		return () =>
			props.modelValue
				? h("div", { class: "v-dialog-stub", role: "dialog" }, [
						h("button", {
							"data-test": "dialog-esc",
							onClick: () => emit("update:modelValue", false),
						}),
						h("button", {
							"data-test": "dialog-outside",
							onClick: () => emit("update:modelValue", false),
						}),
						slots.default?.(),
					])
				: null;
	},
});

const passthrough = (name: string, tag = "div") =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h(tag, { ...attrs }, [slots.default?.(), slots.actions?.()]);
		},
	});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup(props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-testid": attrs["data-testid"],
					disabled: props.disabled,
					onClick: (event: Event) => emit("click", event),
				},
				slots.default?.(),
			);
	},
});

const VChipStub = defineComponent({
	name: "VChip",
	inheritAttrs: false,
	emits: ["click"],
	setup(_props, { slots, emit }) {
		return () =>
			h(
				"button",
				{ type: "button", class: "chip", onClick: (e: Event) => emit("click", e) },
				slots.default?.(),
			);
	},
});

const VTextFieldStub = defineComponent({
	name: "VTextField",
	inheritAttrs: false,
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("label", [
				h("input", {
					"data-testid": attrs["data-testid"],
					value: props.modelValue,
					onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
					onKeydown: attrs.onKeydown,
				}),
			]);
	},
});

const stubs = {
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VIcon: passthrough("VIcon", "i"),
	VSpacer: passthrough("VSpacer"),
	VBtn: VBtnStub,
	VTextField: VTextFieldStub,
	VProgressLinear: passthrough("VProgressLinear"),
	VAlert: passthrough("VAlert"),
	VChip: VChipStub,
	VRow: passthrough("VRow"),
	VCol: passthrough("VCol"),
	VImg: passthrough("VImg"),
};

// --- Fixtures --------------------------------------------------------------

const SELL_BARCODE = "45240197030024";
const sellableItem = {
	item_code: "45240197030024",
	item_name: "Navy 38",
	variant_of: "4524019703",
	available_qty: 5,
	actual_qty: 5,
	qty: 1,
	rate: 97.65,
	price_list_rate: 97.65,
	is_stock_item: 1,
	has_serial_no: 0,
	has_batch_no: 0,
};

const lookupResponse = {
	found: true,
	code: SELL_BARCODE,
	scanned_item_code: "45240197030024",
	template_item_code: "4524019703",
	template_item_name: "Style 4524019703",
	warehouse: "Test - S",
	attributes_meta: { Color: ["NAVY"], Size: ["38", "40"] },
	items: [
		{
			item_code: "45240197030040",
			item_name: "Navy 40",
			actual_qty: 0,
			price_list_rate: 97.65,
			currency: "OMR",
			stock_uom: "Nos",
			item_barcode: [{ barcode: "45240197030040" }],
			item_attributes: [
				{ attribute: "Color", attribute_value: "NAVY" },
				{ attribute: "Size", attribute_value: "40" },
			],
		},
		{
			item_code: "45240197030024",
			item_name: "Navy 38",
			actual_qty: 3,
			price_list_rate: 97.65,
			currency: "OMR",
			stock_uom: "Nos",
			item_barcode: [{ barcode: "45240197030024" }],
			// Deliberately reversed: the server returns attribute rows unordered.
			item_attributes: [
				{ attribute: "Size", attribute_value: "38" },
				{ attribute: "Color", attribute_value: "NAVY" },
			],
		},
	],
};

const flush = async (ms = 60) => {
	await new Promise((resolve) => setTimeout(resolve, ms));
	await nextTick();
};

// The real selling pipeline: useScannerInput -> useScanProcessor ->
// itemAddition.addItem (the cart). Only the cart and network are mocked.
const makeSellingPipeline = () => {
	const addItem = vi.fn(async () => {});
	const scannerInput = useScannerInput();
	const processor = useScanProcessor({
		items: ref<any[]>([]),
		pos_profile: ref({
			name: "Test Pos",
			currency: "OMR",
			warehouse: "Test - S",
			company: "Test Co",
		}),
		active_price_list: ref("Standard Selling"),
		customer_price_list: ref(null),
		itemDetailFetcher: { update_items_details: vi.fn(async () => {}) },
		itemAddition: { addItem },
		barcodeIndex: {
			ensureBarcodeIndex: vi.fn(() => new Map([[SELL_BARCODE, sellableItem]])),
			lookupItemByBarcode: vi.fn((code: string) => (code === SELL_BARCODE ? sellableItem : null)),
			replaceBarcodeIndex: vi.fn(),
			indexItem: vi.fn(),
			searchItemsByCode: vi.fn(() => []),
			resetBarcodeIndex: vi.fn(),
		},
		scannerInput,
		format_number: (v: unknown) => String(v ?? ""),
		float_precision: computed(() => 2),
		hide_qty_decimals: computed(() => false),
		blockSaleBeyondAvailableQty: computed(() => false),
		currency_precision: computed(() => 2),
		exchange_rate: computed(() => 1),
		format_currency: (v: number) => String(v),
		ratePrecision: () => 2,
		customer: ref(null),
		stock_settings: ref({ allow_negative_stock: 1 }),
	} as any);
	scannerInput.setScanHandler(processor.processScannedItem);
	return { scannerInput, addItem };
};

const lookupCalls = () =>
	(window as any).frappe.call.mock.calls.filter(
		([opts]: any[]) => opts.method === "posawesome.posawesome.api.items.lookup_item_stock",
	);

describe("Check Stock dialog", () => {
	let eventBus: { emit: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		offlineSpies.isOffline.mockImplementation(() => false);
		resetStockLookupScanRoute();
		setActivePinia(createPinia());
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
		(globalThis as any).__ = (window as any).__;
		(window as any).frappe = {
			call: vi.fn(async ({ method }: { method: string }) => {
				if (method === "posawesome.posawesome.api.items.lookup_item_stock") {
					return { message: lookupResponse };
				}
				if (method === "posawesome.posawesome.api.items.get_item_detail") {
					return { message: { price_list_rate: 97.65, currency: "OMR" } };
				}
				return { message: null };
			}),
			utils: { play_sound: vi.fn() },
			datetime: { nowdate: () => "2026-10-06" },
		};
		(globalThis as any).frappe = (window as any).frappe;
		eventBus = { emit: vi.fn() };
		const uiStore = useUIStore();
		uiStore.setPosProfile({
			name: "Test Pos",
			currency: "OMR",
			warehouse: "Test - S",
			company: "Test Co",
			selling_price_list: "Standard Selling",
		} as any);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "debug").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	const mountDialog = () =>
		mount(StockLookupDialog, {
			attachTo: document.body,
			global: { components: stubs, provide: { eventBus } },
		});

	it("a scan with the dialog open is looked up and never reaches the cart", async () => {
		const { scannerInput, addItem } = makeSellingPipeline();
		const wrapper = mountDialog();
		useUIStore().openStockLookup({ priceList: "Standard Selling" });
		await nextTick();

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		expect(addItem).not.toHaveBeenCalled();
		expect(lookupCalls()).toHaveLength(1);
		expect(lookupCalls()[0][0].args).toMatchObject({
			pos_profile: "Test Pos",
			code: SELL_BARCODE,
			price_list: "Standard Selling",
		});
		const cards = wrapper.findAll("[data-testid^='stock-lookup-card-']");
		expect(cards).toHaveLength(2);
		// Scanned variant is shown first.
		expect(cards[0].attributes("data-testid")).toBe("stock-lookup-card-45240197030024");
		expect(wrapper.get("[data-testid='stock-lookup-qty-45240197030040']").text()).toContain("0");
		// Labels follow the filter-row order whatever order the rows arrive in.
		expect(cards.map((c) => c.find(".stock-lookup__name").text())).toEqual([
			"NAVY / 38",
			"NAVY / 40",
		]);
		wrapper.unmount();
	});

	it("baseline: with the dialog never opened, a scan adds to the cart", async () => {
		const { scannerInput, addItem } = makeSellingPipeline();
		const wrapper = mountDialog();

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		expect(addItem).toHaveBeenCalledTimes(1);
		expect(lookupCalls()).toHaveLength(0);
		wrapper.unmount();
	});

	const closePaths: Array<[string, (wrapper: any) => Promise<void> | void]> = [
		["the Close button", (w) => w.get("[data-testid='stock-lookup-close']").trigger("click")],
		["Esc", (w) => w.get("[data-test='dialog-esc']").trigger("click")],
		["clicking outside", (w) => w.get("[data-test='dialog-outside']").trigger("click")],
		["the store closing it", () => useUIStore().closeStockLookup()],
	];

	for (const [label, close] of closePaths) {
		it(`after closing via ${label}, the next scan adds to the cart again`, async () => {
			const { scannerInput, addItem } = makeSellingPipeline();
			const wrapper = mountDialog();
			const uiStore = useUIStore();
			uiStore.openStockLookup();
			await nextTick();

			scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
			await flush();
			expect(addItem).not.toHaveBeenCalled();

			await close(wrapper);
			await nextTick();
			expect(uiStore.stockLookupDialog).toBe(false);
			expect(isStockLookupScanActive()).toBe(false);

			scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
			await flush();
			expect(addItem).toHaveBeenCalledTimes(1);
			wrapper.unmount();
		});
	}

	it("after an error inside a lookup, the dialog closes itself and the next scan adds to the cart", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { scannerInput, addItem } = makeSellingPipeline();
		const wrapper = mountDialog();
		const uiStore = useUIStore();
		uiStore.openStockLookup();
		await nextTick();

		// An unexpected (not network) failure inside the lookup itself.
		offlineSpies.isOffline.mockImplementationOnce(() => {
			throw new Error("unexpected");
		});
		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		expect(uiStore.stockLookupDialog).toBe(false);
		expect(isStockLookupScanActive()).toBe(false);
		expect(toastSpies.show).toHaveBeenCalledWith(
			expect.objectContaining({ key: "stock-lookup-failure" }),
		);
		expect(addItem).not.toHaveBeenCalled();

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();
		expect(addItem).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("a network error keeps the dialog open with a message, and selling still resumes on close", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { scannerInput, addItem } = makeSellingPipeline();
		(window as any).frappe.call.mockImplementationOnce(async () => {
			throw new Error("network down");
		});
		const wrapper = mountDialog();
		const uiStore = useUIStore();
		uiStore.openStockLookup();
		await nextTick();

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();
		expect(uiStore.stockLookupDialog).toBe(true);
		expect(wrapper.get("[data-testid='stock-lookup-status']").text()).toContain(
			"Couldn't check stock",
		);
		expect(addItem).not.toHaveBeenCalled();

		await wrapper.get("[data-testid='stock-lookup-close']").trigger("click");
		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();
		expect(addItem).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("when the dialog is unmounted while open (screen torn down), scans go back to selling", async () => {
		const { scannerInput, addItem } = makeSellingPipeline();
		const wrapper = mountDialog();
		const uiStore = useUIStore();
		uiStore.openStockLookup();
		await nextTick();
		expect(isStockLookupScanActive()).toBe(true);

		wrapper.unmount();
		expect(isStockLookupScanActive()).toBe(false);
		expect(uiStore.stockLookupDialog).toBe(false);

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();
		expect(addItem).toHaveBeenCalledTimes(1);
	});

	it("after a reload (fresh store and module state) the dialog is closed and scans sell", async () => {
		useUIStore().openStockLookup();
		vi.resetModules();
		setActivePinia(createPinia());
		const freshStore = (await import("../src/posapp/stores/uiStore")).useUIStore();
		const freshRoute = await import(
			"../src/posapp/composables/pos/items/stockLookupScanRoute"
		);
		expect(freshStore.stockLookupDialog).toBe(false);
		expect(freshRoute.isStockLookupScanActive()).toBe(false);
	});

	it("Add puts that variant in the cart via the normal add path, closes, and selling resumes", async () => {
		const { scannerInput, addItem } = makeSellingPipeline();
		const wrapper = mountDialog();
		const uiStore = useUIStore();
		uiStore.openStockLookup();
		await nextTick();
		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		await wrapper.get("[data-testid='stock-lookup-add-45240197030024']").trigger("click");
		await flush(10);

		expect(eventBus.emit).toHaveBeenCalledWith(
			"add_item",
			expect.objectContaining({
				item_code: "45240197030024",
				code: "45240197030024",
				rate: 97.65,
			}),
		);
		expect(eventBus.emit).toHaveBeenCalledTimes(1);
		expect(uiStore.stockLookupDialog).toBe(false);

		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();
		expect(addItem).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("tapping a card body or a filter chip adds nothing", async () => {
		const { scannerInput } = makeSellingPipeline();
		const wrapper = mountDialog();
		useUIStore().openStockLookup();
		await nextTick();
		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		await wrapper.get("[data-testid='stock-lookup-card-45240197030024']").trigger("click");
		await wrapper.findAll("button.chip")[0].trigger("click");
		await flush(10);
		expect(eventBus.emit).not.toHaveBeenCalled();
		wrapper.unmount();
	});

	it("hides Add on a return invoice", async () => {
		const { scannerInput } = makeSellingPipeline();
		useInvoiceStore().setInvoiceDoc({ is_return: 1 } as any);
		const wrapper = mountDialog();
		useUIStore().openStockLookup();
		await nextTick();
		scannerInput.onBarcodeScanned(SELL_BARCODE, "high");
		await flush();

		expect(wrapper.findAll("[data-testid^='stock-lookup-card-']")).toHaveLength(2);
		expect(wrapper.findAll("[data-testid^='stock-lookup-add-']")).toHaveLength(0);
		wrapper.unmount();
	});

	it("shows a not-found message for an unknown code without touching the cart", async () => {
		const { scannerInput, addItem } = makeSellingPipeline();
		(window as any).frappe.call.mockImplementation(async ({ method }: any) =>
			method === "posawesome.posawesome.api.items.lookup_item_stock"
				? { message: { found: false, code: "UNKNOWN-1" } }
				: { message: null },
		);
		const wrapper = mountDialog();
		useUIStore().openStockLookup();
		await nextTick();
		scannerInput.onBarcodeScanned("UNKNOWN-1", "high");
		await flush();

		expect(wrapper.get("[data-testid='stock-lookup-status']").text()).toContain(
			"No item found for UNKNOWN-1",
		);
		expect(useUIStore().stockLookupDialog).toBe(true);
		expect(addItem).not.toHaveBeenCalled();
		wrapper.unmount();
	});

	it("a scanner typing while focus is on a button is pulled into the code field, and its Enter looks up instead of pressing the button", async () => {
		const wrapper = mountDialog();
		useUIStore().openStockLookup();
		await nextTick();

		const closeBtn = wrapper.get("[data-testid='stock-lookup-close']");
		(closeBtn.element as HTMLElement).focus();
		await closeBtn.trigger("keydown", { key: "4" });
		await nextTick();
		const input = wrapper.get("[data-testid='stock-lookup-input']");
		expect((input.element as HTMLInputElement).value).toBe("4");

		await input.setValue("45240197030024");
		await closeBtn.trigger("keydown", { key: "Enter" });
		await flush(10);

		expect(lookupCalls()).toHaveLength(1);
		expect(lookupCalls()[0][0].args.code).toBe("45240197030024");
		expect(useUIStore().stockLookupDialog).toBe(true);
		wrapper.unmount();
	});
});
