import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useItemsSelectorSearchInput } from "../src/posapp/composables/pos/items/useItemsSelectorSearchInput";

const makeDeps = (overrides: Record<string, any> = {}) => {
	const searchInput = ref("PA4 79S");
	const firstSearch = ref("PA4 79S");
	const clearingSearch = ref(false);
	const activeView = ref("items");
	const clearHighlightedItem = vi.fn();
	const focusItemSearch = vi.fn();
	const setActiveView = vi.fn();
	const triggerItemSearchFocus = vi.fn();
	const searchFocusGuard = {
		armPreserveNextFocusClear: vi.fn(),
		shouldClearSearchOnFocus: vi.fn(() => false),
	};
	const scannerInput = {
		handleSearchInput: vi.fn(),
		setInputHandlers: vi.fn(),
	};

	const api = useItemsSelectorSearchInput({
		searchInput,
		firstSearch,
		clearingSearch,
		activeView,
		eventBus: { emit: vi.fn() },
		scannerInput,
		searchFocusGuard,
		clearHighlightedItem,
		focusItemSearch,
		setActiveView,
		triggerItemSearchFocus,
		...overrides,
	});

	return {
		api,
		searchInput,
		firstSearch,
		clearingSearch,
		searchFocusGuard,
		scannerInput,
	};
};

describe("useItemsSelectorSearchInput clearSearch", () => {
	it("always resets the text refs", () => {
		const { api, searchInput, firstSearch } = makeDeps();

		api.clearSearch();

		expect(searchInput.value).toBe("");
		expect(firstSearch.value).toBe("");
	});

	// The actual bug: in Limit Search mode, filteredItems/items hold
	// whatever a prior server search returned. Clearing only the text left
	// those stale results showing (displayedItems computed re-filters an
	// empty term against a non-empty stale list unfiltered, not empty), so
	// the empty-browse-prompt state never activated. See
	// PROGRESS_NOTES.md section 34/35.
	it("resets limit search results when limit search is enabled", () => {
		const resetLimitSearchResults = vi.fn();
		const { api } = makeDeps({
			isLimitSearchEnabled: () => true,
			resetLimitSearchResults,
		});

		api.clearSearch();

		expect(resetLimitSearchResults).toHaveBeenCalledTimes(1);
	});

	it("does not reset limit search results when limit search is disabled", () => {
		const resetLimitSearchResults = vi.fn();
		const { api } = makeDeps({
			isLimitSearchEnabled: () => false,
			resetLimitSearchResults,
		});

		api.clearSearch();

		expect(resetLimitSearchResults).not.toHaveBeenCalled();
	});

	it("works without isLimitSearchEnabled/resetLimitSearchResults (both optional)", () => {
		const { api, searchInput } = makeDeps();

		expect(() => api.clearSearch()).not.toThrow();
		expect(searchInput.value).toBe("");
	});

	it("also resets limit search results via prepareSearchInjection (scan-triggered value injection)", () => {
		const resetLimitSearchResults = vi.fn();
		const { api } = makeDeps({
			isLimitSearchEnabled: () => true,
			resetLimitSearchResults,
		});

		api.prepareSearchInjection();

		expect(resetLimitSearchResults).toHaveBeenCalledTimes(1);
	});

	it("also resets limit search results via handleItemSearchFocus when the focus guard requires a clear", () => {
		const resetLimitSearchResults = vi.fn();
		const { api, searchFocusGuard } = makeDeps({
			isLimitSearchEnabled: () => true,
			resetLimitSearchResults,
		});
		searchFocusGuard.shouldClearSearchOnFocus.mockReturnValue(true);

		api.handleItemSearchFocus();

		expect(resetLimitSearchResults).toHaveBeenCalledTimes(1);
	});

	it("does not reset limit search results via handleItemSearchFocus when the focus guard does not require a clear", () => {
		const resetLimitSearchResults = vi.fn();
		const { api, searchFocusGuard, searchInput } = makeDeps({
			isLimitSearchEnabled: () => true,
			resetLimitSearchResults,
		});
		searchFocusGuard.shouldClearSearchOnFocus.mockReturnValue(false);

		api.handleItemSearchFocus();

		expect(resetLimitSearchResults).not.toHaveBeenCalled();
		// Confirms this path did not go through clearSearch at all.
		expect(searchInput.value).toBe("PA4 79S");
	});
});
