// Invoice Management's words for returns, credit notes and exchanges, from
// the fields the server adds to each submitted Sales Invoice row
// (credit_exchange.describe_credit): "Exchange", "Credit note",
// "Credit note issued X", "Returned". The real link is the credit Journal
// Entry; an exchange is credit used in the return's own shift.

const translate = (text: string, args?: unknown[]): string => {
	const fn = (globalThis as any).__;
	if (typeof fn === "function") return fn(text, args);
	return args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")) : text;
};

const EPSILON = 0.0005;

export type CreditSegment = { text: string } | { link: string };
export type CreditLine = { key: string; segments: CreditSegment[] };
export type CreditBadge = { text: string; color: string; kind: string };

export type CreditFormatters = {
	money: (value: number) => string;
	date: (value: string) => string;
};

export type CreditFilterKey = "all" | "sales" | "exchanges" | "credit_notes" | "returned" | "unused_credit";

/** Splits a translated template into text and links: "{0}" etc. are replaced
 * by the matching value, which is either text or an invoice to open. */
function fill(template: string, values: Array<CreditSegment>): CreditSegment[] {
	const segments: CreditSegment[] = [];
	const pattern = /\{(\d+)\}/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(template))) {
		if (match.index > last) segments.push({ text: template.slice(last, match.index) });
		const value = values[Number(match[1])];
		if (value) segments.push(value);
		last = match.index + match[0].length;
	}
	if (last < template.length) segments.push({ text: template.slice(last) });
	return segments;
}

/** One line per linked invoice set: "Exchange for return {0}" with every
 * name a link, separated by commas. */
function linkLine(key: string, template: string, names: string[]): CreditLine {
	const segments: CreditSegment[] = [];
	const [before, after] = translate(template).split("{0}");
	if (before) segments.push({ text: before });
	names.forEach((name, index) => {
		if (index) segments.push({ text: ", " });
		segments.push({ link: name });
	});
	if (after) segments.push({ text: after });
	return { key, segments };
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter(Boolean).map(String) : []);
const num = (value: unknown): number => Number(value || 0) || 0;

export function creditBadge(row: any): CreditBadge | null {
	const badge = row?.exchange_credit_badge;
	if (badge === "Exchange") return { text: translate("Exchange"), color: "info", kind: "exchange" };
	if (badge === "Credit note") return { text: translate("Credit note"), color: "warning", kind: "credit_note" };
	return null;
}

/** The credit-note part of a return: issued / X left of Y / Used (+ expired). */
function creditNoteLine(row: any, fmt: CreditFormatters): CreditLine | null {
	const issued = num(row.credit_issued);
	if (issued <= EPSILON) return null;
	const left = num(row.credit_left);
	let segments: CreditSegment[];
	if (left + EPSILON >= issued) {
		segments = [{ text: translate("Credit note issued {0}", [fmt.money(issued)]) }];
	} else if (left > EPSILON) {
		segments = [{ text: translate("{0} left of {1}", [fmt.money(left), fmt.money(issued)]) }];
	} else {
		segments = [{ text: translate("Used") }];
	}
	if (row.credit_expired && row.credit_valid_until) {
		segments.push({ text: ` · ${translate("Expired on {0}", [fmt.date(row.credit_valid_until)])}` });
	}
	return { key: "credit", segments };
}

/** The lines under the badge. detail adds what the popup shows on top:
 * "Valid until", and where each credit note's credit was used. */
export function creditLines(row: any, fmt: CreditFormatters, { detail = false } = {}): CreditLine[] {
	if (!row) return [];
	const lines: CreditLine[] = [];
	if (Number(row.is_return)) {
		const sales = list(row.exchange_sales);
		if (sales.length) lines.push(linkLine("exchange", "Exchange → {0}", sales));
		const credit = creditNoteLine(row, fmt);
		if (credit) lines.push(credit);
		if (detail) {
			if (num(row.credit_left) > EPSILON && !row.credit_expired && row.credit_valid_until) {
				lines.push({
					key: "valid",
					segments: [{ text: translate("Valid until {0}", [fmt.date(row.credit_valid_until)]) }],
				});
			}
			for (const use of Array.isArray(row.credit_used_on) ? row.credit_used_on : []) {
				if (!use?.sale || use.exchange) continue;
				lines.push({
					key: `used-${use.sale}`,
					segments: fill(translate("Used {0} on {1}"), [
						{ text: fmt.money(num(use.used)) },
						{ link: String(use.sale) },
					]),
				});
			}
		}
		return lines;
	}
	const exchangeReturns = list(row.exchange_returns);
	if (exchangeReturns.length) lines.push(linkLine("exchange", "Exchange for return {0}", exchangeReturns));
	const creditNotes = list(row.credit_notes_used);
	if (creditNotes.length) lines.push(linkLine("credit", "Paid with credit note {0}", creditNotes));
	const returnedBy = list(row.returned_by);
	if (row.returned_state === "whole" && returnedBy.length) {
		lines.push(linkLine("returned", "Returned: whole — {0}", returnedBy));
	} else if (row.returned_state === "part" && returnedBy.length) {
		lines.push(linkLine("returned", "Returned: part — {0}", returnedBy));
	}
	return lines;
}

/** Credit left on a return that can still be used. */
export function hasUnusedCredit(row: any): boolean {
	return Number(row?.is_return) === 1 && num(row?.credit_left) > EPSILON && !row?.credit_expired;
}

/** The chip filters: History (sales) and Returns. */
export function matchesCreditFilter(row: any, filter: CreditFilterKey | string): boolean {
	switch (filter) {
		case "sales":
			return !Number(row?.is_return) && (row?.credit_kind || "sale") === "sale";
		case "exchanges":
			return row?.credit_kind === "exchange";
		case "credit_notes":
			return row?.credit_kind === "credit_note";
		case "returned":
			return !Number(row?.is_return) && Boolean(row?.returned_state);
		case "unused_credit":
			return hasUnusedCredit(row);
		default:
			return true;
	}
}

export const HISTORY_CREDIT_FILTERS: Array<{ key: CreditFilterKey; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "sales", label: "Sales" },
	{ key: "exchanges", label: "Exchanges" },
	{ key: "credit_notes", label: "Paid with credit note" },
	{ key: "returned", label: "Returned" },
];

export const RETURN_CREDIT_FILTERS: Array<{ key: CreditFilterKey; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "credit_notes", label: "Credit notes" },
	{ key: "exchanges", label: "Exchanges" },
	{ key: "unused_credit", label: "Unused credit" },
];

/** The status a sale shows in the POS. ERPNext calls a sale with a return
 * "Credit Note Issued"; the POS shows it as "Paid" with its "Returned: part /
 * whole" line instead (returns are credit notes of their own). */
export function displayInvoiceStatus(row: any): string {
	const status = String(row?.status || "");
	if (!Number(row?.is_return) && status === "Credit Note Issued") return "Paid";
	return status;
}
