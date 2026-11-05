// Before the POS reprints an invoice, the server is told about it. For a
// credit note voucher (a return whose whole value stayed as store credit) it
// records which PIN-verified cashier reprinted it, and the POS then prints it
// as a DUPLICATE. Other invoices: nothing is recorded.
//
// Throws when the server refuses (no access, or a locked till for a voucher);
// Frappe has already shown its message, and the caller must not print.

declare const frappe: any;

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
	const response = await frappe.call({
		method: CREDIT_NOTE_REPRINT_METHOD,
		args: { doctype, name, pos_profile: posProfile || null },
	});
	return Boolean(response?.message?.credit_note);
}
