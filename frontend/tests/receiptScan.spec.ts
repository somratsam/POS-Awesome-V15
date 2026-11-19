// Section 109: a scanned receipt barcode ("MCO-2026-00030", with dashes)
// opens by itself, like a credit note voucher -- no Enter -- in the main scan
// box and the return search box: a complete receipt number opens once the box
// is quiet for 250 ms (any scanner speed; at scanner speed even sooner). A
// half number never opens; Enter still works and never opens it twice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let exchangeEnabled = true;
vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: vi.fn() }) }));
vi.mock("../src/posapp/stores/exchangeStore", () => ({
	peekExchangeStore: () => ({ enabled: exchangeEnabled }),
	// The receipt route itself is covered in oneScreenExchange.spec; here the
	// scan reaching onBarcodeScanned is what matters.
	useExchangeStore: () => ({ enabled: false }),
}));

import { useScannerInput } from "../src/posapp/composables/pos/items/useScannerInput";
import { createReceiptScanWatcher, isFullReceiptCode } from "../src/posapp/utils/keyboardScan";
import returnsSource from "../src/posapp/components/pos/flows/Returns.vue?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

let now = 0;

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as any).__ = (value: string) => value;
	now = 0;
	exchangeEnabled = true;
	vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("a complete receipt number", () => {
	it("is year-number with 5+ digits, a store prefix and an amendment allowed", () => {
		for (const ok of ["MCO-2026-00030", "2026-00210", "ACC-SINV-2026-00399", "MCO-2026-00030-1"]) {
			expect(isFullReceiptCode(ok), ok).toBe(true);
		}
		// Half-scanned / half-typed, or not a receipt at all.
		for (const no of ["MCO-2026-0003", "MCO-2026-", "MCO-202", "2026", "t-shirt", "C26-MCO-00019-6S78", ""]) {
			expect(isFullReceiptCode(no), no).toBe(false);
		}
	});
});

describe("main scan box", () => {
	const type = async (scanner: any, text: string, gap: number, field: { value: string }) => {
		for (const char of text) {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			field.value += char;
			scanner.handleSearchInput(field.value);
			now += gap;
			await vi.advanceTimersByTimeAsync(gap);
		}
		now += 150;
		await vi.advanceTimersByTimeAsync(150);
	};
	const make = () => {
		const field = { value: "" };
		const onScan = vi.fn().mockResolvedValue(undefined);
		const scanner = useScannerInput({ onScan, getSearchInput: () => field.value });
		return { field, onScan, scanner };
	};

	it("a scanned receipt opens without Enter", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "MCO-2026-00030", 6, field);
		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("MCO-2026-00030", "high");
	});

	it("a default-series receipt (2026-00210) too", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "2026-00210", 6, field);
		expect(onScan).toHaveBeenCalledWith("2026-00210", "high");
	});

	it("a slow scanner (or a full number typed by hand): opens once the box is quiet, once", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "MCO-2026-00030", 60, field);
		now += 300;
		await vi.advanceTimersByTimeAsync(300);
		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("MCO-2026-00030", "low");
	});

	it("a fast scan opens once, not again when the box goes quiet", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "MCO-2026-00030", 6, field);
		now += 400;
		await vi.advanceTimersByTimeAsync(400);
		expect(onScan).toHaveBeenCalledTimes(1);
	});

	it("typing by hand + Enter: Enter opens it, nothing else does", async () => {
		const { field, onScan, scanner } = make();
		for (const char of "MCO-2026-00030") {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			field.value += char;
			scanner.handleSearchInput(field.value);
			now += 150;
			await vi.advanceTimersByTimeAsync(150);
		}
		scanner.handleSearchKeydown({ key: "Enter" } as KeyboardEvent);
		now += 600;
		await vi.advanceTimersByTimeAsync(600);
		expect(onScan).not.toHaveBeenCalled();
	});

	it("a pause in the middle of a number never fires on the half number", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "MCO-2026-0003", 6, field); // fast, but not complete
		now += 1000;
		await vi.advanceTimersByTimeAsync(1000);
		expect(onScan).not.toHaveBeenCalled();
		await type(scanner, "MCO-20", 200, field);
		now += 1000;
		await vi.advanceTimersByTimeAsync(1000);
		expect(onScan).not.toHaveBeenCalled();
	});

	it("dashed text that isn't a receipt is left for Enter (no item lookup)", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "AB-12-CD-34", 6, field);
		now += 1000;
		await vi.advanceTimersByTimeAsync(1000);
		expect(onScan).not.toHaveBeenCalled();
	});

	it("One-screen exchange off: a scanned receipt does nothing, as before", async () => {
		exchangeEnabled = false;
		const { field, onScan, scanner } = make();
		await type(scanner, "MCO-2026-00030", 6, field);
		now += 1000;
		await vi.advanceTimersByTimeAsync(1000);
		expect(onScan).not.toHaveBeenCalled();
	});

	it("a scanner that sends Enter after the code: opened once (by Enter), not twice", async () => {
		const { field, onScan, scanner } = make();
		for (const char of "MCO-2026-00030") {
			scanner.handleSearchKeydown({ key: char } as KeyboardEvent);
			field.value += char;
			now += 6;
			await vi.advanceTimersByTimeAsync(6);
		}
		scanner.handleSearchKeydown({ key: "Enter" } as KeyboardEvent);
		now += 600;
		await vi.advanceTimersByTimeAsync(600);
		expect(onScan).not.toHaveBeenCalled(); // Enter's own route opens it
	});

	it("item barcodes scan exactly as before", async () => {
		const { field, onScan, scanner } = make();
		await type(scanner, "47542497030013", 6, field);
		expect(onScan).toHaveBeenCalledWith("47542497030013", "high");
	});
});

describe("return search box", () => {
	const make = () => {
		const field = { value: "" };
		const onScan = vi.fn();
		const watcher = createReceiptScanWatcher({ getValue: () => field.value, onScan });
		const type = async (text: string, gap: number) => {
			for (const char of text) {
				watcher.onKeydown({ key: char } as KeyboardEvent);
				field.value += char;
				now += gap;
				await vi.advanceTimersByTimeAsync(gap);
			}
		};
		const wait = async (ms: number) => {
			now += ms;
			await vi.advanceTimersByTimeAsync(ms);
		};
		return { field, onScan, watcher, type, wait };
	};

	it("a scanned receipt searches by itself, once", async () => {
		const { onScan, type, wait } = make();
		await type("MCO-2026-00030", 6);
		await wait(1000);
		expect(onScan).toHaveBeenCalledTimes(1);
		expect(onScan).toHaveBeenCalledWith("MCO-2026-00030");
	});

	it("half a number, or not a receipt: nothing", async () => {
		const half = make();
		await half.type("MCO-2026-003", 150);
		await half.wait(1000);
		expect(half.onScan).not.toHaveBeenCalled();
		const name = make();
		await name.type("Ahmed", 6);
		await name.wait(1000);
		expect(name.onScan).not.toHaveBeenCalled();
	});

	it("Enter cancels the wait (Enter searches on its own)", async () => {
		const { onScan, watcher, type, wait } = make();
		await type("MCO-2026-00030", 6);
		watcher.onKeydown({ key: "Enter" } as KeyboardEvent);
		await wait(1000);
		expect(onScan).not.toHaveBeenCalled();
	});

	it("is wired to the Invoice ID field", () => {
		expect(returnsSource).toContain('@keydown="onInvoiceIdKeydown"');
		expect(returnsSource).toContain("onScan: () => this.search_invoices_by_enter()");
	});
});

describe("all profiles: One-screen exchange off opens the old Return dialog (section 110)", () => {
	it("a complete receipt opens Return with it searched; half numbers and returns-off profiles don't", async () => {
		vi.resetModules();
		const requestReturnFor = vi.fn();
		const profile: any = { company: "Swan", posa_allow_return: 1 };
		vi.doMock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ({ posProfile: profile, requestReturnFor }) }));
		vi.doMock("../src/posapp/stores/exchangeStore", () => ({
			peekExchangeStore: () => ({ enabled: false }),
			useExchangeStore: () => ({ enabled: false }),
		}));
		const route = await import("../src/posapp/composables/pos/items/exchangeScanRoute");
		expect(route.receiptRouteAvailable()).toBe(true);
		expect(route.dispatchExchangeScan("MCO-2026-00030", vi.fn())).toBe(true);
		expect(requestReturnFor).toHaveBeenCalledWith("MCO-2026-00030", "Swan");
		requestReturnFor.mockClear();
		expect(route.dispatchExchangeScan("MCO-2026-003", vi.fn())).toBe(false);
		expect(route.dispatchExchangeScan("47542497030013", vi.fn())).toBe(false);
		// The profile may carry 1, "1" or true (the Return button uses == 1).
		for (const value of ["1", true]) {
			profile.posa_allow_return = value;
			expect(route.receiptRouteAvailable()).toBe(true);
		}
		profile.posa_allow_return = 0;
		expect(route.receiptRouteAvailable()).toBe(false);
		expect(route.dispatchExchangeScan("MCO-2026-00030", vi.fn())).toBe(false);
		expect(requestReturnFor).not.toHaveBeenCalled();
		vi.doUnmock("../src/posapp/stores/uiStore");
	});

	it("the old Return dialog searches the scanned receipt and opens the exact match", () => {
		expect(returnsSource).toContain('const scanned = data && typeof data === "object" ? String(data.invoice || "") : "";');
		expect(returnsSource).toContain("() => this.uiStore?.returnRequest,");
		expect(returnsSource).toContain("this.openReturns({ company: request.company, invoice: request.invoice });");
		expect(returnsSource).toContain("this.$nextTick(() => this.search_invoices_by_enter());");
		expect(selectorSource).toContain("if (openOldReturnFor(typed)) {");
	});
});
