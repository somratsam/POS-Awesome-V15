// Wording of the one-screen exchange (agreed 2026-11-17): "Returned",
// "New items", "Pay 59.100", "Credit note issued 31.100" (named and
// Anonymous customers alike), "Even exchange" (no amount). Arabic in ar.csv.

import { formatQty, type ExchangeKind } from "./oneScreenExchange";

type Translate = (text: string, args?: any[]) => string;
type Money = (value: number) => string;

export interface CartFigures {
	kind: ExchangeKind;
	pay: number;
	credit: number;
}

/** The cart bar's headline, its amount (null: none shown) and the main button. */
export function exchangeCartLabels(figures: CartFigures, money: Money, __: Translate) {
	switch (figures.kind) {
		case "pays":
			return { headline: __("Customer pays"), amount: money(figures.pay), button: __("Pay {0}", [money(figures.pay)]) };
		// Every case goes on to the payment screen (section 108).
		case "credit":
			return {
				headline: __("Credit note issued"),
				amount: money(figures.credit),
				button: __("Continue"),
			};
		case "even":
			return { headline: __("Even exchange"), amount: null, button: __("Continue") };
		default:
			return {
				headline: __("Credit note issued"),
				amount: money(figures.credit),
				button: __("Continue"),
			};
	}
}

/** "1 back · 2 new" */
export function exchangeQtyText(backQty: number, newQty: number, __: Translate): string {
	return newQty > 0
		? __("{0} back · {1} new", [formatQty(backQty), formatQty(newQty)])
		: __("{0} back", [formatQty(backQty)]);
}

/** Title, lines and OK button of an exchange question (ExchangeHost). */
export function exchangeConfirmText(
	prompt: { type: string; data: Record<string, any> },
	money: Money,
	__: Translate,
): { title: string; body: string[]; ok: string } {
	const data = prompt.data || {};
	if (prompt.type === "add_return") {
		const body = [__("Receipt {0}", [data.receipt])];
		if (data.customerChanges) body.push(__("The customer changes to {0}.", [data.customer]));
		return { title: __("Add a return from this receipt?"), body, ok: __("Add return") };
	}
	if (prompt.type === "discard") {
		return { title: __("Discard? Nothing saved."), body: [], ok: __("Discard") };
	}
	return { title: "", body: [], ok: __("OK") };
}

export type ExchangeResultTone = "pays" | "credit" | "even" | "checking" | "error";

/**
 * The big highlighted result line of an exchange (section 109), from the
 * server-checked figures (null: being checked).
 */
export function exchangeResultLine(
	figures: CartFigures | null,
	money: Money,
	__: Translate,
): { tone: ExchangeResultTone; text: string } {
	if (!figures) return { tone: "checking", text: __("Checking…") };
	switch (figures.kind) {
		case "pays":
			return { tone: "pays", text: __("Customer pays: {0}", [money(figures.pay)]) };
		case "even":
			return { tone: "even", text: __("Even exchange — nothing to pay") };
		default:
			// Credit left, or a return with no new items.
			return { tone: "credit", text: __("Credit note to issue: {0}", [money(figures.credit)]) };
	}
}
