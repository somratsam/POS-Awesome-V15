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
	// TOTAL block (sales_breakdown.payment_total_lines).
	credit_notes_issued: 72.97, money_taken: 72.97, total: 72.97,
	total_lines: { loyalty: 0, write_off: 0, rounding: 0, unpaid: 0, other: 0 },
};
const NORMAL = {
	...EXCHANGE, gross_sales: 100, returns: 0, returns_this_shift: 0, net_sales: 100, credit_issued: 0, credit_redeemed: 0,
	same_shift_exchange_total: 0, credit_notes_issued: 0, money_taken: 100, total: 100, takings: 100,
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

describe("overview: the TOTAL block and the shared figures", () => {
	it("exchange: credit notes issued with a minus, used with a plus; TOTAL = Net Sales", () => {
		const s = summaryOf(EXCHANGE);
		expect(s.takingsRows.value.map((r: any) => [r.label, r.amount, r.sign])).toEqual([
			["Credit notes issued", -72.97, "-"],
			["Credit notes used", 72.97, "+"],
		]);
		expect(s.totalAmount.value).toBe(72.97);
		expect(s.totalAmount.value).toBe(EXCHANGE.net_sales);
		expect(s.takingsTotal.value).toBe(72.97);
		expect(s.leftAsStoreCredit.value).toBe(0);
	});

	it("normal day: no lines above TOTAL; TOTAL and Takings (cash + card) = Net Sales", () => {
		const s = summaryOf(NORMAL);
		expect(s.takingsRows.value).toEqual([]);
		expect(s.totalAmount.value).toBe(100);
		expect(s.takingsTotal.value).toBe(100);
	});

	it("issue day and redeem day: one credit line each, the payment lines plus it = TOTAL", () => {
		const issue = summaryOf({ ...NORMAL, net_sales: 366.607, total: 366.607, credit_issued: 64.44, credit_notes_issued: 64.44, money_taken: 431.047 });
		expect(issue.takingsRows.value.map((r: any) => [r.key, r.amount])).toEqual([["issued", -64.44]]);
		expect(issue.takingsTotal.value + issue.takingsRows.value[0].amount).toBeCloseTo(issue.totalAmount.value, 6);
		const redeem = summaryOf({ ...NORMAL, net_sales: 510.651, total: 510.651, credit_redeemed: 64.44, money_taken: 446.211 });
		expect(redeem.takingsRows.value.map((r: any) => [r.key, r.amount])).toEqual([["redeemed", 64.44]]);
		expect(redeem.takingsTotal.value + redeem.takingsRows.value[0].amount).toBeCloseTo(redeem.totalAmount.value, 6);
	});

	it("the other lines only when not zero, with their own sign (both directions)", () => {
		const s = summaryOf({ ...NORMAL, total_lines: { loyalty: 0, write_off: 0, rounding: -0.004, unpaid: 40, other: 0 } });
		expect(s.takingsRows.value).toEqual([
			{ key: "rounding", label: "Rounding", amount: -0.004, sign: "-" },
			{ key: "unpaid", label: "Unpaid", amount: 40, sign: "+" },
		]);
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
		expect(c2("returns").caption).toBe("Credit notes: 1 · of earlier sales: 139.3");
	});

	it("the overview response keeps z_summary, with 'nothing to divide by' as null", async () => {
		(globalThis as any).frappe = {
			call: () => Promise.resolve({ message: { company_currency: "OMR", z_summary: { ...EXCHANGE, sales_per_item: null } } }),
		};
		const { overview, fetchOverview } = useClosingShift({});
		fetchOverview("POSA-OS-1", "OMR");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(overview.value.z_summary.takings).toBe(72.97);
		expect(overview.value.z_summary.money_taken).toBe(72.97);
		expect(overview.value.z_summary.sales_per_item).toBeNull();
		expect(overview.value.z_summary.exchange_count).toBe(1);
	});

	it("the closing dialog passes the TOTAL block to the overview", () => {
		for (const prop of [':takings-rows="takingsRows"', ':total-amount="totalAmount"', ':takings-total="takingsTotal"', ':left-as-store-credit="leftAsStoreCredit"']) {
			expect(closingDialogSource).toContain(prop);
		}
	});
});

describe("ShiftOverview TOTAL block", () => {
	const baseProps = {
		loading: false, primaryInsights: [], secondaryInsights: [], multiCurrencyTotals: [], creditInvoicesByCurrency: [],
		returnsByCurrency: [], changeReturnedRows: [], cashExpectedByCurrency: [], cashMovementSummary: { count: 0, company_currency_total: 0, by_currency: [], by_type: [] },
		loyaltyRedemptionSummary: {}, loyaltyRedemptionByCurrency: [], customerCreditRedeemedSummary: {}, customerCreditRedeemedByCurrency: [],
		customerCreditIssuedSummary: {}, customerCreditIssuedByCurrency: [], paymentsByMode: [], overviewCompanyCurrency: "OMR",
		formatCurrencyWithSymbol: (value: number, currency: string) => `${value} ${currency}`, shouldShowCompanyEquivalent: () => false,
		showExchangeRates: () => false, formatExchangeRates: () => "", isCashMode: () => true, overpaymentDeductionForCurrency: () => 0,
		takingsRows: [{ key: "issued", label: "Credit notes issued", amount: -72.97, sign: "-" }],
		totalAmount: 0,
		takingsTotal: 72.97,
		leftAsStoreCredit: 72.97,
	};
	const mountOverview = (hideExpectedAmounts: boolean) =>
		mount(ShiftOverview, {
			props: { ...baseProps, hideExpectedAmounts },
			global: { stubs: { "v-icon": true, "v-progress-linear": true, "v-progress-circular": true, "v-skeleton-loader": true } },
		});

	it("shows the credit lines with their sign, TOTAL, = Net Sales, Takings (cash + card) and the credit left, in that order", () => {
		const section = mountOverview(false).find('[data-test="takings-bridge"]');
		expect(section.find("h5").text()).toBe("Total");
		expect(section.find("p").text()).toBe("Payments with credit notes add up to Net Sales");
		expect(section.find('[data-test="takings-issued"]').text()).toContain("-72.97 OMR");
		expect(section.find('[data-test="takings-grand-total"]').text()).toContain("TOTAL");
		expect(section.find('[data-test="takings-grand-total"]').text()).toContain("0 OMR");
		expect(section.find('[data-test="takings-grand-total"] .takings-grand-total').exists()).toBe(true);
		expect(section.find('[data-test="takings-equals-net-sales"]').text()).toBe("= Net Sales");
		expect(section.find('[data-test="takings-total"]').text()).toContain("Takings (cash + card)");
		expect(section.find('[data-test="takings-total"]').text()).toContain("72.97 OMR");
		expect(section.find('[data-test="left-as-store-credit"]').text()).toContain("72.97 OMR");
		const order = section.findAll("tr").map((tr) => tr.attributes("data-test"));
		expect(order).toEqual(["takings-issued", "takings-grand-total", "takings-equals-net-sales", "takings-total", "left-as-store-credit"]);
		expect(section.text()).not.toContain("= Takings");
	});

	it("a credit note used prints with a plus", () => {
		const wrapper = mount(ShiftOverview, {
			props: { ...baseProps, hideExpectedAmounts: false, takingsRows: [{ key: "redeemed", label: "Credit notes used", amount: 64.44, sign: "+" }] },
			global: { stubs: { "v-icon": true, "v-progress-linear": true, "v-progress-circular": true, "v-skeleton-loader": true } },
		});
		expect(wrapper.find('[data-test="takings-redeemed"]').text()).toContain("+64.44 OMR");
	});

	it("sits under Payments by Mode of Payment", () => {
		const html = mountOverview(false).html();
		expect(html.indexOf('data-test="payments-by-mode"')).toBeLessThan(html.indexOf('data-test="takings-bridge"'));
	});

	it("is hidden on a blind count, as it equals the payment totals", () => {
		expect(mountOverview(true).find('[data-test="takings-bridge"]').exists()).toBe(false);
	});
});
