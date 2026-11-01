// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import CloseShiftConfirmDialog from "../src/posapp/components/pos/closing/CloseShiftConfirmDialog.vue";

const passthrough = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h("div", { "data-testid": attrs["data-testid"] }, slots.default?.());
		},
	});

// Like Vuetify: Esc / a click outside emit update:modelValue(false).
const VDialogStub = defineComponent({
	name: "VDialog",
	props: { modelValue: { type: Boolean, default: false } },
	emits: ["update:modelValue"],
	setup(props, { slots, emit }) {
		return () =>
			props.modelValue
				? h("div", [
						h("button", { "data-test": "dialog-esc", onClick: () => emit("update:modelValue", false) }),
						slots.default?.(),
					])
				: null;
	},
});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	emits: ["click"],
	setup(_props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-testid": attrs["data-testid"],
					disabled: Boolean(attrs.disabled),
					onClick: (e: Event) => emit("click", e),
				},
				slots.default?.(),
			);
	},
});

const VTextareaStub = defineComponent({
	name: "VTextarea",
	inheritAttrs: false,
	props: { modelValue: { type: String, default: "" }, label: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("textarea", {
				"data-testid": attrs["data-testid"],
				"aria-label": props.label,
				value: props.modelValue,
				onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLTextAreaElement).value),
			});
	},
});

const components = {
	VTextarea: VTextareaStub,
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VSpacer: passthrough("VSpacer"),
	VBtn: VBtnStub,
};

const mountDialog = (modelValue = true, extra: Record<string, any> = {}) => {
	const handlers = { onGoBack: vi.fn(), onConfirm: vi.fn() };
	const wrapper = mount(CloseShiftConfirmDialog, {
		props: { modelValue, ...handlers, ...extra },
		global: { components },
		attachTo: document.body,
	});
	return { wrapper, handlers };
};

describe("CloseShiftConfirmDialog", () => {
	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = "";
	});

	it("asks to close the shift in the agreed words", () => {
		const { wrapper } = mountDialog();
		expect(wrapper.text()).toContain("Close your shift?");
		expect(wrapper.text()).toContain(
			"This will end your shift and print the Z Report. You won't be able to sell until you open a new shift.",
		);
		expect(wrapper.findAll("button[data-testid]").map((b) => b.text())).toEqual(["Go Back", "Close Shift"]);
	});

	it("puts the focus on Go Back, so a stray Enter doesn't close the shift", async () => {
		vi.useFakeTimers();
		const { wrapper } = mountDialog(false);
		await wrapper.setProps({ modelValue: true });
		await vi.runAllTimersAsync();
		expect(document.activeElement?.getAttribute("data-testid")).toBe("close-shift-confirm-go-back");
	});

	it.each([
		["close-shift-confirm-go-back", "onGoBack"],
		["close-shift-confirm-close", "onConfirm"],
	] as const)("%s triggers only %s", async (testId, handler) => {
		const { wrapper, handlers } = mountDialog();
		await wrapper.find(`[data-testid="${testId}"]`).trigger("click");
		for (const [name, fn] of Object.entries(handlers)) {
			expect(fn).toHaveBeenCalledTimes(name === handler ? 1 : 0);
		}
	});

	it("Esc or a click outside counts as Go Back", async () => {
		const { wrapper, handlers } = mountDialog();
		await wrapper.find('[data-test="dialog-esc"]').trigger("click");
		expect(handlers.onGoBack).toHaveBeenCalledTimes(1);
		expect(handlers.onConfirm).not.toHaveBeenCalled();
	});

	describe("closing amounts over the tolerance", () => {
		beforeEach(() => {
			(window as any).__ = (text: string, args?: any[]) =>
				args?.length ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")) : text;
		});
		afterEach(() => {
			delete (window as any).__;
		});
		const variances = [
			{ mode_of_payment: "Cash", difference: -2.35, direction: "short" },
			{ mode_of_payment: "Visa", difference: 5, direction: "over" },
		];
		const close = (wrapper: any) => wrapper.find('[data-testid="close-shift-confirm-close"]');

		it("shows nothing extra and enables Close Shift when everything is within tolerance", () => {
			const { wrapper } = mountDialog(true, { variances: [] });
			expect(wrapper.find('[data-testid="close-shift-variance"]').exists()).toBe(false);
			expect(close(wrapper).attributes("disabled")).toBeUndefined();
		});

		it("lists each method that is off, short or over, by how much", () => {
			const { wrapper } = mountDialog(true, { variances, tolerance: 0.5 });
			expect(wrapper.text()).toContain("These amounts differ from the expected amounts by more than 0.500:");
			expect(wrapper.find('[data-testid="close-shift-variance-Cash"]').text()).toBe("Cash: short 2.350");
			expect(wrapper.find('[data-testid="close-shift-variance-Visa"]').text()).toBe("Visa: over 5.000");
		});

		it("on a blind-count profile names the methods without the amounts", () => {
			const { wrapper } = mountDialog(true, { variances, hideAmounts: true });
			expect(wrapper.find('[data-testid="close-shift-variance-Cash"]').text()).toBe("Cash");
			expect(wrapper.text()).not.toContain("2.350");
			expect(wrapper.text()).not.toContain("short");
		});

		it("keeps Close Shift disabled until a reason is given", async () => {
			const onUpdateReason = vi.fn();
			const { wrapper, handlers } = mountDialog(true, { variances, "onUpdate:reason": onUpdateReason });
			expect(close(wrapper).attributes("disabled")).toBeDefined();
			await close(wrapper).trigger("click");
			expect(handlers.onConfirm).not.toHaveBeenCalled();

			const reason = wrapper.find('[data-testid="close-shift-variance-reason"]');
			(reason.element as HTMLTextAreaElement).value = "Gave too much change";
			await reason.trigger("input");
			expect(onUpdateReason).toHaveBeenCalledWith("Gave too much change");

			await wrapper.setProps({ reason: "   " });
			expect(close(wrapper).attributes("disabled")).toBeDefined();
			await wrapper.setProps({ reason: "Gave too much change" });
			expect(close(wrapper).attributes("disabled")).toBeUndefined();
			await close(wrapper).trigger("click");
			expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
		});

		it("when the profile needs a supervisor, stays disabled until one is switched in", async () => {
			const { wrapper } = mountDialog(true, {
				variances,
				reason: "Short",
				needsSupervisor: true,
				canApprove: false,
			});
			const note = wrapper.find('[data-testid="close-shift-variance-supervisor"]');
			expect(note.text()).toBe(
				"A POS supervisor must approve this closing. Switch to a POS supervisor, then press Close Shift.",
			);
			expect(close(wrapper).attributes("disabled")).toBeDefined();

			await wrapper.setProps({ canApprove: true });
			expect(wrapper.find('[data-testid="close-shift-variance-supervisor"]').text()).toBe(
				"Your POS supervisor approval is recorded with this closing.",
			);
			expect(close(wrapper).attributes("disabled")).toBeUndefined();
		});

		it("says nothing about a supervisor when the profile doesn't ask for one", () => {
			const { wrapper } = mountDialog(true, { variances, reason: "Short" });
			expect(wrapper.find('[data-testid="close-shift-variance-supervisor"]').exists()).toBe(false);
			expect(close(wrapper).attributes("disabled")).toBeUndefined();
		});
	});
});
