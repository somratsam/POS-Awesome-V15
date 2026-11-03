// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PaymentMethods from "../src/posapp/components/pos/payments/PaymentMethods.vue";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import {
	findFundedPaymentLine,
	resolvePaymentOpeningFocus,
} from "../src/posapp/utils/paymentOpeningFocus";

// Same markup shape Vuetify renders: the Amount field's wrapper div carries
// the attributes (data-testid, data-pos-keyboard-target, class) and holds the
// input; buttons are real <button>s.
const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const TextFieldStub = defineComponent({
	inheritAttrs: false,
	props: { modelValue: { type: String, default: "" } },
	setup(props, { attrs }) {
		return () =>
			h(
				"div",
				{
					class: attrs.class,
					"data-testid": attrs["data-testid"],
					"data-pos-keyboard-target": attrs["data-pos-keyboard-target"],
				},
				[h("input", { type: "text", value: props.modelValue })],
			);
	},
});
const BtnStub = defineComponent({
	inheritAttrs: false,
	setup(_, { slots, attrs }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-test": attrs["data-test"],
					"data-pos-keyboard-target": attrs["data-pos-keyboard-target"],
				},
				slots.default?.(),
			);
	},
});
const IconStub = defineComponent({
	inheritAttrs: false,
	setup(_, { attrs }) {
		return () => h("i", { class: attrs.class, "data-test": attrs["data-test"] });
	},
});

const line = (name: string, mode: string, amount: number, isDefault = 0, type = "Bank") => ({
	name,
	mode_of_payment: mode,
	type,
	amount,
	default: isDefault,
});

// Cash first on screen, Visa the Default line -- as on Swan's production profile.
const swanLines = (cash: number, visa: number, master = 0) => [
	line("P1", "Cash", cash, 0, "Cash"),
	line("P2", "Visa", visa, 1),
	line("P3", "Master Card", master),
];

const mountMethods = (payments: any[], extraProps: Record<string, any> = {}) =>
	mount(PaymentMethods, {
		attachTo: document.body,
		props: {
			payments,
			currency: "OMR",
			isReturn: false,
			requestPaymentField: false,
			currencySymbol: () => "OMR ",
			formatCurrency: (value: number) => Number(value).toFixed(3),
			isNumber: () => true,
			getVisibleDenominations: () => [],
			isCashLikePayment: (p: any) => p.type === "Cash",
			isMpesaC2bPayment: () => false,
			...extraProps,
		},
		global: {
			components: { VRow: Box, VCol: Box, VBtn: BtnStub, VTextField: TextFieldStub, VIcon: IconStub },
		},
	});

// What Payments.vue's focusFirstPaymentTarget does with the result.
const openScreen = (root: HTMLElement, payments: any[]) => {
	root.setAttribute("tabindex", "-1");
	const focus = resolvePaymentOpeningFocus(root, payments, 3);
	if (focus.kind === "amount") focus.element.focus();
	else if (focus.kind === "neutral") root.focus();
	return focus;
};

const testidOf = (el: Element | null) => el?.closest("[data-testid]")?.getAttribute("data-testid");

describe("Payments screen: which lines hold money", () => {
	let wrapper: ReturnType<typeof mountMethods> | null = null;

	beforeEach(() => {
		(window as any).frappe = { _: (value: string) => value };
		(window as any).__ = (value: string) => value;
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
		document.body.innerHTML = "";
	});

	describe("opening focus never lands on a button", () => {
		it("focuses the Default line's Amount box when it holds the money (Visa), not the Cash button", () => {
			const payments = swanLines(0, 54.9);
			wrapper = mountMethods(payments);

			openScreen(wrapper.element as HTMLElement, payments);

			expect(document.activeElement?.tagName).toBe("INPUT");
			expect(testidOf(document.activeElement)).toBe("payment-amount-Visa");
		});

		it("follows the money when it sits on a line other than the Default", () => {
			const payments = swanLines(60, 0);
			wrapper = mountMethods(payments);

			openScreen(wrapper.element as HTMLElement, payments);

			expect(document.activeElement?.tagName).toBe("INPUT");
			expect(testidOf(document.activeElement)).toBe("payment-amount-Cash");
		});

		it("prefers the Default line when several lines hold money", () => {
			expect(findFundedPaymentLine(swanLines(20, 34.9), 3)?.mode_of_payment).toBe("Visa");
		});

		it("focuses the refund line's Amount box on a return", () => {
			const payments = [line("P1", "Cash", -90, 1, "Cash"), line("P2", "Visa", 0)];
			wrapper = mountMethods(payments, { isReturn: true });

			openScreen(wrapper.element as HTMLElement, payments);

			expect(testidOf(document.activeElement)).toBe("payment-amount-Cash");
		});

		it("stays neutral, on the screen itself, when no line holds money", () => {
			const payments = swanLines(0, 0);
			wrapper = mountMethods(payments);
			const root = wrapper.element as HTMLElement;

			expect(openScreen(root, payments)).toEqual({ kind: "neutral" });
			expect(document.activeElement).toBe(root);
		});

		it("stays neutral when the funded line's Amount box is disabled", () => {
			const payments = swanLines(0, 54.9);
			wrapper = mountMethods(payments);
			const root = wrapper.element as HTMLElement;
			root.querySelector<HTMLInputElement>('[data-testid="payment-amount-Visa"] input')!.disabled = true;

			expect(openScreen(root, payments)).toEqual({ kind: "neutral" });
			expect(document.activeElement?.tagName).not.toBe("BUTTON");
		});

		it("never returns a button for any mix of amounts", () => {
			for (const [cash, visa, master] of [
				[0, 0, 0],
				[0, 54.9, 0],
				[60, 0, 0],
				[0, 0, 10],
				[20, 34.9, 0],
			]) {
				const payments = swanLines(cash, visa, master);
				wrapper = mountMethods(payments);
				openScreen(wrapper.element as HTMLElement, payments);
				expect(document.activeElement?.tagName).not.toBe("BUTTON");
				wrapper.unmount();
				wrapper = null;
			}
		});

		it("goes to the submit button only when no payment lines are shown (credit-only return)", () => {
			document.body.innerHTML = `<div><p>Store credit</p></div>`;
			expect(resolvePaymentOpeningFocus(document.body.firstElementChild, [line("P1", "Cash", -90, 1)], 3)).toEqual({
				kind: "submit",
			});
			expect(resolvePaymentOpeningFocus(null, [], 3)).toEqual({ kind: "submit" });
		});

		it("is wired into Payments.vue, with a focusable root for the neutral case", () => {
			const block = paymentsSource.slice(
				paymentsSource.indexOf("const focusFirstPaymentTarget"),
				paymentsSource.indexOf("const handleShowPayment"),
			);
			expect(block).toContain("resolvePaymentOpeningFocus(");
			expect(block).toContain("invoice_doc.value?.payments");
			expect(block).toContain("root.focus({ preventScroll: true })");
			expect(block).not.toContain("focusFirstKeyboardTarget");
			expect(paymentsSource).toMatch(/ref="paymentRoot"[\s\S]{0,120}tabindex="-1"/);
		});
	});

	describe("highlight: accent border, tick and bold amount", () => {
		const highlighted = (w: ReturnType<typeof mountMethods>) =>
			w.findAll(".payment-method-card").map((card) => ({
				mode: card.find(".payment-method-card__title").text(),
				funded: card.classes("payment-method-card--funded"),
				tick: card.find('[data-test="payment-method-tick"]').exists(),
				bold: card.find(".payment-method-card__amount--funded").exists(),
			}));

		it("marks only the line with an amount (Visa), not Cash or Master Card at 0", () => {
			wrapper = mountMethods(swanLines(0, 54.9));

			expect(highlighted(wrapper)).toEqual([
				{ mode: "Cash", funded: false, tick: false, bold: false },
				{ mode: "Visa", funded: true, tick: true, bold: true },
				{ mode: "Master Card", funded: false, tick: false, bold: false },
			]);
		});

		it("marks every line used in a split payment", () => {
			wrapper = mountMethods(swanLines(20, 34.9));

			expect(highlighted(wrapper).map((r) => r.funded)).toEqual([true, true, false]);
		});

		it("marks nothing when no line holds money", () => {
			wrapper = mountMethods(swanLines(0, 0));

			expect(wrapper.findAll(".payment-method-card--funded")).toHaveLength(0);
			expect(wrapper.findAll('[data-test="payment-method-tick"]')).toHaveLength(0);
		});

		it("follows the amounts as they change", async () => {
			wrapper = mountMethods(swanLines(0, 54.9));
			await wrapper.setProps({ payments: swanLines(60, 0) });

			expect(highlighted(wrapper).map((r) => r.funded)).toEqual([true, false, false]);
		});

		it("marks a return's refund line, which holds a negative amount", () => {
			wrapper = mountMethods([line("P1", "Cash", -90, 1, "Cash"), line("P2", "Visa", 0)], {
				isReturn: true,
			});

			expect(highlighted(wrapper).map((r) => r.funded)).toEqual([true, false]);
		});
	});
});
