// Discount reasons on cart lines. Mirrors the server's rules in
// posawesome/posawesome/api/discount_reasons.py: a line needs a reason when
// the cashier gave it a discount (not an offer or free item), and
// "Not recorded" -- the server's marker for a submitted line without one --
// counts as missing, so a reloaded line still gets asked.

import { parseBooleanSetting } from "./stock";

export const NOT_RECORDED_DISCOUNT_REASON = "Not recorded";
const DISCOUNT_EPSILON = 0.0000001;

export type DiscountReasonOption = {
	name: string;
	display_order?: number;
	// The reason's usual bank offer rate; 0/blank = no fixed rate. A reminder
	// for the cashier only: nothing ever applies it to a line.
	offer_percentage?: number | null;
};

const RATE_TOLERANCE = 0.005;

/** The reason's offer rate, or null when it has no fixed rate. */
export function reasonOfferRate(reason: DiscountReasonOption | null | undefined): number | null {
	const rate = Number(reason?.offer_percentage || 0);
	return Number.isFinite(rate) && rate > RATE_TOLERANCE ? rate : null;
}

/** "20%", "12.5%" -- at most two decimals, no trailing zeros. */
export const formatOfferRate = (rate: number) => `${Number(Number(rate).toFixed(2))}%`;

/** The Disc % the cashier gave the line, or null when there is none. */
export function lineDiscountPercent(line: any): number | null {
	const percent = Number(line?.discount_percentage || 0);
	return Number.isFinite(percent) && percent > RATE_TOLERANCE ? percent : null;
}

export function reasonMatchesPercent(reason: DiscountReasonOption, percent: number | null) {
	const rate = reasonOfferRate(reason);
	return rate !== null && percent !== null && Math.abs(rate - percent) < RATE_TOLERANCE;
}

/** Reasons whose rate matches one of the lines' Disc % first, otherwise in the given order. */
export function sortReasonsForLines(reasons: DiscountReasonOption[], lines: any[] | null | undefined) {
	const percents = (lines || []).map(lineDiscountPercent).filter((percent) => percent !== null);
	const matches = (reason: DiscountReasonOption) =>
		percents.some((percent) => reasonMatchesPercent(reason, percent));
	return [...(reasons || []).filter(matches), ...(reasons || []).filter((reason) => !matches(reason))];
}

/** Lines whose Disc % differs from the reason's rate (none when the reason has no rate). */
export function linesOffReasonRate(reason: DiscountReasonOption | null | undefined, lines: any[] | null | undefined) {
	if (!reason || reasonOfferRate(reason) === null) return [];
	return (lines || []).filter((line) => {
		const percent = lineDiscountPercent(line);
		return percent !== null && !reasonMatchesPercent(reason, percent);
	});
}

export const isDiscountReasonRequired = (posProfile: any) =>
	parseBooleanSetting(posProfile?.posa_require_discount_reason);

export function hasManualLineDiscount(item: any) {
	if (!item || item.posa_offer_applied || item.posa_is_offer || item.is_free_item) {
		return false;
	}
	return (
		Number(item.discount_percentage || 0) > DISCOUNT_EPSILON ||
		Number(item.discount_amount || 0) > DISCOUNT_EPSILON
	);
}

export function hasDiscountReason(item: any) {
	const reason = String(item?.posa_discount_reason || "").trim();
	return Boolean(reason) && reason !== NOT_RECORDED_DISCOUNT_REASON;
}

export const lineNeedsDiscountReason = (item: any) =>
	hasManualLineDiscount(item) && !hasDiscountReason(item);

export const findLinesMissingDiscountReason = (items: any[] | null | undefined) =>
	(items || []).filter(lineNeedsDiscountReason);

/** The reason most recently picked on this cart, if it is still offered. */
export function preselectDiscountReason(items: any[] | null | undefined, reasons: DiscountReasonOption[]) {
	const offered = new Set((reasons || []).map((reason) => reason.name));
	let latest: { name: string; at: number } | null = null;
	for (const item of items || []) {
		if (!hasDiscountReason(item) || !offered.has(item.posa_discount_reason)) continue;
		const at = Number(item._discount_reason_set_at || 0);
		if (!latest || at > latest.at) latest = { name: item.posa_discount_reason, at };
	}
	return latest?.name || null;
}

/** Set (or clear, with null) a line's reason through the invoice store. */
export function setLineDiscountReason(invoiceStore: any, item: any, reason: string | null) {
	if (!item) return;
	const apply = (line: any) => {
		line.posa_discount_reason = reason || null;
		// Client-only: lets the next prompt preselect the latest pick.
		line._discount_reason_set_at = reason ? Date.now() : 0;
	};
	if (item.posa_row_id && typeof invoiceStore?.updateItemWithTotals === "function") {
		const updated = invoiceStore.updateItemWithTotals(item.posa_row_id, apply);
		if (updated) {
			if (updated !== item) apply(item);
			return;
		}
	}
	apply(item);
}

/** Drop a stale reason once a line no longer carries a manual discount. */
export function clearDiscountReasonIfUndiscounted(invoiceStore: any, item: any) {
	if (item && !hasManualLineDiscount(item) && item.posa_discount_reason) {
		setLineDiscountReason(invoiceStore, item, null);
	}
}
