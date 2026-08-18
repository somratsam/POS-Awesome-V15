import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// A stable, shared mock fn (unlike useItemAddition.spec.ts's per-call
// `show: vi.fn()`) so this file can assert directly on what got shown --
// none of the existing useItemAddition tests check toast calls, only item
// state, so this is a separate file rather than a change to that mock.
const toastShow = vi.fn();
vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastShow }),
}));

import { useItemAddition } from "../src/posapp/composables/pos/items/useItemAddition";

const createItem = (overrides: Record<string, any> = {}) => ({
	item_code: "ITEM-001",
	item_name: "Test Item",
	uom: "Nos",
	stock_uom: "Nos",
	conversion_factor: 1,
	qty: 1,
	rate: 10,
	price_list_rate: 10,
	base_rate: 10,
	base_price_list_rate: 10,
	actual_qty: 100,
	is_stock_item: 1,
	has_batch_no: 0,
	has_serial_no: 0,
	allow_negative_stock: 1,
	item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
	...overrides,
});

const createContext = (overrides: Record<string, any> = {}) => ({
	new_line: false,
	items: [] as any[],
	packed_items: [] as any[],
	expanded: [] as any[],
	pos_profile: {
		warehouse: "Main Warehouse",
		currency: "USD",
		posa_auto_set_batch: 0,
		posa_allow_return_without_invoice: 0,
	},
	stock_settings: {
		allow_negative_stock: 1,
	},
	isReturnInvoice: false,
	...overrides,
});

describe("useItemAddition: tap-to-add confirmation toast", () => {
	beforeEach(() => {
		toastShow.mockClear();
		(globalThis as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => args[Number(i)]) : text;
		(globalThis as any).frappe = {
			call: vi.fn(async () => ({ message: [] })),
			datetime: { nowdate: () => "2026-03-05" },
		};
		setActivePinia(createPinia());
	});

	it("confirms a brand-new line added by tapping (no skipNotification passed)", async () => {
		const api = useItemAddition();
		const context = createContext();
		const item = createItem();

		await api.prepareItemForCart(item, 1, context);
		await api.addItem(item, context);

		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Item Test Item added to invoice",
				color: "success",
			}),
		);
	});

	it("confirms a repeat tap that merges into an existing line", async () => {
		// Mirrors useItemAddition.spec.ts's "merges matching items when
		// new_line is off" -- a plain (no batch/serial) repeat add resolves
		// its merge target on the very first lookup, taking the direct-merge
		// branch rather than the new-line branch.
		const api = useItemAddition();
		const context = createContext();

		const first = createItem();
		await api.prepareItemForCart(first, 1, context);
		await api.addItem(first, context);
		toastShow.mockClear();

		const second = createItem();
		await api.prepareItemForCart(second, 1, context);
		await api.addItem(second, context);

		expect(context.items).toHaveLength(1);
		expect(context.items[0].qty).toBe(2);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Item Test Item added to invoice",
				color: "success",
			}),
		);
	});

	it("does not confirm when the add was blocked by stock", async () => {
		const api = useItemAddition();
		const context = createContext({
			pos_profile: {
				warehouse: "Main Warehouse",
				currency: "USD",
				posa_block_sale_beyond_available_qty: 1,
			},
			stock_settings: { allow_negative_stock: 0 },
		});
		const item = createItem({ actual_qty: 0, allow_negative_stock: 0 });

		await api.prepareItemForCart(item, 1, context);
		await api.addItem(item, context);

		expect(context.items).toHaveLength(0);
		expect(toastShow).not.toHaveBeenCalledWith(
			expect.objectContaining({ color: "success" }),
		);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ color: "error" }),
		);
	});

	it("does not confirm a duplicate-serial click, only the existing warning fires", async () => {
		const api = useItemAddition();
		const context = createContext();
		context.items.push({
			...createItem(),
			posa_row_id: "serial-row",
			has_serial_no: 1,
			serial_no_selected: ["SER-001"],
			qty: 1,
		});

		const duplicate = createItem({
			has_serial_no: 1,
			to_set_serial_no: "SER-001",
		});

		await api.prepareItemForCart(duplicate, 1, context);
		await api.addItem(duplicate, context as any);

		expect(context.items).toHaveLength(1);
		expect(context.items[0].serial_no_selected).toEqual(["SER-001"]);
		expect(toastShow).not.toHaveBeenCalledWith(
			expect.objectContaining({ color: "success" }),
		);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ color: "warning" }),
		);
	});

	it("suppresses the toast when the caller already shows its own (the barcode-scan path)", async () => {
		const api = useItemAddition();
		const context = createContext({ skipNotification: true } as any);
		const item = createItem();

		await api.prepareItemForCart(item, 1, context);
		await api.addItem(item, context);

		expect(context.items).toHaveLength(1);
		expect(toastShow).not.toHaveBeenCalled();
	});
});
