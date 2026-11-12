// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

vi.mock("../src/offline/index", () => ({
	getSalesPersonsStorage: vi.fn(() => []),
	getCachedCustomerAddresses: vi.fn(() => []),
	isOffline: vi.fn(() => false),
	saveCustomerAddressesCache: vi.fn(),
	setSalesPersonsStorage: vi.fn(),
}));

import SalesByCashierDetail from "../src/posapp/components/pos/reports/SalesByCashierDetail.vue";
import { useInvoiceDetails } from "../src/posapp/composables/pos/invoice/useInvoiceDetails";

const translate = (text: string, args?: any[]) =>
	args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;

const values = (net: number, sales: number, byOthers: number) => ({
	gross: net,
	returns: 0,
	net,
	sales,
	by_others: byOthers,
	avg_basket: sales ? net / sales : null,
});

const view = () => {
	const rows = [
		{ key: "cashier:Omar", label: "Omar", kind: "cashier", initials: "O", values: [values(300, 6, 4)] },
		{ key: "cashier:Abeer", label: "Abeer", kind: "cashier", initials: "A", values: [values(100, 2, 1)] },
		{ key: "others:Others", label: "Others", kind: "others", initials: "··", values: [values(50, 1, 0)] },
	];
	return {
		compare: false,
		periods: [{ from: "2026-11-01", to: "2026-11-10" }],
		periodLabels: ["1 – 10 Nov 2026"],
		rows,
		cashiers: rows.slice(0, 2),
		store: [values(450, 9, 5)],
		currency: "OMR",
	};
};

const mountDetail = (selectedKey: string) =>
	mount(SalesByCashierDetail, {
		props: { view: view(), selectedKey, formatMoney: (value: number) => String(value) },
		global: { mocks: { __: translate } },
	});

describe("Sales by Cashier detail: rung up by others", () => {
	beforeEach(() => {
		(window as any).__ = translate;
	});

	it("shows how many of a person's sales another PIN cashier rang up", () => {
		expect(mountDetail("cashier:Omar").get('[data-testid="sbc-detail-by-others"]').text()).toBe("4 sales");
		expect(mountDetail("cashier:Abeer").get('[data-testid="sbc-detail-by-others"]').text()).toBe("1 sale");
	});

	it("is not shown for the Others group or the store summary", () => {
		expect(mountDetail("others:Others").find('[data-testid="sbc-detail-by-others"]').exists()).toBe(false);
		expect(mountDetail("").find('[data-testid="sbc-detail-by-others"]').exists()).toBe(false);
	});
});

describe("POS Sales Person dropdown", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = { call: vi.fn() };
	});

	const build = (profile: any) =>
		useInvoiceDetails({ invoiceDoc: ref<any>({}), posProfile: ref<any>(profile), invoiceType: ref("Invoice") } as any);

	it("uses the server's list even when it is empty, so a group heading on the profile is never offered", () => {
		const details = build({ posa_sales_persons: [{ sales_person: "Sales Team" }] });
		(globalThis as any).frappe.call.mockImplementation((opts: any) => opts.callback?.({ message: [] }));
		details.get_sales_person_names();
		expect(details.sales_persons.value).toEqual([]);
	});

	it("shows the server's people", () => {
		const details = build({ posa_sales_persons: [{ sales_person: "Omar" }, { sales_person: "Sales Team" }] });
		(globalThis as any).frappe.call.mockImplementation((opts: any) =>
			opts.callback?.({ message: [{ name: "Omar", sales_person_name: "Omar Said" }] }),
		);
		details.get_sales_person_names();
		expect(details.sales_persons.value.map((row: any) => row.value)).toEqual(["Omar"]);
	});

	it("asks for this till's store, not the user's first POS Profile", () => {
		const details = build({ name: "Test Pos", posa_sales_persons: [] });
		(globalThis as any).frappe.call.mockImplementation((opts: any) => opts.callback?.({ message: [] }));
		details.get_sales_person_names();
		expect((globalThis as any).frappe.call.mock.calls[0][0].args).toEqual({ pos_profile: "Test Pos" });
	});

	it("falls back to the profile's list only when the server can't be reached", () => {
		const details = build({ posa_sales_persons: [{ sales_person: "Omar" }] });
		(globalThis as any).frappe.call.mockImplementation((opts: any) => opts.error?.(new Error("offline")));
		details.get_sales_person_names();
		expect(details.sales_persons.value.map((row: any) => row.value)).toEqual(["Omar"]);
	});
});
