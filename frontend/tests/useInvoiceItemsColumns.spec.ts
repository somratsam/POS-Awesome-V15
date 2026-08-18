// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({
		show: vi.fn(),
	}),
}));

vi.mock("../src/posapp/composables/pos/shared/useStockUtils", () => ({
	useStockUtils: () => ({
		calc_stock_qty: vi.fn(),
	}),
}));

vi.mock("../src/posapp/composables/pos/items/useItemAddition", () => ({
	useItemAddition: () => ({
		removeItem: vi.fn(),
		addItem: vi.fn(),
	}),
}));

vi.mock("../src/offline/index", () => ({
	getCachedDeliveryCharges: vi.fn(() => []),
	saveDeliveryChargesCache: vi.fn(),
}));

describe("useInvoiceItems column preferences", () => {
	beforeEach(() => {
		vi.resetModules();
		setActivePinia(createPinia());
		localStorage.clear();
		(window as any).__ = (value: string) => value;
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).flt = (value: any) => Number(value || 0);
		(window as any).frappe = {
			defaults: {
				get_default: vi.fn(() => "2"),
			},
			datetime: {
				nowdate: vi.fn(() => "2026-07-10"),
			},
		};
		(globalThis as any).frappe = (window as any).frappe;
	});

	it("updates optional cart columns and persists only valid optional keys", async () => {
		const { useInvoiceItems } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceItems"
		);
		const invoiceItems = useInvoiceItems(ref("Invoice"));

		invoiceItems.setSelectedColumns([
			"uom",
			"price_list_rate",
			"item_name",
			"discount_value",
			"unknown_column",
		]);
		invoiceItems.saveColumnPreferences();

		// discount_value (an alias for discount_percentage) and item_name
		// are NOT valid optional keys -- discount_percentage is required
		// (see the dedicated test below), and item_name always was.
		expect(invoiceItems.selected_columns.value).toEqual([
			"uom",
			"price_list_rate",
		]);
		expect(invoiceItems.items_headers.value.map((column) => column.key)).toEqual(
			expect.arrayContaining([
				"item_name",
				"qty",
				"uom",
				"price_list_rate",
				"discount_percentage",
				"discount_amount",
				"rate",
				"amount",
				"actions",
			]),
		);
		expect(localStorage.getItem("posawesome_selected_columns")).toBe(
			JSON.stringify(["uom", "price_list_rate"]),
		);
	});

	it("never lets Discount % or Discount Amount be excluded, even via an explicit selection that omits them", async () => {
		// Staff use these two regularly -- they must always render,
		// regardless of what selected_columns says, the same guarantee
		// item_name/qty/rate/amount/actions already had.
		const { useInvoiceItems } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceItems"
		);
		const invoiceItems = useInvoiceItems(ref("Invoice"));

		invoiceItems.setSelectedColumns([]);

		const visibleKeys = invoiceItems.items_headers.value.map((column) => column.key);
		expect(visibleKeys).toContain("discount_percentage");
		expect(visibleKeys).toContain("discount_amount");

		const discountColumns = invoiceItems.available_columns.value.filter(
			(column) => column.key === "discount_percentage" || column.key === "discount_amount",
		);
		expect(discountColumns).toHaveLength(2);
		expect(discountColumns.every((column) => column.required)).toBe(true);
	});

	it("uses shortened header labels for Discount %/Amount/Actions, verified against a real narrow render", async () => {
		// The original full labels ("Discount %", "Discount Amount",
		// "Actions") don't fit within these columns' real widths at the
		// compaction this table now needs -- table-layout: fixed stops the
		// header text from forcing the column wider (see
		// itemsTableCellPaddingWiring.spec.ts), but that also means long
		// text just gets clipped by the header's flex+ellipsis wrapper,
		// which doesn't render a clean "..." (display:flex breaks
		// text-overflow: ellipsis reliably -- confirmed by taking a real
		// screenshot and finding garbled, not ellipsized, header text).
		// Shortening the labels sidesteps that CSS bug entirely rather than
		// trying to patch it. Actions becomes icon-only, matching the
		// expand column's existing empty-title convention.
		const { useInvoiceItems } = await import(
			"../src/posapp/composables/pos/invoice/useInvoiceItems"
		);
		const invoiceItems = useInvoiceItems(ref("Invoice"));

		const byKey = (key: string) =>
			invoiceItems.available_columns.value.find((column) => column.key === key);

		expect(byKey("discount_percentage")?.title).toBe("Disc %");
		expect(byKey("discount_amount")?.title).toBe("Disc Amt");
		expect(byKey("actions")?.title).toBe("");
	});
});
