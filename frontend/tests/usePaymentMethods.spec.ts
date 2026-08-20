import { computed, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePaymentMethods } from "../src/posapp/composables/pos/payments/usePaymentMethods";

const getSmartTenderSuggestionsMock = vi.fn();

vi.mock("../src/utils/smartTender", () => ({
	getSmartTenderSuggestions: (...args: any[]) =>
		getSmartTenderSuggestionsMock(...args),
}));

describe("usePaymentMethods", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("discovers M-Pesa modes within the active POS Profile scope", () => {
		const call = vi.fn();
		vi.stubGlobal("frappe", { call });
		const posProfile = ref({ name: "Main POS", company: "Test Company" });
		const { get_mpesa_modes } = usePaymentMethods({
			invoiceDoc: ref({ payments: [] }),
			posProfile,
			diffPayment: computed(() => 0),
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		get_mpesa_modes();

		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				args: {
					company: "Test Company",
					pos_profile: "Main POS",
				},
			}),
		);
	});

	it("sets the selected payment method to the post-credit outstanding amount", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 250,
					base_amount: 250,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
					base_amount: 0,
				},
			],
		});

		const { set_full_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_full_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[0].amount).toBe(0);
		expect(invoiceDoc.value.payments[1].amount).toBe(250);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(250);
	});

	it("fills only the remaining outstanding amount after redeemed credit and other payments", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 100,
					base_amount: 100,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
					base_amount: 0,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 150),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[1].amount).toBe(150);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(150);
	});

	it("fills base payment amount with the invoice conversion rate", () => {
		const invoiceDoc = ref<any>({
			currency: "USD",
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 280,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 0,
					base_amount: 0,
					default: 1,
				},
			],
		});

		const { set_full_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ currency: "PKR" }),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 100,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_full_amount(invoiceDoc.value.payments[0]);

		expect(invoiceDoc.value.payments[0].amount).toBe(100);
		expect(invoiceDoc.value.payments[0].base_amount).toBe(28000);
	});

	it("does not set a negative remaining amount on regular sale overpayments", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 120,
			grand_total: 120,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 0,
					base_amount: 0,
					default: 1,
				},
				{
					mode_of_payment: "Online Transfer",
					type: "Bank",
					amount: 150,
					base_amount: 150,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => -30),
			getNetInvoiceAmount: () => 120,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[0], false);

		expect(invoiceDoc.value.payments[0].amount).toBe(0);
		expect(invoiceDoc.value.payments[0].base_amount).toBe(0);
		expect(invoiceDoc.value.payments[1].amount).toBe(150);
	});

	it("does not overwrite a payment box that already has a manually-entered amount", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 50,
					base_amount: 50,
					default: 1,
				},
				{
					mode_of_payment: "Visa",
					type: "Bank",
					amount: 30,
					base_amount: 30,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 20),
			getNetInvoiceAmount: () => 100,
			currencyPrecision: ref(2),
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		// Refocusing the Cash box, which the cashier already set to 50, must
		// leave it untouched rather than recomputing it to the remainder (70).
		set_rest_amount(invoiceDoc.value.payments[0]);

		expect(invoiceDoc.value.payments[0].amount).toBe(50);
		expect(invoiceDoc.value.payments[0].base_amount).toBe(50);
	});

	it("still auto-fills a genuinely empty box on focus even when currencyPrecision is provided", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 50,
					base_amount: 50,
					default: 1,
				},
				{
					mode_of_payment: "Visa",
					type: "Bank",
					amount: 0,
					base_amount: 0,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 50),
			getNetInvoiceAmount: () => 100,
			currencyPrecision: ref(2),
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[1]);

		expect(invoiceDoc.value.payments[1].amount).toBe(50);
	});

	it("does not overwrite an already-set negative return refund amount on refocus", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 1,
			is_return: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: -60,
					base_amount: -60,
					default: 1,
				},
				{
					mode_of_payment: "Visa",
					type: "Bank",
					amount: -40,
					base_amount: -40,
				},
			],
		});

		const { set_rest_amount } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => -100,
			currencyPrecision: ref(2),
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		set_rest_amount(invoiceDoc.value.payments[0], true);

		expect(invoiceDoc.value.payments[0].amount).toBe(-60);
	});

	it("auto-balances against the net settlement amount instead of gross totals", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			conversion_rate: 1,
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 150,
					base_amount: 150,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 200,
					base_amount: 200,
				},
			],
		});

		const { autoBalancePayments } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		autoBalancePayments(invoiceDoc.value.payments[0]);

		expect(invoiceDoc.value.payments[1].amount).toBe(100);
		expect(invoiceDoc.value.payments[1].base_amount).toBe(100);
	});

	it("auto-balances larger amounts first by default when no comparator is given", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 1,
			payments: [
				{ mode_of_payment: "Cash", type: "Cash", amount: 150, base_amount: 150, default: 1 },
				{ mode_of_payment: "Visa", type: "Bank", amount: 20, base_amount: 20 },
				{ mode_of_payment: "Card", type: "Bank", amount: 30, base_amount: 30 },
			],
		});

		const { autoBalancePayments } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 100,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		// Editing "Card" leaves a 100 excess (150+20+30 - 100). The default
		// (no comparator) sort reduces the largest other amount first: Cash (150)
		// absorbs the whole excess, Visa is untouched.
		autoBalancePayments(invoiceDoc.value.payments[2]);

		expect(invoiceDoc.value.payments[0].amount).toBe(50);
		expect(invoiceDoc.value.payments[1].amount).toBe(20);
	});

	it("respects a custom sortOthers comparator instead of the amount-descending default", () => {
		const invoiceDoc = ref<any>({
			rounded_total: 100,
			grand_total: 100,
			conversion_rate: 1,
			payments: [
				{ mode_of_payment: "Cash", type: "Cash", amount: 150, base_amount: 150, default: 1 },
				{ mode_of_payment: "Visa", type: "Bank", amount: 20, base_amount: 20 },
				{ mode_of_payment: "Card", type: "Bank", amount: 30, base_amount: 30 },
			],
		});

		const { autoBalancePayments } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 100,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		// Custom comparator: reduce Visa before Cash, overriding the
		// amount-descending default entirely.
		autoBalancePayments(invoiceDoc.value.payments[2], 2, {
			sortOthers: (a, b) =>
				(a.mode_of_payment === "Visa" ? -1 : 1) - (b.mode_of_payment === "Visa" ? -1 : 1),
		});

		expect(invoiceDoc.value.payments[1].amount).toBe(0);
		expect(invoiceDoc.value.payments[0].amount).toBe(70);
	});

	it("rebalances other boxes by recency against the net (credit-adjusted) settlement amount", () => {
		// Simulates the preferred-box-direct-edit scenario: credit was forced
		// first (net settlement = 700 instead of the 1000 grand total), the
		// remaining 700 was split Cash (preferred, 400) / Visa (300), and the
		// cashier then directly retypes Cash up to 500 -- getNetInvoiceAmount
		// still reflects the credit-reduced total, so the excess must be
		// computed against 700, not the 1000 gross.
		const invoiceDoc = ref<any>({
			rounded_total: 1000,
			grand_total: 1000,
			conversion_rate: 1,
			payments: [
				{ mode_of_payment: "Cash", type: "Cash", amount: 500, base_amount: 500, default: 1 },
				{ mode_of_payment: "Visa", type: "Bank", amount: 300, base_amount: 300 },
			],
		});

		const { autoBalancePayments } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 700, // 1000 - 300 customer credit already redeemed
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		// Visa was edited before Cash, so a recency comparator (oldest-edited
		// first) picks Visa to absorb the excess, leaving Cash's just-typed 500
		// untouched -- mirrors rebalanceOtherPaymentsByRecency's sortOthers.
		const editedAt: Record<string, number> = { Visa: 1, Cash: 2 };
		autoBalancePayments(invoiceDoc.value.payments[0], 2, {
			sortOthers: (a, b) => (editedAt[a.mode_of_payment] || 0) - (editedAt[b.mode_of_payment] || 0),
		});

		expect(invoiceDoc.value.payments[0].amount).toBe(500);
		expect(invoiceDoc.value.payments[1].amount).toBe(200);
	});

	it("builds cash denomination suggestions from the net settlement amount", () => {
		getSmartTenderSuggestionsMock.mockReturnValue([200, 500]);

		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			currency: "PKR",
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					amount: 100,
					default: 1,
				},
				{
					mode_of_payment: "Card",
					type: "Bank",
					amount: 0,
				},
			],
		});

		const { getVisibleDenominations } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
		});

		const suggestions = getVisibleDenominations(invoiceDoc.value.payments[1]);

		expect(suggestions).toEqual([200, 500]);
		expect(getSmartTenderSuggestionsMock).toHaveBeenCalledWith(150, "PKR");
	});

	it("caps M-Pesa credit redemption against the net settlement amount", () => {
		const customerCreditDict = ref<any[]>([]);
		const redeemCustomerCredit = ref(false);

		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			payments: [],
		});

		const { set_mpesa_payment } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
			setRedeemCustomerCredit: (value) => {
				redeemCustomerCredit.value = value;
			},
			customerCreditDict,
		});

		set_mpesa_payment({
			name: "ACC-PAY-0001",
			unallocated_amount: 400,
		});

		expect(redeemCustomerCredit.value).toBe(true);
		expect(customerCreditDict.value).toEqual([
			expect.objectContaining({
				credit_origin: "ACC-PAY-0001",
				total_credit: 400,
				credit_to_redeem: 250,
			}),
		]);
	});

	it("resets the customer-credit-redemption-requested policy flags so M-Pesa is never subject to the must-redeem-full-balance rule", () => {
		const customerCreditDict = ref<any[]>([]);
		const customerCreditRedemptionRequested = ref(true);
		const customerCreditBlocked = ref(true);

		const invoiceDoc = ref<any>({
			rounded_total: 500,
			grand_total: 500,
			payments: [],
		});

		const { set_mpesa_payment } = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({}),
			diffPayment: computed(() => 0),
			getNetInvoiceAmount: () => 250,
			stores: {
				toastStore: { show: () => undefined },
				uiStore: { freeze: () => undefined, unfreeze: () => undefined },
			},
			customerCreditDict,
			customerCreditRedemptionRequested,
			customerCreditBlocked,
		});

		// Simulates a genuine balance redemption having already been engaged
		// (both flags true) before the cashier also opens M-Pesa -- M-Pesa
		// must unconditionally win and disengage the policy.
		set_mpesa_payment({
			name: "ACC-PAY-0001",
			unallocated_amount: 400,
		});

		expect(customerCreditRedemptionRequested.value).toBe(false);
		expect(customerCreditBlocked.value).toBe(false);
	});
});
