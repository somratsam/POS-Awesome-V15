// Which of a customer's credit rows the POS may apply. The server makes the
// same decision at submit (credit_voucher.authorize_customer_credit) and
// records it in "Credit Authorized By"; this copy only decides what to show,
// so a cashier never builds a sale the server will refuse.
//
// A credit note is usable when:
//   - it comes from a return made in this sale's shift (an exchange), or
//   - the customer's voucher for it was scanned or typed in Payments, or
//   - a POS supervisor is on the till (lost voucher; advances too).
// Once particular credit notes are picked (a voucher, or a return number a
// supervisor typed), only those are used -- plus a same-shift exchange --
// so a supervisor can replace one lost voucher without spending all of the
// customer's credit at once.

export interface CreditVoucher {
	credit_origin: string;
	code: string;
	voucher: string;
	customer: string;
	customer_name?: string;
	amount: number;
	/** 1 for a bearer voucher: a return of a sale to a shared customer (e.g. Anonymous). */
	bearer?: number | boolean;
}

export interface CreditAuthorizationContext {
	shift?: string | null;
	vouchers?: Record<string, CreditVoucher>;
	supervisor?: boolean;
}

export interface CreditSelection {
	authorized: any[];
	needVoucher: any[];
}

export function selectAuthorizedCredit(
	rows: any[],
	{ shift = null, vouchers = {}, supervisor = false }: CreditAuthorizationContext = {},
): CreditSelection {
	const authorized: any[] = [];
	const needVoucher: any[] = [];
	const list = Array.isArray(rows) ? rows : [];
	const picked = list.some((row) => row?.type === "Invoice" && Boolean(vouchers[row.credit_origin]));
	const supervisorAll = supervisor && !picked;
	for (const row of list) {
		const voucher = row?.type === "Invoice" ? vouchers[row.credit_origin] : undefined;
		const sameShift =
			row?.type === "Invoice" && Boolean(shift) && row.pos_opening_shift === shift;
		if (voucher) {
			authorized.push({ ...row, voucher_code: voucher.code });
		} else if (sameShift || supervisorAll) {
			authorized.push({ ...row });
		} else {
			needVoucher.push(row);
		}
	}
	return { authorized, needVoucher };
}

/** Code of a voucher row as the server expects it ("C26-00269-ENV2" -> "C2600269ENV2"). */
export function normalizeVoucherInput(text: unknown): string {
	return String(text ?? "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}
