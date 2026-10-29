// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import PaymentSummary from "../src/posapp/components/pos/payments/PaymentSummary.vue";

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const VTextFieldStub = defineComponent({
	name: "VTextFieldStub",
	props: {
		modelValue: {
			type: [String, Number],
			default: "",
		},
		label: {
			type: String,
			default: "",
		},
	},
	setup(props) {
		return () =>
			h("div", { "data-label": props.label }, String(props.modelValue ?? ""));
	},
});

describe("PaymentSummary", () => {
	beforeEach(() => {
		(window as any).frappe = { _: (value: string) => value };
	});

	it("does not show the settlement state box when there is still a remaining balance", () => {
		const wrapper = mount(PaymentSummary, {
			props: {
				invoice_doc: {
					currency: "PKR",
					is_return: false,
				},
				total_payments_display: "700",
				diff_payment_display: "200",
				diff_label: "Remaining",
				diffPayment: 200,
				change_due: 0,
				paid_change: 0,
				credit_change: 0,
				paid_change_rules: [],
				currencySymbol: () => "Rs",
				formatCurrency: (value: number) => String(value),
			},
			global: {
				components: {
					VRow: BoxStub,
					VCol: BoxStub,
					VTextField: VTextFieldStub,
				},
			},
		});

		expect(wrapper.find('[data-test="payment-settlement-state"]').exists()).toBe(false);
	});

	it("does not show the settlement state box when the invoice is fully covered", () => {
		const wrapper = mount(PaymentSummary, {
			props: {
				invoice_doc: {
					currency: "PKR",
					is_return: false,
				},
				total_payments_display: "900",
				diff_payment_display: "0",
				diff_label: "Remaining",
				diffPayment: 0,
				change_due: 0,
				paid_change: 0,
				credit_change: 0,
				paid_change_rules: [],
				currencySymbol: () => "Rs",
				formatCurrency: (value: number) => String(value),
			},
			global: {
				components: {
					VRow: BoxStub,
					VCol: BoxStub,
					VTextField: VTextFieldStub,
				},
			},
		});

		expect(wrapper.find('[data-test="payment-settlement-state"]').exists()).toBe(false);
	});

	it("shows applied gift card details inside the payment summary", () => {
		const wrapper = mount(PaymentSummary, {
			props: {
				invoice_doc: {
					currency: "PKR",
					is_return: false,
				},
				total_payments_display: "900",
				diff_payment_display: "0",
				diff_label: "Remaining",
				diffPayment: -80,
				change_due: 0,
				paid_change: 0,
				credit_change: 0,
				paid_change_rules: [],
				currencySymbol: () => "Rs",
				formatCurrency: (value: number) => String(value),
				giftCardAppliedAmount: 300,
				giftCardCode: "GC-0001",
			},
			global: {
				components: {
					VRow: BoxStub,
					VCol: BoxStub,
					VTextField: VTextFieldStub,
				},
			},
		});

		expect(wrapper.text()).toContain("Gift Card Applied");
		expect(wrapper.text()).toContain("GC-0001");
		expect(wrapper.text()).toContain("300");
		expect(wrapper.text()).toContain("Included in settlement");
		expect(wrapper.find('[data-test="payment-settlement-state"]').exists()).toBe(false);
	});
	const mountWithChange = (extraProps: Record<string, any>) => {
		(window as any).frappe = {
			_: (value: string, args?: any[]) =>
				value.replace(/\{(\d+)\}/g, (_match, index) => String(args?.[Number(index)] ?? "")),
		};
		return mount(PaymentSummary, {
			props: {
				invoice_doc: { currency: "OMR", is_return: false },
				total_payments_display: "110",
				diff_payment_display: "10",
				diff_label: "Change (OMR)",
				diffPayment: -10,
				change_due: 10,
				paid_change: 10,
				credit_change: 0,
				paid_change_rules: [],
				currencySymbol: () => "OMR",
				formatCurrency: (value: number) => String(value),
				...extraProps,
			},
			global: {
				components: {
					VRow: BoxStub,
					VCol: BoxStub,
					VTextField: VTextFieldStub,
				},
			},
		});
	};

	it("shows 'Over by X' in red instead of Change when a card overpayment can't be given as change", () => {
		const wrapper = mountWithChange({ uncoveredOverpayment: 10 });

		const diffField = wrapper.find('[data-test="payment-diff-field"]');
		expect(diffField.attributes("data-label")).toBe("Over by (OMR)");
		expect(diffField.text()).toBe("10");
		expect(diffField.classes()).toContain("payment-summary-field--over");
		expect(diffField.attributes("base-color")).toBe("error");
		expect(wrapper.find('[data-label="Paid Change"]').exists()).toBe(false);
		expect(wrapper.find('[data-label="Credit Change"]').exists()).toBe(false);
	});

	it("keeps the normal Change display when the overpayment is covered by cash", () => {
		const wrapper = mountWithChange({ uncoveredOverpayment: 0 });

		const diffField = wrapper.find('[data-test="payment-diff-field"]');
		expect(diffField.attributes("data-label")).toBe("Change (OMR)");
		expect(diffField.classes()).not.toContain("payment-summary-field--over");
		expect(wrapper.find('[data-label="Paid Change"]').exists()).toBe(true);
		expect(wrapper.find('[data-label="Credit Change"]').exists()).toBe(true);
	});
});
