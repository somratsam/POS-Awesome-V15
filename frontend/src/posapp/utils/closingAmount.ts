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

export const normalizeClosingAmounts = (rows: any[] | null | undefined) => {
	(Array.isArray(rows) ? rows : []).forEach((row) => {
		if (row) row.closing_amount = normalizeClosingAmount(row.closing_amount);
	});
};
