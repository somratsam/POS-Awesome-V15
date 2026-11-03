import { hasMeaningfulAmount, type PaymentLine } from "./paymentInitialization";

const PAYMENT_LINE_TARGETS =
	"[data-pos-keyboard-target='payment-amount'], [data-pos-keyboard-target='payment-action']";

// The line that holds the money: the Default line when it has an amount,
// otherwise the first line that does.
export const findFundedPaymentLine = (
	payments: PaymentLine[] | null | undefined,
	precision = 2,
): PaymentLine | null => {
	const lines = (payments || []).filter(Boolean);
	return (
		lines.find((line) => Number(line.default) === 1 && hasMeaningfulAmount(line, precision)) ||
		lines.find((line) => hasMeaningfulAmount(line, precision)) ||
		null
	);
};

// Found by test id, not through keyboardNavigation's visibility check: Vuetify
// gives an empty, unfocused field's input opacity 0, which that check reads as
// hidden.
const findAmountInput = (root: ParentNode, modeOfPayment: string | undefined) => {
	if (!modeOfPayment) return null;
	const field = Array.from(
		root.querySelectorAll<HTMLElement>("[data-pos-keyboard-target='payment-amount']"),
	).find((el) => el.getAttribute("data-testid") === `payment-amount-${modeOfPayment}`);
	const input = field?.querySelector<HTMLInputElement>("input:not([type='hidden'])");
	return input && !input.disabled ? input : null;
};

export type PaymentOpeningFocus =
	| { kind: "amount"; element: HTMLInputElement }
	| { kind: "neutral" }
	| { kind: "submit" };

// Where focus goes when the Payments screen opens: the Amount box of the line
// holding the money, so typing corrects that amount. Never a payment method
// button -- a focused button looks selected. With no line holding money, the
// screen itself (neutral). With no payment lines shown at all (credit-only
// return), the submit button, as before.
export const resolvePaymentOpeningFocus = (
	root: ParentNode | null | undefined,
	payments: PaymentLine[] | null | undefined,
	precision = 2,
): PaymentOpeningFocus => {
	if (!root || !root.querySelector(PAYMENT_LINE_TARGETS)) {
		return { kind: "submit" };
	}
	const funded = findFundedPaymentLine(payments, precision);
	const input = funded ? findAmountInput(root, funded.mode_of_payment) : null;
	return input ? { kind: "amount", element: input } : { kind: "neutral" };
};
