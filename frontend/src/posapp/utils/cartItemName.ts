// The cart's Name column has one line. Swan item names end in the variant
// after the last "-" ("JACKET-BROWN PATTERN-40": size 40; "...-AIR FORCE
// BLUE-S": size S), and that is the part staff need to see. So a long name
// is cut in the middle: the start is shortened with "…" and the last part
// always shows ("JACKET-BROWN PA…-40"). The full name stays on hover, in the
// item details, the receipt and the invoice.

// A last part longer than this isn't a size; such names are cut at the end.
export const MAX_KEPT_SUFFIX = 8;

export function splitCartItemName(name: unknown): { head: string; tail: string } {
	const text = String(name ?? "");
	const cut = text.lastIndexOf("-");
	if (cut <= 0 || cut === text.length - 1) return { head: text, tail: "" };
	const tail = text.slice(cut);
	if (tail.length - 1 > MAX_KEPT_SUFFIX) return { head: text, tail: "" };
	return { head: text.slice(0, cut), tail };
}
