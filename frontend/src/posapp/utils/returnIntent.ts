// A return that refunds no money leaves the whole amount as store credit, and
// the cashier must say why: an exchange (the credit pays for a new sale now,
// so no slip is printed) or a credit note (the customer takes the credit away
// on a printed slip). Every submit route in Payments -- both buttons, Alt+P,
// Alt/Ctrl+X, the counter-grid Ctrl(+Shift)+Enter keys and the shortcuts
// started on the invoice screen -- goes through resolveReturnSubmit.

export type ReturnIntent = "exchange" | "credit_note";

export type ReturnSubmitDecision =
	| { action: "submit"; print: boolean; intent: ReturnIntent | null }
	| { action: "ask" };

/** A return where no payment row moves money: all of it becomes store credit. */
export function isNoMoneyReturn(doc: any): boolean {
	if (!doc || !Number(doc.is_return)) return false;
	const payments = Array.isArray(doc.payments) ? doc.payments : [];
	return !payments.some((payment: any) => Math.abs(Number(payment?.amount) || 0) > 0);
}

/**
 * How to submit. A chosen intent decides printing (only a credit note prints).
 * Without one, a no-money return submits as an exchange when no print was
 * asked for, and asks "Exchange or Credit note issue?" when a print key was
 * used, so habit can't print a credit note for an exchange. Anything else is
 * submitted exactly as requested.
 */
export function resolveReturnSubmit({
	noMoneyReturn,
	print,
	intent = null,
}: {
	noMoneyReturn: boolean;
	print: boolean;
	intent?: ReturnIntent | null;
}): ReturnSubmitDecision {
	if (!noMoneyReturn) return { action: "submit", print, intent: null };
	if (intent) return { action: "submit", print: intent === "credit_note", intent };
	if (print) return { action: "ask" };
	return { action: "submit", print: false, intent: "exchange" };
}
