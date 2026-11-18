// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { useInvoiceUI } from "../src/posapp/composables/pos/invoice/useInvoiceUI";

describe("useInvoiceUI payment confirmation", () => {
	it("cancels the pending confirmation when the dialog closes externally", async () => {
		const { confirm_payment_dialog, confirmPaymentSubmission } =
			useInvoiceUI();

		const confirmation = confirmPaymentSubmission(125);
		expect(confirm_payment_dialog.value).toBe(true);

		// Vuetify closes the dialog this way when the operator presses Escape.
		confirm_payment_dialog.value = false;

		await expect(confirmation).resolves.toBeNull();
	});

	it("preserves an explicit confirmation result", async () => {
		const { confirmPaymentSubmission, resolvePaymentConfirmation } =
			useInvoiceUI();

		const confirmation = confirmPaymentSubmission(125);
		resolvePaymentConfirmation(150);

		await expect(confirmation).resolves.toBe(150);
	});
});

describe("useInvoiceUI resize corner", () => {
	const at = (width: number, height: number) => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
		Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
		return useInvoiceUI().canResizeInvoicePanel();
	};

	it("is only on the large size tier (at least 1600 x 960)", () => {
		expect(at(1920, 1080)).toBe(true);
		expect(at(1600, 960)).toBe(true);
		expect(at(1599, 1080)).toBe(false);
		expect(at(1920, 959)).toBe(false);
		expect(at(1440, 900)).toBe(false);
		expect(at(1366, 768)).toBe(false);
	});
});
