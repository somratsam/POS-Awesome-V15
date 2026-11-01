import { describe, expect, it } from "vitest";

import {
	DEFAULT_CLOSING_VARIANCE_TOLERANCE,
	getClosingVariances,
	resolveClosingVarianceTolerance,
} from "../src/posapp/utils/closingVariance";

const row = (mode_of_payment: string, expected_amount: number, closing_amount: unknown) => ({
	mode_of_payment,
	expected_amount,
	closing_amount,
});

describe("closing variance", () => {
	it("uses the POS Profile tolerance, or 0.500 when it isn't set", () => {
		expect(DEFAULT_CLOSING_VARIANCE_TOLERANCE).toBe(0.5);
		expect(resolveClosingVarianceTolerance({ posa_closing_variance_tolerance: 1.25 })).toBe(1.25);
		expect(resolveClosingVarianceTolerance({ posa_closing_variance_tolerance: 0 })).toBe(0);
		expect(resolveClosingVarianceTolerance({ posa_closing_variance_tolerance: "0.100" })).toBe(0.1);
		for (const missing of [{}, null, undefined, { posa_closing_variance_tolerance: null }, { posa_closing_variance_tolerance: "" }]) {
			expect(resolveClosingVarianceTolerance(missing)).toBe(0.5);
		}
		expect(resolveClosingVarianceTolerance({ posa_closing_variance_tolerance: -1 })).toBe(0.5);
	});

	it("flags nothing within the tolerance, including exactly 0.500 either way", () => {
		expect(
			getClosingVariances(
				[row("Cash", 139.3, 138.8), row("Visa", 87.65, 88.15), row("Maal", 12.005, 12.005)],
				0.5,
			),
		).toEqual([]);
	});

	it("flags 0.501 short and 0.501 over, with the right direction and exact difference", () => {
		expect(
			getClosingVariances([row("Cash", 139.3, 138.799), row("Visa", 87.65, 88.151)], 0.5),
		).toEqual([
			{ mode_of_payment: "Cash", difference: -0.501, direction: "short" },
			{ mode_of_payment: "Visa", difference: 0.501, direction: "over" },
		]);
	});

	it("with a tolerance of 0, any baisa is flagged", () => {
		expect(getClosingVariances([row("Cash", 12.005, 12.004)], 0)).toEqual([
			{ mode_of_payment: "Cash", difference: -0.001, direction: "short" },
		]);
	});

	it("treats an empty closing amount as 0 (a full shortage)", () => {
		expect(getClosingVariances([row("Cash", 45.5, ""), row("Visa", 10, null)], 0.5)).toEqual([
			{ mode_of_payment: "Cash", difference: -45.5, direction: "short" },
			{ mode_of_payment: "Visa", difference: -10, direction: "short" },
		]);
	});

	it("handles no rows", () => {
		expect(getClosingVariances(undefined, 0.5)).toEqual([]);
		expect(getClosingVariances([], 0.5)).toEqual([]);
	});
});
