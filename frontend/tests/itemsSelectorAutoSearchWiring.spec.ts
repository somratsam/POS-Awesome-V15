import { describe, expect, it } from "vitest";

import itemsSelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

// ItemsSelector.vue is too large/heavily-integrated to mount directly in a
// unit test (same constraint documented for other components tested this
// way, e.g. customerDropdownXss.spec.ts and itemsSelectorContainerRefWiring.spec.ts)
// -- so this asserts against the raw .vue source instead.
//
// This guards a real wiring bug: useItemsSelectorSearch()'s debounced
// search_onchange (a correctly-implemented ~300ms debounce around
// _performSearch()) was never actually called by anything except onEnter --
// so in Limit Search mode (server-side search, no local catalog to filter
// reactively) typing did nothing at all until the user pressed Enter.
// Non-Limit-Search mode wasn't affected because its displayedItems computed
// filters the already-loaded local catalog live on every keystroke, with no
// trigger needed. The fix wires search_onchange into onSearchInputChanged,
// a callback useItemsSelectorSearchInput() invokes on every keystroke
// (handleSearchInput/appendSearchCharacter), gated to Limit Search mode only
// so non-Limit-Search mode's already-working behavior is untouched.
describe("ItemsSelector.vue wires debounced auto-search into every keystroke", () => {
	it("passes an onSearchInputChanged callback into useItemsSelectorSearchInput()", () => {
		const useCall = itemsSelectorSource.match(
			/useItemsSelectorSearchInput\(\{[\s\S]*?\n\}\);/,
		);
		expect(useCall).not.toBeNull();
		expect(useCall![0]).toMatch(/\bonSearchInputChanged\s*:/);
	});

	it("that callback invokes itemsSelectorSearch.search_onchange()", () => {
		const callbackMatch = itemsSelectorSource.match(
			/onSearchInputChanged:\s*\(\)\s*=>\s*\{[\s\S]*?\n\t\},/,
		);
		expect(callbackMatch).not.toBeNull();
		expect(callbackMatch![0]).toMatch(
			/itemsSelectorSearch\.search_onchange\(\)/,
		);
	});

	it("gates the auto-search trigger to Limit Search mode", () => {
		const callbackMatch = itemsSelectorSource.match(
			/onSearchInputChanged:\s*\(\)\s*=>\s*\{[\s\S]*?\n\t\},/,
		);
		expect(callbackMatch).not.toBeNull();
		expect(callbackMatch![0]).toMatch(/usesLimitSearch\.value/);
	});
});
