// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
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
				{ type: "button", "data-testid": attrs["data-testid"], onClick: (e: Event) => emit("click", e) },
				slots.default?.(),
			);
	},
});

const components = {
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VSpacer: passthrough("VSpacer"),
	VBtn: VBtnStub,
};

const mountDialog = (modelValue = true) => {
	const handlers = { onGoBack: vi.fn(), onConfirm: vi.fn() };
	const wrapper = mount(CloseShiftConfirmDialog, {
		props: { modelValue, ...handlers },
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
});
