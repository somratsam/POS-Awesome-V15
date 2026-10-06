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
};

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
