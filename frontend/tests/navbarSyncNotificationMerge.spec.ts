// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: false,
		rtlStyles: {},
		rtlClasses: [],
	}),
}));

vi.mock("../src/offline/index", () => ({
	forceClearAllCache: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/utils/clearAllCaches", () => ({
	clearAllCaches: vi.fn(async () => undefined),
}));

import Navbar from "../src/posapp/components/Navbar.vue";

const mountNavbar = () =>
	shallowMount(Navbar, {
		props: {
			posProfile: { name: "Main POS" },
		},
		global: {
			mocks: {
				__: (value: string) => value,
			},
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

describe("Navbar offline sync notifications", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		window.localStorage.clear();
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "cashier@example.com", user_fullname: "Main Cashier" },
			boot: { sysdefaults: { company: "Test Co" }, website_settings: {} },
			call: vi.fn(async () => ({ message: {} })),
		});
	});

	// Real bug: pending-count and synced-count are the two sides of the same
	// sync event (pending drops BECAUSE synced rises) -- both used to fire
	// with no shared key, stacking as two separate sequential toasts for one
	// underlying event. A shared key merges them, matching the same pattern
	// socketStore.ts already uses for its own progress/result toast pairs.
	it("uses a shared key so pending and synced updates merge instead of stacking", async () => {
		const wrapper = mountNavbar();
		await Promise.resolve();
		const vm = wrapper.vm as any;
		const show = vi.spyOn(vm.toastStore, "show");

		// Prime with a baseline of 2 pending invoices.
		vm.handleSyncTotalsNotification(
			{ pending: 2, synced: 0, drafted: 0 },
			{ pending: 2, synced: 0, drafted: 0 },
		);
		show.mockClear();

		// One sync tick: those 2 invoices synced -- pending drops from 2 to
		// 0 AND synced rises from 0 to 2, so both the "pending changed" and
		// "synced increased" branches fire for the same underlying event.
		vm.handleSyncTotalsNotification({ pending: 0, synced: 2, drafted: 0 });

		expect(show).toHaveBeenCalledTimes(2);
		const keys = show.mock.calls.map((call) => call[0].key);
		expect(keys).toEqual(["offline-sync-status", "offline-sync-status"]);

		wrapper.unmount();
	});

	it("still shows a toast for a single drafted-only change with the same shared key", async () => {
		const wrapper = mountNavbar();
		await Promise.resolve();
		const vm = wrapper.vm as any;
		const show = vi.spyOn(vm.toastStore, "show");

		vm.handleSyncTotalsNotification(
			{ pending: 0, synced: 0, drafted: 0 },
			{ pending: 0, synced: 0, drafted: 0 },
		);
		show.mockClear();

		vm.handleSyncTotalsNotification({ pending: 0, synced: 0, drafted: 1 });

		expect(show).toHaveBeenCalledTimes(1);
		expect(show.mock.calls[0][0].key).toBe("offline-sync-status");

		wrapper.unmount();
	});
});
