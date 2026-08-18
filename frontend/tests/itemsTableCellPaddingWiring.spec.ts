import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const cssSource = readFileSync(
	resolve(
		__dirname,
		"../src/posapp/components/pos/invoice/items-table-styles.css",
	),
	"utf-8",
);
const cartItemRowSource = readFileSync(
	resolve(__dirname, "../src/posapp/components/pos/invoice/CartItemRow.vue"),
	"utf-8",
);

// Regression guard for two real, browser-verified bugs found while trying to
// close the 1100-1272px (later found to extend to ~1360px) layout gap:
//
// 1. --cell-padding/--header-font-size were defined per breakpoint tier
//    (.breakpoint-xs through .breakpoint-xl) but never actually applied
//    with enough specificity to win: Vuetify ships its own
//    `.v-table > .v-table__wrapper > table > tbody > tr > td { padding: 0
//    16px; }`, which beat the plain `.posa-cart-table td`/scoped
//    `td[data-v-*]` rules here every time (confirmed via Chrome's own
//    "matched CSS rules" inspection, not guessed) -- real padding stayed
//    flat at 16px/16px regardless of viewport the whole time these
//    variables looked wired up. `!important` is what actually wins here;
//    without it this whole fix silently does nothing again.
// 2. The table used `table-layout: auto`, so a column's real width
//    followed whichever was wider -- the header LABEL text or the cell
//    content -- not calculateMinColumnWidth's config at all. A long label
//    like "Discount Amount" alone forced its column wide no matter what
//    was configured. table-layout: fixed makes the column-width map in
//    useItemsTableResponsive.ts actually authoritative.
describe("Invoice Items table: cell padding/font-size CSS actually wins the cascade", () => {
	it("td padding/height and th font-size are !important in the shared stylesheet", () => {
		const tdBlock = cssSource.match(/^\.posa-cart-table td \{([\s\S]*?)\}/m);
		expect(tdBlock).not.toBeNull();
		expect(tdBlock![1]).toMatch(/padding:\s*var\(--cell-padding,[^)]*\)\s*!important/);
		expect(tdBlock![1]).toMatch(/height:\s*var\(--cell-height,[^)]*\)\s*!important/);

		const thBlock = cssSource.match(/^\.posa-cart-table th \{([\s\S]*?)\}/m);
		expect(thBlock).not.toBeNull();
		expect(thBlock![1]).toMatch(
			/font-size:\s*var\(--header-font-size,[^)]*\)\s*!important/,
		);
	});

	it("CartItemRow.vue's own scoped td rule is also !important (avoids the cascade-order inconsistency between the two)", () => {
		const tdBlock = cartItemRowSource.match(/\ntd \{([\s\S]*?)\}/);
		expect(tdBlock).not.toBeNull();
		expect(tdBlock![1]).toMatch(/padding:\s*var\(--cell-padding,[^)]*\)\s*!important/);
		expect(tdBlock![1]).toMatch(/height:\s*var\(--cell-height,[^)]*\)\s*!important/);
	});

	it("the cart table uses table-layout: fixed, not auto", () => {
		const tableBlock = cssSource.match(/^\.posa-cart-table table \{([\s\S]*?)\}/m);
		expect(tableBlock).not.toBeNull();
		expect(tableBlock![1]).toMatch(/table-layout:\s*fixed\s*!important/);
		expect(tableBlock![1]).not.toMatch(/table-layout:\s*auto/);
	});

	it("--body-font-size is wired into the editor-display and input font-size rules", () => {
		expect(cssSource).toMatch(
			/\.posa-cart-table__editor-display \{[\s\S]*?font-size:\s*var\(--body-font-size,/,
		);
		expect(cssSource).toMatch(
			/\.posa-cart-table__editor-input \.v-field__input,\s*\n\s*\.posa-cart-table__qty-input \.v-field__input \{[\s\S]*?font-size:\s*var\(--body-font-size,/,
		);
	});

	it("the per-breakpoint tiers these variables actually drive are still defined, including --body-font-size", () => {
		for (const tier of ["xs", "sm", "md", "lg", "xl"]) {
			const tierBlock = cssSource.match(
				new RegExp(
					`\\.posa-responsive-table-container\\.breakpoint-${tier} \\{([\\s\\S]*?)\\}`,
				),
			);
			expect(tierBlock).not.toBeNull();
			expect(tierBlock![1]).toMatch(/--cell-padding:/);
			expect(tierBlock![1]).toMatch(/--header-font-size:/);
			expect(tierBlock![1]).toMatch(/--body-font-size:/);
			expect(tierBlock![1]).toMatch(/--cell-height:/);
		}
	});
});
