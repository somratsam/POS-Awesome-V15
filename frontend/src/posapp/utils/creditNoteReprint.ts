// Before the POS reprints an invoice, the server is told about it. For a
// credit note voucher (a return whose whole value stayed as store credit) it
// records which PIN-verified cashier reprinted it, and the POS then prints it
// as a DUPLICATE. Other invoices: nothing is recorded.
//
// Throws when the server refuses (no access, or a locked till for a voucher)
// with the server's reason as the message; the caller shows it as a red
// toast (Frappe's own message box would open behind Invoice Management) and
// must not print.

import { callWithoutDialog } from "./voucherMessages";
import { isOffline } from "../../offline/index";

export const CREDIT_NOTE_REPRINT_METHOD =
	"posawesome.posawesome.api.credit_voucher.record_credit_note_reprint";

export const REPRINT_SETTINGS = JSON.stringify({ is_reprint: 1 });

export async function recordCreditNoteReprint({
	doctype,
	name,
	posProfile,
}: {
	doctype: string;
	name: string;
	posProfile?: string | null;
}): Promise<boolean> {
	// Offline the POS prints its own offline copy, which carries no voucher
	// code, so there is nothing to record (as before).
	if (isOffline()) return false;
	const result: any = await callWithoutDialog(CREDIT_NOTE_REPRINT_METHOD, {
		doctype,
		name,
		pos_profile: posProfile || null,
	});
	return Boolean(result?.credit_note);
}

/** Print settings for a balance voucher: the credit note shows the sale it
 * was just used on, what was used and what is left. */
export function balanceVoucherSettings(sale: string): string {
	return JSON.stringify({ balance_for: sale });
}

/**
 * Before the balance voucher of a credit note used in part on `sale` prints:
 * the server records it (Comment naming the PIN cashier) and says whether the
 * sale really used it ({balance: true}); if not, it is treated as an ordinary
 * reprint and prints as a DUPLICATE. Throws like recordCreditNoteReprint.
 */
export async function recordBalanceVoucherPrint({
	name,
	sale,
	posProfile,
}: {
	name: string;
	sale: string;
	posProfile?: string | null;
}): Promise<{ creditNote: boolean; balance: boolean }> {
	const result: any = await callWithoutDialog(CREDIT_NOTE_REPRINT_METHOD, {
		doctype: "Sales Invoice",
		name,
		pos_profile: posProfile || null,
		balance_for: sale,
	});
	return { creditNote: Boolean(result?.credit_note), balance: Boolean(result?.balance) };
}
