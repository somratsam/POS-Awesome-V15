// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";

import DiscountReasonDialog from "../src/posapp/components/pos/invoice/DiscountReasonDialog.vue";
import CartItemRow from "../src/posapp/components/pos/invoice/CartItemRow.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const passthrough = (name: string, tag = "div") =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h(tag, { ...attrs }, slots.default?.());
		},
	});

// Mirrors Vuetify's contract: Esc / outside click emit update:modelValue(false)
// unless the dialog is persistent.
const VDialogStub = defineComponent({
	name: "VDialog",
	props: {
		modelValue: { type: Boolean, default: false },
		persistent: { type: Boolean, default: false },
		// Vuetify spreads contentProps onto its .v-overlay__content element.
		contentProps: { type: Object, default: () => ({}) },
	},
	emits: ["update:modelValue"],
	setup(props, { slots, emit }) {
		const dismiss = () => {
			if (!props.persistent) emit("update:modelValue", false);
		};
		return () =>
			props.modelValue
				? h("div", { ...props.contentProps, class: "v-overlay__content", tabindex: -1, "data-persistent": String(props.persistent) }, [
						h("button", { "data-test": "dialog-esc", onClick: dismiss }),
						h("button", { "data-test": "dialog-outside", onClick: dismiss }),
						slots.default?.(),
					])
				: null;
	},
});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup(props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-testid": attrs["data-testid"],
					"data-reason": attrs["data-reason"],
					"aria-checked": attrs["aria-checked"],
					disabled: props.disabled,
					onClick: (event: Event) => emit("click", event),
				},
				slots.default?.(),
			);
	},
});

const VTextFieldStub = defineComponent({
	name: "VTextField",
	inheritAttrs: false,
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("label", [
				h("input", {
					"data-testid": attrs["data-testid"],
					value: props.modelValue,
					onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
				}),
			]);
	},
});

const VCheckboxStub = defineComponent({
	name: "VCheckbox",
	inheritAttrs: false,
	props: { modelValue: { type: Boolean, default: false } },
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("label", [
				h("input", {
					type: "checkbox",
					"data-testid": attrs["data-testid"],
					checked: props.modelValue,
					onChange: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).checked),
				}),
				String(attrs.label || ""),
			]);
	},
});

const components = {
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardSubtitle: passthrough("VCardSubtitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VSpacer: passthrough("VSpacer"),
	VIcon: passthrough("VIcon", "i"),
	VAlert: passthrough("VAlert"),
	VBtn: VBtnStub,
	VTextField: VTextFieldStub,
	VCheckbox: VCheckboxStub,
};

const REASONS = [{ name: "Mastercard" }, { name: "Staff" }, { name: "Other / General" }];

describe("DiscountReasonDialog", () => {
	let ui: ReturnType<typeof useUIStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
		ui = useUIStore();
		ui.setRegisterData({ discount_reasons: REASONS } as any);
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	const open = async (request: Record<string, any> = {}) => {
		const wrapper = mount(DiscountReasonDialog, { attachTo: document.body, global: { components } });
		const result = ui.requestDiscountReason({
			mode: "line",
			lines: [{ posa_row_id: "r1", item_name: "Navy 38", discount_percentage: 10 }],
			...request,
		});
		await nextTick();
		await nextTick();
		return { wrapper, result };
	};

	it("one tap on any reason confirms it -- including Other / General, with nothing to type", async () => {
		const { wrapper, result } = await open();
		expect(wrapper.text()).toContain("Navy 38 — 10% off");
		expect(wrapper.find("input:not([type='checkbox'])").exists()).toBe(false);
		await wrapper.get('[data-testid="discount-reason-option-Other / General"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "Other / General", applyToOthers: false });
		wrapper.unmount();
	});

	it("Enter confirms the preselected reason", async () => {
		const { wrapper, result } = await open({ preselect: "Staff" });
		expect(wrapper.get('[data-reason="Staff"]').attributes("aria-checked")).toBe("true");
		await wrapper.get('[data-testid="discount-reason-dialog"]').trigger("keydown", { key: "Enter" });
		await expect(result).resolves.toMatchObject({ reason: "Staff" });
		wrapper.unmount();
	});

	it("a scanner burst (keys then a quick Enter) neither picks nor confirms anything", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const { wrapper } = await open({ preselect: "Staff" });
		const card = wrapper.get('[data-testid="discount-reason-dialog"]');
		for (const key of "4524019703 ") {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
			card.element.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		}
		await card.trigger("keydown", { key: "Enter" });
		expect(ui.discountReasonRequest).not.toBeNull();

		vi.setSystemTime(Date.now() + 400);
		await card.trigger("keydown", { key: "Enter" });
		expect(ui.discountReasonRequest).toBeNull();
		vi.useRealTimers();
		wrapper.unmount();
	});

	it("the scanner guard also catches keys when focus sits on the dialog's overlay wrapper", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const { wrapper } = await open({ preselect: "Staff" });
		const overlay = wrapper.get(".v-overlay__content").element as HTMLElement;
		for (const key of "4524 ") {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
			overlay.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		}
		overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		expect(ui.discountReasonRequest).not.toBeNull();
		vi.useRealTimers();
		wrapper.unmount();
	});

	it("focuses the preselected reason even when it isn't the first button, so Enter takes it", async () => {
		const { wrapper, result } = await open({ preselect: "Other / General" });
		await nextTick();
		await nextTick();
		expect((document.activeElement as HTMLElement)?.dataset?.reason).toBe("Other / General");
		await wrapper.get('[data-testid="discount-reason-dialog"]').trigger("keydown", { key: "Enter" });
		await expect(result).resolves.toMatchObject({ reason: "Other / General" });
		wrapper.unmount();
	});

	it('the line prompt has no "Later" and Esc / outside click don\'t close it', async () => {
		const { wrapper } = await open();
		expect(wrapper.get(".v-overlay__content").attributes("data-persistent")).toBe("true");
		expect(wrapper.find('[data-testid="discount-reason-back"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("Later");
		await wrapper.get('[data-test="dialog-esc"]').trigger("click");
		await wrapper.get('[data-test="dialog-outside"]').trigger("click");
		expect(ui.discountReasonRequest).not.toBeNull();
		wrapper.unmount();
	});

	it("the Pay check can only be left back to the cart (resolves null, so payment stays blocked)", async () => {
		const { wrapper, result } = await open({ mode: "pay" });
		await wrapper.get('[data-test="dialog-esc"]').trigger("click");
		expect(ui.discountReasonRequest).not.toBeNull();
		const back = wrapper.get('[data-testid="discount-reason-back"]');
		expect(back.text()).toBe("Back to cart");
		await back.trigger("click");
		await expect(result).resolves.toBeNull();
		wrapper.unmount();
	});

	it("with no reasons set up, the prompt can be closed so the till isn't stuck", async () => {
		ui.setRegisterData({ discount_reasons: [] } as any);
		const { wrapper, result } = await open();
		expect(wrapper.text()).toContain("No discount reasons are set up");
		const close = wrapper.get('[data-testid="discount-reason-back"]');
		expect(close.text()).toBe("Close");
		await close.trigger("click");
		await expect(result).resolves.toBeNull();
		wrapper.unmount();
	});

	it("offers applying the pick to other undiscounted-reason lines", async () => {
		const { wrapper, result } = await open({ otherMissingCount: 2 });
		expect(wrapper.text()).toContain("Also use for 2 other discounted line(s) without a reason");
		await wrapper.get('[data-testid="discount-reason-apply-others"]').setValue(true);
		await wrapper.get('[data-testid="discount-reason-option-Staff"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "Staff", applyToOthers: true });
		wrapper.unmount();
	});

	it("pay mode lists the missing lines", async () => {
		const { wrapper } = await open({
			mode: "pay",
			lines: [
				{ posa_row_id: "a", item_name: "Navy 38", discount_percentage: 10 },
				{ posa_row_id: "b", item_name: "Navy 40", discount_percentage: 15 },
			],
		});
		expect(wrapper.findAll('[data-testid="discount-reason-lines"] li').map((li) => li.text())).toEqual([
			"Navy 38 — 10% off",
			"Navy 40 — 15% off",
		]);
		expect(wrapper.get('[data-testid="discount-reason-back"]').text()).toBe("Back to cart");
		wrapper.unmount();
	});
});

describe("CartItemRow discount reason chip", () => {
	const ChipStub = defineComponent({
		name: "VChip",
		inheritAttrs: false,
		emits: ["click"],
		setup(_props, { slots, attrs, emit }) {
			return () =>
				h(
					"span",
					{ "data-testid": attrs["data-testid"], onClick: (e: Event) => emit("click", e) },
					slots.default?.(),
				);
		},
	});

	const mountRow = (item: Record<string, unknown>, props: Record<string, unknown> = {}) =>
		mount(CartItemRow, {
			props: {
				item: { item_code: "A", item_name: "Navy 38", qty: 1, rate: 9, price_list_rate: 10, ...item },
				visibleColumns: [{ key: "item_name" }],
				posProfile: { posa_require_discount_reason: 1 },
				formatFloat: (value: unknown) => String(value ?? ""),
				formatCurrency: (value: unknown) => String(value ?? ""),
				currencySymbol: () => "",
				isNumber: () => true,
				isNegative: () => false,
				rowIndex: 0,
				...props,
			},
			global: {
				components: { VChip: ChipStub },
				stubs: { VBtn: true, VIcon: true, VTooltip: true },
			},
		});

	beforeEach(() => {
		(window as any).__ = (text: string) => text;
	});

	it('shows "Reason?" on a discounted line without one, and emits on click', async () => {
		const onEdit = vi.fn();
		const wrapper = mountRow({ discount_percentage: 10, discount_amount: 1 }, { onEditDiscountReason: onEdit });
		const chip = wrapper.get('[data-testid="cart-discount-reason-chip"]');
		expect(chip.text()).toContain("Reason?");
		await chip.trigger("click");
		expect(onEdit).toHaveBeenCalledTimes(1);
	});

	it('shows the reason once set, and treats "Not recorded" as missing', () => {
		expect(
			mountRow({ discount_percentage: 10, posa_discount_reason: "Mastercard" })
				.get('[data-testid="cart-discount-reason-chip"]')
				.text(),
		).toContain("Mastercard");
		expect(
			mountRow({ discount_percentage: 10, posa_discount_reason: "Not recorded" })
				.get('[data-testid="cart-discount-reason-chip"]')
				.text(),
		).toContain("Reason?");
	});

	it.each([
		["an undiscounted line", { discount_percentage: 0 }, {}],
		["an offer line", { discount_percentage: 10, posa_offer_applied: 1 }, {}],
		["a return", { discount_percentage: 10 }, { isReturnInvoice: true }],
		["a store whose switch is off", { discount_percentage: 10 }, { posProfile: {} }],
		[
			"a store whose switch is off, even with a reason on the line",
			{ discount_percentage: 10, posa_discount_reason: "Staff" },
			{ posProfile: { posa_require_discount_reason: 0 } },
		],
	])("hides the chip on %s", (_label, item, props) => {
		expect(mountRow(item, props).find('[data-testid="cart-discount-reason-chip"]').exists()).toBe(false);
	});
});
