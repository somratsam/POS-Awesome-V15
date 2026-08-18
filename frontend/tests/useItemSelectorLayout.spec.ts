// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { useItemSelectorLayout } from "../src/posapp/composables/pos/items/useItemSelectorLayout";

const originalInnerWidth = window.innerWidth;

afterEach(() => {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: originalInnerWidth,
	});
});

function setWindowWidth(width: number) {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: width,
	});
}

// A fake bound container element, standing in for the real ref bound to
// ItemsSelectorCards.vue's root -- only clientWidth matters here since
// that's the only property the composable reads off it.
function fakeContainerRef(clientWidth: number) {
	return { $el: { clientWidth } };
}

describe("useItemSelectorLayout: card grid driven by container width, not window width", () => {
	it("picks column count/gap/padding from the measured container, ignoring a much wider window", () => {
		// Regression case for the bug this fixes: a 1366px window with the
		// selector panel occupying only ~4/12 of it (see Pos.vue's lg
		// breakpoint split) leaves a ~455px container -- under
		// getCardColumns' recalibrated 500px single-column cutoff -- even
		// though the window itself is comfortably over the old 1200px
		// "3 columns" cutoff those thresholds used to be tuned against.
		setWindowWidth(1366);
		const layout = useItemSelectorLayout();
		layout.itemsContainerRef.value = fakeContainerRef(455);

		expect(layout.cardColumns.value).toBe(1);
		expect(layout.cardGap.value).toBe(10);
		expect(layout.cardPadding.value).toBe(10);
	});

	it("still shows 3 columns on a large screen once thresholds are recalibrated for container width", () => {
		// A 1920px window (xl tier, 5/12 split) measures a ~800px
		// container. Large screens were never meant to change column
		// count -- only the cramped small-screen case was the target --
		// so the recalibrated thresholds must still land this at 3
		// columns, the same count this resolution showed before any of
		// this fix.
		setWindowWidth(1920);
		const layout = useItemSelectorLayout();
		layout.itemsContainerRef.value = fakeContainerRef(800);

		expect(layout.cardColumns.value).toBe(3);
		expect(layout.cardGap.value).toBe(16);
		expect(layout.cardPadding.value).toBe(16);
	});

	it("still resolves 3 columns when the container itself is wide, regardless of window width", () => {
		setWindowWidth(1366);
		const layout = useItemSelectorLayout();
		layout.itemsContainerRef.value = fakeContainerRef(1400);

		expect(layout.cardColumns.value).toBe(3);
		expect(layout.cardGap.value).toBe(16);
		expect(layout.cardPadding.value).toBe(16);
	});

	it("falls back to an estimate based on window width before the container ref is mounted", () => {
		setWindowWidth(1000);
		const layout = useItemSelectorLayout();
		// itemsContainerRef.value is null until the component mounts and
		// binds it -- cardContainerWidth's own documented fallback (40% of
		// window width) should still drive columns/gap/padding in that
		// window, not a bare 0/undefined.
		expect(layout.itemsContainerRef.value).toBeNull();
		expect(layout.cardColumns.value).toBe(1); // 1000 * 0.4 = 400 <= 500
	});

	it("keeps cardColumnWidth and cardColumns/cardGap/cardPadding reading the same container width", () => {
		setWindowWidth(2560);
		const layout = useItemSelectorLayout();
		layout.itemsContainerRef.value = fakeContainerRef(455);

		// Both cardColumnWidth (already container-aware before this fix)
		// and cardColumns/cardGap/cardPadding (the fix) must now agree on
		// which width they're reasoning about, instead of one seeing a
		// 455px panel and the other seeing a 2560px window.
		expect(layout.cardColumns.value).toBe(1);
		const gapTotal = layout.cardGap.value * (layout.cardColumns.value - 1);
		const paddingTotal = layout.cardPadding.value * 2;
		const expectedWidth = Math.max(
			180,
			Math.floor((455 - gapTotal - paddingTotal) / layout.cardColumns.value),
		);
		expect(layout.cardColumnWidth.value).toBe(expectedWidth);
	});
});
