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
		case "credit":
			return {
				headline: __("Credit note issued"),
				amount: money(figures.credit),
				button: __("Submit exchange"),
			};
		case "even":
			return { headline: __("Even exchange"), amount: null, button: __("Submit exchange") };
		default:
			return {
				headline: __("Credit note issued"),
				amount: money(figures.credit),
				button: __("Submit return → Credit note"),
			};
	}
}

/** "1 back · 2 new" */
export function exchangeQtyText(backQty: number, newQty: number, __: Translate): string {
	return newQty > 0
		? __("{0} back · {1} new", [formatQty(backQty), formatQty(newQty)])
		: __("{0} back", [formatQty(backQty)]);
}

/** Title, lines and OK button of an exchange prompt (ExchangeHost). */
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
	const back = __("{0} back ({1})", [formatQty(data.backQty), money(data.returned)]);
	if (data.kind === "return") {
		return {
			title: __("Submit this return?"),
			body: [`${back}, ${__("credit note issued {0}", [money(data.credit)])}.`],
			ok: __("Submit return → Credit note"),
		};
	}
	const added = __("{0} new ({1})", [formatQty(data.newQty), money(data.saleTotal)]);
	const result =
		data.kind === "pays"
			? __("customer pays {0}", [money(data.pay)])
			: data.kind === "credit"
				? __("credit note issued {0}", [money(data.credit)])
				: __("even exchange");
	return {
		title: __("Submit this exchange?"),
		body: [`${back}, ${added}, ${result}.`],
		ok: __("Submit exchange"),
	};
}
