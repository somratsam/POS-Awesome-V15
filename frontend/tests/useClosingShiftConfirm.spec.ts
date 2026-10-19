import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";

// The closing dialog as staff see it: open, with the figures they typed.
async function openClosing(closingAmounts: Array<string | number>) {
	const eventBus = { emit: vi.fn() };
	const closing = useClosingShift(eventBus);
	closing.dialog_data.value = {
		name: "POSA-CS-DRAFT",
		pos_opening_shift: "POSA-OS-1",
		payment_reconciliation: closingAmounts.map((amount, i) => ({
			mode_of_payment: i ? "Visa" : "Cash",
			closing_amount: amount,
		})),
	};
	closing.closingDialog.value = true;
	await nextTick();
	return { closing, eventBus };
}

describe("Close Shift confirmation", () => {
	it("Submit with valid figures asks first and sends nothing", async () => {
		const { closing, eventBus } = await openClosing([12.345, 40]);

		expect(closing.requestSubmit()).toBe(true);

		expect(closing.confirmCloseDialog.value).toBe(true);
		expect(closing.closingDialog.value).toBe(true);
		expect(eventBus.emit).not.toHaveBeenCalled();
	});

	it("Submit with an invalid figure neither asks nor sends, as before", async () => {
		const { closing, eventBus } = await openClosing(["", 40]);

		expect(closing.requestSubmit()).toBe(false);

		expect(closing.confirmCloseDialog.value).toBe(false);
		expect(closing.closingDialog.value).toBe(true);
		expect(eventBus.emit).not.toHaveBeenCalled();
	});

	it("Go Back keeps the closing dialog open with the figures entered", async () => {
		const { closing, eventBus } = await openClosing([12.345, 40]);
		const entered = closing.dialog_data.value;
		closing.requestSubmit();

		closing.cancelConfirm();

		expect(closing.confirmCloseDialog.value).toBe(false);
		expect(closing.closingDialog.value).toBe(true);
		expect(closing.dialog_data.value).toBe(entered);
		expect(closing.dialog_data.value.payment_reconciliation.map((p: any) => p.closing_amount)).toEqual([12.345, 40]);
		expect(eventBus.emit).not.toHaveBeenCalled();
	});

	it("Close Shift sends the close once, with the entered figures, and closes both dialogs", async () => {
		const { closing, eventBus } = await openClosing([12.345, 40]);
		closing.requestSubmit();

		expect(closing.confirmSubmit()).toBe(true);
		expect(closing.confirmSubmit()).toBe(false);

		expect(eventBus.emit).toHaveBeenCalledTimes(1);
		expect(eventBus.emit).toHaveBeenCalledWith("submit_closing_pos", closing.dialog_data.value);
		expect(closing.confirmCloseDialog.value).toBe(false);
		expect(closing.closingDialog.value).toBe(false);
	});

	it("the next close (dialog opened again) can be sent", async () => {
		const { closing, eventBus } = await openClosing([12.345, 40]);
		closing.requestSubmit();
		closing.confirmSubmit();

		closing.closingDialog.value = true;
		await nextTick();
		closing.requestSubmit();
		expect(closing.confirmSubmit()).toBe(true);
		expect(eventBus.emit).toHaveBeenCalledTimes(2);
	});
});
