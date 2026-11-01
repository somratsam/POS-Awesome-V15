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
 * Why an overpayment can't be settled as change, and by how much it is over.
 *
 * Change can only come out of the cash that was actually taken:
 * - "cards": the excess is larger than the cash taken, so part of it sits on
 *   card/bank lines that have nowhere to go (over by excess - cash).
 * - "cash_in_full": the excess equals or exceeds all the cash taken, so the
 *   cash would be handed straight back -- the cards alone already cover the
 *   total, which is always a mistake (over by the whole excess).
 */
export const getOverpaymentBlock = (
	payments: PaymentLine[] | null | undefined,
	excess: number,
	isCashLike: (_payment: PaymentLine) => boolean,
	precision = 2,
): { reason: "cards" | "cash_in_full" | null; overBy: number } => {
	const cashTaken = (Array.isArray(payments) ? payments : [])
		.filter((payment) => isCashLike(payment))
		.reduce(
			(minor, payment) =>
				minor + Math.max(toMinorUnits(payment?.amount, precision), 0),
			0,
		);
	const excessMinor = Math.max(toMinorUnits(excess, precision), 0);
	if (excessMinor <= 0) return { reason: null, overBy: 0 };
	if (excessMinor > cashTaken) {
		return {
			reason: "cards",
			overBy: fromMinorUnits(excessMinor - cashTaken, precision),
		};
	}
	if (cashTaken > 0 && excessMinor >= cashTaken) {
		return {
			reason: "cash_in_full",
			overBy: fromMinorUnits(excessMinor, precision),
		};
	}
	return { reason: null, overBy: 0 };
};

/** The "Over by" amount shown on the payment screen (0 when settled fine). */
export const getUncoveredOverpayment = (
	payments: PaymentLine[] | null | undefined,
	excess: number,
	isCashLike: (_payment: PaymentLine) => boolean,
	precision = 2,
): number => getOverpaymentBlock(payments, excess, isCashLike, precision).overBy;

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
