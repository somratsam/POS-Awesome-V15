import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pos.vue can't be mounted here (its ".js"-suffixed store imports don't
// resolve under Vitest's bundled Vite), so check its wiring in the source.
describe("Pos.vue wiring for the Shift Closed screen", () => {
	const source = readFileSync(
		resolve("src/posapp/components/pos/shell/Pos.vue"),
		"utf8",
	);

	it("passes a Shift Closed callback that records the shift and tracks its print", () => {
		expect(source).toMatch(
			/usePosShift\(\s*\(\) => \{\s*dialog\.value = true;\s*\},\s*\(closed\) => \{\s*shiftClosed\.value = true;\s*trackClosedShiftPrint\(closed\.closingShift, closed\.zReportPrint\);\s*\},?\s*\)/,
		);
		expect(source).toMatch(/shiftClosed: trackClosedShiftPrint,\s*reprint: reprintZReport,\s*\} = useShiftClosedPrint\(\);/);
	});

	it("passes the print state to the panel and handles Reprint", () => {
		expect(source).toContain(':print-state="zReportPrintState"');
		expect(source).toContain(':print-error="zReportPrintError"');
		expect(source).toContain('@reprint="reprintZReport"');
	});

	it("renders the panel and hides the POS while a shift is closed", () => {
		expect(source).toMatch(/<ShiftClosedPanel\s+v-if="shiftClosed && !dialog"/);
		expect(source).toContain('@close="goToDeskAfterClose"');
		expect(source).toContain('@open-new-shift="openNewShiftAfterClose"');
		expect(source).toContain('@logout="logoutAfterClose"');
		expect(source.match(/v-show="!dialog && !shiftClosed"/g)?.length).toBe(2);
	});

	it("Open New Shift opens the dialog, and registering a shift clears the flag", () => {
		expect(source).toMatch(/openNewShiftAfterClose\(\) \{\s*this\.shiftClosed = false;\s*this\.dialog = true;/);
		expect(source).toMatch(/handleRegisterPosData\(data\) \{\s*this\.shiftClosed = false;/);
	});
});

describe("Close goes to Desk the same way from both places", () => {
	const read = (path: string) => readFileSync(resolve(path), "utf8");

	it("the Shift Closed screen's Close uses goToDesk()", () => {
		expect(read("src/posapp/components/pos/shell/Pos.vue")).toMatch(/goToDeskAfterClose\(\) \{\s*goToDesk\(\);/);
	});

	it("the opening dialog's Close uses the same goToDesk()", () => {
		expect(read("src/posapp/components/pos/shift/OpeningDialog.vue")).toMatch(/function go_desk\(\) \{\s*goToDesk\(\);/);
	});
});
