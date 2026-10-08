// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({ isDark: { value: false } }),
}));

import ItemSalesHistoryModal from "../src/posapp/components/pos/invoice/ItemSalesHistoryModal.vue";

// Vue casts an absent Boolean prop to `false` unless the prop declares a default,
// so `props.isDarkTheme ?? theme.isDark.value` only falls back to the global theme
// when isDarkTheme has an explicit `undefined` default. Without it the dialog was
// always light-themed, and its text-medium-emphasis text went dark-on-dark.
describe("ItemSalesHistoryModal theme", () => {
	it("leaves isDarkTheme undefined when no caller passes it", () => {
		const prop = (ItemSalesHistoryModal as any).props.isDarkTheme;

		expect(Object.prototype.hasOwnProperty.call(prop, "default")).toBe(true);
		expect(prop.default).toBeUndefined();
	});
});
