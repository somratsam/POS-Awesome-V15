// @vitest-environment jsdom
// Clearing the till's saved data deletes offline sales not yet sent, so it is
// blocked while any are waiting (Ctrl+Shift+R and the Navbar "Clear cache").

import { defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const unsent = vi.hoisted(() => ({
	count: vi.fn(async () => ({ sales: 0, other: 0 })),
}));
vi.mock("../src/utils/unsentOfflineWork", () => ({ countUnsentOfflineWork: unsent.count }));

import AppConfirmDialog from "../src/posapp/components/ui/AppConfirmDialog.vue";
import { answerAppDialog } from "../src/posapp/services/appDialog";
import { clearAllCaches, confirmClearSavedData } from "../src/utils/clearAllCaches";

(globalThis as any).__ = (text: string, args?: any[]) =>
	String(text).replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));

const box = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_p, { slots, attrs }) {
			return () => h("div", attrs, slots.default?.());
		},
	});
const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: { modelValue: { type: Boolean, default: false } },
	setup(props, { slots }) {
		return () => (props.modelValue ? h("div", slots.default?.()) : null);
	},
});
const VBtnStub = defineComponent({
	name: "VBtnStub",
	inheritAttrs: false,
	setup(_p, { slots, attrs }) {
		return () => h("button", attrs, slots.default?.());
	},
});

let wrapper: any;
const mountHost = () =>
	mount(AppConfirmDialog, {
		global: {
			components: {
				VDialog: VDialogStub,
				VCard: box("VCard"),
				VCardTitle: box("VCardTitle"),
				VCardText: box("VCardText"),
				VCardActions: box("VCardActions"),
				VSpacer: box("VSpacer"),
				VBtn: VBtnStub,
			},
		},
	});
const flush = async () => {
	for (let i = 0; i < 5; i += 1) await nextTick();
};
const title = () => wrapper.find('[data-testid="app-confirm-title"]');
const message = () => wrapper.find('[data-testid="app-confirm-message"]').text();
const clearOpts = { skipServiceWorkers: true, skipStorage: ["indexedDB", "caches"] };

beforeEach(() => {
	wrapper = mountHost();
	localStorage.setItem("posa_test_key", "1");
	unsent.count.mockReset();
});
afterEach(() => {
	answerAppDialog(false);
	wrapper.unmount();
	vi.restoreAllMocks();
});

describe("Clear saved data with offline sales not sent yet", () => {
	it("blocks with the count, offers no Clear button, and clears nothing", async () => {
		unsent.count.mockResolvedValue({ sales: 3, other: 0 });
		const run = clearAllCaches(clearOpts);
		await flush();
		expect(title().text()).toBe("Saved data not cleared");
		expect(message()).toContain("3 offline sales not sent yet — connect and sync first.");
		expect(message()).toContain("Nothing was cleared.");
		expect(wrapper.find('[data-testid="app-confirm-cancel"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="app-confirm-ok"]').text()).toBe("OK");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await run;
		expect(localStorage.getItem("posa_test_key")).toBe("1");
	});

	it("also blocks for other unsent records (customers, payments, cash movements)", async () => {
		unsent.count.mockResolvedValue({ sales: 0, other: 2 });
		const answer = confirmClearSavedData();
		await flush();
		expect(message()).toContain("2 other offline records");
		expect(message()).not.toContain("offline sales not sent yet");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await expect(answer).resolves.toBe(false);
	});

	it("blocks when the check itself fails", async () => {
		unsent.count.mockRejectedValue(new Error("db closed"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const run = clearAllCaches(clearOpts);
		await flush();
		expect(title().text()).toBe("Saved data not cleared");
		expect(message()).toContain("Could not check this till");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await run;
		expect(localStorage.getItem("posa_test_key")).toBe("1");
	});
});

describe("Clear saved data with nothing unsent", () => {
	it("shows the normal Clear data dialog: Keep data keeps, Clear data clears", async () => {
		unsent.count.mockResolvedValue({ sales: 0, other: 0 });
		const confirmSpy = vi.spyOn(window, "confirm");

		const kept = clearAllCaches(clearOpts);
		await flush();
		expect(title().text()).toBe("Clear saved data on this till?");
		expect(message()).toContain("no offline sales waiting to be sent");
		expect(wrapper.find('[data-testid="app-confirm-cancel"]').text()).toBe("Keep data");
		await wrapper.find('[data-testid="app-confirm-cancel"]').trigger("click");
		await kept;
		expect(localStorage.getItem("posa_test_key")).toBe("1");

		const cleared = clearAllCaches(clearOpts);
		await flush();
		expect(wrapper.find('[data-testid="app-confirm-ok"]').text()).toBe("Clear data");
		await wrapper.find('[data-testid="app-confirm-ok"]').trigger("click");
		await cleared;
		expect(localStorage.getItem("posa_test_key")).toBeNull();
		expect(confirmSpy).not.toHaveBeenCalled();
	});
});

describe("Ctrl+Shift+R is left to the browser", () => {
	it("is not intercepted: no preventDefault, no check, no dialog, nothing cleared", async () => {
		const event = new KeyboardEvent("keydown", {
			key: "R",
			code: "KeyR",
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(event);
		await flush();
		expect(event.defaultPrevented).toBe(false);
		expect(unsent.count).not.toHaveBeenCalled();
		expect(title().exists()).toBe(false);
		expect(localStorage.getItem("posa_test_key")).toBe("1");
	});

	it("no source file binds Ctrl+Shift+R", () => {
		const sources = import.meta.glob("../src/**/*.{vue,ts,js}", { as: "raw", eager: true }) as Record<
			string,
			string
		>;
		const hits = Object.entries(sources)
			.filter(([file]) => !file.includes("/libs/"))
			.filter(([, text]) => /shiftKey[\s\S]{0,80}(KeyR|["']R["'])|(KeyR|["']R["'])[\s\S]{0,80}shiftKey/.test(text))
			.map(([file]) => file);
		expect(hits).toEqual([]);
	});
});
