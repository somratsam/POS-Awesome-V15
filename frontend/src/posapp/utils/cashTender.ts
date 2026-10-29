// @ts-ignore
import { getSmartTenderSuggestions } from "../../utils/smartTender";
import {
	resolvePreferredPaymentLine,
	type PaymentLine,
} from "./paymentInitialization";

type PosProfileLike = {
	currency?: string;
	posa_cash_mode_of_payment?: string | null;
	payments?: PaymentLine[];
};

type QuickCashTenderOptions = {
	amount: number;
	currency?: string;
	posProfile?: PosProfileLike | null;
	payments?: PaymentLine[] | null;
};

export const isCashLikePaymentLine = (
	payment: PaymentLine | null | undefined,
	posProfile?: PosProfileLike | null,
): boolean => {
	if (!payment) return false;

	const configuredCashMOP = String(
		posProfile?.posa_cash_mode_of_payment || "",
	).toLowerCase();
	const type = String(payment.type || "").toLowerCase();

	if (type === "cash") return true;

	const mode = String(payment.mode_of_payment || "").toLowerCase();
	if (configuredCashMOP && mode === configuredCashMOP) return true;

	return mode.includes("cash");
};

// Money is added and subtracted in whole minor units (baisa for OMR, at
// precision 3) so results are exact: 139.300 - 80.000 is 59.300, never
// 59.29999. Inputs are first rounded to the currency precision.
export const toMinorUnits = (value: unknown, precision = 2): number => {
	const factor = Math.pow(10, Math.max(precision, 0));
	return Math.round((Number(value) || 0) * factor);
};

export const fromMinorUnits = (minor: number, precision = 2): number =>
	minor / Math.pow(10, Math.max(precision, 0));

/** amountDue minus every amount, exact to the currency precision. */
export const subtractAmounts = (
	amountDue: unknown,
	amounts: unknown[],
	precision = 2,
): number =>
	fromMinorUnits(
		amounts.reduce<number>(
			(minor, amount) => minor - toMinorUnits(amount, precision),
			toMinorUnits(amountDue, precision),
		),
		precision,
	);

/**
 * How much of an overpayment cannot be handed back as change.
 *
 * Change can only come out of the cash that was actually taken, so an excess
 * over the amount due is fine up to the cash lines' total; anything beyond
 * that is money charged on a card/bank line that has nowhere to go.
 */
export const getUncoveredOverpayment = (
	payments: PaymentLine[] | null | undefined,
	excess: number,
	isCashLike: (_payment: PaymentLine) => boolean,
	precision = 2,
): number => {
	const cashTaken = (Array.isArray(payments) ? payments : [])
		.filter((payment) => isCashLike(payment))
		.map((payment) => Math.max(Number(payment?.amount) || 0, 0));
	const uncovered = subtractAmounts(Math.max(excess, 0), cashTaken, precision);
	return uncovered > 0 ? uncovered : 0;
};

export const normalizeProfilePaymentLines = (
	payments: PaymentLine[] | null | undefined,
): PaymentLine[] => {
	if (!Array.isArray(payments)) return [];

	const paymentRows = payments.filter(
		(payment) => !!payment?.mode_of_payment,
	);
	const hasExplicitDefault = paymentRows.some(
		(payment) => payment.default === 1 || payment.default === true,
	);

	return paymentRows.map((payment, index) => ({
		mode_of_payment: payment.mode_of_payment,
		amount: payment.amount || 0,
		account: payment.account,
		type: payment.type,
		default:
			payment.default === 1 ||
			payment.default === true ||
			(!hasExplicitDefault && index === 0)
				? 1
				: 0,
		base_amount: payment.base_amount || 0,
	}));
};

export const getQuickCashTenderSuggestions = ({
	amount,
	currency,
	posProfile,
	payments,
}: QuickCashTenderOptions): number[] => {
	const paymentLines = normalizeProfilePaymentLines(
		payments || posProfile?.payments,
	);
	if (!paymentLines.length) return [];

	const preferredPayment = resolvePreferredPaymentLine(
		{ payments: paymentLines },
		(payment) => isCashLikePaymentLine(payment, posProfile),
	);
	if (!isCashLikePaymentLine(preferredPayment, posProfile)) {
		return [];
	}

	const normalizedAmount = Math.abs(Number(amount) || 0);
	if (normalizedAmount <= 0) return [];

	return getSmartTenderSuggestions(
		normalizedAmount,
		currency || posProfile?.currency || "",
	);
};
