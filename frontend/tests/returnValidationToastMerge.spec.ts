import { describe, expect, it, vi } from "vitest";

import { validate } from "../src/posapp/components/pos/invoice_utils/validation";

(globalThis as any).__ = (text: string) => text;

describe("return-invoice validation toast merging", () => {
	// Real bug: a positive-qty return item and a positive subtotal are the
	// same root cause (the item's positive qty IS what keeps the subtotal
	// positive) -- both toasts used to fire with no shared key, stacking as
	// two separate sequential notifications for one underlying problem.
	it("uses a shared key so both return-validation toasts merge instead of stacking", async () => {
		const show = vi.fn();
		const item = {
			posa_row_id: "ROW-1",
			item_code: "ITEM-1",
			qty: 2,
			stock_qty: 2,
		};

		await validate({
			isReturnInvoice: true,
			items: [item],
			subtotal: 20,
			toastStore: { show },
			eventBus: { emit: vi.fn() },
		});

		expect(show).toHaveBeenCalledTimes(2);
		const keys = show.mock.calls.map((call) => call[0].key);
		expect(keys[0]).toBe("return-validation");
		expect(keys[1]).toBe("return-validation");
		expect(keys[0]).toBe(keys[1]);
	});

	it("still auto-corrects the item's quantity to negative", async () => {
		const item = {
			posa_row_id: "ROW-1",
			item_code: "ITEM-1",
			qty: 2,
			stock_qty: 2,
		};

		await validate({
			isReturnInvoice: true,
			items: [item],
			subtotal: 20,
			toastStore: { show: vi.fn() },
			eventBus: { emit: vi.fn() },
		});

		expect(item.qty).toBe(-2);
		expect(item.stock_qty).toBe(-2);
	});
});
