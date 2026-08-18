import { describe, expect, it } from "vitest";

import {
	getResponsiveVisibleHeaders,
	type TableHeader,
} from "../src/posapp/composables/pos/items/useItemsTableResponsive";
import useItemsTableResponsiveSource from "../src/posapp/composables/pos/items/useItemsTableResponsive.ts?raw";

// Mirrors useInvoiceItems.ts's actual available_columns (post fix: Discount
// %/Amount are required, matching what staff asked for). Required column
// min-widths (item_name 175, qty 116, discount_percentage 80,
// discount_amount 84, rate 90, amount 84, actions 66 -- tuned as part of the
// "real-browser-verified" follow-up that replaced the earlier
// arithmetic-only pass, which turned out to have never actually taken
// effect: table-layout was still auto and a higher-specificity Vuetify
// default was silently winning over --cell-padding) sum to 695px + the
// table's own 48px expand column = 743px floor; price_list_rate (120)
// takes it to 863, uom (80, no entry in useItemsTableResponsive's own
// width map so it falls to that function's 80px default) to 943,
// posa_is_offer (70) to 1013.
const ALL_HEADERS: TableHeader[] = [
	{ title: "Name", key: "item_name", required: true },
	{ title: "QTY", key: "qty", required: true },
	{ title: "UOM", key: "uom", required: false },
	{ title: "Price List Rate", key: "price_list_rate", required: false },
	{ title: "Disc %", key: "discount_percentage", required: true },
	{ title: "Disc Amt", key: "discount_amount", required: true },
	{ title: "Rate", key: "rate", required: true },
	{ title: "Amount", key: "amount", required: true },
	{ title: "Offer?", key: "posa_is_offer", required: false },
	{ title: "", key: "actions", required: true },
];

const REQUIRED_FLOOR = 743;
const PLUS_PRICE_LIST_RATE = 863;
const PLUS_UOM = 943;
const PLUS_POSA_IS_OFFER = 1013;

function visibleKeys(width: number) {
	return getResponsiveVisibleHeaders(ALL_HEADERS, width).map((h) => h.key);
}

describe("useItemsTableResponsive: graduated column hiding", () => {
	it("shows only required columns below the required-only floor", () => {
		const keys = visibleKeys(REQUIRED_FLOOR - 1);
		expect(keys).toEqual(
			expect.arrayContaining([
				"item_name",
				"qty",
				"discount_percentage",
				"discount_amount",
				"rate",
				"amount",
				"actions",
			]),
		);
		expect(keys).not.toContain("price_list_rate");
		expect(keys).not.toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds price_list_rate first once there's room for it", () => {
		const keys = visibleKeys(PLUS_PRICE_LIST_RATE);
		expect(keys).toContain("price_list_rate");
		expect(keys).not.toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds uom next, after price_list_rate", () => {
		const keys = visibleKeys(PLUS_UOM);
		expect(keys).toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).not.toContain("posa_is_offer");
	});

	it("adds posa_is_offer last, once everything fits", () => {
		const keys = visibleKeys(PLUS_POSA_IS_OFFER);
		expect(keys).toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).toContain("posa_is_offer");
	});

	it("never hides Discount % or Discount Amount, at any width including the narrowest realistic one", () => {
		// The narrowest width this table will ever actually render at in
		// practice: useCompactPosSwitcher fully stacks the layout below
		// 1100px, so this is a synthetic worst case below even that --
		// discount columns still must never disappear.
		for (const width of [0, 1, 200, 449, 450, 700, REQUIRED_FLOOR - 1]) {
			const keys = visibleKeys(width);
			expect(keys).toContain("discount_percentage");
			expect(keys).toContain("discount_amount");
		}
	});

	it("shows everything when width is not yet measured (0), matching the pre-layout fallback", () => {
		const keys = visibleKeys(0);
		expect(keys).toEqual(
			expect.arrayContaining([
				"item_name",
				"qty",
				"uom",
				"price_list_rate",
				"discount_percentage",
				"discount_amount",
				"rate",
				"amount",
				"posa_is_offer",
				"actions",
			]),
		);
	});

	it("only offers optional columns that were actually passed in (respects prior user/profile selection)", () => {
		// If price_list_rate was already deselected by the caller (not in
		// the headers array at all), the graduated logic must not invent
		// it back just because there's room -- it only ever adds back
		// columns that were candidates in the first place.
		const withoutPriceListRate = ALL_HEADERS.filter(
			(h) => h.key !== "price_list_rate",
		);
		const keys = getResponsiveVisibleHeaders(
			withoutPriceListRate,
			PLUS_POSA_IS_OFFER,
		).map((h) => h.key);
		expect(keys).not.toContain("price_list_rate");
		expect(keys).toContain("uom");
		expect(keys).toContain("posa_is_offer");
	});
});

describe("useItemsTableResponsive: item_name's rendered width ratio", () => {
	// calculateColumnWidth itself isn't exported, but getResponsiveVisibleHeaders
	// returns each header's computed .width, so its behavior is observable
	// through there. Regression guard for the real-browser-verified finding
	// that item_name's old 0.3 ratio ate most of any extra room a wider
	// split ratio provided (measured directly: bumping the narrow-band
	// split from 75% to 76/77/78% only closed 2-3px of a 35px gap each
	// time, because item_name kept absorbing most of the gain) -- 0.14
	// keeps it near its floor through the cramped range and lets the
	// other, already-floor-bound columns actually benefit from extra width.
	function itemNameWidth(width: number) {
		const headers = [{ key: "item_name", title: "Name", required: true }];
		const [header] = getResponsiveVisibleHeaders(headers, width);
		return header.width;
	}

	it("stays at its 175px floor at a container width where the old 0.3 ratio would have exceeded it", () => {
		// 800 * 0.3 = 240 (what the old ratio would have produced, well
		// above its old 200px floor) vs 800 * 0.14 = 112, clamped up to the
		// 175px floor.
		expect(itemNameWidth(800)).toBe(175);
	});

	it("grows past the floor only once the container is wide enough for 0.14x of it to clear 175px", () => {
		// 175 / 0.14 = 1250 -- just under that, still floored.
		expect(itemNameWidth(1249)).toBe(175);
		// At 1500, 1500 * 0.14 = 210, genuinely above the floor.
		expect(itemNameWidth(1500)).toBeCloseTo(210);
	});

	it("still caps at its 250px max on very wide containers", () => {
		// 2000 * 0.14 = 280, clamped down to the 250px max.
		expect(itemNameWidth(2000)).toBe(250);
	});
});

describe("useItemsTableResponsive: compact-density threshold raised to 1000px", () => {
	// useItemsTableResponsive() itself (the composable, as opposed to the
	// pure helper functions above) has no unit test in this suite --
	// ResizeObserver isn't available in jsdom without a mock this repo
	// doesn't have yet, so this is a source-string guard (same pattern as
	// posLayoutSplitRatio.spec.ts/posNarrowSplitBand.spec.ts for the same
	// reason). Regression guard for the real-browser-verified finding that
	// the narrow-band split ratio (Pos.vue) can push this container to
	// ~920-960px -- md's tighter --cell-padding/--header-font-size/
	// --body-font-size need to stay active through that range, not flip
	// back to lg's looser values right when the ratio bump is trying to
	// buy back space. Raised from the original 900px alongside this same
	// follow-up.
	it("updateBreakpoint's md/lg cutoff is 1000, not 900", () => {
		const fn = useItemsTableResponsiveSource.match(
			/const updateBreakpoint = \(width: number\) => \{([\s\S]*?)\};/,
		);
		expect(fn).not.toBeNull();
		expect(fn![1]).toMatch(/if \(width < 1000\) return "md";/);
		expect(fn![1]).not.toMatch(/width < 900/);
	});

	it("compact-view/medium-view/large-view classes use the 1000px cutoff", () => {
		const block = useItemsTableResponsiveSource.match(
			/const containerClasses = computed\(\(\) => \(\{([\s\S]*?)\}\)\);/,
		);
		expect(block).not.toBeNull();
		expect(block![1]).toMatch(/"compact-view": containerWidth\.value < 1000,/);
		expect(block![1]).toMatch(/containerWidth\.value >= 600 && containerWidth\.value < 1000,/);
		expect(block![1]).toMatch(/"large-view": containerWidth\.value >= 1000,/);
	});

	it("tableDensity's compact cutoff is 1000px", () => {
		const block = useItemsTableResponsiveSource.match(
			/const tableDensity = computed\(\(\) => \{([\s\S]*?)\}\);/,
		);
		expect(block).not.toBeNull();
		expect(block![1]).toMatch(/if \(containerWidth\.value < 1000\) return "compact";/);
	});
});
