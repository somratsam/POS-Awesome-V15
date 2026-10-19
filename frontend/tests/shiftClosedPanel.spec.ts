// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import ShiftClosedPanel from "../src/posapp/components/pos/shift/ShiftClosedPanel.vue";
import { goToDesk } from "../src/posapp/services/deskNavigation";

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
					disabled: props.disabled,
					onClick: (event: Event) => emit("click", event),
				},
				slots.default?.(),
			);
	},
});

const VIconStub = defineComponent({ name: "VIcon", setup: () => () => h("i") });
const VAlertStub = defineComponent({
	name: "VAlert",
	inheritAttrs: false,
	setup(_props, { slots, attrs }) {
		return () => h("div", { role: "alert", "data-testid": attrs["data-testid"] }, slots.default?.());
	},
});

describe("ShiftClosedPanel", () => {
	const mountPanel = (props: Record<string, unknown> = {}) => {
		const handlers = { onClose: vi.fn(), onLogout: vi.fn(), onReprint: vi.fn(), onOpenNewShift: vi.fn() };
		const wrapper = mount(ShiftClosedPanel, {
			props: { ...handlers, ...props },
			global: { components: { VBtn: VBtnStub, VIcon: VIconStub, VAlert: VAlertStub } },
		});
		return { wrapper, handlers };
	};
	const status = (wrapper: any) => wrapper.find('[data-testid="shift-closed-print-status"]');
	const reprint = (wrapper: any) => wrapper.find('[data-testid="shift-closed-reprint"]');

	it("shows Close, Log Out, Reprint Z Report and Open New Shift, in that order", () => {
		const { wrapper } = mountPanel({ printState: "sent" });
		expect(wrapper.text()).toContain("Shift closed");
		expect(wrapper.findAll("button").map((b) => b.text())).toEqual([
			"Close",
			"Log Out",
			"Reprint Z Report",
			"Open New Shift",
		]);
	});

	it("while printing, says so and disables Reprint", () => {
		const { wrapper } = mountPanel({ printState: "printing" });
		expect(status(wrapper).text()).toBe("Printing the Z Report…");
		expect(reprint(wrapper).attributes("disabled")).toBeDefined();
	});

	it("once sent, says to reprint if nothing came out (paper-out can't be detected)", () => {
		const { wrapper } = mountPanel({ printState: "sent" });
		expect(status(wrapper).text()).toBe(
			"Z Report sent to the printer. If it didn't print, check the printer and press Reprint.",
		);
		expect(reprint(wrapper).attributes("disabled")).toBeUndefined();
	});

	it("on failure, warns with the reason and what to do", () => {
		const { wrapper } = mountPanel({ printState: "failed", printError: "QZ Tray is not available." });
		const alert = status(wrapper);
		expect(alert.attributes("role")).toBe("alert");
		expect(alert.text()).toContain("The Z Report didn't print.");
		expect(alert.text()).toContain("QZ Tray is not available.");
		expect(alert.text()).toContain("Check QZ Tray and the printer, then press Reprint.");
		expect(reprint(wrapper).attributes("disabled")).toBeUndefined();
	});

	it.each([
		["shift-closed-close", "onClose"],
		["shift-closed-logout", "onLogout"],
		["shift-closed-reprint", "onReprint"],
		["shift-closed-open-new", "onOpenNewShift"],
	] as const)("%s triggers only %s", async (testId, handler) => {
		const { wrapper, handlers } = mountPanel({ printState: "sent" });
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
