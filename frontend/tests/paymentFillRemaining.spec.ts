// @vitest-environment jsdom

import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaymentMethods } from "../src/posapp/composables/pos/payments/usePaymentMethods";
import { usePaymentCalculations } from "../src/posapp/composables/pos/payments/usePaymentCalculations";
import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";
import PaymentSummary from "../src/posapp/components/pos/payments/PaymentSummary.vue";
import PaymentMethods from "../src/posapp/components/pos/payments/PaymentMethods.vue";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import {
	getUncoveredOverpayment,
	subtractAmounts,
	toMinorUnits,
} from "../src/posapp/utils/cashTender";
import {
	hasMeaningfulAmount,
	initializePaymentLinesForDialog,
	resolvePreferredPaymentLine,
} from "../src/posapp/utils/paymentInitialization";

vi.mock("../src/utils/smartTender", () => ({
	getSmartTenderSuggestions: () => [],
}));
vi.mock("../src/offline/index", () => ({
	enqueueInvoiceOutboxEntry: vi.fn(async () => ({})),
	isOffline: vi.fn(() => false),
	persistInvoiceIntentJournal: vi.fn(() => "test-request-id"),
	removeInvoiceOutboxEntry: vi.fn(async () => 1),
	saveOfflineInvoice: vi.fn(),
	updateLocalStock: vi.fn(),
}));
vi.mock("../src/posapp/services/invoiceService", () => ({
	default: { submitInvoice: vi.fn() },
}));
vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: { applyInvoiceConsumption: vi.fn() },
}));

const PRECISION = 3;
// Precision-3 rounding, as Frappe's flt() does on the real screen.
const flt3 = (value: unknown) => Math.round((Number(value) || 0) * 1000) / 1000;
const fmt = (value: number) => Number(value || 0).toFixed(PRECISION);

const line = (mode_of_payment: string, type: string, extra: any = {}) => ({
	mode_of_payment,
	type,
	amount: 0,
	base_amount: 0,
	default: 0,
	...extra,
});
const swanPayments = (defaultMode: string) =>
	[
		line("Cash", "Cash"),
		line("Visa", "Bank"),
		line("Master Card", "Bank"),
		line("Maal", "Bank"),
	].map((p) => ({ ...p, default: p.mode_of_payment === defaultMode ? 1 : 0 }));

// Drives the composables exactly as Payments.vue's handlers do (see the wiring
// tests below): click = handleSetFullAmount, focus = handleSetRestAmount,
// type = handlePaymentAmountChange's mark + rebalance.
const openPaymentScreen = ({
	total,
	payments,
	loyaltyOrCredit = 0,
	giftCard = 0,
	isReturn = 0,
	creditSale = false,
}: {
	total: number;
	payments: any[];
	loyaltyOrCredit?: number;
	giftCard?: number;
	isReturn?: number;
	creditSale?: boolean;
}) => {
	const invoiceDoc = ref<any>({
		rounded_total: total,
		grand_total: total,
		conversion_rate: 1,
		currency: "OMR",
		is_return: isReturn,
		payments,
	});
	const netAmount = subtractAmounts(total, [loyaltyOrCredit], PRECISION);
	const methods = usePaymentMethods({
		invoiceDoc,
		posProfile: ref<any>({ currency: "OMR" }),
		diffPayment: computed(() => 0),
		getNetInvoiceAmount: () => netAmount,
		formatFloat: flt3,
		currencyPrecision: ref(PRECISION),
		stores: {
			toastStore: { show: () => undefined },
			uiStore: { freeze: () => undefined, unfreeze: () => undefined },
		},
	});
	initializePaymentLinesForDialog(invoiceDoc.value, PRECISION, methods.isCashLikePayment);

	const sequence: Record<string, number> = {};
	let counter = 0;
	const mark = (p: any) => {
		counter += 1;
		sequence[p.mode_of_payment] = counter;
	};
	const isCashierEntered = (p: any) => Boolean(sequence[p?.mode_of_payment]);
	const amountDue = () => subtractAmounts(netAmount, [giftCard], PRECISION);
	const canFillRemaining = () => !isReturn && !creditSale;
	const fillOptions = () => ({ amountDue: amountDue(), isCashierEntered });
	const byMode = (mode: string) =>
		invoiceDoc.value.payments.find((p: any) => p.mode_of_payment === mode);

	const screen = {
		invoiceDoc,
		methods,
		sequence,
		amount: (mode: string) => byMode(mode).amount,
		amounts: () =>
			Object.fromEntries(
				invoiceDoc.value.payments.map((p: any) => [p.mode_of_payment, p.amount]),
			),
		click: (mode: string) => {
			const payment = byMode(mode);
			if (!canFillRemaining()) {
				mark(payment);
				methods.set_full_amount(payment, Boolean(isReturn));
				return;
			}
			const filled = methods.fill_remaining_amount(payment, fillOptions());
			mark(payment);
			if (!filled) methods.set_full_amount(payment, false, amountDue());
		},
		focus: (mode: string) => {
			const payment = byMode(mode);
			if (hasMeaningfulAmount(payment, PRECISION)) return;
			if (!canFillRemaining()) {
				methods.set_rest_amount(payment, Boolean(isReturn));
				return;
			}
			if (!methods.fill_remaining_amount(payment, fillOptions())) {
				methods.set_rest_amount(payment, false, amountDue());
			}
			if (hasMeaningfulAmount(payment, PRECISION)) mark(payment);
		},
		type: (mode: string, value: number) => {
			const payment = byMode(mode);
			payment.amount = value;
			payment.base_amount = value;
			mark(payment);
			methods.rebalanceAfterCashierEdit(payment, {
				amountDue: amountDue(),
				preferredPayment: resolvePreferredPaymentLine(
					invoiceDoc.value,
					methods.isCashLikePayment,
				),
				isCashierEntered,
				sortOthers: (a: any, b: any) =>
					(sequence[a?.mode_of_payment] || 0) - (sequence[b?.mode_of_payment] || 0),
			});
		},
		// Payments.vue clearPaymentLines(): every line 0, staff entries forgotten.
		clearAll: () => {
			methods.clear_all_amounts();
			Object.keys(sequence).forEach((key) => delete sequence[key]);
			counter = 0;
		},
		// Payments.vue removePaymentLine(): this line 0 and no longer staff-entered.
		remove: (mode: string) => {
			const payment = byMode(mode);
			payment.amount = 0;
			payment.base_amount = 0;
			delete sequence[mode];
		},
		// The summary's own figures, from the real calculations composable.
		figures: () => {
			const calc = usePaymentCalculations({
				invoiceDoc,
				posProfile: ref<any>({ currency: "OMR" }),
				currencyPrecision: ref(PRECISION),
				loyaltyAmount: ref(loyaltyOrCredit),
				redeemedCustomerCredit: ref(0),
				customerCreditDict: ref([]),
				customerInfo: ref({}),
				giftCardRedemptions: ref(giftCard ? [{ amount: giftCard }] : []),
				formatCurrency: (value: number) => fmt(value),
			});
			const diff = calc.diff_payment.value;
			return {
				paid: calc.total_payments.value,
				diff,
				label: calc.diff_label.value,
				over: getUncoveredOverpayment(
					invoiceDoc.value.payments,
					-diff,
					methods.isCashLikePayment,
					PRECISION,
				),
			};
		},
	};
	return screen;
};

const validateAt3 = (payments: any[], total: number) => {
	const amounts = payments.map((p: any) => p.amount);
	const { validateSubmission } = usePaymentSubmission({
		invoiceDoc: ref({ is_return: 0, items: [], payments, rounded_total: total, grand_total: total }),
		posProfile: ref({ posa_allow_partial_payment: 0 }),
		stockSettings: ref({}),
		invoiceType: ref("Invoice"),
		formatFloat: flt3,
		currencyPrecision: ref(PRECISION),
		stores: { toastStore: { show: vi.fn() } },
		diff_payment: ref(subtractAmounts(total, amounts, PRECISION)) as any,
		paidChange: ref(Math.max(-subtractAmounts(total, amounts, PRECISION), 0)),
		creditChange: ref(0),
		isCashback: ref(true),
		is_credit_sale: ref(false),
	});
	return validateSubmission(true);
};

describe("fill the remaining amount", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string, args?: any[]) =>
			args?.length
				? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""))
				: value,
		);
		vi.stubGlobal("frappe", {
			_: (value: string, args?: any[]) =>
				args?.length
					? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""))
					: value,
			utils: { play_sound: vi.fn() },
		});
		(window as any).frappe = (globalThis as any).frappe;
	});

	describe("whole-baisa arithmetic", () => {
		it("is exact where plain floating point is not", () => {
			expect(139.3 - 80).not.toBe(59.3);
			expect(subtractAmounts(139.3, [80], 3)).toBe(59.3);
			expect(subtractAmounts(12.005, [12], 3)).toBe(0.005);
			expect(subtractAmounts(0.3, [0.1, 0.2], 3)).toBe(0);
			expect(subtractAmounts(0, [-0.1, -0.2, -0.3], 3)).toBe(0.6);
			expect(subtractAmounts(87.65, [50.25, 20.125], 3)).toBe(17.275);
		});

		it("converts to whole minor units", () => {
			expect(toMinorUnits(139.3, 3)).toBe(139300);
			expect(toMinorUnits(12.005, 3)).toBe(12005);
			expect(toMinorUnits(87.65, 3)).toBe(87650);
		});
	});

	describe("139.300: click Visa, type 80, click Maal, then click Cash changes nothing", () => {
		it.each(["Cash", "Visa", "Master Card"])("Default %s", (defaultMode) => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments(defaultMode) });
			screen.click("Visa");
			expect(screen.amount("Visa")).toBe(139.3);
			screen.type("Visa", 80);
			screen.click("Maal");

			const afterMaal = { Cash: 0, Visa: 80, "Master Card": 0, Maal: 59.3 };
			expect(screen.amounts()).toEqual(afterMaal);

			screen.click("Cash");
			expect(screen.amounts()).toEqual(afterMaal);
			const figures = screen.figures();
			expect(figures.diff).toBe(0);
			expect(figures.over).toBe(0);
		});
	});

	describe("stricter overpayment guard: cash handed back in full is blocked", () => {
		it("Cash 139.300 on top of cards that already cover 139.300 is blocked, over by 139.300", async () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Cash") });
			screen.click("Visa");
			screen.type("Visa", 80);
			screen.click("Maal");
			screen.type("Cash", 139.3);

			expect(screen.amounts()).toEqual({ Cash: 139.3, Visa: 80, "Master Card": 0, Maal: 59.3 });
			expect(screen.figures().over).toBe(139.3);
			await expect(validateAt3(screen.invoiceDoc.value.payments, 139.3)).rejects.toThrow(
				"Over by 139.3: cash would be handed back in full. Reduce a card amount or remove the cash.",
			);
		});

		it("Visa 80 + Maal 59.300 + Cash 20 on 139.300 is blocked, over by 20", async () => {
			const payments = [
				line("Cash", "Cash", { amount: 20 }),
				line("Visa", "Bank", { amount: 80 }),
				line("Maal", "Bank", { amount: 59.3 }),
			];
			expect(getUncoveredOverpayment(payments, 20, (p: any) => p.type === "Cash", PRECISION)).toBe(20);
			await expect(validateAt3(payments, 139.3)).rejects.toThrow(
				/^Over by 20: cash would be handed back in full/,
			);
		});

		it("Cash 120 alone on 100 is allowed with Change 20", async () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.type("Cash", 120);

			const figures = screen.figures();
			expect(figures.label).toBe("Change (OMR)");
			expect(figures.diff).toBe(-20);
			expect(figures.over).toBe(0);
			await expect(validateAt3(screen.invoiceDoc.value.payments, 100)).resolves.toBe(true);
		});

		it("Cash 150 + Visa 50 on 100 is allowed with Change 100", async () => {
			const payments = [line("Cash", "Cash", { amount: 150 }), line("Visa", "Bank", { amount: 50 })];
			expect(getUncoveredOverpayment(payments, 100, (p: any) => p.type === "Cash", PRECISION)).toBe(0);
			expect(subtractAmounts(0, [-150, -50, 100], PRECISION)).toBe(100);
			await expect(validateAt3(payments, 100)).resolves.toBe(true);
		});

		it("cards over the total with less cash than the excess keeps the card message", async () => {
			const payments = [line("Cash", "Cash", { amount: 5 }), line("Visa", "Bank", { amount: 150 })];
			await expect(validateAt3(payments, 139.3)).rejects.toThrow(
				/^Over by 10\.7: card payments exceed the amount due/,
			);
		});
	});

	describe("Clear payments", () => {
		const filled = (defaultMode = "Cash", extra: any = {}) => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments(defaultMode), ...extra });
			screen.click("Visa");
			screen.type("Visa", 80);
			screen.click("Maal");
			return screen;
		};

		it("resets every line to 0 and shows the full amount remaining; clicking Cash then fills 139.300", () => {
			const screen = filled();
			screen.clearAll();

			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 0, "Master Card": 0, Maal: 0 });
			expect(screen.sequence).toEqual({});
			expect(screen.figures().diff).toBe(139.3);
			expect(screen.figures().label).toBe("Remaining (OMR)");

			screen.click("Cash");
			expect(screen.amounts()).toEqual({ Cash: 139.3, Visa: 0, "Master Card": 0, Maal: 0 });
			expect(screen.figures().diff).toBe(0);
		});

		it("forgets staff entries: the next click fills the full amount, and typing stays card-safe", () => {
			const screen = filled("Visa");
			screen.clearAll();

			screen.click("Maal");
			expect(screen.amount("Maal")).toBe(139.3);
			screen.type("Master Card", 20);
			expect(screen.amount("Maal")).toBe(139.3);
			expect(screen.figures().over).toBe(20);
		});

		it("leaves a gift card redemption in place: clicking Cash fills 129.300", () => {
			const screen = filled("Cash", { giftCard: 10 });
			screen.clearAll();
			screen.click("Cash");

			expect(screen.amount("Cash")).toBe(129.3);
			expect(screen.figures().diff).toBe(0);
		});

		it("leaves loyalty or customer credit in place: clicking Cash fills 129.300", () => {
			const screen = filled("Cash", { loyaltyOrCredit: 10 });
			screen.clearAll();
			screen.click("Cash");

			expect(screen.amount("Cash")).toBe(129.3);
		});
	});

	describe("remove (x) on one line", () => {
		it("sets just that line to 0 and forgets it; Remaining shows what it held", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.click("Maal");
			screen.remove("Maal");

			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 80, "Master Card": 0, Maal: 0 });
			expect(screen.sequence.Maal).toBeUndefined();
			expect(screen.sequence.Visa).toBeGreaterThan(0);
			expect(screen.figures().diff).toBe(59.3);

			screen.click("Cash");
			expect(screen.amount("Cash")).toBe(59.3);
		});

		it("removing a staff-typed card lets the next click take its share", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.click("Maal");
			screen.remove("Visa");
			screen.click("Cash");

			expect(screen.amounts()).toEqual({ Cash: 80, Visa: 0, "Master Card": 0, Maal: 59.3 });
		});

		it("switching to all cash: remove each card, then click Cash", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Visa") });
			screen.type("Visa", 80);
			screen.click("Maal");
			screen.remove("Visa");
			screen.remove("Maal");
			screen.click("Cash");

			expect(screen.amounts()).toEqual({ Cash: 139.3, Visa: 0, "Master Card": 0, Maal: 0 });
		});

		it("does not touch a gift card redemption", () => {
			const screen = openPaymentScreen({ total: 139.3, giftCard: 10, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.click("Maal");
			expect(screen.amount("Maal")).toBe(49.3);
			screen.remove("Maal");

			expect(screen.figures().diff).toBe(49.3);
		});
	});

	describe("PaymentMethods: the x button", () => {
		const BtnStub = defineComponent({
			emits: ["click"],
			setup(_, { slots, emit, attrs }) {
				return () =>
					h(
						"button",
						{
							type: "button",
							"data-test": attrs["data-test"],
							"aria-label": attrs["aria-label"],
							onClick: () => emit("click"),
						},
						slots.default?.(),
					);
			},
		});
		const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
		const mountMethods = (props: Record<string, any>) =>
			mount(PaymentMethods, {
				props: {
					payments: [
						{ name: "P1", mode_of_payment: "Cash", type: "Cash", amount: 0, default: 1 },
						{ name: "P2", mode_of_payment: "Visa", type: "Bank", amount: 80, default: 0 },
					],
					currency: "OMR",
					isReturn: false,
					requestPaymentField: false,
					currencySymbol: () => "OMR ",
					formatCurrency: (value: number) => fmt(value),
					isNumber: () => true,
					getVisibleDenominations: () => [],
					isCashLikePayment: (p: any) => p.type === "Cash",
					isMpesaC2bPayment: () => false,
					...props,
				},
				global: {
					components: {
						VRow: Box,
						VCol: Box,
						VBtn: BtnStub,
						VTextField: defineComponent({ setup: () => () => h("input") }),
					},
				},
			});

		beforeEach(() => {
			(window as any).__ = (value: string, args?: any[]) =>
				args?.length
					? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""))
					: value;
		});

		it("shows only on lines holding an amount, and emits remove-payment for that line", async () => {
			const onRemovePayment = vi.fn();
			const wrapper = mountMethods({ showClearControls: true, onRemovePayment });

			expect(wrapper.find('[data-test="payment-remove-Cash"]').exists()).toBe(false);
			const remove = wrapper.find('[data-test="payment-remove-Visa"]');
			expect(remove.exists()).toBe(true);
			expect(remove.attributes("aria-label")).toBe("Remove Visa amount");

			await remove.trigger("click");
			expect(onRemovePayment).toHaveBeenCalledTimes(1);
			expect(onRemovePayment.mock.calls[0][0].mode_of_payment).toBe("Visa");
		});

		it("is hidden when the parent doesn't enable it (returns, credit sales)", () => {
			const wrapper = mountMethods({ showClearControls: false });
			expect(wrapper.find('[data-test="payment-remove-Visa"]').exists()).toBe(false);
		});
	});

	describe("clicking a method (too little paid: fills exactly what's owed)", () => {
		it.each(["Cash", "Visa"])(
			"139.300, Default %s: Visa typed 80, click Maal fills 59.300",
			(defaultMode) => {
				const screen = openPaymentScreen({ total: 139.3, payments: swanPayments(defaultMode) });
				screen.type("Visa", 80);
				screen.click("Maal");

				expect(screen.amount("Maal")).toBe(59.3);
				expect(fmt(screen.amount("Maal"))).toBe("59.300");
				expect(screen.amounts()).toEqual({ Cash: 0, Visa: 80, "Master Card": 0, Maal: 59.3 });
				expect(screen.figures().diff).toBe(0);
			},
		);

		it("87.650: Visa 50.250 + Mastercard 20.125, click Maal fills 17.275", () => {
			const screen = openPaymentScreen({ total: 87.65, payments: swanPayments("Cash") });
			screen.type("Visa", 50.25);
			screen.type("Master Card", 20.125);
			screen.click("Maal");

			expect(screen.amount("Maal")).toBe(17.275);
			expect(screen.amount("Visa")).toBe(50.25);
			expect(screen.amount("Master Card")).toBe(20.125);
			expect(screen.amount("Cash")).toBe(0);
		});

		it("12.005: Visa 12, click Maal fills 0.005", () => {
			const screen = openPaymentScreen({ total: 12.005, payments: swanPayments("Cash") });
			screen.type("Visa", 12);
			screen.click("Maal");

			expect(screen.amount("Maal")).toBe(0.005);
			expect(fmt(screen.amount("Maal"))).toBe("0.005");
		});

		it("clears the screen's own Cash top-up before filling (Visa Default, Visa typed 80)", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });
			screen.type("Visa", 80);
			expect(screen.amount("Cash")).toBe(20);

			screen.click("Maal");
			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 80, "Master Card": 0, Maal: 20 });
		});

		it("clears the Default line's untouched prefill before filling (Cash Default)", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			expect(screen.amount("Cash")).toBe(20);

			screen.click("Maal");
			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 80, "Master Card": 0, Maal: 20 });
		});

		it("keeps a staff-typed Cash amount and fills only the rest", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });
			screen.type("Cash", 30);
			screen.click("Visa");

			expect(screen.amounts()).toEqual({ Cash: 30, Visa: 70, "Master Card": 0, Maal: 0 });
		});

		it("fills the full amount as today when no other line holds a staff-entered amount", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Cash") });
			expect(screen.amount("Cash")).toBe(139.3);

			screen.click("Visa");
			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 139.3, "Master Card": 0, Maal: 0 });
		});

		it("never changes a card amount staff typed or clicked", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.click("Visa");
			screen.type("Visa", 60);
			screen.type("Master Card", 25);
			screen.click("Maal");

			expect(screen.amount("Visa")).toBe(60);
			expect(screen.amount("Master Card")).toBe(25);
			expect(screen.amount("Maal")).toBe(15);
		});
	});

	describe("clicking a method (too much paid: nothing changes)", () => {
		it("139.300, Visa typed 150: click Maal leaves everything, over by 10.700", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Cash") });
			screen.type("Visa", 150);
			screen.click("Maal");

			expect(screen.amount("Visa")).toBe(150);
			expect(screen.amount("Maal")).toBe(0);
			expect(screen.figures().over).toBe(10.7);
		});

		it("Cash typed 120 on 100: click Visa leaves Visa at 0 and the change at 20.000", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.type("Cash", 120);
			screen.click("Visa");

			expect(screen.amounts()).toEqual({ Cash: 120, Visa: 0, "Master Card": 0, Maal: 0 });
			const figures = screen.figures();
			expect(figures.diff).toBe(-20);
			expect(figures.label).toBe("Change (OMR)");
			expect(figures.over).toBe(0);
		});

		it("0.300 already covered by Visa 0.100 + Mastercard 0.200: click Maal fills nothing", () => {
			const screen = openPaymentScreen({ total: 0.3, payments: swanPayments("Cash") });
			screen.type("Visa", 0.1);
			screen.type("Master Card", 0.2);
			screen.click("Maal");

			expect(screen.amount("Maal")).toBe(0);
			const figures = screen.figures();
			expect(figures.diff).toBe(0);
			expect(figures.label).toBe("Remaining (OMR)");
		});
	});

	describe("focusing an empty Amount box follows the same rule", () => {
		it("139.300: Visa typed 80, focus Maal fills 59.300 and counts as staff-entered", () => {
			const screen = openPaymentScreen({ total: 139.3, payments: swanPayments("Visa") });
			screen.type("Visa", 80);
			screen.focus("Maal");

			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 80, "Master Card": 0, Maal: 59.3 });
			expect(screen.sequence.Maal).toBeGreaterThan(0);
		});

		it("does not overwrite a box that already holds an amount", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.type("Maal", 5);
			screen.focus("Maal");

			expect(screen.amount("Maal")).toBe(5);
		});

		it("leaves the box at 0 when nothing is owed", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.type("Visa", 100);
			screen.focus("Maal");

			expect(screen.amount("Maal")).toBe(0);
			expect(screen.sequence.Maal).toBeUndefined();
		});

		it("with no staff-entered line, keeps today's fill (the untouched prefill already covers it)", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });
			screen.focus("Visa");

			expect(screen.amounts()).toEqual({ Cash: 100, Visa: 0, "Master Card": 0, Maal: 0 });
		});
	});

	describe("loyalty, customer credit and gift cards count toward what is due", () => {
		it("gift card 10 on 100: clicking Visa fills 90, not 100", () => {
			const screen = openPaymentScreen({ total: 100, giftCard: 10, payments: swanPayments("Cash") });
			screen.click("Visa");

			expect(screen.amount("Visa")).toBe(90);
			expect(screen.figures().diff).toBe(0);
		});

		it("loyalty or customer credit 10 on 100: clicking Visa fills 90", () => {
			const screen = openPaymentScreen({ total: 100, loyaltyOrCredit: 10, payments: swanPayments("Cash") });
			screen.click("Visa");

			expect(screen.amount("Visa")).toBe(90);
		});

		it("gift card 10 on 139.300: Visa 80, click Maal fills 49.300", () => {
			const screen = openPaymentScreen({ total: 139.3, giftCard: 10, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.click("Maal");

			expect(screen.amount("Maal")).toBe(49.3);
		});
	});

	describe("returns and credit sales keep the plain full-amount fill", () => {
		it("a return click still fills the full refund and zeroes other lines", () => {
			const payments = swanPayments("Cash").map((p) =>
				p.mode_of_payment === "Visa" ? { ...p, amount: -20 } : p,
			);
			const screen = openPaymentScreen({ total: -100, isReturn: 1, payments });
			screen.click("Cash");

			expect(screen.amounts()).toEqual({ Cash: -100, Visa: 0, "Master Card": 0, Maal: 0 });
		});

		it("a credit-sale click still fills the full amount", () => {
			const screen = openPaymentScreen({ total: 100, creditSale: true, payments: swanPayments("Cash") });
			screen.type("Visa", 80);
			screen.click("Maal");

			expect(screen.amounts()).toEqual({ Cash: 0, Visa: 0, "Master Card": 0, Maal: 100 });
		});
	});

	describe("the figure next to Paid", () => {
		it.each([
			[139.3, 80, "Remaining (OMR)", 59.3],
			[87.65, 50.25, "Remaining (OMR)", 37.4],
			[12.005, 12, "Remaining (OMR)", 0.005],
		])("total %s with Visa %s shows %s %s", (total, visa, label, remaining) => {
			const screen = openPaymentScreen({ total, payments: swanPayments("Cash") });
			screen.click("Visa");
			screen.type("Visa", visa);
			screen.type("Cash", 0);

			const figures = screen.figures();
			expect(figures.label).toBe(label);
			expect(figures.diff).toBe(remaining);
			expect(fmt(figures.diff)).toBe(remaining.toFixed(3));
		});

		it.each([
			[139.3, 140, -0.7],
			[87.65, 90, -2.35],
			[12.005, 12.01, -0.005],
		])("total %s with Cash %s shows Change %s", (total, cash, diff) => {
			const screen = openPaymentScreen({ total, payments: swanPayments("Cash") });
			screen.type("Cash", cash);

			const figures = screen.figures();
			expect(figures.label).toBe("Change (OMR)");
			expect(figures.diff).toBe(diff);
			expect(figures.over).toBe(0);
		});

		it.each([
			[139.3, 150, 10.7],
			[87.65, 90, 2.35],
			[12.005, 12.01, 0.005],
		])("total %s with Visa %s is over by %s", (total, visa, over) => {
			const screen = openPaymentScreen({ total, payments: swanPayments("Cash") });
			screen.click("Visa");
			screen.type("Visa", visa);

			expect(screen.figures().over).toBe(over);
		});

		const mountSummary = (props: Record<string, any>) =>
			mount(PaymentSummary, {
				props: {
					invoice_doc: { currency: "OMR", is_return: false },
					total_payments_display: "0.000",
					diff_payment_display: fmt(Math.abs(props.diffPayment)),
					diff_label: props.diffPayment < 0 ? "Change (OMR)" : "Remaining (OMR)",
					change_due: Math.max(-props.diffPayment, 0),
					paid_change: Math.max(-props.diffPayment, 0),
					credit_change: 0,
					paid_change_rules: [],
					currencySymbol: () => "OMR",
					formatCurrency: (value: number) => fmt(value),
					...props,
				},
				global: {
					components: {
						VRow: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
						VCol: defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) }),
						VTextField: defineComponent({
							props: { modelValue: { type: [String, Number], default: "" }, label: { type: String, default: "" } },
							setup: (p) => () => h("div", { "data-label": p.label }, String(p.modelValue ?? "")),
						}),
					},
				},
			});

		it.each([
			[59.3, 0, "remaining", "Remaining (OMR)", "59.300", "error"],
			[0, 0, "settled", "Remaining (OMR)", "0.000", "success"],
			[-0.7, 0, "change", "Change (OMR)", "0.700", undefined],
			[-10.7, 10.7, "over", "Over by (OMR)", "10.700", "error"],
		])(
			"diff %s, uncovered %s renders the %s state",
			(diffPayment, uncoveredOverpayment, state, label, text, baseColor) => {
				const field = mountSummary({ diffPayment, uncoveredOverpayment }).find(
					'[data-test="payment-diff-field"]',
				);
				expect(field.attributes("data-state")).toBe(state);
				expect(field.attributes("data-label")).toBe(label);
				expect(field.text()).toBe(text);
				expect(field.classes()).toContain(`payment-summary-field--${state}`);
				expect(field.attributes("base-color")).toBe(baseColor);
			},
		);
	});

	describe("works with the overpayment guard and partial payment off", () => {
		it("Visa 80 + Maal filled 20 submits with partial payment off", async () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });
			screen.type("Visa", 80);
			screen.click("Maal");

			const payments = screen.invoiceDoc.value.payments;
			const { validateSubmission } = usePaymentSubmission({
				invoiceDoc: ref({ ...screen.invoiceDoc.value, items: [] }),
				posProfile: ref({ posa_allow_partial_payment: 0 }),
				stockSettings: ref({}),
				invoiceType: ref("Invoice"),
				formatFloat: flt3,
				currencyPrecision: ref(PRECISION),
				stores: { toastStore: { show: vi.fn() } },
				diff_payment: ref(subtractAmounts(100, payments.map((p: any) => p.amount), PRECISION)) as any,
				paidChange: ref(0),
				creditChange: ref(0),
				isCashback: ref(true),
				is_credit_sale: ref(false),
			});
			await expect(validateSubmission(true)).resolves.toBe(true);
		});
	});

	describe("Payments.vue wiring", () => {
		const source = paymentsSource;
		const fnBody = (name: string) => {
			const start = source.indexOf(`const ${name} = `);
			expect(start).toBeGreaterThan(-1);
			return source.slice(start, source.indexOf("\n};\n", start));
		};

		it("routes the amount box's focus through handleSetRestAmount", () => {
			expect(source).toContain('@set-rest-amount="handleSetRestAmount"');
		});

		it("clicks fill the remainder first and fall back to the full amount net of gift cards", () => {
			const body = fnBody("handleSetFullAmount");
			expect(body).toContain("fill_remaining_amount(payment, fillRemainingOptions())");
			expect(body).toContain("set_full_amount(payment, isReturn, paymentLinesAmountDue())");
			expect(body).toContain("canFillRemaining(isReturn)");
		});

		it("focus fills the remainder first, falls back to today's fill, and marks a filled box", () => {
			const body = fnBody("handleSetRestAmount");
			expect(body).toContain("fill_remaining_amount(payment, fillRemainingOptions())");
			expect(body).toContain("set_rest_amount(payment, isReturn, paymentLinesAmountDue())");
			expect(body).toContain("markPaymentCashierEntered(payment)");
		});

		it("works out what is due net of gift cards in whole minor units", () => {
			expect(fnBody("paymentLinesAmountDue")).toContain(
				"subtractAmounts(netInvoiceSettlementAmount.value, [giftCardAppliedAmount.value]",
			);
			expect(fnBody("rebalanceOtherPaymentsAfterEdit")).toContain(
				"amountDue: paymentLinesAmountDue()",
			);
		});

		it("shows Clear payments and the x only when the remainder fill applies (sales, not returns or credit sales)", () => {
			expect(fnBody("paymentClearControlsVisible").replace(/\s+/g, " ")).toContain(
				"computed(() => canFillRemaining(false))",
			);
			const at = source.indexOf('data-test="payment-clear-all"');
			expect(at).toBeGreaterThan(-1);
			const header = source.slice(at - 250, at + 100);
			expect(header).toContain('v-if="paymentClearControlsVisible"');
			expect(header).toContain('@click="clearPaymentLines"');
			const tagStart = source.indexOf("<PaymentMethods");
			const methodsTag = source.slice(tagStart, source.indexOf("/>", tagStart));
			expect(methodsTag).toContain(':show-clear-controls="paymentClearControlsVisible"');
			expect(methodsTag).toContain('@remove-payment="removePaymentLine"');
		});

		it("Clear payments zeroes every line and forgets every staff entry", () => {
			const body = fnBody("clearPaymentLines");
			expect(body).toContain("clear_all_amounts();");
			expect(body).toContain("lastEditedPaymentSequence.value = {};");
			expect(body).toContain("paymentEditSequenceCounter.value = 0;");
		});

		it("the x zeroes one line and forgets only that line's staff entry", () => {
			const body = fnBody("removePaymentLine");
			expect(body).toContain("payment.amount = 0;");
			expect(body).toContain("delete lastEditedPaymentSequence.value[payment.mode_of_payment];");
			expect(body).not.toContain("clear_all_amounts");
		});

		it("returns and credit sales skip the remainder fill", () => {
			expect(fnBody("canFillRemaining")).toContain("!invoice_doc.value?.is_return && !is_credit_sale.value");
		});
	});
});
