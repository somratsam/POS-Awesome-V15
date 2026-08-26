import { describe, expect, it } from "vitest";

import { classifyClipboardScanText } from "../src/posapp/composables/pos/items/scannerInput/clipboardScan";

describe("classifyClipboardScanText", () => {
	it("blocks and scans sanitized numeric clipboard text that meets the scan length", () => {
		expect(classifyClipboardScanText("  123456789012  ", 7)).toEqual({
			sanitizedText: "123456789012",
			shouldPreventDefault: true,
			shouldScan: true,
		});
	});

	it("blocks whitespace-only clipboard text without scanning", () => {
		expect(classifyClipboardScanText(" \n\t ", 7)).toEqual({
			sanitizedText: "",
			shouldPreventDefault: true,
			shouldScan: false,
		});
	});

	it("leaves non-scan clipboard text for normal paste handling", () => {
		expect(classifyClipboardScanText("12345", 7)).toEqual({
			sanitizedText: "12345",
			shouldPreventDefault: false,
			shouldScan: false,
		});
		expect(classifyClipboardScanText("black dress, size M", 7)).toEqual({
			sanitizedText: "black dress, size M",
			shouldPreventDefault: false,
			shouldScan: false,
		});
	});

	// Real Charlotte Wix / GEOX / LIU.JO barcode formats (see
	// PROGRESS_NOTES.md section 34) -- letters, an internal space, and one
	// lowercase example. These previously failed unconditionally: the old
	// digits-only isNumericString() check rejected every one of them
	// regardless of length.
	it("scans real Charlotte Wix barcode formats (letters + internal space)", () => {
		expect(classifyClipboardScanText("PA4 79SF", 7)).toEqual({
			sanitizedText: "PA4 79SF",
			shouldPreventDefault: true,
			shouldScan: true,
		});
		expect(classifyClipboardScanText("FE1 10L/XL", 7)).toEqual({
			sanitizedText: "FE1 10L/XL",
			shouldPreventDefault: true,
			shouldScan: true,
		});
	});

	it("scans real GEOX exception barcode format", () => {
		expect(classifyClipboardScanText("PYTSETPYTS10", 7)).toEqual({
			sanitizedText: "PYTSETPYTS10",
			shouldPreventDefault: true,
			shouldScan: true,
		});
	});

	it("scans real LIU.JO exception barcode format, preserving lowercase exactly", () => {
		expect(classifyClipboardScanText("dl0084003392", 7)).toEqual({
			sanitizedText: "dl0084003392",
			shouldPreventDefault: true,
			shouldScan: true,
		});
	});

	it("trims accidental leading/trailing whitespace from a pasted barcode", () => {
		expect(classifyClipboardScanText("  PA4 79SF  ", 7)).toEqual({
			sanitizedText: "PA4 79SF",
			shouldPreventDefault: true,
			shouldScan: true,
		});
	});

	it("no longer collapses internal whitespace -- a barcode with a meaningful internal space must survive intact", () => {
		// Previously sanitizeClipboardText stripped ALL whitespace, which
		// would have mangled "PA4 79SF" into "PA479SF" -- a different string
		// that would never match the real registered barcode. Only
		// leading/trailing whitespace may be trimmed now.
		const result = classifyClipboardScanText("PA4 79SF", 7);
		expect(result.sanitizedText).toBe("PA4 79SF");
		expect(result.sanitizedText).not.toBe("PA479SF");
	});

	it("falls through to normal search for text shorter than the scan length floor", () => {
		expect(classifyClipboardScanText("PA4SF", 7)).toEqual({
			sanitizedText: "PA4SF",
			shouldPreventDefault: false,
			shouldScan: false,
		});
	});

	it("rejects characters outside the real barcode charset regardless of length", () => {
		expect(classifyClipboardScanText("ABC-123-456-789", 7)).toEqual({
			sanitizedText: "ABC-123-456-789",
			shouldPreventDefault: false,
			shouldScan: false,
		});
	});
});
