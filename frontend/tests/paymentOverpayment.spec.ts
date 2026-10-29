import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaymentMethods } from "../src/posapp/composables/pos/payments/usePaymentMethods";
import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";
import {
	getUncoveredOverpayment,
	isCashLikePaymentLine,
} from "../src/posapp/utils/cashTender";
import {
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

// The Swan setup: Cash is the only Cash-type mode; Visa, Master Card and
// Maal are all Bank-type.
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

// Drives usePaymentMethods the same way Payments.vue does: the dialog opens
// with the total prefilled on the preferred line; clicking a line's
// full-amount button and typing into a box both mark that box as
// cashier-entered, and typing then re-settles the other lines.
const openPaymentScreen = ({
	total,
	payments,
	netAmount = total,
	giftCardAmount = 0,
}: {
	total: number;
	payments: any[];
	netAmount?: number;
	giftCardAmount?: number;
}) => {
	const posProfile = ref<any>({});
	const invoiceDoc = ref<any>({
		rounded_total: total,
		grand_total: total,
		conversion_rate: 1,
		payments,
	});
	const methods = usePaymentMethods({
		invoiceDoc,
		posProfile,
		diffPayment: computed(() => 0),
		getNetInvoiceAmount: () => netAmount,
		stores: {
			toastStore: { show: () => undefined },
			uiStore: { freeze: () => undefined, unfreeze: () => undefined },
		},
	});

	initializePaymentLinesForDialog(invoiceDoc.value, 2, methods.isCashLikePayment);

	const sequence: Record<string, number> = {};
	let counter = 0;
	const byMode = (mode: string) =>
		invoiceDoc.value.payments.find((p: any) => p.mode_of_payment === mode);
	const mark = (payment: any) => {
		counter += 1;
		sequence[payment.mode_of_payment] = counter;
	};

	const screen = {
		invoiceDoc,
		amount: (mode: string) => byMode(mode).amount,
		clickFull: (mode: string) => {
			const payment = byMode(mode);
			mark(payment);
			methods.set_full_amount(payment);
		},
		type: (mode: string, amount: number) => {
			const payment = byMode(mode);
			payment.amount = amount;
			payment.base_amount = amount;
			mark(payment);
			methods.rebalanceAfterCashierEdit(payment, {
				amountDue: netAmount - giftCardAmount,
				preferredPayment: resolvePreferredPaymentLine(
					invoiceDoc.value,
					methods.isCashLikePayment,
				),
				isCashierEntered: (p: any) => Boolean(sequence[p?.mode_of_payment]),
				sortOthers: (a: any, b: any) =>
					(sequence[a?.mode_of_payment] || 0) -
					(sequence[b?.mode_of_payment] || 0),
			});
		},
		paid: () =>
			invoiceDoc.value.payments.reduce(
				(sum: number, p: any) => sum + Number(p.amount || 0),
				0,
			),
		overBy: () =>
			getUncoveredOverpayment(
				invoiceDoc.value.payments,
				screen.paid() + giftCardAmount - netAmount,
				methods.isCashLikePayment,
				2,
			),
	};
	return screen;
};

const snapshot = (screen: ReturnType<typeof openPaymentScreen>) =>
	Object.fromEntries(
		screen.invoiceDoc.value.payments.map((p: any) => [p.mode_of_payment, p.amount]),
	);

const makeValidator = (payments: any[], total: number, profile: any = {}) => {
	const invoiceDoc = ref<any>({
		is_return: 0,
		items: [],
		payments,
		rounded_total: total,
		grand_total: total,
	});
	const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
	const { validateSubmission } = usePaymentSubmission({
		invoiceDoc,
		posProfile: ref({ posa_allow_partial_payment: 1, ...profile }),
		stockSettings: ref({}),
		invoiceType: ref("Invoice"),
		formatFloat: (value) => Math.round(Number(value || 0) * 100) / 100,
		stores: { toastStore: { show: vi.fn() } },
		diff_payment: ref(total - paid) as any,
		paidChange: ref(Math.max(paid - total, 0)),
		creditChange: ref(0),
		isCashback: ref(true),
		is_credit_sale: ref(false),
	});
	return () => validateSubmission(true);
};

describe("payment overpayment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_match, index) =>
				String(args[Number(index)] ?? ""),
			);
		});
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() } });
	});

	describe("what counts as a cash line", () => {
		it("treats Mode of Payment Type = Cash as cash and Bank-type modes as non-cash", () => {
			expect(isCashLikePaymentLine(line("Cash", "Cash"))).toBe(true);
			expect(isCashLikePaymentLine(line("Visa", "Bank"))).toBe(false);
			expect(isCashLikePaymentLine(line("Master Card", "Bank"))).toBe(false);
			expect(isCashLikePaymentLine(line("Maal", "Bank"))).toBe(false);
		});

		it("also treats the profile's configured cash mode, or a name containing 'cash', as cash", () => {
			expect(
				isCashLikePaymentLine(line("Drawer", "Bank"), {
					posa_cash_mode_of_payment: "Drawer",
				}),
			).toBe(true);
			expect(isCashLikePaymentLine(line("Petty Cash", "Bank"))).toBe(true);
		});
	});

	describe("getUncoveredOverpayment", () => {
		const isCash = (p: any) => isCashLikePaymentLine(p);

		it("is zero when the excess is no larger than the cash taken", () => {
			const payments = [line("Cash", "Cash", { amount: 10 }), line("Visa", "Bank", { amount: 100 })];
			expect(getUncoveredOverpayment(payments, 10, isCash)).toBe(0);
		});

		it("is the part of the excess beyond the cash taken", () => {
			const payments = [line("Cash", "Cash", { amount: 10 }), line("Visa", "Bank", { amount: 105 })];
			expect(getUncoveredOverpayment(payments, 15, isCash)).toBe(5);
		});

		it("is the whole excess when only cards were paid", () => {
			const payments = [line("Visa", "Bank", { amount: 100 }), line("Master Card", "Bank", { amount: 20 })];
			expect(getUncoveredOverpayment(payments, 20, isCash)).toBe(20);
		});

		it("is zero for an exact or short payment", () => {
			const payments = [line("Visa", "Bank", { amount: 80 })];
			expect(getUncoveredOverpayment(payments, 0, isCash)).toBe(0);
			expect(getUncoveredOverpayment(payments, -20, isCash)).toBe(0);
		});
	});

	describe("rebalancing after a cashier edit never changes a card the cashier entered", () => {
		it("Visa Default, Maal clicked for the full 100, then Mastercard 10: nothing changes and it is over by 10", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });
			expect(screen.amount("Visa")).toBe(100);

			screen.clickFull("Maal");
			screen.type("Master Card", 10);

			expect(snapshot(screen)).toEqual({ Cash: 0, Visa: 0, "Master Card": 10, Maal: 100 });
			expect(screen.overBy()).toBe(10);
		});

		it.each(["Cash", "Visa", "Master Card"])(
			"Default %s: Visa clicked for the full 100, then Mastercard 20 leaves Visa at 100, over by 20",
			(defaultMode) => {
				const screen = openPaymentScreen({ total: 100, payments: swanPayments(defaultMode) });

				screen.clickFull("Visa");
				screen.type("Master Card", 20);

				expect(screen.amount("Visa")).toBe(100);
				expect(screen.amount("Master Card")).toBe(20);
				expect(screen.overBy()).toBe(20);
			},
		);

		it("does not grow a card the cashier entered to cover a shortfall", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });

			screen.clickFull("Maal");
			screen.type("Visa", 30);
			screen.type("Maal", 50);

			// Visa (Default) was typed by the cashier, so it stays at 30; the
			// 20 shortfall goes to Cash.
			expect(snapshot(screen)).toEqual({ Cash: 20, Visa: 30, "Master Card": 0, Maal: 50 });
			expect(screen.paid()).toBe(100);
		});

		it("leaves a shortfall for the cashier when only entered cards could take it and there is no cash line", () => {
			const payments = [
				line("Visa", "Bank", { default: 1 }),
				line("Master Card", "Bank"),
			];
			const screen = openPaymentScreen({ total: 100, payments });

			screen.type("Visa", 60);

			expect(snapshot(screen)).toEqual({ Visa: 60, "Master Card": 0 });
			expect(screen.paid()).toBe(60);
		});
	});

	describe("the Cash line and untouched system amounts still adjust", () => {
		it("Cash Default: Cash 120 then a card of 20 gives Cash 80 and no change", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });

			screen.type("Cash", 120);
			expect(screen.amount("Cash")).toBe(120);
			expect(screen.overBy()).toBe(0);

			screen.type("Master Card", 20);
			expect(snapshot(screen)).toEqual({ Cash: 80, Visa: 0, "Master Card": 20, Maal: 0 });
			expect(screen.paid()).toBe(100);
		});

		it("Visa Default: Cash 120 removes the untouched Visa prefill, then a card of 20 brings Cash to 80", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });

			screen.type("Cash", 120);
			expect(screen.amount("Visa")).toBe(0);
			expect(screen.amount("Cash")).toBe(120);

			screen.type("Master Card", 20);
			expect(snapshot(screen)).toEqual({ Cash: 80, Visa: 0, "Master Card": 20, Maal: 0 });
		});

		it("Visa Default: typing a card reduces the untouched Visa prefill (excess direction)", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });

			screen.type("Master Card", 30);

			expect(snapshot(screen)).toEqual({ Cash: 0, Visa: 70, "Master Card": 30, Maal: 0 });
		});

		it("Cash Default: lowering a card tops the untouched Cash line back up (shortfall direction)", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });

			screen.type("Visa", 100);
			expect(screen.amount("Cash")).toBe(0);

			screen.type("Visa", 60);
			expect(snapshot(screen)).toEqual({ Cash: 40, Visa: 60, "Master Card": 0, Maal: 0 });
		});

		it("Visa Default: lowering the Default card itself puts the shortfall on Cash, not on another card", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });

			screen.type("Visa", 60);

			expect(snapshot(screen)).toEqual({ Cash: 40, Visa: 60, "Master Card": 0, Maal: 0 });
		});

		it("a Cash line alone may be overpaid: the excess is change, not 'over by'", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });

			screen.type("Cash", 120);

			expect(screen.amount("Cash")).toBe(120);
			expect(screen.paid()).toBe(120);
			expect(screen.overBy()).toBe(0);
		});

		it("shrinks untouched system amounts before the cashier's own cash entry", () => {
			const payments = [
				line("Cash", "Cash"),
				line("Visa", "Bank", { default: 1 }),
				line("Master Card", "Bank"),
			];
			const screen = openPaymentScreen({ total: 100, payments });

			screen.type("Cash", 50);
			expect(screen.amount("Visa")).toBe(50);
			screen.type("Master Card", 30);

			// Visa's 50 is still the untouched prefill, so it gives way first.
			expect(snapshot(screen)).toEqual({ Cash: 50, Visa: 20, "Master Card": 30 });
		});

		it("between two cash lines, reduces the least-recently-edited one first", () => {
			const payments = [
				line("Cash", "Cash", { default: 1 }),
				line("Cash USD", "Cash"),
				line("Visa", "Bank"),
			];
			const screen = openPaymentScreen({ total: 100, payments });

			screen.type("Cash", 60);
			screen.type("Cash USD", 40);
			screen.type("Visa", 30);

			expect(snapshot(screen)).toEqual({ Cash: 30, "Cash USD": 40, Visa: 30 });
		});

		it("settles against the net amount after loyalty/credit and gift cards", () => {
			const screen = openPaymentScreen({
				total: 100,
				netAmount: 90,
				giftCardAmount: 10,
				payments: swanPayments("Cash"),
			});

			screen.type("Cash", 100);
			screen.type("Visa", 30);

			// 100 - 10 loyalty/credit - 10 gift card = 80 due on the lines.
			expect(snapshot(screen)).toEqual({ Cash: 50, Visa: 30, "Master Card": 0, Maal: 0 });
		});

		it("keeps base_amount in step with amount on every line it adjusts", () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Cash") });

			screen.type("Cash", 120);
			screen.type("Visa", 20);

			const cash = screen.invoiceDoc.value.payments[0];
			expect(cash.amount).toBe(80);
			expect(cash.base_amount).toBe(80);
		});

		it("does nothing (and does not throw) when no line may absorb a shortfall", () => {
			const payments = [line("Visa", "Bank", { default: 1 })];
			const screen = openPaymentScreen({ total: 100, payments });

			expect(() => screen.type("Visa", 40)).not.toThrow();
			expect(screen.amount("Visa")).toBe(40);
		});
	});

	describe("submit guard", () => {
		it("blocks the Visa-Default / Maal 100 / Mastercard 10 case with 'Over by 10'", async () => {
			const screen = openPaymentScreen({ total: 100, payments: swanPayments("Visa") });
			screen.clickFull("Maal");
			screen.type("Master Card", 10);

			const validate = makeValidator(screen.invoiceDoc.value.payments, 100);
			await expect(validate()).rejects.toThrow(/^Over by 10: .*Correct Master Card, Maal\.$/);
		});

		it("blocks when only cards were paid and they exceed the total", async () => {
			const validate = makeValidator(
				[line("Visa", "Bank", { amount: 100 }), line("Master Card", "Bank", { amount: 20 })],
				100,
			);
			await expect(validate()).rejects.toThrow(/Over by 20/);
		});

		it("blocks when the excess is larger than the cash taken", async () => {
			const validate = makeValidator(
				[line("Cash", "Cash", { amount: 10 }), line("Visa", "Bank", { amount: 105 })],
				100,
			);
			await expect(validate()).rejects.toThrow(/Over by 5/);
		});

		it("allows an excess no larger than the cash taken (it is change)", async () => {
			const validate = makeValidator(
				[line("Cash", "Cash", { amount: 10 }), line("Visa", "Bank", { amount: 100 })],
				100,
			);
			await expect(validate()).resolves.toBe(true);
		});

		it("allows a cash-only overpayment (change)", async () => {
			const validate = makeValidator([line("Cash", "Cash", { amount: 120 })], 100);
			await expect(validate()).resolves.toBe(true);
		});

		it("allows an exact split payment", async () => {
			const validate = makeValidator(
				[line("Cash", "Cash", { amount: 80 }), line("Master Card", "Bank", { amount: 20 })],
				100,
			);
			await expect(validate()).resolves.toBe(true);
		});

		it("still blocks an underpayment with the existing message", async () => {
			const validate = makeValidator([line("Visa", "Bank", { amount: 80 })], 100, {
				posa_allow_partial_payment: 0,
			});
			await expect(validate()).rejects.toThrow("The amount paid is not complete");
		});

		it("counts the profile's configured cash mode as cash when deciding", async () => {
			const validate = makeValidator(
				[line("Drawer", "Bank", { amount: 20 }), line("Visa", "Bank", { amount: 100 })],
				100,
				{ posa_cash_mode_of_payment: "Drawer" },
			);
			await expect(validate()).resolves.toBe(true);
		});
	});

	describe("Payments.vue wiring", () => {
		const source = readFileSync(
			resolve(__dirname, "../src/posapp/components/pos/Payments.vue"),
			"utf8",
		);
		const fnBody = (name: string) => {
			const start = source.indexOf(`const ${name} = `);
			expect(start).toBeGreaterThan(-1);
			return source.slice(start, source.indexOf("\n};\n", start));
		};

		it("marks the box and re-settles the other lines on every cashier edit", () => {
			const body = fnBody("handlePaymentAmountChange");
			expect(body).toContain("markPaymentCashierEntered(payment);");
			expect(body).toContain("rebalanceOtherPaymentsAfterEdit(payment);");
			expect(body).not.toContain("rebalancePreferredPaymentCoverage(");
		});

		it("re-settles through the card-safe rebalance with the net-of-gift-card amount due", () => {
			const body = fnBody("rebalanceOtherPaymentsAfterEdit");
			expect(body).toContain("rebalanceAfterCashierEdit(editedPayment, {");
			expect(body).toContain("amountDue: paymentLinesAmountDue()");
			expect(body).toContain("isExcluded: isGiftCardPayment");
			expect(body).toMatch(/doc\.is_return \|\| is_credit_sale\.value/);
		});

		it("routes both full-amount entry points through the marking handler", () => {
			expect(source).toContain('@set-full-amount="handleSetFullAmount"');
			expect(source).toContain(
				"handleSetFullAmount(payment, Boolean(invoice_doc.value?.is_return));",
			);
			expect(source).not.toMatch(/\bset_full_amount\(payment, Boolean/);
			expect(fnBody("handleSetFullAmount")).toContain("markPaymentCashierEntered(payment);");
		});

		it("forwards the uncovered overpayment to PaymentSummary", () => {
			const summaryTag = source.slice(
				source.indexOf("<PaymentSummary"),
				source.indexOf("/>", source.indexOf("<PaymentSummary")),
			);
			expect(summaryTag).toContain(':uncovered-overpayment="uncovered_overpayment"');
			expect(fnBody("uncovered_overpayment")).toContain("getUncoveredOverpayment(");
		});
	});
});
