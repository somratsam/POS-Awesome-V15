// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({ isDark: { value: false } }),
}));

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({ windowWidth: { value: 1400 } }),
}));

vi.mock("../src/offline/index", () => ({
	isOffline: () => false,
}));

vi.mock("../src/posapp/plugins/print", () => ({
	appendDebugPrintParam: (url: string) => url,
	isDebugPrintEnabled: () => false,
	silentPrint: vi.fn(),
	watchPrintWindow: vi.fn(),
}));

const qz = vi.hoisted(() => ({ enabled: false, print: vi.fn() }));
vi.mock("../src/posapp/services/documentPrint", () => ({
	confirmDocumentPrintFallback: vi.fn(),
	printDocumentViaConfiguredQz: qz.print,
	shouldUseConfiguredQzDocumentPrinting: () => qz.enabled,
	shouldUseRawDocumentPrinting: () => false,
}));

const ui = vi.hoisted(() => ({ lastInvoiceId: "", posProfile: null as any }));
vi.mock("../src/posapp/stores/uiStore", () => ({
	useUIStore: () => ui,
}));

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => toast,
}));

import {
	CREDIT_NOTE_REPRINT_METHOD,
	recordCreditNoteReprint,
} from "../src/posapp/utils/creditNoteReprint";
import InvoiceManagement from "../src/posapp/components/pos/flows/InvoiceManagement.vue";
import { useLastInvoicePrinting } from "../src/posapp/composables/core/useLastInvoicePrinting";

const REPRINT = encodeURIComponent(JSON.stringify({ is_reprint: 1 }));
const profile = { name: "Test Pos", print_format: "Swan Sales Invoice", letter_head: "" };

let openSpy: ReturnType<typeof vi.fn>;
let events: string[];

// The reprint check is a direct server call (no Frappe message box).
let fetchSpy: ReturnType<typeof vi.fn>;
function serverSays(creditNote: boolean | "refuse") {
	fetchSpy = vi.fn(async (url: string, init: any) => {
		const method = url.replace("/api/method/", "");
		events.push(`call:${method}`);
		(fetchSpy as any).lastBody = JSON.parse(init.body);
		if (creditNote === "refuse") {
			return {
				ok: false,
				status: 403,
				json: async () => ({
					_server_messages: JSON.stringify([
						JSON.stringify({ message: "This POS terminal is locked. Verify a cashier PIN to continue." }),
					]),
				}),
			};
		}
		return { ok: true, status: 200, json: async () => ({ message: { credit_note: creditNote } }) };
	});
	vi.stubGlobal("fetch", fetchSpy);
}

beforeEach(() => {
	events = [];
	(globalThis as any).__ = (text: string) => text;
	(globalThis as any).frappe = { urllib: { get_base_url: () => "http://pos" }, csrf_token: "t" };
	toast.show.mockReset();
	openSpy = vi.fn((url: string) => {
		events.push(`open:${url}`);
		return {};
	});
	vi.stubGlobal("open", openSpy);
	qz.enabled = false;
	qz.print.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("recordCreditNoteReprint", () => {
	it("asks the server and reports whether it is a credit note voucher", async () => {
		serverSays(true);
		await expect(
			recordCreditNoteReprint({ doctype: "Sales Invoice", name: "SINV-1", posProfile: "Test Pos" }),
		).resolves.toBe(true);
		expect(events).toEqual([`call:${CREDIT_NOTE_REPRINT_METHOD}`]);
		expect((fetchSpy as any).lastBody).toEqual({ doctype: "Sales Invoice", name: "SINV-1", pos_profile: "Test Pos" });
		serverSays(false);
		await expect(recordCreditNoteReprint({ doctype: "Sales Invoice", name: "SINV-2" })).resolves.toBe(false);
	});

	it("passes a refusal on", async () => {
		serverSays("refuse");
		await expect(recordCreditNoteReprint({ doctype: "Sales Invoice", name: "SINV-1" })).rejects.toThrow(
			"This POS terminal is locked. Verify a cashier PIN to continue.",
		);
	});
});

describe("Invoice Management reprint", () => {
	const reprint = (invoice: any) => {
		const ctx = {
			toastStore: toast,
			posProfile: profile,
			currentInvoiceDoctype: "Sales Invoice",
			resolveReprintPrintFormat: async () => "Swan Sales Invoice",
		};
		return (InvoiceManagement as any).methods.printInvoice.call(ctx, invoice);
	};

	it("records the reprint first, then prints a DUPLICATE", async () => {
		serverSays(true);
		await reprint({ name: "ACC-SINV-2026-00247" });
		expect(events[0]).toBe(`call:${CREDIT_NOTE_REPRINT_METHOD}`);
		expect(events[1]).toMatch(/^open:.*name=ACC-SINV-2026-00247/);
		expect(events[1]).toContain(`settings=${REPRINT}`);
	});

	it("prints nothing when the server refuses, and says why in red", async () => {
		serverSays("refuse");
		await reprint({ name: "ACC-SINV-2026-00247" });
		expect(openSpy).not.toHaveBeenCalled();
		expect(toast.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "This POS terminal is locked. Verify a cashier PIN to continue.",
				color: "red-darken-3",
				timeout: 8000,
			}),
		);
	});

	it("sends the reprint flag to QZ too", async () => {
		serverSays(true);
		qz.enabled = true;
		await reprint({ name: "ACC-SINV-2026-00247" });
		expect(qz.print).toHaveBeenCalledWith(expect.objectContaining({ settings: JSON.stringify({ is_reprint: 1 }) }));
	});
});

describe("Print last invoice", () => {
	beforeEach(() => {
		ui.lastInvoiceId = "ACC-SINV-2026-00247";
		ui.posProfile = profile;
	});

	it("prints a credit note voucher as a DUPLICATE after recording it", async () => {
		serverSays(true);
		await useLastInvoicePrinting().printLastInvoice();
		expect(events[0]).toBe(`call:${CREDIT_NOTE_REPRINT_METHOD}`);
		expect(events[1]).toContain(`settings=${REPRINT}`);
	});

	it("prints other invoices as before", async () => {
		serverSays(false);
		await useLastInvoicePrinting().printLastInvoice();
		expect(events[1]).toMatch(/^open:/);
		expect(events[1]).not.toContain("settings=");
	});

	it("sends the reprint flag to QZ for a voucher only", async () => {
		qz.enabled = true;
		serverSays(true);
		await useLastInvoicePrinting().printLastInvoice();
		expect(qz.print.mock.calls[0][0].settings).toBe(JSON.stringify({ is_reprint: 1 }));
		serverSays(false);
		await useLastInvoicePrinting().printLastInvoice();
		expect(qz.print.mock.calls[1][0]).not.toHaveProperty("settings");
	});

	it("prints nothing when the server refuses, and says why in red", async () => {
		serverSays("refuse");
		await useLastInvoicePrinting().printLastInvoice();
		expect(openSpy).not.toHaveBeenCalled();
		expect(qz.print).not.toHaveBeenCalled();
		expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red-darken-3", timeout: 8000 }));
	});
});
