// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { startItemsSelectorInitialization } from "../src/posapp/composables/pos/items/useItemsSelectorInitialization";

function createArgs(overrides: Record<string, unknown> = {}) {
	const uiPosProfile = ref<any>(null);
	const isInitialized = ref(false);
	const initTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
	const initError = ref<unknown>(null);
	const itemsIntegration = {
		initializeStore: vi.fn(async () => undefined),
	};
	return {
		uiPosProfile,
		selectedCustomer: ref<unknown>(null),
		customerPriceList: ref<unknown>(null),
		selectedCurrency: ref(""),
		selectedExchangeRate: ref(1),
		selectedConversionRate: ref(1),
		isInitialized,
		initTimeout,
		initError,
		itemsIntegration,
		startItemWorker: vi.fn(),
		loadItemSettings: vi.fn(),
		startBackgroundSyncScheduler: vi.fn(),
		timeoutMs: 10000,
		...overrides,
	};
}

describe("startItemsSelectorInitialization", () => {
	it("initializes once a POS profile is present and clears any prior error", async () => {
		const args = createArgs();
		args.uiPosProfile.value = { name: "Main POS", currency: "USD" };

		const handle = startItemsSelectorInitialization(args as any);
		await vi.waitFor(() => expect(args.isInitialized.value).toBe(true));

		expect(args.itemsIntegration.initializeStore).toHaveBeenCalledWith(
			{ name: "Main POS", currency: "USD" },
			null,
			null,
		);
		expect(args.initError.value).toBeNull();
		expect(args.startItemWorker).toHaveBeenCalledTimes(1);
		handle.stop();
	});

	it("records initError on failure but still marks initialized so the watcher can't spin forever", async () => {
		const args = createArgs();
		args.itemsIntegration.initializeStore.mockRejectedValueOnce(
			new Error("boom"),
		);
		args.uiPosProfile.value = { name: "Main POS", currency: "USD" };

		const handle = startItemsSelectorInitialization(args as any);
		await vi.waitFor(() => expect(args.isInitialized.value).toBe(true));

		expect(args.initError.value).toBe("boom");
		handle.stop();
	});

	it("retry() re-runs initialization even though isInitialized is already true after a failure", async () => {
		const args = createArgs();
		args.itemsIntegration.initializeStore.mockRejectedValueOnce(
			new Error("boom"),
		);
		args.uiPosProfile.value = { name: "Main POS", currency: "USD" };

		const handle = startItemsSelectorInitialization(args as any);
		await vi.waitFor(() => expect(args.initError.value).toBe("boom"));
		expect(args.isInitialized.value).toBe(true);

		args.itemsIntegration.initializeStore.mockResolvedValueOnce(undefined);
		await handle.retry();

		expect(args.itemsIntegration.initializeStore).toHaveBeenCalledTimes(2);
		expect(args.initError.value).toBeNull();
		expect(args.isInitialized.value).toBe(true);
		handle.stop();
	});

	it("retry() is a no-op when there is no active POS profile", async () => {
		const args = createArgs();
		const handle = startItemsSelectorInitialization(args as any);

		await handle.retry();

		expect(args.itemsIntegration.initializeStore).not.toHaveBeenCalled();
		handle.stop();
	});
});
