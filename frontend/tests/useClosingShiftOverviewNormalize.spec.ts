import { describe, expect, it } from "vitest";
import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";

describe("useClosingShift fetchOverview() -> normalize()", () => {
	it("forwards same_shift_exchange_total from the raw API response into overview.value", async () => {
		(globalThis as any).frappe = {
			call: () =>
				Promise.resolve({
					message: {
						total_invoices: 2,
						company_currency: "OMR",
						customer_credit_issued: { count: 1, company_currency_total: 203.4 },
						customer_credit_redeemed: { count: 1, company_currency_total: 203.4 },
						same_shift_exchange_total: 203.4,
					},
				}),
		};

		const { overview, fetchOverview } = useClosingShift({});
		fetchOverview("POSA-OS-26-0000016", "OMR");

		// fetchOverview resolves the frappe.call promise asynchronously.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(overview.value.same_shift_exchange_total).toBe(203.4);
	});

	it("defaults to 0, not undefined, when the field is absent from the response", async () => {
		(globalThis as any).frappe = {
			call: () =>
				Promise.resolve({
					message: {
						total_invoices: 0,
						company_currency: "OMR",
					},
				}),
		};

		const { overview, fetchOverview } = useClosingShift({});
		fetchOverview("POSA-OS-26-0000016", "OMR");

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(overview.value.same_shift_exchange_total).toBe(0);
	});
});
