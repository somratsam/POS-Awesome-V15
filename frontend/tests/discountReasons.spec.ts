import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/offline/index", () => ({
	getTaxTemplate: vi.fn(() => null),
	getTaxInclusiveSetting: vi.fn(() => false),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_getPlcConversionRate: vi.fn(() => 1),
}));

import {
	NOT_RECORDED_DISCOUNT_REASON,
	clearDiscountReasonIfUndiscounted,
	findLinesMissingDiscountReason,
	hasManualLineDiscount,
	isDiscountReasonRequired,
	lineNeedsDiscountReason,
	preselectDiscountReason,
	setLineDiscountReason,
} from "../src/posapp/utils/discountReasons";
import { get_invoice_items } from "../src/posapp/components/pos/invoice_utils/document";
import { ensureDiscountReasons, show_payment } from "../src/posapp/components/pos/invoice_utils/dialogs";
import { useUIStore } from "../src/posapp/stores/uiStore";

const REASONS = [{ name: "Mastercard" }, { name: "Staff" }, { name: "Other / General" }];

describe("discount reason rules (mirror discount_reasons.py)", () => {
	it("only a cashier-given positive discount counts", () => {
		expect(hasManualLineDiscount({ discount_percentage: 10 })).toBe(true);
		expect(hasManualLineDiscount({ discount_amount: 2 })).toBe(true);
		expect(hasManualLineDiscount({ discount_percentage: 0, discount_amount: 0 })).toBe(false);
		expect(hasManualLineDiscount({ discount_percentage: -5 })).toBe(false);
		expect(hasManualLineDiscount({ discount_percentage: 10, posa_offer_applied: 1 })).toBe(false);
		expect(hasManualLineDiscount({ discount_percentage: 10, posa_is_offer: 1 })).toBe(false);
		expect(hasManualLineDiscount({ discount_percentage: 100, is_free_item: 1 })).toBe(false);
	});

	it('treats "Not recorded" as still missing, so a reloaded line is asked again', () => {
		expect(lineNeedsDiscountReason({ discount_percentage: 10 })).toBe(true);
		expect(
			lineNeedsDiscountReason({ discount_percentage: 10, posa_discount_reason: NOT_RECORDED_DISCOUNT_REASON }),
		).toBe(true);
		expect(lineNeedsDiscountReason({ discount_percentage: 10, posa_discount_reason: "Staff" })).toBe(false);
		expect(
			findLinesMissingDiscountReason([
				{ item_code: "A", discount_percentage: 10 },
				{ item_code: "B", discount_percentage: 0 },
				{ item_code: "C", discount_percentage: 5, posa_discount_reason: "Staff" },
			]).map((line) => line.item_code),
		).toEqual(["A"]);
	});

	it("reads the POS Profile switch", () => {
		expect(isDiscountReasonRequired({ posa_require_discount_reason: 1 })).toBe(true);
		expect(isDiscountReasonRequired({ posa_require_discount_reason: "1" })).toBe(true);
		expect(isDiscountReasonRequired({ posa_require_discount_reason: 0 })).toBe(false);
		expect(isDiscountReasonRequired(null)).toBe(false);
	});

	it("preselects the latest reason picked on this cart, if still offered", () => {
		const items = [
			{ posa_discount_reason: "Staff", _discount_reason_set_at: 10 },
			{ posa_discount_reason: "Mastercard", _discount_reason_set_at: 20 },
			{ posa_discount_reason: "Retired", _discount_reason_set_at: 30 },
		];
		expect(preselectDiscountReason(items, REASONS)).toBe("Mastercard");
		expect(preselectDiscountReason([], REASONS)).toBeNull();
	});

	it("sets reasons through the invoice store's own update path, with no note", () => {
		const line: any = { posa_row_id: "row-1", discount_percentage: 10 };
		const store = {
			updateItemWithTotals: vi.fn((_rowId: string, updater: (_line: any) => void) => {
				updater(line);
				return line;
			}),
		};
		setLineDiscountReason(store, line, "Other / General");
		expect(store.updateItemWithTotals).toHaveBeenCalledWith("row-1", expect.any(Function));
		expect(line.posa_discount_reason).toBe("Other / General");
		expect("posa_discount_reason_note" in line).toBe(false);

		line.discount_percentage = 0;
		clearDiscountReasonIfUndiscounted(store, line);
		expect(line.posa_discount_reason).toBeNull();
	});
});

describe("uiStore discount reason prompt", () => {
	beforeEach(() => setActivePinia(createPinia()));

	it("resolves the pending request, and a newer request cancels an unanswered one", async () => {
		const ui = useUIStore();
		ui.setRegisterData({ discount_reasons: REASONS } as any);
		expect(ui.discountReasons.map((reason: any) => reason.name)).toEqual([
			"Mastercard",
			"Staff",
			"Other / General",
		]);

		const first = ui.requestDiscountReason({ mode: "line", lines: [{ posa_row_id: "a" }] });
		const second = ui.requestDiscountReason({ mode: "pay", lines: [{ posa_row_id: "b" }] });
		await expect(first).resolves.toBeNull();
		expect(ui.discountReasonRequest?.mode).toBe("pay");

		ui.resolveDiscountReason({ reason: "Staff", applyToOthers: false });
		await expect(second).resolves.toEqual({ reason: "Staff", applyToOthers: false });
		expect(ui.discountReasonRequest).toBeNull();
	});
});

const makeContext = (overrides: Record<string, any> = {}) => {
	const items = [
		{ posa_row_id: "r1", item_code: "A", discount_percentage: 10, posa_discount_reason: "Staff" },
		{ posa_row_id: "r2", item_code: "B", discount_percentage: 20 },
		{ posa_row_id: "r3", item_code: "C", discount_percentage: 0 },
	];
	return {
		items,
		pos_profile: { posa_require_discount_reason: 1, currency: "OMR" },
		isReturnInvoice: false,
		invoice_doc: {},
		uiStore: {
			discountReasons: REASONS,
			requestDiscountReason: vi.fn(async () => ({ reason: "Mastercard", applyToOthers: false })),
		},
		invoiceStore: {
			updateItemWithTotals: vi.fn((rowId: string, updater: (_line: any) => void) => {
				const line = items.find((item) => item.posa_row_id === rowId);
				if (line) updater(line);
				return line;
			}),
		},
		toastStore: { show: vi.fn() },
		...overrides,
	};
};

describe("ensureDiscountReasons (the Pay check)", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
	});

	it("prompts once in pay mode for just the missing lines and applies the pick", async () => {
		const context = makeContext();
		await expect(ensureDiscountReasons(context)).resolves.toBe(true);
		expect(context.uiStore.requestDiscountReason).toHaveBeenCalledTimes(1);
		const request = context.uiStore.requestDiscountReason.mock.calls[0][0];
		expect(request.mode).toBe("pay");
		expect(request.lines.map((line: any) => line.item_code)).toEqual(["B"]);
		// A reason already on the cart (e.g. a reloaded draft line) is offered first.
		expect(request.preselect).toBe("Staff");
		expect(context.items[1].posa_discount_reason).toBe("Mastercard");
		expect(context.items[0].posa_discount_reason).toBe("Staff");
	});

	it("going back to the cart blocks payment with a message", async () => {
		const context = makeContext();
		context.uiStore.requestDiscountReason = vi.fn(async () => null);
		await expect(ensureDiscountReasons(context)).resolves.toBe(false);
		expect(context.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ key: "discount-reason-missing" }),
		);
		expect(context.items[1].posa_discount_reason).toBeUndefined();
	});

	it("re-checks after the pick and blocks if any line is still without a reason", async () => {
		const context = makeContext();
		// A line store that drops the write (e.g. the row was removed meanwhile).
		context.invoiceStore.updateItemWithTotals = vi.fn(() => null) as any;
		const original = context.items[1];
		Object.defineProperty(original, "posa_discount_reason", { get: () => null, set: () => {} });
		await expect(ensureDiscountReasons(context)).resolves.toBe(false);
	});

	it("blocks rather than lets payment through if the prompt can't be shown", async () => {
		const context = makeContext({ uiStore: { discountReasons: REASONS } });
		await expect(ensureDiscountReasons(context)).resolves.toBe(false);
	});

	it.each([
		["the switch is off", { pos_profile: { posa_require_discount_reason: 0 } }],
		["a return", { isReturnInvoice: true }],
		["a loaded return invoice", { invoice_doc: { is_return: 1 } }],
	])("does nothing when %s", async (_label, overrides) => {
		const context = makeContext(overrides);
		await expect(ensureDiscountReasons(context)).resolves.toBe(true);
		expect(context.uiStore.requestDiscountReason).not.toHaveBeenCalled();
	});
});

describe("Pay with a discounted line that has no reason", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { call: vi.fn() });
	});

	const payContext = (switchOn: boolean, pickedReason: string | null) => {
		const context: any = {
			...makeContext({
				pos_profile: { posa_require_discount_reason: switchOn ? 1 : 0, currency: "OMR" },
			}),
			customer: "CUST",
			validate: vi.fn(async () => true),
			ensure_auto_batch_selection: vi.fn(async () => {}),
			invoiceType: "Invoice",
			process_invoice: vi.fn(async () => ({
				doctype: "Sales Invoice",
				grand_total: 10,
				rounded_total: 10,
				total: 10,
				payments: [],
			})),
			load_invoice: vi.fn(async () => {}),
			_collectManualRateOverrides: vi.fn(() => []),
			selected_currency: "OMR",
			conversion_rate: 1,
			_getPlcConversionRate: () => 1,
			flt: (value: unknown) => Number(value || 0),
			currency_precision: 2,
			float_precision: 2,
			get_payments: () => [],
			$nextTick: async () => {},
			eventBus: { emit: vi.fn() },
		};
		context.uiStore.openPaymentDialog = vi.fn();
		context.uiStore.closePaymentDialog = vi.fn();
		context.uiStore.setActiveView = vi.fn();
		context.uiStore.requestDiscountReason = vi.fn(async () =>
			pickedReason ? { reason: pickedReason, applyToOthers: false } : null,
		);
		return context;
	};

	const paymentOpened = (context: any) =>
		context.eventBus.emit.mock.calls.some(([event]: any[]) => event === "show_payment");

	it("switch ON: payment is blocked -- nothing is saved and the payment screen never opens", async () => {
		const context = payContext(true, null);
		await show_payment(context);
		expect(context.uiStore.requestDiscountReason).toHaveBeenCalledTimes(1);
		expect(context.process_invoice).not.toHaveBeenCalled();
		expect(paymentOpened(context)).toBe(false);
		expect(context.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ key: "discount-reason-missing" }),
		);
		expect(context._paymentInFlight).toBe(false);
	});

	it("switch ON: once every discounted line has a reason, payment opens", async () => {
		const context = payContext(true, "Other / General");
		await show_payment(context);
		expect(context.items[1].posa_discount_reason).toBe("Other / General");
		expect(context.process_invoice).toHaveBeenCalledTimes(1);
		expect(paymentOpened(context)).toBe(true);
	});

	it("switch OFF: works exactly as before -- no prompt, payment opens with the reason still empty", async () => {
		const context = payContext(false, null);
		await show_payment(context);
		expect(context.uiStore.requestDiscountReason).not.toHaveBeenCalled();
		expect(context.process_invoice).toHaveBeenCalledTimes(1);
		expect(paymentOpened(context)).toBe(true);
		expect(context.items[1].posa_discount_reason).toBeUndefined();
	});

	it("runs the check after validate and before the draft is saved", async () => {
		const sequence: string[] = [];
		const context = payContext(true, null);
		context.validate = vi.fn(async () => {
			sequence.push("validate");
			return true;
		});
		context.process_invoice = vi.fn(async () => {
			sequence.push("process");
			return null;
		});
		context.uiStore.requestDiscountReason = vi.fn(async () => {
			sequence.push("reason");
			return null;
		});
		await show_payment(context);
		expect(sequence).toEqual(["validate", "reason"]);
	});
});

describe("the invoice payload carries the reason, and no note", () => {
	it("get_invoice_items includes posa_discount_reason only", () => {
		(globalThis as any).flt = (value: unknown) => Number(value || 0);
		const items = get_invoice_items({
			items: [
				{
					item_code: "A",
					qty: 1,
					rate: 9,
					price_list_rate: 10,
					discount_percentage: 10,
					discount_amount: 1,
					posa_discount_reason: "Other / General",
					posa_discount_reason_note: "left over from an old cart",
				},
				{ item_code: "B", qty: 1, rate: 5, price_list_rate: 5 },
			],
			pos_profile: { currency: "OMR" },
			selected_currency: "OMR",
			isReturnInvoice: false,
			invoiceType: "Invoice",
		});
		expect(items[0].posa_discount_reason).toBe("Other / General");
		expect("posa_discount_reason_note" in items[0]).toBe(false);
		expect(items[1].posa_discount_reason).toBeNull();
	});
});
