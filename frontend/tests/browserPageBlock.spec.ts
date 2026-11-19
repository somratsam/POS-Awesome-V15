// The receipt, credit note voucher and Z Report carry an 80 mm @page rule for
// browser printing. QZ Tray must get the HTML without it (exactly what it
// printed before): stripBrowserPageBlock() in qzTray.ts.
import { describe, expect, it, vi } from "vitest";

const qzMock = vi.hoisted(() => ({
	print: vi.fn(async () => undefined),
	createConfig: vi.fn((_printer: unknown, options: unknown) => ({ options })),
}));
vi.mock("qz-tray", () => ({
	default: {
		websocket: {
			isActive: () => true,
			connect: vi.fn(async () => undefined),
			disconnect: vi.fn(async () => undefined),
			setClosedCallbacks: vi.fn(),
		},
		printers: { find: vi.fn(async () => ["Epson"]) },
		security: {
			setCertificatePromise: vi.fn(),
			setSignatureAlgorithm: vi.fn(),
			setSignaturePromise: vi.fn(),
		},
		configs: { create: qzMock.createConfig },
		print: qzMock.print,
	},
}));
vi.mock("../src/posapp/stores/uiStore", () => ({
	useUIStore: () => ({ posProfile: { posa_qz_printer_name: "Epson" } }),
}));

import { stripBrowserPageBlock } from "../src/posapp/services/qzTray";

const templates = import.meta.glob("../../posawesome/templates/print/{swan_receipt,credit_note_voucher}.html", {
	as: "raw",
	eager: true,
}) as Record<string, string>;
const zReport = JSON.parse(
	Object.values(
		import.meta.glob("../../posawesome/posawesome/print_format/z_report/z_report.json", {
			as: "raw",
			eager: true,
		}) as Record<string, string>,
	)[0],
).html as string;

const sources: Record<string, string> = {
	receipt: Object.entries(templates).find(([f]) => f.includes("swan_receipt"))![1],
	voucher: Object.entries(templates).find(([f]) => f.includes("credit_note_voucher"))![1],
	zReport,
};

describe("80 mm browser page block in the print templates", () => {
	it.each(Object.keys(sources))("%s has one marked 80 mm @page block inside @media print", (key) => {
		const text = sources[key];
		expect(text.match(/posa-browser-page:start/g)).toHaveLength(1);
		expect(text.match(/posa-browser-page:end/g)).toHaveLength(1);
		expect(text).toMatch(/@media print \{ @page \{ size: 80mm \{\{ _(pdf_h|zh) \}\}mm; margin: 2mm; \} \}/);
		// The only @page in the file is the marked one.
		expect(stripBrowserPageBlock(text)).not.toContain("@page");
		expect(stripBrowserPageBlock(text)).not.toContain("posa-browser-page");
	});

	it("removes the receipt/voucher block lines exactly, keeping the rest of the <style>", () => {
		const html = `<style>\n  .a { x: 1; }\n  /* posa-browser-page:start  note\n     more */\n  @media print { @page { size: 80mm 300mm; margin: 2mm; } }\n  /* posa-browser-page:end */\n</style>\n<p>Doc</p>`;
		expect(stripBrowserPageBlock(html)).toBe(`<style>\n  .a { x: 1; }\n</style>\n<p>Doc</p>`);
	});

	it("removes a <style> that holds only the block (Z Report)", () => {
		const html = `<p>Z</p>\n<style>\n  /* posa-browser-page:start  x */\n  @media print { @page { size: 80mm 500mm; margin: 2mm; } }\n  /* posa-browser-page:end */\n</style>\n`;
		expect(stripBrowserPageBlock(html)).toBe(`<p>Z</p>\n`);
	});

	it("leaves HTML without the block unchanged", () => {
		const html = "<style>.a{}</style><p>Doc</p>";
		expect(stripBrowserPageBlock(html)).toBe(html);
		expect(stripBrowserPageBlock("")).toBe("");
	});

	it("QZ Tray is sent the document without the @page rule", async () => {
		(globalThis as any).frappe = {
			call: vi.fn(async () => ({
				message: {
					html: `<style>\n  .x { y: 1; }\n  /* posa-browser-page:start */\n  @media print { @page { size: 80mm 300mm; margin: 2mm; } }\n  /* posa-browser-page:end */\n</style><p>Receipt</p>`,
					style: "",
				},
			})),
		};
		const qzTray = await import("../src/posapp/services/qzTray");
		await qzTray.printDocumentViaQz({ doctype: "Sales Invoice", name: "SINV-1" });
		const [, data] = qzMock.print.mock.calls[0] as unknown as [unknown, any[]];
		expect(data[0].data).toContain("<p>Receipt</p>");
		expect(data[0].data).toContain(".x { y: 1; }");
		expect(data[0].data).not.toContain("@page");
	});
});
