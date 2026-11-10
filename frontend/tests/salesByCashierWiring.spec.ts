// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount } from "@vue/test-utils";

import NavbarMenu from "../src/posapp/components/navbar/NavbarMenu.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

describe("Sales by Cashier wiring", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "terminal@swan.test", user_fullname: "Terminal" },
			boot: { pos_profile: {} },
			call: vi.fn(async () => ({ message: {} })),
		});
	});

	const mountMenu = (posProfile: Record<string, any>, listener = vi.fn()) =>
		shallowMount(NavbarMenu, {
			props: {
				posProfile: { name: "SWAN GALLERIA MCC", ...posProfile },
				cashierName: "Maryam",
				manualOffline: false,
				networkOnline: true,
				serverOnline: true,
				onOpenSalesByCashier: listener,
			},
			global: {
				mocks: { __: (value: string) => value, $theme: { isDark: { value: false } } },
				stubs: {
					QzTrayDialog: true,
					VMenu: true,
					VBtn: true,
					VIcon: true,
					VCard: true,
					VList: true,
					VListItem: true,
					VDivider: true,
					VDialog: true,
					VCardTitle: true,
					VCardText: true,
					VCardActions: true,
					VSpacer: true,
					VSelect: true,
					VSwitch: true,
					VSnackbar: true,
					VAlert: true,
					VTextField: true,
				},
			},
		});

	it("the menu item exists only when the store's switch is on, right under Z Report History", () => {
		for (const value of [undefined, 0, "0"]) {
			const ids = (mountMenu({ posa_enable_sales_by_cashier: value }).vm as any).quickActions.map((a: any) => a.id);
			expect(ids).not.toContain("sales-by-cashier");
		}
		const actions = (mountMenu({ posa_enable_sales_by_cashier: 1 }).vm as any).quickActions;
		const ids = actions.map((a: any) => a.id);
		expect(ids.indexOf("sales-by-cashier")).toBe(ids.indexOf("z-report-history") + 1);
		const item = actions.find((a: any) => a.id === "sales-by-cashier");
		expect(item.label).toBe("Sales by Cashier");
		expect(item.subtitle).toBe("Each cashier's sales for a period");
	});

	it("choosing it emits open-sales-by-cashier", () => {
		const listener = vi.fn();
		const wrapper = mountMenu({ posa_enable_sales_by_cashier: 1 }, listener);
		const item = (wrapper.vm as any).quickActions.find((a: any) => a.id === "sales-by-cashier");
		(wrapper.vm as any).handleAction(item);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("the store opens and closes the dialog", () => {
		const ui = useUIStore();
		ui.openSalesByCashier();
		expect(ui.salesByCashierDialog).toBe(true);
		ui.closeSalesByCashier();
		expect(ui.salesByCashierDialog).toBe(false);
	});
});
