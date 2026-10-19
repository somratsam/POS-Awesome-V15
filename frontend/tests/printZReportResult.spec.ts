import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const printDocumentViaQz = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("../src/posapp/services/qzTray", () => ({ printDocumentViaQz }));
vi.mock("../src/posapp/services/rawDocumentPrint", () => ({
	printRawDocumentViaQz: vi.fn(),
	shouldUseRawDocumentPrinting: vi.fn(() => false),
}));
vi.mock("../src/posapp/stores/toastStore.js", () => ({
	useToastStore: () => ({ show: showToast }),
}));

import { printZReport } from "../src/posapp/services/documentPrint";

describe("printZReport result", () => {
	beforeEach(() => {
		printDocumentViaQz.mockReset();
		showToast.mockReset();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports ok when QZ Tray accepts the job", async () => {
		printDocumentViaQz.mockResolvedValue(undefined);

		await expect(printZReport("POSA-CS-1")).resolves.toEqual({ ok: true });
		expect(printDocumentViaQz).toHaveBeenCalledWith({
			doctype: "POS Closing Shift",
			name: "POSA-CS-1",
			printFormat: "Z Report",
			noLetterhead: 1,
		});
		expect(showToast).not.toHaveBeenCalled();
	});

	it("reports the reason when printing fails, and still shows the toast", async () => {
		printDocumentViaQz.mockRejectedValue(new Error("QZ Tray is not available."));

		await expect(printZReport("POSA-CS-1")).resolves.toEqual({
			ok: false,
			error: "QZ Tray is not available.",
		});
		// Z Report History relies on this toast; it stays as it was.
		expect(showToast).toHaveBeenCalledWith({ title: "Z Report print failed", color: "warning" });
	});
});
