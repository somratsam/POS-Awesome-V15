import { describe, expect, it } from "vitest";

import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";

// ItemsTable.vue is too large to mount here (see itemsTableDiscountStayPut.spec.ts),
// so this asserts against the raw source. It guards the same two-site trap as
// that spec: a discount confirmed with Enter reaches the cart through EITHER
// the row's own *-edit-submitted event OR the keyboard grid's capture-phase
// Enter (commitActiveGridEditorAndStay, which commits by blur so the row's
// submitted event never fires). Found live on staging: with the prompt wired
// to the first site only, every discount after a session's first one -- once
// gridMode had latched to "cell" -- got no reason prompt at all.
const fn = (pattern: RegExp) => {
	const match = itemsTableSource.match(pattern);
	expect(match).not.toBeNull();
	return match![0];
};

describe("ItemsTable.vue asks for a discount reason on every Enter path", () => {
	it("the row's Disc % and Disc Amt submitted events both prompt", () => {
		expect(itemsTableSource).toMatch(
			/handleGridEditorSubmitted\(submittedItem, 'discount_percentage'\);\s*promptDiscountReason\(submittedItem, \{ returnToCell: 'discount_percentage' \}\);/,
		);
		expect(itemsTableSource).toMatch(
			/handleGridEditorSubmitted\(submittedItem, 'discount_amount'\);\s*promptDiscountReason\(submittedItem, \{ returnToCell: 'discount_amount' \}\);/,
		);
	});

	it("the keyboard-grid Enter path prompts for the row being edited, taken from the event", () => {
		const stay = fn(/const commitActiveGridEditorAndStay = async \([^)]*\) => \{[\s\S]*?\n\};/);
		expect(stay).toMatch(/getRowIndexFromEvent\(event\)/);
		expect(stay).toMatch(/closest\?\.\("\[data-column-key\]"\)/);
		expect(stay).toMatch(/cellKey === "discount_percentage" \|\| cellKey === "discount_amount"/);
		expect(stay).toMatch(/promptDiscountReason\(rowItem, \{ returnToCell: cellKey \}\)/);

		const keydown = fn(/const handleGridKeydown = \([\s\S]*?\n};\n/);
		expect(keydown).toMatch(/commitActiveGridEditorAndStay\(event\)/);
	});

	it("a plain value update (blur) never prompts, but clears a stale reason", () => {
		const percent = fn(/const handleDiscountPercentUpdate = \([\s\S]*?\n};/);
		const amount = fn(/const handleDiscountAmountUpdate = \([\s\S]*?\n};/);
		for (const body of [percent, amount]) {
			expect(body).not.toMatch(/promptDiscountReason/);
			expect(body).toMatch(/clearDiscountReasonIfUndiscounted\(invoiceStore, item\)/);
		}
	});

	it("the prompt skips returns and profiles that don't ask, asks once, and returns to the cell", () => {
		const prompt = fn(/const promptDiscountReason = async \([\s\S]*?\n};/);
		expect(prompt).toMatch(/props\.isReturnInvoice \|\| !isDiscountReasonRequired\(props\.pos_profile\)/);
		expect(prompt).toMatch(/pending\?\.mode === "line" && pending\.lines\?\.\[0\]\?\.posa_row_id === line\.posa_row_id/);
		expect(prompt).toMatch(/stayOnGridEntryFromItem\(line, options\.returnToCell\)/);
	});

	it("the chip's edit event re-opens the prompt even when a reason is already set", () => {
		expect(itemsTableSource).toMatch(
			/@edit-discount-reason="\(reasonItem\) => promptDiscountReason\(reasonItem, \{ force: true \}\)"/,
		);
	});
});
