import { subtractAmounts, toMinorUnits } from "./cashTender";

export const DEFAULT_CLOSING_VARIANCE_TOLERANCE = 0.5;

export type ClosingVariance = {
	mode_of_payment: string;
	// closing - expected: negative is a shortage, positive an overage.
	difference: number;
	direction: "short" | "over";
};

// The POS Profile's tolerance, or the 0.500 default when it isn't set.
export const resolveClosingVarianceTolerance = (profile: any): number => {
	const value = profile?.posa_closing_variance_tolerance;
	if (value === null || value === undefined || value === "") {
		return DEFAULT_CLOSING_VARIANCE_TOLERANCE;
	}
	const tolerance = Number(value);
	return Number.isFinite(tolerance) && tolerance >= 0
		? tolerance
		: DEFAULT_CLOSING_VARIANCE_TOLERANCE;
};

/**
 * Payment methods whose counted closing amount differs from the expected
 * amount by more than the tolerance, either way -- the same rule the server
 * enforces in POSClosingShift.check_closing_variance(). Worked out in whole
 * minor units so 0.500 over a 0.500 tolerance is not flagged.
 */
export const getClosingVariances = (
	rows: any[] | null | undefined,
	tolerance: number,
	precision = 3,
): ClosingVariance[] => {
	const limit = toMinorUnits(tolerance, precision);
	return (Array.isArray(rows) ? rows : [])
		.map((row) => ({
			mode_of_payment: String(row?.mode_of_payment || ""),
			difference: subtractAmounts(row?.closing_amount, [row?.expected_amount], precision),
		}))
		.filter((row) => Math.abs(toMinorUnits(row.difference, precision)) > limit)
		.map((row) => ({
			...row,
			direction: row.difference < 0 ? ("short" as const) : ("over" as const),
		}));
};
