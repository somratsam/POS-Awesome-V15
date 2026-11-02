// A closing amount left empty means 0 -- it is never sent as blank or null
// (POS Closing Shift Detail.closing_amount is a required Currency field).
// Anything else typed is kept as a number, or as typed if it isn't one, so
// the input's own rule can flag it.
export const normalizeClosingAmount = (value: unknown): unknown => {
	if (value === null || value === undefined) return 0;
	if (typeof value === "string" && value.trim() === "") return 0;
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : value;
};

// The amount boxes' input rule (closing and opening counts): empty is fine
// (it means 0), anything else must be a number with at most `precision`
// decimals. Returns true or the message to show.
export const amountInputRule = (
	v: unknown,
	precision: number,
	translate: (text: string, args?: unknown[]) => string = (text) => text,
): true | string => {
	if (v === "" || v === null || v === undefined) {
		return true;
	}

	const value = typeof v === "number" ? v : Number(String(v).trim());

	if (!Number.isFinite(value)) {
		return "Please enter a valid number";
	}

	const stringValue = String(v);
	const [integerPart = "", fractionalPart] = stringValue.split(".");

	if (integerPart.replace(/^-/, "").length > 20) {
		return "Number is too large";
	}

	if (fractionalPart && fractionalPart.length > precision) {
		return translate("Maximum of {0} decimal places", [precision]);
	}

	return true;
};

export const normalizeClosingAmounts = (rows: any[] | null | undefined) => {
	(Array.isArray(rows) ? rows : []).forEach((row) => {
		if (row) row.closing_amount = normalizeClosingAmount(row.closing_amount);
	});
};
