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

// Regression guard for the "close the remaining 1100-1272px gap without
// stacking" follow-up: --cell-padding and --header-font-size were already
// defined per breakpoint tier (.breakpoint-xs through .breakpoint-xl) but
// never actually applied to any td/th rule -- the real padding/font-size
// were hardcoded flat (14-16px / 0.8rem) regardless of width, so the
// breakpoint tiers had no effect. This wires them in, which is also what
// makes it safe to have trimmed the required-column min-widths in
// useItemsTableResponsive.ts (the CSS shrinks first, the column floor
// shrinks to match -- if the CSS wiring were ever reverted on its own,
// the trimmed min-widths would clip content against the old flat padding).
describe("Invoice Items table: cell padding/font-size CSS variables are actually wired in", () => {
	it("td padding and height read --cell-padding/--cell-height in the shared stylesheet", () => {
		// Anchored at the start of a line so this matches only the plain
		// `.posa-cart-table td` rule, not the `--counter-grid`-prefixed
		// variant that also matches `.posa-cart-table td {` as a substring.
		const tdBlock = cssSource.match(/^\.posa-cart-table td \{([\s\S]*?)\}/m);
		expect(tdBlock).not.toBeNull();
		expect(tdBlock![1]).toMatch(/padding:\s*var\(--cell-padding,/);
		expect(tdBlock![1]).toMatch(/height:\s*var\(--cell-height,/);
	});

	it("th font-size reads --header-font-size in the shared stylesheet", () => {
		const thBlock = cssSource.match(/^\.posa-cart-table th \{([\s\S]*?)\}/m);
		expect(thBlock).not.toBeNull();
		expect(thBlock![1]).toMatch(/font-size:\s*var\(--header-font-size,/);
	});

	it("CartItemRow.vue's own scoped td rule matches the same wiring (avoids the cascade-order inconsistency between the two)", () => {
		const tdBlock = cartItemRowSource.match(/\ntd \{([\s\S]*?)\}/);
		expect(tdBlock).not.toBeNull();
		expect(tdBlock![1]).toMatch(/padding:\s*var\(--cell-padding,/);
		expect(tdBlock![1]).toMatch(/height:\s*var\(--cell-height,/);
	});

	it("the per-breakpoint tiers these variables now actually drive are still defined", () => {
		for (const tier of ["xs", "sm", "md", "lg", "xl"]) {
			const tierBlock = cssSource.match(
				new RegExp(
					`\\.posa-responsive-table-container\\.breakpoint-${tier} \\{([\\s\\S]*?)\\}`,
				),
			);
			expect(tierBlock).not.toBeNull();
			expect(tierBlock![1]).toMatch(/--cell-padding:/);
			expect(tierBlock![1]).toMatch(/--header-font-size:/);
			expect(tierBlock![1]).toMatch(/--cell-height:/);
		}
	});
});
