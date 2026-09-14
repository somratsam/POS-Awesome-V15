// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const itemAddition = vi.hoisted(() => ({
	addItem: vi.fn(),
	clearInvoice: vi.fn(),
}));

vi.mock("../src/posapp/composables/pos/items/useItemAddition", () => ({
	useItemAddition: () => ({
		addItem: itemAddition.addItem,
		clearInvoice: itemAddition.clearInvoice,
	}),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_buildPriceListSnapshot: vi.fn(() => ({})),
	_logPriceListDebug: vi.fn(),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/item_updates", () => ({
	applyReturnDiscountProration: vi.fn(),
}));

const documentUtils = vi.hoisted(() => ({
	get_invoice_doc: vi.fn(),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/document", () => ({
	get_invoice_doc: documentUtils.get_invoice_doc,
	get_invoice_items: vi.fn(() => []),
	get_payments: vi.fn(() => []),
}));

vi.mock("../src/posapp/utils/documentSources", () => ({
	prepareDocumentFlowAction: vi.fn(),
}));

const createContext = () => ({
	update_invoice: vi.fn(),
	toastStore: { show: vi.fn() },
	eventBus: { emit: vi.fn() },
});

describe("save_and_clear_invoice reentrancy guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		itemAddition.clearInvoice.mockReset();
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = {
			datetime: { nowdate: () => "2026-09-14" },
		};
	});

	it("ignores a concurrent second call while a save is already in flight (double-click/double-tap guard)", async () => {
		const { save_and_clear_invoice } = await import(
			"../src/posapp/components/pos/invoice_utils/actions"
		);

		const context = createContext();
		documentUtils.get_invoice_doc.mockReturnValue({ name: null, items: [{ item_code: "ITEM-1" }] });

		let resolveUpdateInvoice: (value: unknown) => void = () => {};
		const updateInvoicePromise = new Promise((resolve) => {
			resolveUpdateInvoice = resolve;
		});
		context.update_invoice.mockReturnValue(updateInvoicePromise);

		const firstCall = save_and_clear_invoice(context);
		// Fired while the first call is still awaiting update_invoice() --
		// simulates a rapid double-click/double-tap, or Print Draft firing
		// alongside a Save & Clear click (both call this same function).
		const secondCall = save_and_clear_invoice(context);

		// Let the first call's own synchronous work run so it reaches the
		// still-unresolved update_invoice() call before asserting anything.
		await new Promise((resolve) => setTimeout(resolve, 0));

		await secondCall;
		expect(context.update_invoice).toHaveBeenCalledTimes(1);

		resolveUpdateInvoice({ name: "SINV-DOUBLE" });
		await firstCall;

		// Only one draft invoice's worth of work happened, despite two calls.
		expect(context.update_invoice).toHaveBeenCalledTimes(1);
		expect(itemAddition.clearInvoice).toHaveBeenCalledTimes(1);

		// The guard releases once the in-flight call finishes -- a genuinely
		// new call afterward is not permanently locked out.
		documentUtils.get_invoice_doc.mockReturnValue({ name: null, items: [{ item_code: "ITEM-2" }] });
		context.update_invoice.mockResolvedValue({ name: "SINV-SECOND" });
		await save_and_clear_invoice(context);
		expect(context.update_invoice).toHaveBeenCalledTimes(2);
	});

	it("releases the guard even when update_invoice() throws, so a later call is not permanently blocked", async () => {
		const { save_and_clear_invoice } = await import(
			"../src/posapp/components/pos/invoice_utils/actions"
		);

		const context = createContext();
		documentUtils.get_invoice_doc.mockReturnValue({ name: null, items: [{ item_code: "ITEM-1" }] });
		context.update_invoice.mockRejectedValueOnce(new Error("network error"));

		await save_and_clear_invoice(context);
		expect(context.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Error saving the current invoice" }),
		);

		context.update_invoice.mockResolvedValueOnce({ name: "SINV-RETRY" });
		await save_and_clear_invoice(context);
		expect(context.update_invoice).toHaveBeenCalledTimes(2);
	});

	it("releases the guard on the 'nothing to save' branch (empty cart, no existing draft)", async () => {
		const { save_and_clear_invoice } = await import(
			"../src/posapp/components/pos/invoice_utils/actions"
		);

		const context = createContext();
		documentUtils.get_invoice_doc.mockReturnValue({ name: null, items: [] });

		await save_and_clear_invoice(context);
		expect(context.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Nothing to save" }),
		);
		expect(context.update_invoice).not.toHaveBeenCalled();

		// Guard must not be stuck true after this no-op branch either.
		documentUtils.get_invoice_doc.mockReturnValue({ name: null, items: [{ item_code: "ITEM-1" }] });
		context.update_invoice.mockResolvedValueOnce({ name: "SINV-AFTER-EMPTY" });
		await save_and_clear_invoice(context);
		expect(context.update_invoice).toHaveBeenCalledTimes(1);
	});
});
