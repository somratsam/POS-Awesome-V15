// @vitest-environment jsdom
// The shared POS confirm / notice dialog that replaces window.confirm/alert.

import { defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import AppConfirmDialog from "../src/posapp/components/ui/AppConfirmDialog.vue";
import {
	answerAppDialog,
	appConfirm,
	appDialogRequest,
	appNotice,
	hasAppDialogHost,
} from "../src/posapp/services/appDialog";

(globalThis as any).__ = (text: string, args?: any[]) =>
	String(text).replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));

const passthrough = (name: string, tag = "div") =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h(tag, attrs, slots.default?.());
		},
	});

const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: { modelValue: { type: Boolean, default: false } },
	emits: ["update:modelValue"],
	setup(props, { slots }) {
		return () => (props.modelValue ? h("div", { class: "dialog" }, slots.default?.()) : null);
	},
});

const VBtnStub = defineComponent({
	name: "VBtnStub",
	inheritAttrs: false,
	setup(_props, { slots, attrs }) {
		return () => h("button", { ...attrs, onClick: attrs.onClick }, slots.default?.());
	},
});

const mounted: any[] = [];
function mountDialog() {
	const wrapper = mount(AppConfirmDialog, {
		global: {
			mocks: { __: (globalThis as any).__ },
			components: {
				VDialog: VDialogStub,
				VCard: passthrough("VCard"),
				VCardTitle: passthrough("VCardTitle"),
				VCardText: passthrough("VCardText"),
				VCardActions: passthrough("VCardActions"),
				VSpacer: passthrough("VSpacer", "span"),
				VBtn: VBtnStub,
			},
		},
	});
	mounted.push(wrapper);
	return wrapper;
}

afterEach(() => {
	while (mounted.length) {
		const w = mounted.pop();
		try {
			w.unmount();
		} catch {
			/* already unmounted */
		}
	}
	answerAppDialog(false);
	delete (globalThis as any).frappe;
	vi.restoreAllMocks();
});

describe("appConfirm with the dialog mounted", () => {
	it("shows title, message and buttons, and resolves true on the confirm button", async () => {
		const wrapper = mountDialog();
		expect(hasAppDialogHost()).toBe(true);
		const confirmSpy = vi.spyOn(window, "confirm");

		const answer = appConfirm({
			title: "Delete this draft?",
			message: "Draft invoice X will be deleted.",
			confirmText: "Delete draft",
			cancelText: "Keep draft",
			danger: true,
		});
		await nextTick();

		expect(wrapper.find('[data-testid="app-confirm-title"]').text()).toBe("Delete this draft?");
		expect(wrapper.find('[data-testid="app-confirm-message"]').text()).toBe(
			"Draft invoice X will be deleted.",
		);
		expect(wrapper.find('[data-testid="app-confirm-cancel"]').text()).toBe("Keep draft");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");

		await expect(answer).resolves.toBe(true);
		expect(appDialogRequest.value).toBeNull();
		expect(confirmSpy).not.toHaveBeenCalled();
		wrapper.unmount();
	});

	it("resolves false on the cancel button", async () => {
		const wrapper = mountDialog();
		const answer = appConfirm({ message: "Sure?" });
		await nextTick();
		await wrapper.find('[data-testid="app-confirm-cancel"]').trigger("click");
		await expect(answer).resolves.toBe(false);
		wrapper.unmount();
	});

	it("resolves false when closed with Esc / click outside", async () => {
		const wrapper = mountDialog();
		const answer = appConfirm({ message: "Sure?" });
		await nextTick();
		wrapper.findComponent(VDialogStub).vm.$emit("update:modelValue", false);
		await expect(answer).resolves.toBe(false);
		wrapper.unmount();
	});

	it("a newer request answers the open one with false", async () => {
		const wrapper = mountDialog();
		const first = appConfirm({ message: "First?" });
		const second = appConfirm({ message: "Second?" });
		await expect(first).resolves.toBe(false);
		await nextTick();
		expect(wrapper.find('[data-testid="app-confirm-message"]').text()).toBe("Second?");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await expect(second).resolves.toBe(true);
		wrapper.unmount();
	});

	it("unmounting the dialog answers an open confirm with false", async () => {
		const wrapper = mountDialog();
		const answer = appConfirm({ message: "Sure?" });
		wrapper.unmount();
		await expect(answer).resolves.toBe(false);
		expect(hasAppDialogHost()).toBe(false);
	});

	it("swallows typed characters and a scanner's Enter so they don't reach the cart", async () => {
		const wrapper = mountDialog();
		void appConfirm({ message: "Sure?" });
		await nextTick();
		const contentProps = (wrapper.findComponent(VDialogStub).vm.$attrs as any)["content-props"];
		const onKeydown = contentProps.onKeydownCapture;
		const key = (k: string) => {
			const ev = new KeyboardEvent("keydown", { key: k, cancelable: true });
			const stop = vi.spyOn(ev, "stopPropagation");
			onKeydown(ev);
			return { prevented: ev.defaultPrevented, stopped: stop.mock.calls.length > 0 };
		};
		expect(key("1")).toEqual({ prevented: true, stopped: true });
		expect(key("Enter")).toEqual({ prevented: true, stopped: true });
		wrapper.unmount();
	});

	it("a notice has one button and resolves when it is pressed", async () => {
		const wrapper = mountDialog();
		const done = appNotice({ title: "Offline data tidied up", message: "Nothing needs to be done." });
		await nextTick();
		expect(wrapper.find('[data-testid="app-confirm-cancel"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="app-confirm-ok"]').text()).toBe("OK");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await expect(done).resolves.toBeUndefined();
		wrapper.unmount();
	});
});

describe("appConfirm without the dialog mounted (desk pages)", () => {
	it("falls back to frappe.confirm, yes and no", async () => {
		const confirm = vi.fn();
		(globalThis as any).frappe = { confirm };
		const yes = appConfirm({ message: "Clear?" });
		confirm.mock.calls[0][1]();
		await expect(yes).resolves.toBe(true);

		const no = appConfirm({ message: "Clear?" });
		confirm.mock.calls[1][2]();
		await expect(no).resolves.toBe(false);
	});

	it("uses the browser pop-up only without Frappe", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		await expect(appConfirm({ message: "Clear?" })).resolves.toBe(true);
	});

	it("a notice falls back to frappe.msgprint", async () => {
		const msgprint = vi.fn();
		(globalThis as any).frappe = { msgprint };
		await appNotice({ title: "T", message: "M" });
		expect(msgprint).toHaveBeenCalledWith({ title: "T", message: "M" });
	});
});

describe("no browser pop-ups left outside the part-2 sites", () => {
	it("only the print fallback, start-up check and Close Shift check still use window.confirm", async () => {
		const sources = import.meta.glob("../src/**/*.{vue,ts,js}", { as: "raw", eager: true }) as Record<
			string,
			string
		>;
		const hits: string[] = [];
		for (const [file, text] of Object.entries(sources)) {
			if (file.includes("/libs/")) continue;
			if (
				/(^|[^.\w$])(window\.)?(confirm|alert)\s*\(\s*["'`_a-zA-Z]/m.test(
					text.replace(/function confirm\(\)|confirm\(\);|frappe\.confirm\(/g, ""),
				)
			) {
				hits.push(file.replace("../src/", ""));
			}
		}
		expect(hits.sort()).toEqual(
			[
				"posapp/composables/pos/shared/usePosShift.ts",
				"posapp/layouts/DefaultLayout.vue",
				"posapp/services/appDialog.ts",
				"posapp/services/documentPrint.ts",
			].sort(),
		);
	});
});
