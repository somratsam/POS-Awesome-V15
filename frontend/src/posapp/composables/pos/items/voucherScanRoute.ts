// A credit note voucher scanned or typed in the main screen's scan box
// (section 108). Order of the scan box: the "Items on receipt" picker when it
// is open, a receipt (One-screen exchange), a voucher, an item.
//
// The voucher shape is only which lookup to try first: "C" + 2-digit year +
// the store's letters (none on the default series) + the number + 4 check
// characters, printed with dashes ("C26-MCO-00001-K7Q4"). Item barcodes are
// digits only and receipts have a 4-digit year between dashes, so neither
// takes this route. The server decides: its check characters are a keyed
// hash, so a misread can't match another voucher. When the server knows no
// such voucher, the code goes on to the item search once (like a receipt
// that isn't one); a wrong number still counts towards the till's limit.

import { peekSaleCreditStore } from "../../../stores/saleCreditStore";

// Same alphabet as credit_voucher.CHECK_ALPHABET: no 0/O, 1/I/L.
const CHECK = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const VOUCHER_PATTERN = new RegExp(`^C\\d{2}[A-Z]*\\d+[${CHECK}]{4}$`);

export function normalizeVoucherText(text: unknown): string {
	return String(text ?? "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}

export function looksLikeVoucher(text: unknown): boolean {
	const raw = String(text ?? "").trim();
	if (!raw || raw.length > 40) return false;
	// Only letters, digits, spaces and dashes, as printed or typed.
	if (!/^[A-Za-z0-9\s-]+$/.test(raw)) return false;
	const code = normalizeVoucherText(raw);
	return code.length >= 9 && VOUCHER_PATTERN.test(code);
}

const passThrough = new Set<string>();

/**
 * True when the code was taken as a voucher (the caller must not sell it).
 * `rescan` sends a code the server doesn't know as a voucher back through
 * the item search.
 */
export function dispatchVoucherScan(code: string, rescan: (_code: string) => void): boolean {
	const value = String(code || "").trim();
	if (!value) return false;
	if (passThrough.delete(value)) return false;
	if (!looksLikeVoucher(value)) return false;
	const store = peekSaleCreditStore();
	if (!store) return false;
	void store
		.applyFromScan(value)
		.then((result) => {
			if (result !== "not_voucher") return;
			passThrough.add(value);
			rescan(value);
		})
		.catch((error) => console.error("Credit note scan failed", error));
	return true;
}

/** Test-only. */
export function resetVoucherScanRoute() {
	passThrough.clear();
}
