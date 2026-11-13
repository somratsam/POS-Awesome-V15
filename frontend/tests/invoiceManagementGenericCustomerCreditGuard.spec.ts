// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({ isDark: { value: false } }),
}));

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({ windowWidth: { value: 1400 } }),
}));

vi.mock("../src/offline/index", () => ({
	isOffline: () => false,
}));

vi.mock("../src/posapp/plugins/print", () => ({
	appendDebugPrintParam: (url: string) => url,
	isDebugPrintEnabled: () => false,
	silentPrint: vi.fn(),
	watchPrintWindow: vi.fn(),
}));

vi.mock("../src/posapp/services/qzTray", () => ({
	printDocumentViaQz: vi.fn(),
}));

import InvoiceManagement from "../src/posapp/components/pos/flows/InvoiceManagement.vue";

describe("InvoiceManagement.vue createReturn: return of a sale to a shared (generic) customer", () => {
	beforeEach(() => {
		(globalThis as any).__ = (text: string, args?: any[]) => {
			if (!args) return text;
			return args.reduce((str: string, arg: any, i: number) => str.replaceAll(`{${i}}`, String(arg)), text);
		};
		(globalThis as any).frappe = { call: vi.fn() };
	});

	const baseContext = () => ({
		posProfile: { name: "Main POS", company: "Test Company" },
		currentInvoiceDoctype: "Sales Invoice",
		toastStore: { show: vi.fn() },
		eventBus: { emit: vi.fn() },
		uiStore: { closeInvoiceManagement: vi.fn() },
		customersStore: { dropBearerVouchers: vi.fn(), markSharedCustomer: vi.fn() },
	});

	const returnableItem = {
		name: "SINV-0001-ITEM-001",
		item_code: "ITEM-001",
		qty: 1,
		stock_qty: 1,
		amount: 100,
		rate: 100,
		price_list_rate: 100,
		discount_percentage: 0,
		discount_amount: 0,
		is_free_item: 0,
		net_rate: 100,
		net_amount: 100,
	};

	it("loads the return of a sale to a generic customer, keeping that customer, and marks it shared (bearer voucher)", async () => {
		const callMock = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		callMock.mockResolvedValue({
			message: {
				doctype: "Sales Invoice",
				name: "SINV-0001",
				customer: "Anonymous",
				customer_name: "Anonymous",
				posa_customer_is_generic: 1,
				grand_total: 100,
				items: [returnableItem],
				payments: [],
			},
		});

		const context = baseContext();
		await (InvoiceManagement as any).methods.createReturn.call(context, { name: "SINV-0001", doctype: "Sales Invoice" });

		expect(context.eventBus.emit).toHaveBeenCalledWith(
			"load_return_invoice",
			expect.objectContaining({
				invoice_doc: expect.objectContaining({
					customer: "Anonymous",
					is_return: 1,
					return_against: "SINV-0001",
				}),
			}),
		);
		expect(context.customersStore.markSharedCustomer).toHaveBeenCalledWith("Anonymous");
		expect(context.customersStore.dropBearerVouchers).toHaveBeenCalled();
		expect(context.toastStore.show).not.toHaveBeenCalled();
	});

	it("does not block a return whose original invoice's customer is a real customer", async () => {
		const callMock = (globalThis as any).frappe.call as ReturnType<typeof vi.fn>;
		callMock.mockResolvedValue({
			message: {
				doctype: "Sales Invoice",
				name: "SINV-0002",
				customer: "CUST-0001",
				customer_name: "Jane Doe",
				posa_customer_is_generic: 0,
				grand_total: 100,
				items: [returnableItem],
				payments: [],
			},
		});

		const context = baseContext();
		await (InvoiceManagement as any).methods.createReturn.call(context, { name: "SINV-0002", doctype: "Sales Invoice" });

		expect(context.eventBus.emit).toHaveBeenCalledWith(
			"load_return_invoice",
			expect.objectContaining({
				invoice_doc: expect.objectContaining({ customer: "CUST-0001", is_return: 1 }),
			}),
		);
		expect(context.uiStore.closeInvoiceManagement).toHaveBeenCalled();
		expect(context.toastStore.show).not.toHaveBeenCalled();
		expect(context.customersStore.markSharedCustomer).not.toHaveBeenCalled();
	});
});
