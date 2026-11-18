// One-screen Return / Exchange (POS Profile "One-screen exchange"): the
// receipt's returned lines and the new items in one cart. The server books
// the return at the receipt's own prices (one_screen_exchange.submit_exchange)
// and its figures (quote_exchange) are the ones shown before submitting.

export interface ExchangeLine {
	name: string;
	idx?: number;
	item_code: string;
	item_name?: string;
	uom?: string;
	barcodes?: string[];
	sold: number;
	returned: number;
	left: number;
	history?: { qty: number; date: string; name: string }[];
	rate: number;
	price_list_rate?: number;
	discount_percentage?: number;
	discount_amount?: number;
	discount_reason?: string | null;
	is_free_item?: number;
}

export interface ExchangeReceipt {
	found: number;
	name?: string;
	error?: string;
	customer?: string;
	customer_name?: string;
	is_generic_customer?: number;
	posting_date?: string;
	returnable_until?: string | null;
	currency?: string;
	grand_total?: number;
	has_invoice_discount?: number;
	lines?: ExchangeLine[];
}

export type Picks = Record<string, number>;

export type ExchangeKind = "return" | "pays" | "credit" | "even";

const QTY_DECIMALS = 3;

const round = (value: number, decimals = QTY_DECIMALS): number => {
	const factor = Math.pow(10, decimals);
	return Math.round((Number(value) || 0) * factor) / factor;
};

export function isOneScreenExchangeOn(profile: any): boolean {
	const value = profile?.posa_one_screen_exchange;
	return value === 1 || value === "1" || value === true;
}

// A receipt's barcode: "2026-00210" (default series) or a store series name
// such as "MCO-2026-00210" (print_barcode.invoice_scan_code). Item barcodes
// are digits only, so they never match.
const RECEIPT_PATTERN = /^(?:[A-Z]+-)*\d{4}-\d{3,}(?:-\d+)?$/i;

export function looksLikeReceipt(text: unknown): boolean {
	const value = String(text ?? "").trim();
	return value.length <= 60 && RECEIPT_PATTERN.test(value);
}

/** What can still be returned on a line, less what is ticked already. */
export function roomLeft(line: ExchangeLine, picks: Picks): number {
	return round(Math.max((Number(line.left) || 0) - (Number(picks[line.name]) || 0), 0));
}

export function clampPick(line: ExchangeLine, qty: unknown): number {
	const value = round(Number(qty) || 0);
	if (value <= 0) return 0;
	return Math.min(value, round(Number(line.left) || 0));
}

export function setPick(picks: Picks, line: ExchangeLine, qty: unknown): Picks {
	const next = { ...picks };
	const value = clampPick(line, qty);
	if (value > 0) next[line.name] = value;
	else delete next[line.name];
	return next;
}

/** Nothing ticked; a one-line receipt with 1 left comes ticked (as today). */
export function initialPicks(lines: ExchangeLine[]): Picks {
	const list = Array.isArray(lines) ? lines : [];
	const only = list.length === 1 ? list[0] : undefined;
	if (only && round(only.left) === 1) {
		return { [only.name]: 1 };
	}
	return {};
}

export function pickedCount(picks: Picks): number {
	return Object.values(picks || {}).filter((qty) => Number(qty) > 0).length;
}

export function pickedQty(picks: Picks): number {
	return round(Object.values(picks || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0));
}

/**
 * A scanned item barcode or code in the picker ticks one more of that item,
 * on the first line that still has room. `error` when the item isn't on the
 * receipt or nothing of it is left.
 */
export function tickByScan(
	lines: ExchangeLine[],
	picks: Picks,
	code: unknown,
): { picks: Picks; line: ExchangeLine | null; error: "" | "not_on_receipt" | "nothing_left" } {
	const value = String(code ?? "").trim();
	const matches = (lines || []).filter(
		(line) =>
			value &&
			(line.item_code === value || (Array.isArray(line.barcodes) && line.barcodes.includes(value))),
	);
	if (!matches.length) return { picks, line: null, error: "not_on_receipt" };
	const line = matches.find((candidate) => roomLeft(candidate, picks) >= 1) || null;
	if (!line) return { picks, line: matches[0] || null, error: "nothing_left" };
	return { picks: setPick(picks, line, (Number(picks[line.name]) || 0) + 1), line, error: "" };
}

/** Why a line can't be ticked (greyed out), or "". */
export function lineBlockedReason(
	line: ExchangeLine,
	formatDate: (date: string) => string,
	translate: (text: string, args?: any[]) => string,
): string {
	if (round(Number(line.left) || 0) > 0) return "";
	const history = Array.isArray(line.history) ? line.history : [];
	const last = history[history.length - 1];
	if (last) {
		return translate("returned {0} on {1}", [formatQty(round(Number(line.returned) || 0)), formatDate(last.date)]);
	}
	return translate("0 left");
}

/** Earlier returns of a line that still has some left ("returned 1 on 13 Nov"). */
export function lineHistoryNote(
	line: ExchangeLine,
	formatDate: (date: string) => string,
	translate: (text: string, args?: any[]) => string,
): string {
	const history = Array.isArray(line.history) ? line.history : [];
	if (!history.length || round(Number(line.left) || 0) <= 0) return "";
	return history
		.map((entry) => translate("returned {0} on {1}", [formatQty(entry.qty), formatDate(entry.date)]))
		.join(" · ");
}

export function formatQty(value: unknown): string {
	const number = round(Number(value) || 0);
	return Number.isInteger(number) ? String(number) : number.toFixed(QTY_DECIMALS).replace(/0+$/, "");
}

/** The till's estimate of a line's value until the server's quote arrives. */
export function estimateReturned(lines: ExchangeLine[], picks: Picks): number {
	return round(
		(lines || []).reduce((sum, line) => sum + (Number(line.rate) || 0) * (Number(picks[line.name]) || 0), 0),
		6,
	);
}

/** What the till sends for the return: which lines, how many. */
export function returnRequestItems(picks: Picks): { sales_invoice_item: string; qty: number }[] {
	return Object.entries(picks || {})
		.filter(([, qty]) => Number(qty) > 0)
		.map(([name, qty]) => ({ sales_invoice_item: name, qty: round(Number(qty)) }));
}

/** Customer pays more, credit left, even, or a plain return (no new items). */
export function exchangeFigures(
	returned: number,
	newItemsTotal: number | null,
	precision = 3,
): { kind: ExchangeKind; pay: number; credit: number } {
	const factor = Math.pow(10, precision);
	const toUnits = (value: number) => Math.round((Number(value) || 0) * factor);
	const back = toUnits(Math.abs(returned));
	if (newItemsTotal === null || newItemsTotal === undefined) {
		return { kind: "return", pay: 0, credit: back / factor };
	}
	const diff = toUnits(newItemsTotal) - back;
	if (diff > 0) return { kind: "pays", pay: diff / factor, credit: 0 };
	if (diff < 0) return { kind: "credit", pay: 0, credit: -diff / factor };
	return { kind: "even", pay: 0, credit: 0 };
}
