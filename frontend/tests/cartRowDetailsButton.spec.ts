// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CartItemRow from "../src/posapp/components/pos/invoice/CartItemRow.vue";
import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";

// The item details open from the chart icon at the end of a cart row only;
// a click anywhere else on the row just selects it.

const BtnStub = defineComponent({
	inheritAttrs: false,
	setup(_, { attrs, slots }) {
		return () =>
			h(
				"button",
				{ "aria-label": attrs["aria-label"], class: attrs.class, onClick: attrs.onClick },
				slots.default?.(),
			);
	},
});

const mountRow = (props: Record<string, unknown> = {}) =>
	mount(CartItemRow, {
		props: {
			item: {
				item_code: "30410232030043",
				item_name: "JACKET-BROWN PATTERN-40",
				qty: 1,
				rate: 139.3,
				amount: 139.3,
				price_list_rate: 139.3,
				uom: "Nos",
				item_uoms: [{ uom: "Nos" }],
			},
			visibleColumns: [{ key: "item_name" }, { key: "amount" }, { key: "data-table-expand" }],
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
			components: { VBtn: BtnStub, "v-btn": BtnStub },
			stubs: { VIcon: true, "v-icon": true, VChip: true, "v-chip": true, VTooltip: true, "v-tooltip": true },
		},
	});

describe("cart row: item details only from the chart icon", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (text: string) => text);
	});

	it("the chart icon opens the details, and doesn't also count as a row click", async () => {
		const onToggleExpand = vi.fn();
		const onClick = vi.fn();
		const wrapper = mountRow({ onToggleExpand, onClick });
		await wrapper.get('button[aria-label="Open item sales history and details"]').trigger("click");
		expect(onToggleExpand).toHaveBeenCalledTimes(1);
		expect(onClick).not.toHaveBeenCalled();
	});

	it("a click on the name or another cell is a plain row click, not 'open details'", async () => {
		const onToggleExpand = vi.fn();
		const onClick = vi.fn();
		const wrapper = mountRow({ onToggleExpand, onClick });
		await wrapper.get('td[data-column-key="item_name"]').trigger("click");
		await wrapper.get('td[data-column-key="amount"]').trigger("click");
		expect(onClick).toHaveBeenCalledTimes(2);
		expect(onToggleExpand).not.toHaveBeenCalled();
	});
});

// ItemsTable.vue is too large to mount here (see itemsTableDiscountStayPut.spec.ts),
// so check its wiring.
describe("ItemsTable.vue row click", () => {
	const script = itemsTableSource.slice(itemsTableSource.indexOf("<script"));
	const handler = script.slice(
		script.indexOf("const handleRowClick"),
		script.indexOf("};", script.indexOf("const handleRowClick")) + 2,
	);

	it("only selects the row (the keyboard actions on the selected row keep working)", () => {
		expect(handler).toContain("rememberSelectedRow(getItemIndex(item));");
		expect(handler).not.toContain("openItemHistory");
	});

	it("the chart icon still opens the item details", () => {
		expect(itemsTableSource).toContain('@toggle-expand="openItemHistory(item)"');
		expect(itemsTableSource).toContain('@click="handleRowClick($event, item)"');
		expect(script).toMatch(/const openSelectedItemWorkspace = \(\) => \{[\s\S]*?getSelectedGridItem\(\)/);
	});
});
