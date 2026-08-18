import { describe, expect, it } from "vitest";

import itemsSelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

// ItemsSelector.vue is too large/heavily-integrated to mount directly in a
// unit test (same constraint documented for other components tested this
// way, e.g. customerDropdownXss.spec.ts and posLayoutSplitRatio.spec.ts) --
// so this asserts against the raw .vue source instead.
//
// This guards a real wiring bug found while implementing the item-card grid
// container-width fix: useItemSelectorLayout()'s itemsContainerRef is only
// useful if some component actually binds a real DOM/component instance to
// it. ItemsSelector.vue used to declare `ref="itemsContainer"` on
// <ItemsSelectorCards> -- a name that matched no script-level binding at
// all (not the destructured composable value, not any local ref) -- so the
// composable's itemsContainerRef stayed null forever in production, and
// every computed that depends on cardContainerWidth (cardColumnWidth
// already, and now cardColumns/cardGap/cardPadding) silently fell back to
// its windowWidth * 0.4 estimate instead of ever reading a real measured
// panel width.
describe("ItemsSelector.vue wires the real container ref into useItemSelectorLayout", () => {
	it("destructures itemsContainerRef from useItemSelectorLayout()", () => {
		const useCall = itemsSelectorSource.match(
			/const \{[\s\S]*?\} = useItemSelectorLayout\(/,
		);
		expect(useCall).not.toBeNull();
		expect(useCall![0]).toMatch(/\bitemsContainerRef\b/);
	});

	it("binds ItemsSelectorCards' template ref to that exact destructured name", () => {
		expect(itemsSelectorSource).toMatch(
			/<ItemsSelectorCards[\s\S]*?ref="itemsContainerRef"/,
		);
	});

	it("does not leave a stale, unbound 'itemsContainer' ref name anywhere", () => {
		const staleRefMatches = itemsSelectorSource.match(/ref="itemsContainer"/g);
		expect(staleRefMatches).toBeNull();
	});
});
