// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

import { useClosingSummary } from "../src/posapp/composables/pos/closing/useClosingSummary";
import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";
import ShiftOverview from "../src/posapp/components/pos/closing/ShiftOverview.vue";
import closingDialogSource from "../src/posapp/components/pos/shell/ClosingDialog.vue?raw";

// The live Closing Shift overview shows the same figures the Z Report prints
// after closing (server: closing_processing/sales_breakdown.py).

const formatters = {
	formatCurrencyWithSymbol: (value: number, currency: string) => `${value} ${currency}`,
	formatCount: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: (currency: string) => currency,
	__: (text: string, args: any[] = []) => text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")),
};

const EXCHANGE = {
	gross_sales: 145.94, returns: 72.97, returns_this_shift: 72.97, returns_earlier: 0, net_sales: 72.97,
	sale_count: 2, return_count: 1, exchange_count: 1, exchange_sales: 72.97, receipts: 1,
	sales_per_receipt: 72.97, items_per_receipt: 1, sales_per_item: 72.97,
	credit_issued: 72.97, credit_redeemed: 72.97, same_shift_exchange_total: 72.97, left_as_store_credit: 0,
	takings: 72.97, refunds: 0, loyalty: 0, write_off: 0, rounding: 0, unpaid: 0, other: 0,
};

const summaryOf = (z: Record<string, any>, extra: Record<string, any> = {}) => {
	(globalThis as any).__ = formatters.__;
	return useClosingSummary(
		ref({ company_currency: "OMR", z_summary: z, sales_summary: { average_invoice_value: z.sales_per_receipt ?? 0, sale_invoices_count: z.sale_count }, ...extra }),
		ref(null),
		ref(null),
		formatters,
	);
};

describe("overview: Takings and the shared figures", () => {
	it("Takings rows are the Z Report bridge, with the extra lines only when not zero", () => {
		const s = summaryOf(EXCHANGE);
		expect(s.takingsRows.value.map((r: any) => [r.label, r.amount])).toEqual([
			["Net Sales", 72.97],
			["+ Credit Issued", 72.97],
			["- Credit Redeemed", 72.97],
		]);
		expect(s.takingsTotal.value).toBe(72.97);
		expect(s.leftAsStoreCredit.value).toBe(0);
		const withUnpaid = summaryOf({ ...EXCHANGE, unpaid: 40, takings: 32.97 });
		expect(withUnpaid.takingsRows.value.at(-1)).toEqual({ key: "unpaid", label: "- Unpaid", amount: 40 });
	});

	it("cards: exchanges under Gross Sales, Average Ticket = Sales Figure/Receipt, earlier returns under Returns", () => {
		const s = summaryOf(EXCHANGE);
		const card = (key: string) => [...s.primaryInsights.value, ...s.secondaryInsights.value].find((c: any) => c.key === key);
		expect(card("gross-sales").caption).toBe("Before returns · of which exchanges (1): 72.97");
		expect(card("average-ticket").value).toBe("72.97 OMR");
		expect(card("average-ticket").caption).toBe("Net Sales over: 1 receipts + 1 exch.");
		const earlier = summaryOf({ ...EXCHANGE, net_sales: -139.3, receipts: 0, exchange_count: 0, sales_per_receipt: null, returns_earlier: 139.3 }, { returns: { count: 1, company_currency_total: 139.3 } });
		const c2 = (key: string) => [...earlier.primaryInsights.value, ...earlier.secondaryInsights.value].find((c: any) => c.key === key);
		expect(c2("average-ticket").value).toBe("-");
		expect(c2("returns").caption).toBe("Return count: 1 · of earlier sales: 139.3");
	});

	it("the overview response keeps z_summary, with 'nothing to divide by' as null", async () => {
		(globalThis as any).frappe = {
			call: () => Promise.resolve({ message: { company_currency: "OMR", z_summary: { ...EXCHANGE, sales_per_item: null } } }),
		};
		const { overview, fetchOverview } = useClosingShift({});
		fetchOverview("POSA-OS-1", "OMR");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(overview.value.z_summary.takings).toBe(72.97);
		expect(overview.value.z_summary.sales_per_item).toBeNull();
		expect(overview.value.z_summary.exchange_count).toBe(1);
	});

	it("the closing dialog passes the Takings figures to the overview", () => {
		for (const prop of [':takings-rows="takingsRows"', ':takings-total="takingsTotal"', ':left-as-store-credit="leftAsStoreCredit"']) {
			expect(closingDialogSource).toContain(prop);
		}
	});
});

describe("ShiftOverview Takings section", () => {
	const baseProps = {
		loading: false, primaryInsights: [], secondaryInsights: [], multiCurrencyTotals: [], creditInvoicesByCurrency: [],
		returnsByCurrency: [], changeReturnedRows: [], cashExpectedByCurrency: [], cashMovementSummary: { count: 0, company_currency_total: 0, by_currency: [], by_type: [] },
		loyaltyRedemptionSummary: {}, loyaltyRedemptionByCurrency: [], customerCreditRedeemedSummary: {}, customerCreditRedeemedByCurrency: [],
		customerCreditIssuedSummary: {}, customerCreditIssuedByCurrency: [], paymentsByMode: [], overviewCompanyCurrency: "OMR",
		formatCurrencyWithSymbol: (value: number, currency: string) => `${value} ${currency}`, shouldShowCompanyEquivalent: () => false,
		showExchangeRates: () => false, formatExchangeRates: () => "", isCashMode: () => true, overpaymentDeductionForCurrency: () => 0,
		takingsRows: [{ key: "net", label: "Net Sales", amount: 0 }, { key: "issued", label: "+ Credit Issued", amount: 72.97 }, { key: "redeemed", label: "- Credit Redeemed", amount: 0 }],
		takingsTotal: 72.97,
		leftAsStoreCredit: 72.97,
	};
	const mountOverview = (hideExpectedAmounts: boolean) =>
		mount(ShiftOverview, {
			props: { ...baseProps, hideExpectedAmounts },
			global: { stubs: { "v-icon": true, "v-progress-linear": true, "v-progress-circular": true, "v-skeleton-loader": true } },
		});

	it("shows the bridge, the takings and the store credit left", () => {
		const section = mountOverview(false).find('[data-test="takings-bridge"]');
		expect(section.find('[data-test="takings-issued"]').text()).toContain("72.97 OMR");
		expect(section.find('[data-test="takings-total"]').text()).toContain("= Takings");
		expect(section.find('[data-test="takings-total"]').text()).toContain("72.97 OMR");
		expect(section.find('[data-test="left-as-store-credit"]').text()).toContain("72.97 OMR");
	});

	it("is hidden on a blind count, as it equals the payment totals", () => {
		expect(mountOverview(true).find('[data-test="takings-bridge"]').exists()).toBe(false);
	});
});
