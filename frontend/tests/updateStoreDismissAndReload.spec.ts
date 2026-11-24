// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const cart = vi.hoisted(() => ({ itemsCount: 0, pendingExchange: null as any }));

vi.mock("../src/posapp/stores/invoiceStore", () => ({
	useInvoiceStore: () => ({
		get itemsCount() {
			return cart.itemsCount;
		},
	}),
}));
vi.mock("../src/posapp/stores/customersStore", () => ({
	useCustomersStore: () => ({
		get pendingExchange() {
			return cart.pendingExchange;
		},
	}),
}));

import { isNewerThanDismissed, useUpdateStore } from "../src/posapp/stores/updateStore";

function showingBuild2000() {
	const store = useUpdateStore();
	store.setCurrentVersion("build-1000", 1000);
	store.setAvailableVersion("build-2000", 2000);
	return store;
}

describe("update popup: Dismiss stays dismissed", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorage.clear();
		sessionStorage.clear();
		cart.itemsCount = 0;
		cart.pendingExchange = null;
	});

	it("keeps the dismissed version hidden when the same version is announced again", () => {
		const store = showingBuild2000();
		expect(store.shouldPrompt).toBe(true);
		store.dismissUpdate();
		expect(store.shouldPrompt).toBe(false);

		store.setAvailableVersion("build-2000", 2000);
		expect(store.shouldPrompt).toBe(false);
		expect(store.dismissedVersion).toBe("build-2000");
		expect(localStorage.getItem("posawesome_update_dismissed")).toBe("build-2000");
	});

	it("keeps it hidden when the version flips to another value and back (old bug)", () => {
		const store = showingBuild2000();
		store.dismissUpdate();

		// commit hash from the update check, same build timestamp
		store.$patch({ availableVersion: "abc123def" });
		expect(store.shouldPrompt).toBe(false);
		store.setAvailableVersion("build-2000", 2000);
		expect(store.shouldPrompt).toBe(false);
		expect(store.dismissedVersion).toBe("build-2000");
		expect(localStorage.getItem("posawesome_update_dismissed")).toBe("build-2000");
	});

	it("keeps it hidden for an older build", () => {
		const store = showingBuild2000();
		store.dismissUpdate();
		store.setAvailableVersion("build-1500", 1500);
		expect(store.shouldPrompt).toBe(false);
	});

	it("shows the popup again for a newer build", () => {
		const store = showingBuild2000();
		store.dismissUpdate();
		store.setAvailableVersion("build-3000", 3000);
		expect(store.shouldPrompt).toBe(true);
	});

	it("keeps the dismissal after a page reload (read back from storage)", () => {
		showingBuild2000().dismissUpdate();

		setActivePinia(createPinia());
		const reloaded = useUpdateStore();
		reloaded.initializeFromStorage();
		reloaded.setCurrentVersion("build-1000", 1000);
		reloaded.setAvailableVersion("build-2000", 2000);
		expect(reloaded.shouldPrompt).toBe(false);
		reloaded.setAvailableVersion("build-3000", 3000);
		expect(reloaded.shouldPrompt).toBe(true);
	});

	it("clears the dismissal once the update is applied", () => {
		const store = showingBuild2000();
		store.dismissUpdate();
		store.markUpdateApplied("build-2000", 2000);
		expect(store.dismissedVersion).toBeNull();
		expect(store.dismissedTimestamp).toBeNull();
		expect(localStorage.getItem("posawesome_update_dismissed")).toBeNull();
		expect(localStorage.getItem("posawesome_update_dismissed_ts")).toBeNull();
	});

	it("compares versions without a build number by value only", () => {
		expect(isNewerThanDismissed("abc", null, "abc", null)).toBe(false);
		expect(isNewerThanDismissed("def", null, "abc", null)).toBe(true);
		expect(isNewerThanDismissed("x", null, null, null)).toBe(true);
		expect(isNewerThanDismissed("1795541734954", null, "1795500000000", null)).toBe(true);
		expect(isNewerThanDismissed("1795400000000", null, "1795500000000", null)).toBe(false);
	});
});

describe("update popup: Reload Now waits for an empty cart", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorage.clear();
		cart.itemsCount = 0;
		cart.pendingExchange = null;
	});

	it("does not reload with items in the cart", () => {
		const store = showingBuild2000();
		const reload = vi.fn();
		store.setReloadAction(reload);
		cart.itemsCount = 2;
		expect(store.saleInProgress).toBe(true);
		store.reloadNow();
		expect(reload).not.toHaveBeenCalled();
		expect(store.reloading).toBe(false);
	});

	it("does not reload while an exchange waits for its sale", () => {
		const store = showingBuild2000();
		const reload = vi.fn();
		store.setReloadAction(reload);
		cart.pendingExchange = { returnName: "RET-1", customer: "C1" };
		store.reloadNow();
		expect(reload).not.toHaveBeenCalled();
	});

	it("reloads when the cart is empty", () => {
		const store = showingBuild2000();
		const reload = vi.fn();
		store.setReloadAction(reload);
		expect(store.saleInProgress).toBe(false);
		store.reloadNow();
		expect(reload).toHaveBeenCalledTimes(1);
		expect(store.reloading).toBe(true);
	});

	it("does not keep release notes from the update check", async () => {
		const store = showingBuild2000();
		(window as any).frappe = {
			call: vi.fn().mockResolvedValue({
				message: {
					build_version: "build-2000",
					commit_hash: "abc",
					commit_message: "secret change",
					release_url: "https://example.invalid/notes",
					remote_ahead: { "develop-swan": "def" },
					remote_sample: { commit_hash: "def", commit_message: "x", commit_date: "d" },
					remote_commits: [{ commit_hash: "def", commit_message: "x" }],
				},
			}),
		};
		await store.checkForUpdates(true);
		expect(store.availableReleaseUrl).toBeNull();
		expect(store.availableMessage).toBeNull();
		expect(store.availableCommits).toEqual([]);
		delete (window as any).frappe;
	});
});
