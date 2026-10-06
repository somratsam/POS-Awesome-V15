import { describe, expect, it } from "vitest";

import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";

// ItemsTable.vue is too large/heavily-integrated to mount directly in a unit
// test (same constraint documented for other components tested this way,
// e.g. itemsSelectorContainerRefWiring.spec.ts, itemsSelectorAutoSearchWiring.spec.ts)
// -- so this asserts against the raw .vue source instead.
//
// This guards a real bug: Discount % and Discount Amount are deliberately
// meant to "stay put" on Enter in the standard (non-counter-grid) cart --
// handleGridEditorSubmitted had this carve-out -- but there are TWO
// independent Enter-interception sites in this file (the plain bubble path
// via handleGridEditorSubmitted, and the keyboard-grid capture-phase path in
// handleGridKeydown, which intercepts Enter first whenever gridMode is
// already "cell"). Only the first site had the carve-out; the capture-phase
// site unconditionally advanced to the next column regardless of which
// field was active. Since gridMode latches to "cell" as a side effect of
// the very first Enter-driven edit of any grid field (including the
// "stay put" branch itself), the capture-phase path -- NOT the carve-out --
// is what actually runs on every edit after a session's first one. The fix
// is a single shared isStayPutGridColumnKey() check used by both sites, so
// they can no longer drift apart again.
describe("ItemsTable.vue keeps discount fields from auto-advancing consistently on Enter", () => {
	it("defines a single shared isStayPutGridColumnKey helper for discount_percentage/discount_amount, scoped to non-counter-grid", () => {
		const helperMatch = itemsTableSource.match(
			/const isStayPutGridColumnKey = \([^)]*\) =>[\s\S]*?;\n/,
		);
		expect(helperMatch).not.toBeNull();
		const helper = helperMatch![0];
		expect(helper).toMatch(/!props\.counterGrid/);
		expect(helper).toMatch(/discount_percentage/);
		expect(helper).toMatch(/discount_amount/);
	});

	it("the plain bubble-path (handleGridEditorSubmitted) uses the shared helper", () => {
		const fnMatch = itemsTableSource.match(
			/const handleGridEditorSubmitted = \([\s\S]*?\n};/,
		);
		expect(fnMatch).not.toBeNull();
		expect(fnMatch![0]).toMatch(/isStayPutGridColumnKey\(fromCellKey\)/);
		expect(fnMatch![0]).toMatch(/stayOnGridEntryFromItem\(item, fromCellKey\)/);
	});

	it("the keyboard-grid capture-phase path (handleGridKeydown's Enter branch) also uses the shared helper, not an unconditional advance", () => {
		const fnMatch = itemsTableSource.match(
			/const handleGridKeydown = \([\s\S]*?\n};\n/,
		);
		expect(fnMatch).not.toBeNull();
		const fn = fnMatch![0];

		// The Enter/Space branch inside gridMode === "cell" must check the
		// shared helper before deciding to advance.
		const enterBranch = fn.match(
			/if \(event\.key === "Enter" \|\| event\.key === " "\) \{[\s\S]*?\n\t\t\}\n\t\}\n\};\n/,
		);
		expect(enterBranch).not.toBeNull();
		expect(enterBranch![0]).toMatch(/isStayPutGridColumnKey\(activeCellKey\.value\)/);
		expect(enterBranch![0]).toMatch(/commitActiveGridEditorAndStay\((event)?\)/);
	});

	it("commitActiveGridEditorAndStay commits without moving to another cell", () => {
		const fnMatch = itemsTableSource.match(
			/const commitActiveGridEditorAndStay = async \([^)]*\) => \{[\s\S]*?\n\};/,
		);
		expect(fnMatch).not.toBeNull();
		const fn = fnMatch![0];
		expect(fn).toMatch(/commitActiveGridEditor\(\)/);
		expect(fn).not.toMatch(/moveGridEntry/);
		// Re-focuses the same cell in display (non-edit) mode, matching
		// stayOnGridEntryFromItem's own behavior.
		expect(fn).toMatch(/focusActiveGridTarget\(\{ activateDirectEdit: false \}\)/);
	});
});
