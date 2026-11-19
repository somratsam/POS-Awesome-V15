// @vitest-environment jsdom
// The Navbar "Clear cache" button uses the same unsent-sales check and
// "Clear data" dialog as Ctrl+Shift+R (it used to clear without asking).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({ isRtl: false, rtlStyles: {}, rtlClasses: [] }),
}));

const mocks = vi.hoisted(() => ({
	forceClearAllCache: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	clearAllCaches: vi.fn(async () => undefined),
	confirmClearSavedData: vi.fn(async () => false),
}));
vi.mock("../src/offline/index", () => ({
	forceClearAllCache: mocks.forceClearAllCache,
	isOffline: mocks.isOffline,
}));
vi.mock("../src/utils/clearAllCaches", () => ({
	clearAllCaches: mocks.clearAllCaches,
	confirmClearSavedData: mocks.confirmClearSavedData,
}));

import Navbar from "../src/posapp/components/Navbar.vue";

const mountNavbar = () =>
	shallowMount(Navbar, {
		props: { posProfile: { name: "Main POS" } },
		global: {
			mocks: { __: (value: string) => value },
			stubs: {
				NavbarAppBar: true,
				NavbarDrawer: true,
				NavbarMenu: true,
				NotificationBell: true,
				StatusIndicator: true,
				CacheUsageMeter: true,
				AboutDialog: true,
				EmployeeSwitchDialog: true,
				OfflineInvoicesDialog: true,
				ServerUsageGadget: true,
				DatabaseUsageGadget: true,
				VDialog: true,
				VCard: true,
				VCardTitle: true,
				VCardText: true,
				VSnackbar: true,
				VBtn: true,
				VProgressCircular: true,
			},
		},
	});

describe("Navbar Clear cache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "cashier@example.com", user_fullname: "Main Cashier" },
			boot: { sysdefaults: { company: "Test Co" }, website_settings: {} },
			call: vi.fn(async () => ({ message: {} })),
		});
		Object.values(mocks).forEach((fn) => fn.mockClear());
		mocks.isOffline.mockReturnValue(false);
	});

	it("clears nothing when the check blocks or the cashier keeps the data", async () => {
		mocks.confirmClearSavedData.mockResolvedValue(false);
		const wrapper = mountNavbar();
		const vm = wrapper.vm as any;
		await vm.clearCache();
		expect(mocks.confirmClearSavedData).toHaveBeenCalledTimes(1);
		expect(mocks.forceClearAllCache).not.toHaveBeenCalled();
		expect(mocks.clearAllCaches).not.toHaveBeenCalled();
		expect(vm.clearingCache).toBe(false);
		wrapper.unmount();
	});

	it("clears after Clear data is confirmed", async () => {
		mocks.confirmClearSavedData.mockResolvedValue(true);
		const wrapper = mountNavbar();
		await (wrapper.vm as any).clearCache();
		expect(mocks.forceClearAllCache).toHaveBeenCalledTimes(1);
		expect(mocks.clearAllCaches).toHaveBeenCalledWith({ confirmBeforeClear: false });
		wrapper.unmount();
	});

	it("still refuses while offline, before asking anything", async () => {
		mocks.isOffline.mockReturnValue(true);
		const wrapper = mountNavbar();
		await (wrapper.vm as any).clearCache();
		expect(mocks.confirmClearSavedData).not.toHaveBeenCalled();
		expect(mocks.clearAllCaches).not.toHaveBeenCalled();
		wrapper.unmount();
	});
});

describe("Navbar Clear cache when the check throws", () => {
	it("clears nothing and does not throw", async () => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "cashier@example.com" },
			boot: { sysdefaults: {}, website_settings: {} },
			call: vi.fn(async () => ({ message: {} })),
		});
		mocks.isOffline.mockReturnValue(false);
		mocks.clearAllCaches.mockClear();
		mocks.confirmClearSavedData.mockRejectedValueOnce(new Error("boom"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const wrapper = mountNavbar();
		await expect((wrapper.vm as any).clearCache()).resolves.toBeUndefined();
		expect(mocks.clearAllCaches).not.toHaveBeenCalled();
		expect((wrapper.vm as any).clearingCache).toBe(false);
		wrapper.unmount();
	});
});
