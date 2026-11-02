// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const qzMock = vi.hoisted(() => {
	let websocketActive = false;

	const state = {
		posProfile: { value: null as Record<string, any> | null },
		isActive: vi.fn(() => websocketActive),
		connect: vi.fn(async () => {
			websocketActive = true;
		}),
		disconnect: vi.fn(async () => {
			websocketActive = false;
		}),
		setClosedCallbacks: vi.fn(),
		findPrinters: vi.fn(async () => [] as string[]),
		setCertificatePromise: vi.fn(),
		setSignatureAlgorithm: vi.fn(),
		setSignaturePromise: vi.fn(),
		createConfig: vi.fn((printer: string, options: Record<string, any>) => ({
			printer,
			options,
		})),
		print: vi.fn(async () => undefined),
		setActive(value: boolean) {
			websocketActive = value;
		},
	};

	return state;
});

vi.mock("qz-tray", () => ({
	default: {
		websocket: {
			isActive: qzMock.isActive,
			connect: qzMock.connect,
			disconnect: qzMock.disconnect,
			setClosedCallbacks: qzMock.setClosedCallbacks,
		},
		printers: {
			find: qzMock.findPrinters,
		},
		security: {
			setCertificatePromise: qzMock.setCertificatePromise,
			setSignatureAlgorithm: qzMock.setSignatureAlgorithm,
			setSignaturePromise: qzMock.setSignaturePromise,
		},
		configs: {
			create: qzMock.createConfig,
		},
		print: qzMock.print,
	},
}));

vi.mock("../src/posapp/stores/uiStore", () => ({
	useUIStore: () => ({
		posProfile: qzMock.posProfile,
	}),
}));

describe("qzTray service", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		window.localStorage.clear();
		qzMock.setActive(false);
		qzMock.posProfile.value = null;
		qzMock.findPrinters.mockResolvedValue([]);
		(globalThis as any).frappe = {
			call: vi.fn(),
		};
	});

	it("keeps QZ disconnected until the user manually reconnects", async () => {
		const qzTray = await import("../src/posapp/services/qzTray");
		qzMock.setActive(true);

		await qzTray.disconnectQzTray();

		expect(qzMock.disconnect).toHaveBeenCalledTimes(1);

		const printersWhilePaused = await qzTray.findQzPrinters();

		expect(printersWhilePaused).toEqual([]);
		expect(qzMock.connect).not.toHaveBeenCalled();

		await expect(qzTray.printHtmlViaQz("<p>Receipt</p>")).rejects.toThrow(
			"manually disconnected",
		);
		expect(qzMock.connect).not.toHaveBeenCalled();

		qzMock.findPrinters.mockResolvedValue(["Receipt Printer"]);

		await expect(
			qzTray.connectQzTray({ userInitiated: true }),
		).resolves.toBe(true);

		expect(qzMock.connect).toHaveBeenCalledTimes(1);

		const printersAfterReconnect = await qzTray.findQzPrinters();

		expect(printersAfterReconnect).toEqual(["Receipt Printer"]);
	});

	it("uses the POS Profile default printer until this browser saves a manual override", async () => {
		qzMock.posProfile.value = {
			posa_qz_printer_name: "Profile Printer",
		};
		qzMock.setActive(true);
		qzMock.findPrinters.mockResolvedValue([
			"Profile Printer",
			"Counter Printer",
		]);

		const qzTray = await import("../src/posapp/services/qzTray");

		await qzTray.findQzPrinters();

		expect(qzTray.selectedQzPrinter.value).toBe("Profile Printer");
		expect(window.localStorage.getItem("posa_qz_printer_name")).toBeNull();

		qzTray.setSelectedQzPrinter("Counter Printer");
		expect(window.localStorage.getItem("posa_qz_printer_name")).toBe(
			"Counter Printer",
		);

		await qzTray.findQzPrinters();
		expect(qzTray.selectedQzPrinter.value).toBe("Counter Printer");

		qzTray.setSelectedQzPrinter("");
		expect(window.localStorage.getItem("posa_qz_printer_name")).toBeNull();

		await qzTray.findQzPrinters();
		expect(qzTray.selectedQzPrinter.value).toBe("Profile Printer");
	});

	it("prefers the POS Profile default over a transient selected printer", async () => {
		qzMock.posProfile.value = {
			posa_qz_printer_name: "Profile Printer",
		};
		qzMock.setActive(true);

		const qzTray = await import("../src/posapp/services/qzTray");

		qzTray.selectedQzPrinter.value = "Printer A";

		await qzTray.printHtmlViaQz("<p>Receipt</p>");

		expect(qzMock.createConfig).toHaveBeenCalledWith(
			"Profile Printer",
			expect.any(Object),
		);
	});

	it("falls back to the first discovered printer when no override or profile default exists", async () => {
		qzMock.setActive(true);
		qzMock.findPrinters.mockResolvedValue(["Printer A", "Printer B"]);

		const qzTray = await import("../src/posapp/services/qzTray");

		await qzTray.findQzPrinters();

		expect(qzTray.selectedQzPrinter.value).toBe("Printer A");
	});

	describe("printable width", () => {
		const TODAYS_CONFIG = {
			size: { width: 80, height: null },
			units: "mm",
			orientation: "portrait",
			margins: { top: 0, right: 0, bottom: 0, left: 0 },
			colorType: "grayscale",
			interpolation: "nearest-neighbor",
		};

		function mockPrintHtml() {
			(globalThis as any).frappe.call = vi.fn(async () => ({
				message: { html: "<p>Doc</p>", style: "" },
			}));
		}

		function printed() {
			const [, options] = qzMock.createConfig.mock.calls[0];
			const [, data] = qzMock.print.mock.calls[0] as unknown as [unknown, any[]];
			return { options, data };
		}

		beforeEach(() => {
			qzMock.setActive(true);
			mockPrintHtml();
		});

		it("leaves the QZ config exactly as before when the profile has no printable width", async () => {
			qzMock.posProfile.value = { posa_qz_printer_name: "Bixolon", posa_qz_printable_width: 0 };
			const qzTray = await import("../src/posapp/services/qzTray");

			await qzTray.printDocumentViaQz({ doctype: "Sales Invoice", name: "SINV-1" });

			const { options, data } = printed();
			expect(options).toEqual(TODAYS_CONFIG);
			expect(data).toEqual([
				{ type: "pixel", format: "html", flavor: "plain", data: expect.any(String) },
			]);
			expect(data[0]).not.toHaveProperty("options");
		});

		it("centres the page on a 72mm printable width with a 76mm render width", async () => {
			qzMock.posProfile.value = { posa_qz_printer_name: "Epson", posa_qz_printable_width: 72 };
			const qzTray = await import("../src/posapp/services/qzTray");

			await qzTray.printDocumentViaQz({ doctype: "Sales Invoice", name: "SINV-1" });

			const { options, data } = printed();
			expect(options).toEqual({
				...TODAYS_CONFIG,
				margins: { top: 0, right: 4, bottom: 0, left: 4 },
			});
			expect(data[0].options).toEqual({ pageWidth: 76 });
		});

		it("ignores a printable width that is not narrower than the paper", async () => {
			qzMock.posProfile.value = { posa_qz_printer_name: "Bixolon", posa_qz_printable_width: 80 };
			const qzTray = await import("../src/posapp/services/qzTray");

			await qzTray.printDocumentViaQz({ doctype: "Sales Invoice", name: "SINV-1" });

			const { options, data } = printed();
			expect(options).toEqual(TODAYS_CONFIG);
			expect(data[0]).not.toHaveProperty("options");
		});

		it("reaches QZ from the profile for receipts and the Z Report", async () => {
			qzMock.posProfile.value = { posa_qz_printer_name: "Epson", posa_qz_printable_width: 72 };
			const { printDocumentViaConfiguredQz, printZReport } = await import(
				"../src/posapp/services/documentPrint"
			);

			await printDocumentViaConfiguredQz({
				doctype: "Sales Invoice",
				name: "SINV-1",
				printFormat: "Swan Sales Invoice",
				profile: qzMock.posProfile.value,
			});
			await expect(printZReport("POSA-CS-1")).resolves.toEqual({ ok: true });

			expect(qzMock.createConfig).toHaveBeenCalledTimes(2);
			for (const [printer, options] of qzMock.createConfig.mock.calls) {
				expect(printer).toBe("Epson");
				expect(options.margins).toEqual({ top: 0, right: 4, bottom: 0, left: 4 });
			}
			for (const [, data] of qzMock.print.mock.calls as unknown as [unknown, any[]][]) {
				expect(data[0].options).toEqual({ pageWidth: 76 });
			}
			expect((globalThis as any).frappe.call).toHaveBeenCalledWith(
				expect.objectContaining({
					args: expect.objectContaining({ doc: "POS Closing Shift", print_format: "Z Report" }),
				}),
			);
		});

		it("does not apply the receipt printable width to direct HTML prints such as labels", async () => {
			qzMock.posProfile.value = { posa_qz_printer_name: "Epson", posa_qz_printable_width: 72 };
			const qzTray = await import("../src/posapp/services/qzTray");

			await qzTray.printHtmlViaQz("<p>Label</p>", { widthMm: 50 });

			const { options, data } = printed();
			expect(options.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
			expect(data[0]).not.toHaveProperty("options");
		});
	});

	it("sends raw printer commands using QZ command format", async () => {
		qzMock.setActive(true);
		qzMock.findPrinters.mockResolvedValue(["Receipt Printer"]);

		const qzTray = await import("../src/posapp/services/qzTray");

		await qzTray.sendRawToQz("\x1B@Hello\n");

		expect(qzMock.print).toHaveBeenCalledWith(
			expect.objectContaining({ printer: "Receipt Printer" }),
			[
				{
					type: "raw",
					format: "command",
					flavor: "plain",
					data: "\x1B@Hello\n",
				},
			],
		);
	});
});
