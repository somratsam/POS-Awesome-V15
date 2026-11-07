// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CartItemRow from "../src/posapp/components/pos/invoice/CartItemRow.vue";
import { splitCartItemName } from "../src/posapp/utils/cartItemName";
import cartItemRowSource from "../src/posapp/components/pos/invoice/CartItemRow.vue?raw";
import responsiveSource from "../src/posapp/composables/pos/items/useItemsTableResponsive.ts?raw";

// The cart's Name column shows the name on one line, cut in the middle with
// "…" when it doesn't fit so the size at the end stays visible, with the full
// name on hover. Nothing else changes: the row
// still holds the full name (item details, receipt and invoice use the item
// itself), and the column widths are not touched.

const NAME = "TOP-WOVEN WAISTCOAT-AIR FORCE BLUE PATTERN-40";

const mountRow = (itemOverrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
	mount(CartItemRow, {
		props: {
			item: { item_code: "71610520030013", item_name: NAME, qty: 1, rate: 72.97, amount: 72.97, ...itemOverrides },
			visibleColumns: [{ key: "item_name" }],
			posProfile: {},
			formatFloat: (value: unknown) => String(value ?? ""),
			formatCurrency: (value: unknown) => String(value ?? ""),
			currencySymbol: () => "OMR",
			isNumber: () => true,
			isNegative: () => false,
			rowIndex: 0,
			...props,
		},
		global: {
			stubs: { VBtn: true, "v-btn": true, VIcon: true, "v-icon": true, VChip: true, "v-chip": true, VTooltip: true, "v-tooltip": true },
		},
	});

describe("cart Name column: one line", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (text: string) => text);
	});

	it("keeps the full name in the row and shows it on hover", () => {
		const name = mountRow().get('[data-testid="cart-item-name"]');
		expect(name.text()).toBe(NAME);
		expect(name.attributes("title")).toBe(NAME);
	});

	it("puts the size in its own part, which is never cut", () => {
		const name = mountRow().get('[data-testid="cart-item-name"]');
		expect(name.get(".posa-cart-item-row__item-name-head").text()).toBe("TOP-WOVEN WAISTCOAT-AIR FORCE BLUE PATTERN");
		expect(name.get(".posa-cart-item-row__item-name-tail").text()).toBe("-40");
	});

	it("the hover text follows an edited name", () => {
		const name = mountRow({ item_name: "Gift wrap - custom", name_overridden: 1 }).get('[data-testid="cart-item-name"]');
		expect(name.attributes("title")).toBe("Gift wrap - custom");
	});

	it("one line; only the start is cut with '…', the size part never shrinks", () => {
		const style = cartItemRowSource.slice(cartItemRowSource.indexOf("<style"));
		const rule = (name: string) => style.match(new RegExp(`\\.${name} \\{[^}]*\\}`))?.[0] || "";
		const whole = rule("posa-cart-item-row__item-name");
		expect(whole).toContain("white-space: nowrap;");
		expect(whole).toContain("overflow: hidden;");
		expect(whole).toContain("flex: 1 1 0;");
		expect(whole).not.toContain("overflow-wrap: anywhere");
		const head = rule("posa-cart-item-row__item-name-head");
		expect(head).toContain("text-overflow: ellipsis;");
		expect(head).toContain("min-width: 0;");
		expect(rule("posa-cart-item-row__item-name-tail")).toContain("flex: none;");
	});

	it("leaves the Name column width settings alone", () => {
		expect(responsiveSource).toContain("item_name: { min: 175, max: 250, ratio: 0.14 },");
	});
});

describe("splitCartItemName", () => {
	it("keeps the last part (the size) whole", () => {
		expect(splitCartItemName("JACKET-BROWN PATTERN-40")).toEqual({ head: "JACKET-BROWN PATTERN", tail: "-40" });
		expect(splitCartItemName("KNITWEAR T-SHIRT SLEEVELESS-AIR FORCE BLUE-S")).toEqual({
			head: "KNITWEAR T-SHIRT SLEEVELESS-AIR FORCE BLUE",
			tail: "-S",
		});
		expect(splitCartItemName("CUSTOMER JEWELLRY-LILAC 001-UNI").tail).toBe("-UNI");
	});

	it("names without a short last part are cut at the end as before", () => {
		expect(splitCartItemName("Gift wrap")).toEqual({ head: "Gift wrap", tail: "" });
		expect(splitCartItemName("T-SHIRTS AND TOPS ASSORTMENT")).toEqual({ head: "T-SHIRTS AND TOPS ASSORTMENT", tail: "" });
		expect(splitCartItemName("ENDS-WITH-")).toEqual({ head: "ENDS-WITH-", tail: "" });
		expect(splitCartItemName("-40")).toEqual({ head: "-40", tail: "" });
		expect(splitCartItemName(null)).toEqual({ head: "", tail: "" });
	});
});
