import { describe, expect, it, vi } from "vitest";

import { _applyItemDetailPayload } from "../src/posapp/components/pos/invoice_utils/item_updates";

describe("_applyItemDetailPayload serial preservation", () => {
	it("keeps selected serial info when server payload does not include serial_no", () => {
		const context: any = {
			pos_profile: { warehouse: "Main", posa_auto_set_batch: false },
			price_list_currency: "USD",
			selected_currency: "USD",
			currency_precision: 2,
			flt: (value: any) => Number(value),
			update_qty_limits: vi.fn(),
			_getPlcConversionRate: () => 1,
			_applyPriceListRate: vi.fn(),
		};

		const item: any = {
			item_code: "ITEM-1",
			warehouse: "Main",
			qty: 1,
			serial_no_selected: ["SER-KEEP-01"],
			serial_no_selected_count: 1,
			serial_no: "SER-KEEP-01",
			item_uoms: [],
		};

		const data: any = {
			stock_uom: "Nos",
			uom: "Nos",
			conversion_factor: 1,
			item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
			allow_change_warehouse: 0,
			locked_price: 0,
			description: "",
			item_tax_template: "",
			discount_percentage: 0,
			warehouse: "Main",
			has_batch_no: 0,
			has_serial_no: 1,
			serial_no: null,
			batch_no: null,
			is_stock_item: 1,
			is_fixed_asset: 0,
			allow_alternative_item: 0,
			actual_qty: 10,
			price_list_rate: 100,
			currency: "USD",
			serial_no_data: [],
		};

		_applyItemDetailPayload(context, item, data, {});

		expect(item.serial_no_selected).toEqual(["SER-KEEP-01"]);
		expect(item.serial_no).toBe("SER-KEEP-01");
		expect(item.serial_no_selected_count).toBe(1);
	});

	it("preserves original return-against pricing even when item details return current rates", () => {
		const context: any = {
			pos_profile: { warehouse: "Main", posa_auto_set_batch: false },
			invoice_doc: { is_return: 1, return_against: "SINV-0001" },
			price_list_currency: "USD",
			selected_currency: "USD",
			currency_precision: 2,
			flt: (value: any) => Number(value),
			update_qty_limits: vi.fn(),
			_getPlcConversionRate: () => 1,
			_applyPriceListRate: vi.fn(),
		};

		const item: any = {
			item_code: "PROMO-ITEM",
			warehouse: "Main",
			qty: -1,
			locked_price: true,
			rate: 600,
			base_rate: 600,
			price_list_rate: 600,
			base_price_list_rate: 600,
			discount_percentage: 40,
			item_uoms: [],
		};

		const data: any = {
			stock_uom: "Nos",
			uom: "Nos",
			conversion_factor: 1,
			item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
			allow_change_warehouse: 0,
			locked_price: 0,
			description: "",
			item_tax_template: "",
			discount_percentage: 0,
			warehouse: "Main",
			has_batch_no: 0,
			has_serial_no: 0,
			serial_no: null,
			batch_no: null,
			is_stock_item: 1,
			is_fixed_asset: 0,
			allow_alternative_item: 0,
			actual_qty: 10,
			price_list_rate: 1000,
			currency: "USD",
		};

		_applyItemDetailPayload(context, item, data, {});

		expect(item.locked_price).toBe(true);
		expect(item.rate).toBe(600);
		expect(item.base_rate).toBe(600);
		expect(item.price_list_rate).toBe(600);
		expect(item.base_price_list_rate).toBe(600);
		expect(item.discount_percentage).toBe(40);
		expect(context._applyPriceListRate).not.toHaveBeenCalled();
	});

	it("preserves a manually-set discount_percentage when a racing item-detail response arrives after the edit", () => {
		// Real bug: expanding a cart row fires update_item_detail() (a network
		// call). If the cashier types a discount % and it commits (calcPrices
		// sets discount_percentage/discount_amount/base_discount_amount/rate
		// synchronously) before that call resolves, the stale response used to
		// unconditionally overwrite discount_percentage with the server's
		// default (0) while rate/discount_amount were correctly left alone --
		// receipts then showed no discount despite a real price reduction.
		const context: any = {
			pos_profile: { warehouse: "Main", posa_auto_set_batch: false },
			price_list_currency: "USD",
			selected_currency: "USD",
			currency_precision: 2,
			flt: (value: any) => Number(value),
			update_qty_limits: vi.fn(),
			_getPlcConversionRate: () => 1,
			_applyPriceListRate: vi.fn(),
		};

		// Item state as left by the cashier's manual 65% discount edit --
		// matches calcPrices's "discount_percentage" case output exactly.
		const item: any = {
			item_code: "ITEM-1",
			warehouse: "Main",
			qty: 1,
			locked_price: false,
			price_list_rate: 10.19,
			base_price_list_rate: 10.19,
			rate: 3.57,
			base_rate: 3.57,
			discount_percentage: 65,
			discount_amount: 6.62,
			base_discount_amount: 6.62,
			_manual_rate_set: true,
			item_uoms: [],
		};

		// The racing get_item_detail response, launched before the edit and
		// resolving after -- reflects the item's un-discounted server defaults.
		const data: any = {
			stock_uom: "Nos",
			uom: "Nos",
			conversion_factor: 1,
			item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
			allow_change_warehouse: 0,
			locked_price: 0,
			description: "",
			item_tax_template: "",
			discount_percentage: 0,
			warehouse: "Main",
			has_batch_no: 0,
			has_serial_no: 0,
			serial_no: null,
			batch_no: null,
			is_stock_item: 1,
			is_fixed_asset: 0,
			allow_alternative_item: 0,
			actual_qty: 10,
			price_list_rate: 10.19,
			currency: "USD",
		};

		_applyItemDetailPayload(context, item, data, {});

		expect(item.discount_percentage).toBe(65);
		expect(item.rate).toBe(3.57);
		expect(item.discount_amount).toBe(6.62);
	});

	it("still applies the server's discount_percentage when the item has no existing discount", () => {
		// The fix must not break the original, intended behavior: a fresh
		// item-detail fetch with no prior manual discount should still pick
		// up a server-side default percentage (e.g. from a customer price
		// group discount) exactly as before.
		const context: any = {
			pos_profile: { warehouse: "Main", posa_auto_set_batch: false },
			price_list_currency: "USD",
			selected_currency: "USD",
			currency_precision: 2,
			flt: (value: any) => Number(value),
			update_qty_limits: vi.fn(),
			_getPlcConversionRate: () => 1,
			_applyPriceListRate: vi.fn(),
		};

		const item: any = {
			item_code: "ITEM-2",
			warehouse: "Main",
			qty: 1,
			locked_price: false,
			price_list_rate: 100,
			base_price_list_rate: 100,
			rate: 100,
			base_rate: 100,
			discount_percentage: 0,
			discount_amount: 0,
			base_discount_amount: 0,
			item_uoms: [],
		};

		const data: any = {
			stock_uom: "Nos",
			uom: "Nos",
			conversion_factor: 1,
			item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
			allow_change_warehouse: 0,
			locked_price: 0,
			description: "",
			item_tax_template: "",
			discount_percentage: 10,
			warehouse: "Main",
			has_batch_no: 0,
			has_serial_no: 0,
			serial_no: null,
			batch_no: null,
			is_stock_item: 1,
			is_fixed_asset: 0,
			allow_alternative_item: 0,
			actual_qty: 10,
			price_list_rate: 100,
			currency: "USD",
		};

		_applyItemDetailPayload(context, item, data, {});

		expect(item.discount_percentage).toBe(10);
		expect(item.rate).toBe(90);
		expect(item.discount_amount).toBe(10);
	});
});

