// A return that refunds no money leaves the whole amount as store credit, and
// the cashier must say why: an exchange (the credit pays for a new sale now,
// so no slip is printed) or a credit note (the customer takes the credit away
// on a printed slip). Every submit route in Payments -- both buttons, Alt+P,
// Alt/Ctrl+X, the counter-grid Ctrl(+Shift)+Enter keys and the shortcuts
// started on the invoice screen -- goes through resolveReturnSubmit.
//
// Submitting such a return can't be undone at the till, and "Exchange" was
// once read as "go on to the next screen" (a return submitted by mistake,
// credit never used). So every route asks first: the confirmation shows what
// happens, with Back focused so a habit Enter can't submit.

export type ReturnIntent = "exchange" | "credit_note";

export type ReturnSubmitDecision =
	| { action: "submit"; print: boolean; intent: null }
	| { action: "ask"; intent: ReturnIntent | null };

/** A return where no payment row moves money: all of it becomes store credit. */
export function isNoMoneyReturn(doc: any): boolean {
	if (!doc || !Number(doc.is_return)) return false;
	const payments = Array.isArray(doc.payments) ? doc.payments : [];
	return !payments.some((payment: any) => Math.abs(Number(payment?.amount) || 0) > 0);
}

/**
 * How to submit. Anything that isn't a no-money return is submitted exactly
 * as requested. A no-money return always asks for confirmation first, with
 * the intent already chosen when the route says it: the Exchange / Credit
 * note buttons, or a plain submit key (Exchange, the default). A print key
 * leaves the choice open (both options shown), so habit can't print a credit
 * note for an exchange. The confirmed intent decides printing (only a credit
 * note prints).
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
	return { action: "ask", intent: intent || (print ? null : "exchange") };
}

/** What the confirmation tells the cashier about this return. */
export function returnConfirmFigures(doc: any) {
	const items = Array.isArray(doc?.items) ? doc.items : [];
	const itemCount = items.reduce((sum: number, item: any) => sum + Math.abs(Number(item?.qty) || 0), 0);
	// The credit is the return's grand total (what the voucher shows).
	return {
		itemCount,
		credit: Math.abs(Number(doc?.grand_total) || 0),
		customer: String(doc?.customer_name || doc?.customer || ""),
	};
}
