// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isNoMoneyReturn, resolveReturnSubmit } from "../src/posapp/utils/returnIntent";
import PaymentActionButtons from "../src/posapp/components/pos/payments/PaymentActionButtons.vue";
import ReturnIntentDialog from "../src/posapp/components/pos/payments/ReturnIntentDialog.vue";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";

describe("isNoMoneyReturn", () => {
	it("is a return with every payment at 0", () => {
		expect(isNoMoneyReturn({ is_return: 1, payments: [{ amount: 0 }, { amount: 0 }] })).toBe(true);
		expect(isNoMoneyReturn({ is_return: 1, payments: [] })).toBe(true);
	});

	it("is not a return that refunds money, or a sale", () => {
		expect(isNoMoneyReturn({ is_return: 1, payments: [{ amount: -10 }] })).toBe(false);
		expect(isNoMoneyReturn({ is_return: 1, payments: [{ amount: 0 }, { amount: "-0.5" }] })).toBe(false);
		expect(isNoMoneyReturn({ is_return: 0, payments: [{ amount: 0 }] })).toBe(false);
		expect(isNoMoneyReturn(null)).toBe(false);
	});
});

describe("resolveReturnSubmit", () => {
	it("leaves everything else as asked", () => {
		expect(resolveReturnSubmit({ noMoneyReturn: false, print: true })).toEqual({
			action: "submit",
			print: true,
			intent: null,
		});
		expect(resolveReturnSubmit({ noMoneyReturn: false, print: false })).toEqual({
			action: "submit",
			print: false,
			intent: null,
		});
	});

	it("Exchange never prints, Credit note issue always prints", () => {
		expect(resolveReturnSubmit({ noMoneyReturn: true, print: true, intent: "exchange" })).toEqual({
			action: "submit",
			print: false,
			intent: "exchange",
		});
		expect(resolveReturnSubmit({ noMoneyReturn: true, print: false, intent: "credit_note" })).toEqual({
			action: "submit",
			print: true,
			intent: "credit_note",
		});
	});

	it("a plain submit key is the default, Exchange", () => {
		expect(resolveReturnSubmit({ noMoneyReturn: true, print: false })).toEqual({
			action: "submit",
			print: false,
			intent: "exchange",
		});
	});

	it("a print key asks instead of printing", () => {
		expect(resolveReturnSubmit({ noMoneyReturn: true, print: true })).toEqual({ action: "ask" });
	});
});

const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const BtnStub = defineComponent({
	inheritAttrs: false,
	setup(_, { slots, attrs }) {
		return () =>
			h("button", { "data-testid": attrs["data-testid"], onClick: attrs.onClick }, slots.default?.());
	},
});
const DialogStub = defineComponent({
	props: { modelValue: Boolean },
	setup(props, { slots }) {
		return () => (props.modelValue ? h("div", slots.default?.()) : null);
	},
});
const components = {
	VCard: Box,
	VRow: Box,
	VCol: Box,
	VBtn: BtnStub,
	VDialog: DialogStub,
	VCardTitle: Box,
	VCardText: Box,
	VCardActions: Box,
};

describe("PaymentActionButtons on a no-money return", () => {
	beforeEach(() => {
		(window as any).__ = (text: string) => text;
	});

	it("shows Exchange and Credit note issue instead of Submit / Submit & Print", async () => {
		const onSubmitExchange = vi.fn();
		const onSubmitCreditNote = vi.fn();
		const wrapper = mount(PaymentActionButtons, {
			props: { returnChoice: true, onSubmitExchange, onSubmitCreditNote },
			global: { components },
		});
		const text = wrapper.text();
		expect(text).toContain("Exchange: continue to new sale");
		expect(text).toContain("Credit note issue");
		expect(text).not.toContain("Submit & Print");
		expect(wrapper.find('[data-testid="payment-submit"]').exists()).toBe(false);

		await wrapper.find('[data-testid="payment-submit-exchange"]').trigger("click");
		await wrapper.find('[data-testid="payment-submit-credit-note"]').trigger("click");
		expect(onSubmitExchange).toHaveBeenCalledTimes(1);
		expect(onSubmitCreditNote).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("keeps Submit / Submit & Print for sales and refunds", () => {
		const wrapper = mount(PaymentActionButtons, { props: { returnChoice: false }, global: { components } });
		expect(wrapper.find('[data-testid="payment-submit"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="payment-submit-print"]').exists()).toBe(true);
		expect(wrapper.text()).not.toContain("Credit note issue");
		wrapper.unmount();
	});
});

describe("ReturnIntentDialog", () => {
	beforeEach(() => {
		(window as any).__ = (text: string) => text;
	});

	it("asks 'Exchange or Credit note issue?' and reports the choice", async () => {
		const onChoose = vi.fn();
		const onCancel = vi.fn();
		const wrapper = mount(ReturnIntentDialog, {
			props: { modelValue: true, onChoose, onCancel },
			global: { components },
		});
		expect(wrapper.text()).toContain("Exchange or Credit note issue?");
		await wrapper.find('[data-testid="return-intent-exchange"]').trigger("click");
		await wrapper.find('[data-testid="return-intent-credit-note"]').trigger("click");
		await wrapper.find('[data-testid="return-intent-cancel"]').trigger("click");
		expect(onChoose.mock.calls).toEqual([["exchange"], ["credit_note"]]);
		expect(onCancel).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
});

// Payments.vue can't be mounted here (Vitest's bundled Vite can't resolve its
// ".js" store imports), so check its wiring: one submit path, and every route
// into it passes through the exchange / credit note decision.
describe("Payments.vue wiring", () => {
	const script = paymentsSource.slice(paymentsSource.indexOf("<script"));

	it("binds the two buttons and the question dialog", () => {
		expect(paymentsSource).toContain(':return-choice="noMoneyReturn"');
		expect(paymentsSource).toContain("@submit-exchange=\"submitReturnAs('exchange')\"");
		expect(paymentsSource).toContain("@submit-credit-note=\"submitReturnAs('credit_note')\"");
		expect(paymentsSource).toMatch(/<ReturnIntentDialog[\s\S]*?@choose="settleReturnIntent"/);
	});

	it("has a single submitInvoice call, inside the wrapper, after the decision", () => {
		expect(script.match(/\bsubmitInvoice\(/g)).toHaveLength(1);
		const wrapper = script.slice(script.indexOf("const submitInvoiceWrapper"));
		expect(wrapper.indexOf("resolveReturnSubmit(")).toBeGreaterThan(-1);
		expect(wrapper.indexOf("resolveReturnSubmit(")).toBeLessThan(wrapper.indexOf("submitInvoice("));
		expect(wrapper).toMatch(/\.\.\.callbackOverrides,\s*returnIntent,/);
	});

	it("routes every shortcut through submit / submitInvoiceWrapper and pauses them while asking", () => {
		const shortcut = script.slice(script.indexOf("const handlePaymentShortcut"), script.indexOf("const queueShortcutSubmit"));
		expect(shortcut).toContain("submit(null, false, counterShortcut.print)");
		expect(shortcut).toContain("submit(null, false, true)");
		expect(shortcut).toContain("submit(null, false, false)");
		expect(shortcut).toContain("submit(null, false, print)");
		expect(shortcut.match(/if \(returnIntentDialog\.value \|\| creditRemainderDialog\.value\) return;/g)).toHaveLength(2);
		expect(script).toMatch(/onSubmit: \(args, submitPrint\) => \{\s*submitInvoiceWrapper\(/);
	});

	it("never turns the invoice-screen shortcut amount into a refund on a credit-only store", () => {
		const shortcut = script.slice(script.indexOf("const handleSubmitPaymentShortcut"), script.indexOf("const queueShortcutSubmit"));
		expect(shortcut).toMatch(/const refundBlocked = Boolean\(invoice_doc\.value\?\.is_return\) && returnsCreditOnlyPolicy\.value;/);
		expect(shortcut).toContain("if (amount !== null && !refundBlocked) {");
	});
});
