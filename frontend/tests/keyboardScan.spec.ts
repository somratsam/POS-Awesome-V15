import { describe, expect, it } from "vitest";

import { isLikelyKeyboardScan } from "../src/posapp/utils/keyboardScan";

describe("isLikelyKeyboardScan", () => {
	it("accepts a code whose average interval is within maxInterval", () => {
		expect(
			isLikelyKeyboardScan({
				code: "PA4 79SF",
				duration: 40, // 8 chars, 5ms/char average
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
			}),
		).toBe(true);
	});

	it("rejects a code whose average interval exceeds maxInterval", () => {
		expect(
			isLikelyKeyboardScan({
				code: "PA4 79SF",
				duration: 800, // 100ms/char average
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
			}),
		).toBe(false);
	});

	// A fast-typed prefix followed by one slow gap can still pass an
	// average-only check for a short sequence -- the many fast gaps dilute
	// the one slow one. maxGapObserved catches this even when the average
	// alone would not.
	it("rejects when the average is fast enough but one individual gap was not (maxGapObserved)", () => {
		// 6 gaps of 5ms + effectively diluted by a slow moment elsewhere would
		// still average under 45ms/char for a short code -- but the single
		// worst gap here (150ms) is what a real scanner would never produce.
		expect(
			isLikelyKeyboardScan({
				code: "PA4 79S",
				duration: 180, // ~25.7ms/char average -- passes the average check alone
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
				maxGapObserved: 150,
			}),
		).toBe(false);
	});

	it("still accepts when maxGapObserved is within maxInterval", () => {
		expect(
			isLikelyKeyboardScan({
				code: "PA4 79SF",
				duration: 40,
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
				maxGapObserved: 5,
			}),
		).toBe(true);
	});

	it("treats an omitted maxGapObserved as a no-op (backward compatible)", () => {
		expect(
			isLikelyKeyboardScan({
				code: "PA4 79SF",
				duration: 40,
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
			}),
		).toBe(true);
	});

	it("rejects non-barcode-charset codes regardless of timing", () => {
		expect(
			isLikelyKeyboardScan({
				code: "hello there!",
				duration: 10,
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
			}),
		).toBe(false);
	});

	it("rejects a code shorter than minLength regardless of timing", () => {
		expect(
			isLikelyKeyboardScan({
				code: "PA4",
				duration: 10,
				minLength: 7,
				maxDuration: 250,
				maxInterval: 45,
			}),
		).toBe(false);
	});
});
