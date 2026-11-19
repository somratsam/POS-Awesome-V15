// The credit note voucher card in the Active sale box (section 112): what it
// says, worked out from the vouchers on the sale and the payment screen's own
// figures (saleCreditStore.figures). Kept pure so every case is testable.

export interface SaleCreditCardInput {
	vouchers: any[];
	/** saleCreditStore.figures: null while the cart is being checked. */
	figures: { credit: number; pay: number; total: number; left?: number } | null;
	/** Today on the till, "YYYY-MM-DD". */
	today: string;
	money: (_value: number) => string;
	formatDate: (_date: string) => string;
	t: (_text: string, _args?: any[]) => string;
}

export type SaleCreditCardState = "checking" | "scan" | "pays" | "balance" | "covered";

export interface SaleCreditCard {
	title: string;
	available: string;
	validUntil: string;
	store: string;
	/** "" when more than 7 days are left. */
	expiryChip: string;
	state: SaleCreditCardState;
	/** The "after this sale" line. */
	result: string;
	/** The same, shorter, for the two-line card and Counter Grid. */
	resultShort: string;
	/** The PAY button: "" while checking (the caller keeps the last one). */
	pay: string;
}

export const EXPIRY_WARNING_DAYS = 7;

const dayNumber = (value: string): number | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
	if (!match) return null;
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
};

/** Whole days from today to the expiry date (0 = expires today). */
export function daysUntil(expiresOn: string, today: string): number | null {
	const end = dayNumber(expiresOn);
	const start = dayNumber(today);
	if (end === null || start === null) return null;
	return Math.round(end - start);
}

export function buildSaleCreditCard(input: SaleCreditCardInput): SaleCreditCard {
	const { vouchers, figures, today, money, formatDate, t } = input;
	const list = Array.isArray(vouchers) ? vouchers : [];
	const availableRaw = list.reduce((sum, voucher) => sum + (Number(voucher?.amount) || 0), 0);

	const title =
		list.length > 1
			? t("{0} credit notes", [String(list.length)])
			: String(list[0]?.voucher || list[0]?.credit_origin || t("Credit note"));

	// The earliest expiry decides (it is the first one lost).
	const dates = list
		.map((voucher) => String(voucher?.expires_on || ""))
		.filter((value) => dayNumber(value) !== null)
		.sort();
	const earliest = dates[0] || "";
	const days = earliest ? daysUntil(earliest, today) : null;
	let expiryChip = "";
	if (days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS) {
		expiryChip =
			days === 0
				? t("Expires today")
				: days === 1
					? t("Expires in 1 day")
					: t("Expires in {0} days", [String(days)]);
	}

	const stores = [...new Set(list.map((voucher) => String(voucher?.store || "").trim()).filter(Boolean))];

	const base = {
		title,
		available: money(availableRaw),
		validUntil: earliest ? formatDate(earliest) : "",
		store: stores.join(", "),
		expiryChip,
	};

	if (!figures) {
		return { ...base, state: "checking", result: t("Checking…"), resultShort: t("Checking…"), pay: "" };
	}
	if (!(Number(figures.total) > 0)) {
		const hint = t("Now scan the new items");
		return { ...base, state: "scan", result: hint, resultShort: hint, pay: t("Pay") };
	}
	const used = `${t("Credit used")} −${money(figures.credit)}`;
	const pays = t("Customer pays {0}", [money(figures.pay)]);
	const payLabel = t("Pay {0}", [money(figures.pay)]);
	const left = Number(figures.left) || 0;
	if (Number(figures.pay) > 0) {
		return { ...base, state: "pays", result: `${used} · ${pays}`, resultShort: pays, pay: payLabel };
	}
	if (left > 0) {
		const balance = t("Balance voucher {0}", [money(left)]);
		return { ...base, state: "balance", result: `${used} · ${balance}`, resultShort: balance, pay: payLabel };
	}
	return {
		...base,
		state: "covered",
		result: `${t("Credit covers it")} · ${pays}`,
		resultShort: t("Credit covers it"),
		pay: payLabel,
	};
}
