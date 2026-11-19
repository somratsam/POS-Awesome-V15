// Section 112: the store scanners (LS2208) send Enter after each scan.
// Enter in the item box ends what the scanner typed (useScannerInput.claimEnter,
// called first in ItemsSelector.onEnter): it cancels the pending receipt
// (250 ms) and keyboard-scan (100 ms) timers -- a receipt opened twice before --
// and tells whether the text came at scanner speed, so an unknown barcode is a
// high-confidence miss ("Item not found" + error sound), not a silent search.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: vi.fn() }) }));
vi.mock("../src/posapp/stores/exchangeStore", () => ({
	peekExchangeStore: () => ({ enabled: true }),
	useExchangeStore: () => ({ enabled: false }),
}));

import { useScannerInput } from "../src/posapp/composables/pos/items/useScannerInput";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

let now = 0;

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as any).__ = (value: string) => value;
	now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const make = () => {
	const field = { value: "" };
	const onScan = vi.fn().mockResolvedValue(undefined);
	const scanner = useScannerInput({ onScan, getSearchInput: () => field.value });
	return { field, onScan, scanner };
};

/** Keys into the box at `gap` ms each; Enter follows `enterAfter` ms later (no settle). */
const typeThenEnter = async (scanner: any, field: { value: string }, text: string, gap: number, enterAfter = 3) => {
	for (const [i, char] of [...text].entries()) {
		scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
		field.value += char;
		scanner.handleSearchInput(field.value);
		if (i < text.length - 1) {
			now += gap;
			await vi.advanceTimersByTimeAsync(gap);
		}
	}
	now += enterAfter;
	await vi.advanceTimersByTimeAsync(enterAfter);
	return scanner.claimEnter(field.value);
};

// The clock moves with the timers, step by step, as in useScannerInput.spec.
const waitLong = async () => {
	for (let i = 0; i < 25; i++) {
		now += 20;
		await vi.advanceTimersByTimeAsync(20);
	}
};

describe("Enter after a scan", () => {
	it("a 14-digit barcode at scanner speed is a hardware scan, and the timer doesn't scan it again", async () => {
		const { field, onScan, scanner } = make();
		expect(await typeThenEnter(scanner, field, "30410232030045", 5)).toBe(true);
		await waitLong();
		expect(onScan).not.toHaveBeenCalled(); // onEnter sends it, once
	});

	it("a Charlotte Wix code with a space at scanner speed too", async () => {
		const { field, scanner } = make();
		expect(await typeThenEnter(scanner, field, "PA4 79SF", 6)).toBe(true);
	});

	it("the same text typed by hand is not a scan", async () => {
		const { field, scanner } = make();
		expect(await typeThenEnter(scanner, field, "30410232030045", 120)).toBe(false);
	});

	it("hand typing in quick pairs is not a scan, even when the last pair is fast", async () => {
		const { field, scanner } = make();
		const text = "30410232030045";
		for (let i = 0; i < text.length; i += 2) {
			for (const [j, char] of [...text.slice(i, i + 2)].entries()) {
				scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
				field.value += char;
				scanner.handleSearchInput(field.value);
				const gap = j === 0 ? 30 : 150; // 30 ms inside a pair, 150 ms between pairs
				if (i + j < text.length - 1) {
					now += gap;
					await vi.advanceTimersByTimeAsync(gap);
				}
			}
		}
		now += 3;
		await vi.advanceTimersByTimeAsync(3);
		expect(scanner.claimEnter(field.value)).toBe(false);
	});

	it("a scan into a box that already held hand-typed text is not a whole-code scan", async () => {
		const { field, scanner } = make();
		for (const char of "abc") {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			field.value += char;
			scanner.handleSearchInput(field.value);
			now += 200;
			await vi.advanceTimersByTimeAsync(200);
		}
		expect(await typeThenEnter(scanner, field, "30410232030045", 5)).toBe(false);
	});

	it("a pasted code (no keystrokes) is not a scan", () => {
		const { field, scanner } = make();
		field.value = "30410232030045";
		scanner.handleSearchInput(field.value);
		expect(scanner.claimEnter(field.value)).toBe(false);
	});

	it("short codes are not scans (under the 7-character floor)", async () => {
		const { field, scanner } = make();
		expect(await typeThenEnter(scanner, field, "12345", 5)).toBe(false);
	});

	it("a receipt at scanner speed + Enter: neither timer opens it again", async () => {
		const { field, onScan, scanner } = make();
		expect(await typeThenEnter(scanner, field, "2026-00417", 5)).toBe(false); // onEnter's receipt branch opens it
		await waitLong();
		expect(onScan).not.toHaveBeenCalled();
	});

	it("a receipt from a slow scanner + Enter: the 250 ms settle doesn't open it again", async () => {
		const { field, onScan, scanner } = make();
		expect(await typeThenEnter(scanner, field, "MCO-2026-00030", 60)).toBe(false);
		await waitLong();
		expect(onScan).not.toHaveBeenCalled();
	});

	it("without Enter nothing changes: the timer still scans it (high)", async () => {
		const { field, onScan, scanner } = make();
		for (const char of "30410232030045") {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			field.value += char;
			scanner.handleSearchInput(field.value);
			now += 5;
			await vi.advanceTimersByTimeAsync(5);
		}
		await waitLong();
		expect(onScan).toHaveBeenCalledWith("30410232030045", "high");
	});
});

describe("ItemsSelector.onEnter", () => {
	const body = selectorSource.slice(selectorSource.indexOf("const onEnter = (e) => {"));
	const onEnter = body.slice(0, body.indexOf("\n};") + 3);

	it("claims Enter before any branch (receipt, voucher, counter grid, search)", () => {
		const claim = onEnter.indexOf("scannerInput.claimEnter");
		expect(claim).toBeGreaterThan(0);
		for (const later of ['presentation === "counter-grid-dialog"', "looksLikeReceipt(typed)", "looksLikeVoucher(typed)"]) {
			expect(onEnter.indexOf(later), later).toBeGreaterThan(claim);
		}
	});

	it("a hardware scan goes to the scan pipeline as high confidence, not to the search", () => {
		const route = onEnter.indexOf('onBarcodeScannedFromScannerInput(typed, "high")');
		expect(route).toBeGreaterThan(onEnter.indexOf("looksLikeVoucher(typed)"));
		expect(route).toBeLessThan(onEnter.lastIndexOf("itemsSelectorSearch.onEnter(e)"));
	});
});
