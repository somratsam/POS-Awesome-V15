// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { useClosingSummary } from "../src/posapp/composables/pos/closing/useClosingSummary";
import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";
import ShiftOverview from "../src/posapp/components/pos/closing/ShiftOverview.vue";

const formatters = {
	formatCurrencyWithSymbol: (value: number, currency: string) => `${Number(value).toFixed(3)} ${currency}`,
	formatCount: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: (currency: string) => currency,
	__: (text: string) => text,
};

// A shift with 20.000 opening cash and 185.600 cash taken: the drawer should
// hold 205.600, the same as the Cash row of Payment Reconciliation.
const overviewWithFloat = () =>
	ref({
		company_currency: "OMR",
		cash_expected: {
			mode_of_payment: "Cash",
			company_currency_total: 205.6,
			opening_amount: 20,
			cash_taken: 185.6,
			by_currency: [{ currency: "OMR", total: 205.6, company_currency_total: 205.6 }],
		},
	});

const cashCard = (insights: any[]) => insights.find((row: any) => row.key === "cash-expected");

describe("Expected Cash card", () => {
	it("shows the drawer figure, with the opening cash and cash taken in the caption", () => {
		const { secondaryInsights } = useClosingSummary(overviewWithFloat(), ref({}), ref(null), formatters);
		const card = cashCard(secondaryInsights.value);
		expect(card.label).toBe("Expected Cash");
		expect(card.value).toBe("205.600 OMR");
		expect(card.caption).toBe("Opening 20.000 OMR + cash taken 185.600 OMR");
	});

	it("notes the cash movement deduction when there were movements", () => {
		const overview = overviewWithFloat();
		(overview.value as any).cash_movements = { count: 1, company_currency_total: 5, by_currency: [], by_type: [] };
		const { secondaryInsights } = useClosingSummary(overview, ref({}), ref(null), formatters);
		expect(cashCard(secondaryInsights.value).caption).toBe(
			"Opening 20.000 OMR + cash taken 185.600 OMR | Cash movement deduction applied",
		);
	});

	it("is hidden on a Hide Expected Amount (blind count) profile", () => {
		const { secondaryInsights, hideExpectedAmounts } = useClosingSummary(
			overviewWithFloat(),
			ref({ hide_expected_amount: 1 }),
			ref(null),
			formatters,
		);
		expect(hideExpectedAmounts.value).toBe(true);
		expect(cashCard(secondaryInsights.value)).toBeUndefined();
		// The other cards stay.
		expect(secondaryInsights.value.find((row: any) => row.key === "same-shift-exchange")).toBeDefined();
	});

	it("is shown when the profile doesn't hide expected amounts", () => {
		const { secondaryInsights, hideExpectedAmounts } = useClosingSummary(
			overviewWithFloat(),
			ref({ hide_expected_amount: 0 }),
			ref(null),
			formatters,
		);
		expect(hideExpectedAmounts.value).toBe(false);
		expect(cashCard(secondaryInsights.value)).toBeDefined();
	});
});

describe("useClosingShift overview normalize", () => {
	it("keeps the opening cash and cash taken from the server", async () => {
		(globalThis as any).frappe = {
			call: () =>
				Promise.resolve({
					message: {
						company_currency: "OMR",
						cash_expected: {
							mode_of_payment: "Cash",
							company_currency_total: 205.6,
							opening_amount: 20,
							cash_taken: 185.6,
							by_currency: [],
						},
					},
				}),
		};
		const { overview, fetchOverview } = useClosingShift({});
		fetchOverview("POSA-OS-26-0000041", "OMR");
		await new Promise((done) => setTimeout(done, 0));
		expect(overview.value.cash_expected.opening_amount).toBe(20);
		expect(overview.value.cash_expected.cash_taken).toBe(185.6);
		expect(overview.value.cash_expected.company_currency_total).toBe(205.6);
	});
});

describe("ShiftOverview on a blind count profile", () => {
	const baseProps = {
		loading: false,
		primaryInsights: [],
		secondaryInsights: [],
		multiCurrencyTotals: [],
		creditInvoicesByCurrency: [],
		returnsByCurrency: [],
		changeReturnedRows: [],
		cashExpectedByCurrency: [{ currency: "OMR", total: 205.6, company_currency_total: 205.6 }],
		cashMovementSummary: { count: 0, company_currency_total: 0, by_currency: [], by_type: [] },
		loyaltyRedemptionSummary: {},
		loyaltyRedemptionByCurrency: [],
		customerCreditRedeemedSummary: {},
		customerCreditRedeemedByCurrency: [],
		customerCreditIssuedSummary: {},
		customerCreditIssuedByCurrency: [],
		paymentsByMode: [{ mode_of_payment: "Cash", currency: "OMR", total: 185.6, company_currency_total: 185.6 }],
		overviewCompanyCurrency: "OMR",
		formatCurrencyWithSymbol: (value: number, currency: string) => `${value} ${currency}`,
		shouldShowCompanyEquivalent: () => false,
		showExchangeRates: () => false,
		formatExchangeRates: () => "",
		isCashMode: () => true,
		overpaymentDeductionForCurrency: () => 0,
	};
	const mountOverview = (hideExpectedAmounts: boolean) =>
		mount(ShiftOverview, {
			props: { ...baseProps, hideExpectedAmounts },
			global: { stubs: { "v-icon": true, "v-progress-linear": true, "v-progress-circular": true, "v-skeleton-loader": true } },
		});

	it("hides the Cash Drawer Snapshot and Payments by Mode", () => {
		const wrapper = mountOverview(true);
		expect(wrapper.find('[data-test="cash-drawer-snapshot"]').exists()).toBe(false);
		expect(wrapper.find('[data-test="payments-by-mode"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("205.6");
		expect(wrapper.text()).not.toContain("185.6");
	});

	it("shows them otherwise", () => {
		const wrapper = mountOverview(false);
		expect(wrapper.find('[data-test="cash-drawer-snapshot"]').text()).toContain("205.6 OMR");
		expect(wrapper.find('[data-test="payments-by-mode"]').text()).toContain("185.6 OMR");
	});
});
