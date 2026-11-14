// Tick-to-return: after a receipt is scanned (or an invoice picked) for a
// return, its returnable lines are shown with nothing selected. Staff tick
// the lines being returned and set each quantity, up to what is still
// returnable after earlier returns (get_invoice_for_return already sends the
// remaining quantity as each line's qty). Price and discount stay the
// original line's. A receipt with one line comes with that line ticked at
// its full returnable quantity. Lines left unticked or at 0 aren't returned.

export const NOTHING_SELECTED_MESSAGE = "Select at least one item to return";

export interface ReturnableLine {
	name: string;
	item_code?: string;
	item_name?: string;
	qty?: number;
	stock_qty?: number;
	conversion_factor?: number;
	rate?: number;
	net_rate?: number;
	amount?: number;
	net_amount?: number;
	[key: string]: any;
}

export interface ReturnPick {
	name: string;
	selected: boolean;
	qty: number;
	max: number;
}

const QTY_DECIMALS = 3;

function round(value: number, decimals = QTY_DECIMALS): number {
	const factor = Math.pow(10, decimals);
	return Math.round((Number(value) || 0) * factor) / factor;
}

/** What is still returnable on a line (its qty, as get_invoice_for_return sends it). */
export function returnableQty(line: ReturnableLine): number {
	return round(Math.abs(Number(line?.qty) || 0));
}

/** A quantity kept between 0 and what is still returnable. */
export function clampReturnQty(qty: unknown, max: number): number {
	const value = round(Number(qty) || 0);
	if (value <= 0) return 0;
	return Math.min(value, round(max));
}

/** Nothing selected; a single-line receipt comes ticked at its full returnable quantity. */
export function initialReturnPicks(lines: ReturnableLine[]): ReturnPick[] {
	const list = Array.isArray(lines) ? lines.filter((line) => returnableQty(line) > 0) : [];
	const single = list.length === 1;
	return list.map((line) => {
		const max = returnableQty(line);
		return { name: line.name, selected: single, qty: single ? max : 0, max };
	});
}

/** Ticking a line returns 1 of it (or all of it when less than 1 is left); unticking returns none. */
export function setPicked(pick: ReturnPick, selected: boolean): ReturnPick {
	if (!selected) return { ...pick, selected: false, qty: 0 };
	const qty = pick.qty > 0 ? pick.qty : Math.min(1, pick.max);
	return { ...pick, selected: true, qty: clampReturnQty(qty, pick.max) };
}

/** A new quantity typed or stepped: 0 unticks the line, anything else ticks it. */
export function setPickedQty(pick: ReturnPick, qty: unknown): ReturnPick {
	const value = clampReturnQty(qty, pick.max);
	return { ...pick, qty: value, selected: value > 0 };
}

/**
 * The lines to return, each with its chosen (positive) quantity and its
 * amounts for that quantity. Unticked lines and lines at 0 are left out.
 */
export function pickedReturnLines(lines: ReturnableLine[], picks: ReturnPick[]): ReturnableLine[] {
	const byName = new Map((picks || []).map((pick) => [pick.name, pick]));
	const result: ReturnableLine[] = [];
	for (const line of Array.isArray(lines) ? lines : []) {
		const pick = byName.get(line.name);
		if (!pick || !pick.selected) continue;
		const qty = clampReturnQty(pick.qty, returnableQty(line));
		if (qty <= 0) continue;
		const factor = Number(line.conversion_factor) || 1;
		const rate = Number(line.rate) || 0;
		const netRate = Number(line.net_rate ?? line.rate) || 0;
		result.push({
			...line,
			qty,
			stock_qty: round(qty * factor, 6),
			amount: round(rate * qty, 6),
			net_amount: round(netRate * qty, 6),
		});
	}
	return result;
}

export function pickedCount(picks: ReturnPick[]): number {
	return (picks || []).filter((pick) => pick.selected && pick.qty > 0).length;
}

/**
 * The return's grand total before the cart recalculates it: the original's
 * grand total (tax included) in proportion to the picked lines' amounts.
 */
export function buildPickedReturnTotal(
	returnDoc: { grand_total?: number; total?: number } | null | undefined,
	pickedLines: ReturnableLine[],
): number {
	const picked = (pickedLines || []).reduce((sum, line) => sum + Math.abs(Number(line.amount) || 0), 0);
	const total = Math.abs(Number(returnDoc?.total) || 0);
	const grand = Math.abs(Number(returnDoc?.grand_total) || 0);
	if (!total || !grand) return round(picked, 6);
	return round((grand * picked) / total, 6);
}

/**
 * A one-line receipt with 1 (or less) left to return skips the picking
 * step: that line is returned straight away. Otherwise null -- show the step
 * (a one-line receipt with 2 or more comes ticked at its full quantity).
 */
export function linesWithoutPicking(lines: ReturnableLine[]): ReturnableLine[] | null {
	const list = Array.isArray(lines) ? lines.filter((line) => returnableQty(line) > 0) : [];
	const only = list.length === 1 ? list[0] : undefined;
	if (!only || returnableQty(only) > 1) return null;
	return pickedReturnLines(list, initialReturnPicks(list));
}
