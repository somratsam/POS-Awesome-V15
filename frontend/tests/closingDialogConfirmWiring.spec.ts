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
		const tag = source.slice(source.indexOf("<CloseShiftConfirmDialog"), source.indexOf("/>", source.indexOf("<CloseShiftConfirmDialog")));
		expect(tag).toContain(':model-value="confirmCloseDialog"');
		expect(tag).toContain('@go-back="cancelConfirm"');
		expect(tag).toContain('@confirm="confirmClose"');
	});

	it("passes the closing variance figures and the reason to the confirmation", () => {
		const tag = source.slice(source.indexOf("<CloseShiftConfirmDialog"), source.indexOf("/>", source.indexOf("<CloseShiftConfirmDialog")));
		for (const binding of [
			':variances="closingVariances"',
			':tolerance="closingVarianceTolerance"',
			':hide-amounts="Boolean(pos_profile && pos_profile.hide_expected_amount)"',
			':needs-supervisor="closingVarianceNeedsSupervisor"',
			':can-approve="canApproveClosingVariance"',
			':reason="varianceReason"',
			'@update:reason="(value) => (varianceReason = value)"',
		]) {
			expect(tag).toContain(binding);
		}
		expect(source).toContain("getClosingVariances(\n\t\t\t\tdialog_data.value?.payment_reconciliation,");
		expect(source).toContain("resolveClosingVarianceTolerance(pos_profile.value)");
		expect(source).toMatch(/employeeStore\.currentCashier\?\.is_supervisor/);
	});

	it("sends the reason with the close, and starts each closing with an empty reason", () => {
		const body = source.slice(source.indexOf("const confirmClose = () => {"), source.indexOf("};", source.indexOf("const confirmClose = () => {")));
		expect(body).toContain("dialog_data.value.posa_variance_reason = closingVariances.value.length");
		expect(body).toContain("confirmSubmit();");
		expect(source).toMatch(/eventBus\.on\("open_ClosingDialog", \(data\) => \{\s*closingDialog\.value = true;\s*varianceReason\.value = "";/);
		for (const name of ["varianceReason,", "closingVariances,", "confirmClose,", "canApproveClosingVariance,"]) {
			expect(source).toContain(`\t\t\t${name}`);
		}
	});

	it("Esc with the confirmation open only goes back, keeping the closing dialog", () => {
		expect(source).toMatch(
			/if \(confirmCloseDialog\.value\) \{\s*cancelConfirm\(\);\s*return;\s*\}\s*closeDialog\(\);/,
		);
	});

	it("passes the currency precision to the closing amounts table (3 decimals for OMR)", () => {
		const tag = source.slice(source.indexOf("<PaymentReconciliation"), source.indexOf("/>", source.indexOf("<PaymentReconciliation")));
		expect(tag).toContain(':currency-precision="currency_precision"');
		expect(source).toMatch(/const \{[^}]*\bcurrency_precision\b[^}]*\} = useFormat\(\);/);
		expect(source).toMatch(/return \{[\s\S]*\n\t\t\tcurrency_precision,\n/);
	});
});
