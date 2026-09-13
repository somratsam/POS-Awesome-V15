// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	isOffline: vi.fn(() => false),
}));

import * as offlineModule from "../src/offline/index";
import { close_payments, show_payment } from "../src/posapp/components/pos/invoice_utils/dialogs";

const createPaymentContext = () => ({
	_suppressClosePaymentsTimer: null,
	_suppressClosePayments: false,
	customer: "CUST-001",
	items: [{ item_code: "ITEM-001" }],
	validate: vi.fn(async () => true),
	ensure_auto_batch_selection: vi.fn(async () => {}),
	invoiceType: "Invoice",
	pos_profile: { currency: "USD" },
	invoice_doc: {},
	process_invoice: vi.fn(async () => ({
		doctype: "Sales Invoice",
		grand_total: 10,
		rounded_total: 10,
		total: 10,
		payments: [],
	})),
	process_invoice_from_order: vi.fn(),
	reload_current_invoice_from_backend: vi.fn(),
	load_invoice: vi.fn(async () => {}),
	_collectManualRateOverrides: vi.fn(() => []),
	_applyManualRateOverridesToDoc: vi.fn(),
	selected_currency: "USD",
	conversion_rate: 1,
	_getPlcConversionRate: () => 1,
	flt: (value: unknown) => Number(value || 0),
	currency_precision: 2,
	float_precision: 2,
	isReturnInvoice: false,
	get_payments: () => [],
	$nextTick: async () => {},
	uiStore: {
		openPaymentDialog: vi.fn(),
		closePaymentDialog: vi.fn(),
		setActiveView: vi.fn(),
	},
	eventBus: { emit: vi.fn() },
	toastStore: { show: vi.fn() },
});

describe("invoice payment dialogs", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { call: vi.fn() });
		(offlineModule.isOffline as any).mockReturnValue(false);
		Object.defineProperty(window, "innerWidth", {
			value: 500,
			writable: true,
			configurable: true,
		});
	});

	it("switches compact layout to the selector when opening payments", async () => {
		const context = createPaymentContext();

		await show_payment(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("payment");
		expect(context.eventBus.emit).toHaveBeenCalledWith("set_compact_panel", "selector");
		expect(context.eventBus.emit).toHaveBeenCalledWith("show_payment", "true");
	});

	it("completes automatic batch assignment before validating payment", async () => {
		const context = createPaymentContext();
		const sequence: string[] = [];
		context.ensure_auto_batch_selection = vi.fn(async () => {
			sequence.push("assign");
		});
		context.validate = vi.fn(async () => {
			sequence.push("validate");
			return true;
		});

		await show_payment(context);

		expect(sequence).toEqual(["assign", "validate"]);
	});

	it("syncs cart state from the update_invoice() response instead of re-fetching it from the server", async () => {
		const context = createPaymentContext();
		context.process_invoice = vi.fn(async () => ({
			doctype: "Sales Invoice",
			name: "SINV-0001",
			grand_total: 10,
			rounded_total: 10,
			total: 10,
			payments: [],
		}));

		await show_payment(context);

		expect(context.load_invoice).toHaveBeenCalledTimes(1);
		expect(context.load_invoice).toHaveBeenCalledWith(
			expect.objectContaining({ name: "SINV-0001" }),
			{ preserveAdditionalDiscountPercentage: true },
		);
		// No second round trip for data update_invoice() already returned.
		expect(context.reload_current_invoice_from_backend).not.toHaveBeenCalled();
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("reapplies manual rate overrides onto the update_invoice() doc before syncing cart state", async () => {
		const context = createPaymentContext();
		context.process_invoice = vi.fn(async () => ({
			doctype: "Sales Invoice",
			name: "SINV-0002",
			grand_total: 10,
			rounded_total: 10,
			total: 10,
			payments: [],
		}));
		const overrides = [{ posa_row_id: "row-1", values: { rate: 42 } }];
		context._collectManualRateOverrides = vi.fn(() => overrides);

		await show_payment(context);

		expect(context._collectManualRateOverrides).toHaveBeenCalledWith(context.items);
		expect(context._applyManualRateOverridesToDoc).toHaveBeenCalledWith(
			expect.objectContaining({ name: "SINV-0002" }),
			overrides,
		);
		// The doc mutated by _applyManualRateOverridesToDoc must be the same one
		// handed to load_invoice, not a separately re-fetched copy.
		const overriddenDoc = context._applyManualRateOverridesToDoc.mock.calls[0][0];
		const loadedDoc = context.load_invoice.mock.calls[0][0];
		expect(loadedDoc).toBe(overriddenDoc);
	});

	it("ignores a concurrent second call while a payment click is already in flight (double-click/double-tap guard)", async () => {
		const context = createPaymentContext();
		let resolveProcessInvoice: (value: unknown) => void = () => {};
		const processInvoicePromise = new Promise((resolve) => {
			resolveProcessInvoice = resolve;
		});
		context.process_invoice = vi.fn(() => processInvoicePromise);

		const firstCall = show_payment(context);
		// Fired while the first call is still awaiting process_invoice() --
		// simulates a rapid double-click/double-tap or a held keyboard shortcut.
		const secondCall = show_payment(context);

		// Let the first call's own preceding awaits (ensure_auto_batch_selection,
		// validate) actually run so it reaches the still-unresolved
		// process_invoice() call before asserting anything.
		await new Promise((resolve) => setTimeout(resolve, 0));

		await secondCall;
		expect(context.process_invoice).toHaveBeenCalledTimes(1);
		expect(context.eventBus.emit).toHaveBeenCalledWith("payment_processing", true);
		expect(context.eventBus.emit).not.toHaveBeenCalledWith("payment_processing", false);

		resolveProcessInvoice({
			doctype: "Sales Invoice",
			name: "SINV-DOUBLE",
			grand_total: 10,
			rounded_total: 10,
			total: 10,
			payments: [],
		});
		await firstCall;

		// Only one draft invoice's worth of work happened, despite two clicks.
		expect(context.process_invoice).toHaveBeenCalledTimes(1);
		expect(context.eventBus.emit).toHaveBeenCalledWith("payment_processing", false);

		// The guard releases once the in-flight call finishes -- a genuinely
		// new click afterward is not permanently locked out.
		await show_payment(context);
		expect(context.process_invoice).toHaveBeenCalledTimes(2);
	});

	it("skips the cart-state sync when offline, matching the pre-existing reload guard", async () => {
		(offlineModule.isOffline as any).mockReturnValue(true);
		const context = createPaymentContext();
		context.process_invoice = vi.fn(async () => ({
			doctype: "Sales Invoice",
			name: "SINV-0003",
			grand_total: 10,
			rounded_total: 10,
			total: 10,
			payments: [],
		}));

		await show_payment(context);

		expect(context.load_invoice).not.toHaveBeenCalled();
		expect(context._collectManualRateOverrides).not.toHaveBeenCalled();
	});

	it("switches compact layout back to the invoice when closing payments", () => {
		const context = {
			_suppressClosePayments: false,
			paymentVisible: true,
			uiStore: {
				paymentDialogOpen: false,
				closePaymentDialog: vi.fn(),
				setActiveView: vi.fn(),
			},
			eventBus: { emit: vi.fn() },
		};

		close_payments(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("items");
		expect(context.eventBus.emit).toHaveBeenCalledWith("set_compact_panel", "invoice");
		expect(context.eventBus.emit).toHaveBeenCalledWith("show_payment", "false");
	});
});
