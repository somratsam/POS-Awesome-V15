import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({
		show: vi.fn(),
	}),
}));

import { useScannerInput } from "../src/posapp/composables/pos/items/useScannerInput";

describe("useScannerInput", () => {
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
		delete (globalThis as any).__;
	});

	it("auto-processes rapid numeric input without requiring Enter", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		searchValue = "123456789012";
		scanner.handleSearchInput(searchValue);

		now += 150;
		await vi.advanceTimersByTimeAsync(150);
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("123456789012", "low");
	});

	it("does not auto-process short numeric input", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		searchValue = "12345";
		scanner.handleSearchInput(searchValue);
		now += 220;
		await vi.advanceTimersByTimeAsync(220);

		expect(onScan).not.toHaveBeenCalled();
	});

	it("coalesces the same barcode while its scan pipeline is active", async () => {
		let finishScan: (() => void) | undefined;
		const onScan = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishScan = resolve;
				}),
		);
		const scanner = useScannerInput({ onScan });

		scanner.onBarcodeScanned("123456789012");
		scanner.onBarcodeScanned("123456789012");
		await vi.advanceTimersByTimeAsync(32);
		expect(onScan).toHaveBeenCalledTimes(1);

		scanner.onBarcodeScanned("123456789012");
		await vi.advanceTimersByTimeAsync(32);
		expect(onScan).toHaveBeenCalledTimes(1);

		finishScan?.();
		await vi.advanceTimersByTimeAsync(1);
		scanner.onBarcodeScanned("123456789012");
		await vi.advanceTimersByTimeAsync(32);
		expect(onScan).toHaveBeenCalledTimes(2);
	});

	it("starts with no scan-variant hint, and clearScanVariantHint resets it to null", () => {
		const scanner = useScannerInput({});

		expect(scanner.scanVariantHint.value).toBeNull();

		scanner.scanVariantHint.value = {
			itemCode: "ITEM-BLUE-M",
			itemName: "Style 123 - Blue - Medium",
			variantOf: "STYLE-123",
		};
		scanner.clearScanVariantHint();

		expect(scanner.scanVariantHint.value).toBeNull();
	});

	// Real Charlotte Wix / GEOX / LIU.JO barcode formats are alphanumeric,
	// contain an internal space, and are as short as 7 characters -- none of
	// which the old digits-only, 12-char-minimum detection could recognize
	// at all. See PROGRESS_NOTES.md section 34.

	it("auto-processes a real Charlotte Wix barcode via handleSearchInput (virtual-scanner path)", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		searchValue = "PA4 79SF";
		scanner.handleSearchInput(searchValue);

		now += 150;
		await vi.advanceTimersByTimeAsync(150);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("PA4 79SF", "low");
	});

	it("does not auto-process short alphanumeric input (still under the 7-char floor)", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		searchValue = "PA47";
		scanner.handleSearchInput(searchValue);
		now += 220;
		await vi.advanceTimersByTimeAsync(220);

		expect(onScan).not.toHaveBeenCalled();
	});

	it("recognizes a real Charlotte Wix barcode typed at hardware-scanner speed (rapid keystrokes)", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		const barcode = "PA4 79SF";
		for (const char of barcode) {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			searchValue += char;
			now += 5;
			await vi.advanceTimersByTimeAsync(5);
		}

		now += 100;
		await vi.advanceTimersByTimeAsync(100);
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("PA4 79SF", "high");
	});

	it("does not treat the same characters typed at ordinary human speed as a scan", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		const barcode = "PA4 79SF";
		for (const char of barcode) {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			searchValue += char;
			now += 200; // well above keyboardScanMaxInterval (45ms)
			await vi.advanceTimersByTimeAsync(200);
		}

		now += 150;
		await vi.advanceTimersByTimeAsync(150);

		expect(onScan).not.toHaveBeenCalled();
	});

	it("still recognizes a real numeric barcode via rapid keystroke timing (existing brands unaffected)", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		const barcode = "30410232030043"; // real MAX&CO.-shaped 14-digit barcode
		for (const char of barcode) {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			searchValue += char;
			now += 5;
			await vi.advanceTimersByTimeAsync(5);
		}

		now += 100;
		await vi.advanceTimersByTimeAsync(100);
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith(barcode, "high");
	});

	it("tags a pasted barcode as low confidence", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
			setSearchInput: (value: string) => {
				searchValue = value;
			},
		});

		const pasteEvent = {
			preventDefault: vi.fn(),
			clipboardData: { getData: () => "PA4 79SF" },
		} as unknown as ClipboardEvent;
		scanner.handleSearchPaste(pasteEvent);
		await nextTick();
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("PA4 79SF", "low");
	});

	it("tags a direct triggerOnScan call (onScan.js hardware library) as high confidence", async () => {
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({ onScan });

		scanner.triggerOnScan("PA4 79SF");
		await nextTick();
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("PA4 79SF", "high");
	});

	// Real DOM wiring fires handleSearchKeydown (keydown) AND handleSearchInput
	// (update:model-value) for every keystroke, in that order, unlike the
	// earlier tests above which each only drive one path in isolation. For
	// genuinely fast (scanner-speed) typing, both paths track the same value;
	// without deferring to handleSearchKeydown's own decision, handleSearchInput
	// would also independently schedule a second, redundant evaluation for
	// the exact same moment. Confirms only one evaluation actually fires.
	it("does not double-fire when both keydown and input paths track the same fast-typed sequence", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		const barcode = "PA4 79SF";
		for (const char of barcode) {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			searchValue += char;
			scanner.handleSearchInput(searchValue);
			now += 5;
			await vi.advanceTimersByTimeAsync(5);
		}

		now += 100;
		await vi.advanceTimersByTimeAsync(100);
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("PA4 79SF", "high");
	});

	// The actual reported bug: ordinary human typing speed (each gap well
	// above keyboardScanMaxInterval, so handleSearchKeydown's own buffer
	// never accumulates -- handleSearchInput's idle-settle check is the sole
	// decider here, exactly as before the timing-race defer, since that
	// defer only applies to genuinely fast typing) pausing >100ms right
	// before the final character of an 8-character barcode. A premature
	// evaluation of the incomplete "PA4 79S" firing is not itself
	// prevented (there is no reliable way to know typing has actually
	// stopped vs. merely paused) -- what matters, and what this proves, is
	// that any such premature call is tagged "low" confidence, never
	// "high", so it can never surface as a user-facing error (see
	// ScanConfidence / useScanProcessor.ts), and the real, complete value
	// still succeeds once it arrives.
	it("tags a premature idle-settle fire on human-paced typing as low confidence, never high", async () => {
		let searchValue = "";
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({
			onScan,
			getSearchInput: () => searchValue,
		});

		const typeChar = async (char: string, gapMs: number) => {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			searchValue += char;
			scanner.handleSearchInput(searchValue);
			now += gapMs;
			await vi.advanceTimersByTimeAsync(gapMs);
		};

		// "PA4 79S" -- 7 characters, at a realistic human pace (well above
		// keyboardScanMaxInterval of 45ms), reaching keyboardScanMinLength.
		for (const char of "PA4 79S") {
			await typeChar(char, 60);
		}

		// Realistic pause before the final character.
		now += 150;
		await vi.advanceTimersByTimeAsync(150);

		// A premature call may or may not have fired for the incomplete
		// value -- that's an accepted, invisible-to-the-user tradeoff, not
		// a bug. What must always hold is that it was never "high".
		for (const call of onScan.mock.calls) {
			expect(call[1]).toBe("low");
		}

		// Finish typing "F".
		await typeChar("F", 60);
		now += 100;
		await vi.advanceTimersByTimeAsync(100);
		now += 32;
		await vi.advanceTimersByTimeAsync(32);

		const finalCall = onScan.mock.calls.at(-1);
		expect(finalCall).toEqual(["PA4 79SF", "low"]);
	});
});
