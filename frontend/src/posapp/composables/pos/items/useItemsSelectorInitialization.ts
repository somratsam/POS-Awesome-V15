import { watch, type Ref, type WatchStopHandle } from "vue";

import {
	finishStartupPhase,
	startStartupPhase,
} from "../../../../utils/startupTrace";

type PosProfileLike = {
	name?: string | null;
	currency?: string | null;
};

type ItemsIntegrationLike = {
	initializeStore: (
		_profile: PosProfileLike,
		_customer: unknown,
		_priceList: unknown,
	) => Promise<void>;
};

type UseItemsSelectorInitializationArgs = {
	uiPosProfile: Ref<PosProfileLike | null | undefined>;
	selectedCustomer: Ref<unknown>;
	customerPriceList: Ref<unknown>;
	selectedCurrency: Ref<string>;
	selectedExchangeRate: Ref<number>;
	selectedConversionRate: Ref<number>;
	isInitialized: Ref<boolean>;
	initTimeout: Ref<ReturnType<typeof setTimeout> | null>;
	initError: Ref<unknown>;
	itemsIntegration: ItemsIntegrationLike;
	startItemWorker: () => void;
	loadItemSettings: () => void;
	startBackgroundSyncScheduler: () => void;
	timeoutMs?: number;
};

function resolveErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message || error;
	}
	return error;
}

async function runInitializationAttempt(
	newProfile: PosProfileLike,
	{
		selectedCustomer,
		customerPriceList,
		selectedCurrency,
		selectedExchangeRate,
		selectedConversionRate,
		isInitialized,
		initTimeout,
		initError,
		itemsIntegration,
		startItemWorker,
		loadItemSettings,
		startBackgroundSyncScheduler,
		timeoutMs = 10000,
	}: UseItemsSelectorInitializationArgs,
) {
	if (initTimeout.value) clearTimeout(initTimeout.value);
	initTimeout.value = setTimeout(() => {
		if (!isInitialized.value) {
			console.warn(
				"ItemsSelector: Initialization taking too long, forcing isInitialized to true.",
			);
			isInitialized.value = true;
		}
	}, timeoutMs);

	initError.value = null;
	const phase = startStartupPhase("items.selector_initialization", {
		profile: newProfile.name,
	});
	try {
		// Storage hydration is not a prerequisite for the online catalog call.
		// Keep it running so offline queues and caches become ready independently.
		selectedCurrency.value = newProfile.currency || "";
		selectedExchangeRate.value = 1;
		selectedConversionRate.value = 1;

		await itemsIntegration.initializeStore(
			newProfile,
			selectedCustomer.value,
			customerPriceList.value,
		);

		isInitialized.value = true;
		startItemWorker();
		loadItemSettings();
		startBackgroundSyncScheduler();
		finishStartupPhase(phase, "ok");
	} catch (err: unknown) {
		console.error("ItemsSelector: Initialization failed", err);
		initError.value = resolveErrorMessage(err);
		isInitialized.value = true;
		finishStartupPhase(phase, "error", { error: err });
	} finally {
		if (initTimeout.value) {
			clearTimeout(initTimeout.value);
			initTimeout.value = null;
		}
	}
}

export type ItemsSelectorInitializationHandle = {
	stop: WatchStopHandle;
	/**
	 * Re-runs the same initialization attempt as the reactive watcher, for a
	 * manual "Retry" action. The watcher itself only fires on a genuine
	 * `uiPosProfile` change and skips entirely once `isInitialized` is true
	 * (which a failed attempt also sets), so it can never re-trigger on its
	 * own after a failure.
	 */
	retry: () => Promise<void>;
};

export function startItemsSelectorInitialization(
	args: UseItemsSelectorInitializationArgs,
): ItemsSelectorInitializationHandle {
	const { uiPosProfile, isInitialized } = args;
	const stop = watch(
		uiPosProfile,
		async (newProfile) => {
			if (!newProfile?.name || isInitialized.value) {
				return;
			}
			await runInitializationAttempt(newProfile, args);
		},
		{ immediate: true },
	);

	const retry = async () => {
		const profile = uiPosProfile.value;
		if (!profile?.name) {
			return;
		}
		await runInitializationAttempt(profile, args);
	};

	return { stop, retry };
}
