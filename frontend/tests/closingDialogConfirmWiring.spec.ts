import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ClosingDialog.vue can't be mounted here (its ".js"-suffixed store import
// doesn't resolve under Vitest's bundled Vite), so check its wiring in the
// source.
describe("ClosingDialog wiring for the Close Shift confirmation", () => {
	const source = readFileSync(resolve("src/posapp/components/pos/shell/ClosingDialog.vue"), "utf8");

	it("Submit asks first instead of closing the shift", () => {
		expect(source).toMatch(/@click="requestSubmit"\s+class="pos-action-btn submit-action-btn"/);
		expect(source).not.toContain("submitDialog");
	});

	it("renders the confirmation with Go Back and Close Shift wired", () => {
		expect(source).toMatch(
			/<CloseShiftConfirmDialog\s+:model-value="confirmCloseDialog"\s+@go-back="cancelConfirm"\s+@confirm="confirmSubmit"/,
		);
	});

	it("Esc with the confirmation open only goes back, keeping the closing dialog", () => {
		expect(source).toMatch(
			/if \(confirmCloseDialog\.value\) \{\s*cancelConfirm\(\);\s*return;\s*\}\s*closeDialog\(\);/,
		);
	});
});
