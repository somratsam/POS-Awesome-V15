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
	const cashTaken = (Array.isArray(payments) ? payments : []).reduce(
		(sum, payment) =>
			isCashLike(payment) ? sum + Math.max(Number(payment?.amount) || 0, 0) : sum,
		0,
	);
	const factor = Math.pow(10, Math.max(precision, 0));
	const uncovered = Math.round((Math.max(excess, 0) - cashTaken) * factor) / factor;
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
