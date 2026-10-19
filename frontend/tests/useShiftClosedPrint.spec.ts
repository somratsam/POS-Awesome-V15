import { beforeEach, describe, expect, it, vi } from "vitest";

const printZReport = vi.hoisted(() => vi.fn());
vi.mock("../src/posapp/services/documentPrint", () => ({ printZReport }));

import { useShiftClosedPrint } from "../src/posapp/composables/pos/closing/useShiftClosedPrint";

// A print the test settles by hand, to look at the state while it runs.
function pendingPrint() {
	let settle!: (result: { ok: boolean; error?: string }) => void;
	const promise = new Promise<{ ok: boolean; error?: string }>((resolve) => (settle = resolve));
	return { promise, settle };
}

describe("useShiftClosedPrint", () => {
	beforeEach(() => {
		printZReport.mockReset();
	});

	it("shows printing until the automatic print settles, then sent", async () => {
		const shift = useShiftClosedPrint();
		const auto = pendingPrint();

		const done = shift.shiftClosed("POSA-CS-1", auto.promise);
		expect(shift.printState.value).toBe("printing");

		auto.settle({ ok: true });
		await done;
		expect(shift.printState.value).toBe("sent");
		expect(shift.printError.value).toBe("");
	});

	it("shows failed with the reason when the automatic print fails", async () => {
		const shift = useShiftClosedPrint();

		await shift.shiftClosed("POSA-CS-1", Promise.resolve({ ok: false, error: "QZ Tray is not available." }));

		expect(shift.printState.value).toBe("failed");
		expect(shift.printError.value).toBe("QZ Tray is not available.");
	});

	it("Reprint prints the shift that was just closed and updates the state", async () => {
		const shift = useShiftClosedPrint();
		await shift.shiftClosed("POSA-CS-7", Promise.resolve({ ok: false, error: "No QZ printer selected." }));
		printZReport.mockResolvedValue({ ok: true });

		await shift.reprint();

		expect(printZReport).toHaveBeenCalledWith("POSA-CS-7");
		expect(shift.printState.value).toBe("sent");
		expect(shift.printError.value).toBe("");
	});

	it("ignores Reprint while a print is still running", async () => {
		const shift = useShiftClosedPrint();
		const auto = pendingPrint();
		const done = shift.shiftClosed("POSA-CS-1", auto.promise);

		shift.reprint();
		expect(printZReport).not.toHaveBeenCalled();

		auto.settle({ ok: false, error: "x" });
		await done;
		const reprint = pendingPrint();
		printZReport.mockReturnValue(reprint.promise);
		shift.reprint();
		shift.reprint();
		expect(printZReport).toHaveBeenCalledTimes(1);
		reprint.settle({ ok: true });
	});

	it("does nothing before any shift has closed", () => {
		const shift = useShiftClosedPrint();
		shift.printState.value = "failed";
		shift.reprint();
		expect(printZReport).not.toHaveBeenCalled();
	});
});
