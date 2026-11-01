// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";

import PaymentMethods from "../src/posapp/components/pos/payments/PaymentMethods.vue";
import PaymentReconciliation from "../src/posapp/components/pos/closing/PaymentReconciliation.vue";
import { normalizeClosingAmount } from "../src/posapp/utils/closingAmount";

const fmt = (value: number) => Number(value || 0).toFixed(3);
const translate = (value: string, args?: any[]) =>
	args?.length ? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")) : value;

const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const Btn = defineComponent({
	emits: ["click"],
	setup: (_, { slots, emit, attrs }) => () =>
		h("button", { type: "button", "data-test": attrs["data-test"], onClick: () => emit("click") }, slots.default?.()),
});

// A real <input> standing in for v-text-field: Vuetify sends focus/blur to the
// input and lets mouseup/keydown bubble from it, which this mirrors.
const TextField = defineComponent({
	props: { modelValue: { type: [String, Number], default: "" } },
	emits: ["change", "focus", "blur", "mouseup", "keydown", "update:modelValue"],
	setup(props, { emit, attrs }) {
		return () =>
			h("input", {
				type: "text",
				"data-testid": attrs["data-testid"],
				"data-test": attrs["data-test"],
				value: props.modelValue,
				onChange: (event: Event) => emit("change", event),
				onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
				onFocus: (event: FocusEvent) => emit("focus", event),
				onBlur: (event: FocusEvent) => emit("blur", event),
				onMouseup: (event: MouseEvent) => emit("mouseup", event),
				onKeydown: (event: KeyboardEvent) => {
					emit("keydown", event);
					if (event.key === "Enter") (event.target as HTMLInputElement).blur();
				},
			});
	},
});

const isAllSelected = (input: HTMLInputElement) =>
	input.value.length > 0 && input.selectionStart === 0 && input.selectionEnd === input.value.length;

describe("Payment screen Amount box", () => {
	beforeEach(() => {
		(window as any).__ = translate;
		(window as any).frappe = { _: translate };
		document.body.innerHTML = "";
	});

	// The parent (Payments.vue's handleSetRestAmount) fills what's still owed
	// into an empty box; here it fills `owed` when the box is empty.
	const mountScreen = ({ amount = 0, owed = 0, isReturn = false } = {}) => {
		const payments = reactive([
			{ name: "P1", mode_of_payment: "Visa", type: "Bank", amount: 80, default: 0 },
			{ name: "P2", mode_of_payment: "Maal", type: "Bank", amount, default: 0 },
		]);
		const onUpdateAmount = vi.fn();
		const onSetRestAmount = vi.fn((payment: any) => {
			if (!Number(payment.amount) && owed > 0) payment.amount = owed;
		});
		const wrapper = mount(PaymentMethods, {
			attachTo: document.body,
			props: {
				payments,
				currency: "OMR",
				isReturn,
				requestPaymentField: false,
				currencySymbol: () => "OMR ",
				formatCurrency: fmt,
				isNumber: () => true,
				getVisibleDenominations: () => [],
				isCashLikePayment: () => false,
				isMpesaC2bPayment: () => false,
				onUpdateAmount,
				onSetRestAmount,
			},
			global: { components: { VRow: Box, VCol: Box, VBtn: Btn, VTextField: TextField } },
		});
		const input = wrapper.find('[data-testid="payment-amount-Maal"]').element as HTMLInputElement;
		return { wrapper, input, payments, onUpdateAmount, onSetRestAmount };
	};

	const focus = async (input: HTMLInputElement) => {
		input.focus();
		await nextTick();
		await nextTick();
	};

	it("shows an empty box for a 0 amount", () => {
		const { input } = mountScreen({ amount: 0 });
		expect(input.value).toBe("");
	});

	it.each([
		[59.3, "59.300"],
		[17.275, "17.275"],
		[0.005, "0.005"],
	])("focusing an empty box with %s owed fills it and selects the whole value", async (owed, shown) => {
		const { input, payments, onSetRestAmount } = mountScreen({ owed });
		await focus(input);

		expect(onSetRestAmount).toHaveBeenCalledTimes(1);
		expect(payments[1].amount).toBe(owed);
		expect(input.value).toBe(shown);
		expect(isAllSelected(input)).toBe(true);
	});

	it("Enter keeps the filled amount: no edit is sent and the value stays", async () => {
		const { input, payments, onUpdateAmount } = mountScreen({ owed: 59.3 });
		await focus(input);
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await nextTick();

		expect(document.activeElement).not.toBe(input);
		expect(onUpdateAmount).not.toHaveBeenCalled();
		expect(payments[1].amount).toBe(59.3);
		expect(input.value).toBe("59.300");
	});

	it("Tab (leaving the box) keeps the filled amount", async () => {
		const { input, payments, onUpdateAmount } = mountScreen({ owed: 59.3 });
		await focus(input);
		input.blur();
		await nextTick();

		expect(onUpdateAmount).not.toHaveBeenCalled();
		expect(payments[1].amount).toBe(59.3);
	});

	it("typing replaces the selected value: the edit carries only what was typed", async () => {
		const { input, onUpdateAmount } = mountScreen({ owed: 59.3 });
		await focus(input);
		expect(isAllSelected(input)).toBe(true);

		// With the whole value selected, a keystroke replaces it.
		input.setRangeText("50", input.selectionStart!, input.selectionEnd!, "end");
		input.dispatchEvent(new Event("change"));

		expect(onUpdateAmount).toHaveBeenCalledTimes(1);
		expect((onUpdateAmount.mock.calls[0][1].target as HTMLInputElement).value).toBe("50");
	});

	it("nothing owed and value 0: the box stays empty", async () => {
		const { input, payments } = mountScreen({ owed: 0 });
		await focus(input);

		expect(payments[1].amount).toBe(0);
		expect(input.value).toBe("");
	});

	it("a box that already holds an amount selects it on focus", async () => {
		const { input, payments } = mountScreen({ amount: 25, owed: 59.3 });
		expect(input.value).toBe("25.000");
		await focus(input);

		expect(payments[1].amount).toBe(25);
		expect(isAllSelected(input)).toBe(true);
	});

	it("a refund box shows and selects its amount", async () => {
		const { input } = mountScreen({ amount: -20, isReturn: true });
		expect(input.value).toBe("-20.000");
		await focus(input);
		expect(isAllSelected(input)).toBe(true);
	});

	it("the first mouseup after a click keeps the selection; a later click may place the caret", async () => {
		const { input } = mountScreen({ owed: 59.3 });
		await focus(input);

		const first = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
		input.dispatchEvent(first);
		expect(first.defaultPrevented).toBe(true);
		expect(isAllSelected(input)).toBe(true);

		const second = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
		input.dispatchEvent(second);
		expect(second.defaultPrevented).toBe(false);
	});
});

describe("Closing shift Amount box", () => {
	beforeEach(() => {
		(window as any).__ = translate;
		(window as any).frappe = { _: translate };
		document.body.innerHTML = "";
	});

	const DataTable = defineComponent({
		props: { items: { type: Array, default: () => [] } },
		setup: (props, { slots }) => () =>
			h(
				"div",
				(props.items as any[]).map((item) => h("div", slots["item.closing_amount"]?.({ item }))),
			),
	});

	const mountClosing = (closing_amount: unknown, currencyPrecision?: number) => {
		const payments = reactive([{ mode_of_payment: "Cash", expected_amount: 45.5, closing_amount }]);
		const wrapper = mount(PaymentReconciliation, {
			attachTo: document.body,
			props: {
				payments,
				headers: [],
				companyCurrencySymbol: "OMR",
				// Like useFormat's formatCurrency(value, precision).
				formatCurrency: (value: number, precision = 2) => Number(value || 0).toFixed(precision),
				formatFloat: (value: number) => String(value),
				...(currencyPrecision === undefined ? {} : { currencyPrecision }),
			},
			global: {
				components: { VDataTable: DataTable, VTextField: TextField },
				provide: { frappe: { _: translate } },
			},
		});
		const input = wrapper.find('[data-test="closing-amount-Cash"]').element as HTMLInputElement;
		const field = wrapper.findComponent(TextField);
		return { wrapper, input, field, payments };
	};

	it("an empty box shows a faint 0 at the currency precision instead of the old 'Edit' label", () => {
		const { input, field } = mountClosing(0, 3);
		expect(input.getAttribute("placeholder")).toBe("0.000");
		expect(field.vm.$attrs.label).toBeUndefined();
		expect(input.getAttribute("aria-label")).toBe("Closing amount for Cash");

		expect(mountClosing(0).input.getAttribute("placeholder")).toBe("0.00");
	});

	it("the placeholder stays while a value is shown, and the value wins", () => {
		const { input } = mountClosing(45.5, 3);
		expect(input.value).toBe("45.5");
		expect(input.getAttribute("placeholder")).toBe("0.000");
	});

	it("shows an empty box for a 0 closing amount, and for null", () => {
		expect(mountClosing(0).input.value).toBe("");
		expect(mountClosing(null).input.value).toBe("");
	});

	// The closing box is type="number": browsers select its text with
	// select(), but jsdom keeps no selection for number inputs, so check that
	// select() runs (on focus, and once more on the first mouseup).
	it("focus selects the whole value so typing replaces it", async () => {
		const { input } = mountClosing(45.5);
		expect(input.type).toBe("number");
		const select = vi.spyOn(input, "select");
		input.focus();
		await nextTick();
		await nextTick();
		expect(input.value).toBe("45.5");
		expect(select).toHaveBeenCalledTimes(1);

		const first = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
		input.dispatchEvent(first);
		expect(first.defaultPrevented).toBe(true);
		expect(select).toHaveBeenCalledTimes(2);

		const second = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
		input.dispatchEvent(second);
		expect(second.defaultPrevented).toBe(false);
	});

	it("typing 12.345 then leaving the box stores the number 12.345", async () => {
		const { input, payments } = mountClosing(0);
		input.focus();
		input.value = "12.345";
		input.dispatchEvent(new Event("input"));
		await nextTick();
		expect(payments[0].closing_amount).toBe("12.345");
		expect(input.value).toBe("12.345");

		input.blur();
		await nextTick();
		expect(payments[0].closing_amount).toBe(12.345);
	});

	it.each([[""], [null], ["   "]])("leaving the box empty (%j) stores 0, never blank or null", async (start) => {
		const { input, payments } = mountClosing(20);
		input.focus();
		input.value = start === null ? "" : (start as string);
		input.dispatchEvent(new Event("input"));
		if (start === null) payments[0].closing_amount = null;
		input.blur();
		await nextTick();

		expect(payments[0].closing_amount).toBe(0);
		expect(input.value).toBe("");
	});

	it("accepts 3 decimals when the currency precision is 3, and refuses a 4th", () => {
		const { field } = mountClosing(0, 3);
		const rule = (field.vm.$attrs.rules as any[])?.[0] ?? (field.props() as any).rules?.[0];
		expect(rule("12.345")).toBe(true);
		expect(rule("12.3456")).toBe("Maximum of 3 decimal places");
	});

	it("without a precision passed, it still defaults to 2 (why ClosingDialog must pass it)", () => {
		const { field } = mountClosing(0);
		const rule = (field.vm.$attrs.rules as any[])?.[0] ?? (field.props() as any).rules?.[0];
		expect(rule("12.345")).toBe("Maximum of 2 decimal places");
	});
});

describe("normalizeClosingAmount", () => {
	it.each([
		["", 0],
		["  ", 0],
		[null, 0],
		[undefined, 0],
		["12.345", 12.345],
		[0, 0],
		[45.5, 45.5],
		["abc", "abc"],
	])("%j -> %j", (input, expected) => {
		expect(normalizeClosingAmount(input)).toBe(expected);
	});
});
