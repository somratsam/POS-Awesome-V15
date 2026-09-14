import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.mock("../src/offline/index", () => ({
	getSalesPersonsStorage: vi.fn(() => []),
	getCachedCustomerAddresses: vi.fn(() => []),
	isOffline: vi.fn(() => false),
	saveCustomerAddressesCache: vi.fn(),
	setSalesPersonsStorage: vi.fn(),
}));

import { useInvoiceDetails } from "../src/posapp/composables/pos/invoice/useInvoiceDetails";

describe("useInvoiceDetails secondary-details freshness (addresses, sales persons)", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = { call: vi.fn() };
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const buildDetails = (customer = "CUST-001") => {
		const invoiceDoc = ref<any>({ customer });
		const posProfile = ref<any>({});
		const invoiceType = ref("Invoice");
		return {
			details: useInvoiceDetails({ invoiceDoc, posProfile, invoiceType }),
			invoiceDoc,
		};
	};

	it("get_addresses() skips a second network call for the same customer within the freshness window", () => {
		const { details } = buildDetails();
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ exc: null, message: [{ name: "ADDR-1", address_line1: "Line 1" }] });
		});

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
		expect(details.addresses.value).toHaveLength(1);

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
	});

	it("get_addresses() re-fetches once the freshness window elapses", () => {
		vi.useFakeTimers();
		const { details } = buildDetails();
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ exc: null, message: [] });
		});

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30001);

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(2);
	});

	it("get_addresses() re-fetches immediately when the customer changes, even within the freshness window", () => {
		const { details, invoiceDoc } = buildDetails("CUST-001");
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ exc: null, message: [] });
		});

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);

		invoiceDoc.value = { ...invoiceDoc.value, customer: "CUST-002" };
		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(2);
	});

	it("get_addresses() does not stamp freshness on a failed fetch, so the very next call retries", () => {
		const { details } = buildDetails();
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ exc: "server error" });
		});

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);

		details.get_addresses();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(2);
	});

	it("get_sales_person_names() skips a second network call within the freshness window", () => {
		const { details } = buildDetails();
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ message: [{ name: "SP-1", sales_person_name: "Alice" }] });
		});

		details.get_sales_person_names();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);

		details.get_sales_person_names();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
	});

	it("get_sales_person_names() re-fetches once the freshness window elapses", () => {
		vi.useFakeTimers();
		const { details } = buildDetails();
		(globalThis as any).frappe.call.mockImplementation((opts: any) => {
			opts.callback?.({ message: [] });
		});

		details.get_sales_person_names();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30001);

		details.get_sales_person_names();
		expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(2);
	});
});
