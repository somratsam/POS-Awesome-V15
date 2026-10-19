// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import ShiftClosedPanel from "../src/posapp/components/pos/shift/ShiftClosedPanel.vue";
import { goToDesk } from "../src/posapp/services/deskNavigation";

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	emits: ["click"],
	setup(_props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{ type: "button", "data-testid": attrs["data-testid"], onClick: (event: Event) => emit("click", event) },
				slots.default?.(),
			);
	},
});

const VIconStub = defineComponent({ name: "VIcon", setup: () => () => h("i") });

describe("ShiftClosedPanel", () => {
	const mountPanel = () => {
		const handlers = { onClose: vi.fn(), onLogout: vi.fn(), onOpenNewShift: vi.fn() };
		const wrapper = mount(ShiftClosedPanel, {
			props: handlers,
			global: { components: { VBtn: VBtnStub, VIcon: VIconStub } },
		});
		return { wrapper, handlers };
	};

	it("says the shift is closed and the Z Report is printing", () => {
		const { wrapper } = mountPanel();
		expect(wrapper.text()).toContain("Shift closed");
		expect(wrapper.text()).toContain("The Z Report is printing.");
	});

	it("shows Close, Log Out and Open New Shift, in that order", () => {
		const { wrapper } = mountPanel();
		expect(wrapper.findAll("button").map((b) => b.text())).toEqual(["Close", "Log Out", "Open New Shift"]);
	});

	it.each([
		["shift-closed-close", "onClose"],
		["shift-closed-logout", "onLogout"],
		["shift-closed-open-new", "onOpenNewShift"],
	] as const)("%s triggers only %s", async (testId, handler) => {
		const { wrapper, handlers } = mountPanel();
		await wrapper.find(`[data-testid="${testId}"]`).trigger("click");
		for (const [name, fn] of Object.entries(handlers)) {
			expect(fn).toHaveBeenCalledTimes(name === handler ? 1 : 0);
		}
	});
});

describe("goToDesk", () => {
	it("routes to the Desk home and reloads, like the opening dialog's Close", () => {
		const setRoute = vi.fn();
		const reload = vi.fn();
		vi.stubGlobal("frappe", { set_route: setRoute });
		vi.stubGlobal("location", { reload });
		goToDesk();
		expect(setRoute).toHaveBeenCalledWith("/");
		expect(reload).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});
});
