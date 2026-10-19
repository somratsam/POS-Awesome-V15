import { ref } from "vue";

import {
	printZReport,
	type ZReportPrintResult,
} from "../../../services/documentPrint";

export type ZReportPrintState = "printing" | "sent" | "failed";

// The Z Report print for the shift that was just closed, so the Shift Closed
// screen can say whether it printed and offer a reprint.
export function useShiftClosedPrint() {
	const closedShiftName = ref("");
	const printState = ref<ZReportPrintState>("printing");
	const printError = ref("");

	async function track(print: Promise<ZReportPrintResult>) {
		printState.value = "printing";
		printError.value = "";
		const result = await print;
		printState.value = result?.ok ? "sent" : "failed";
		printError.value = result?.ok ? "" : result?.error || "";
	}

	function shiftClosed(closingShift: string, print: Promise<ZReportPrintResult>) {
		closedShiftName.value = closingShift;
		return track(print);
	}

	function reprint() {
		// One print at a time; the button is also disabled while printing.
		if (printState.value === "printing" || !closedShiftName.value) {
			return;
		}
		return track(printZReport(closedShiftName.value));
	}

	return { closedShiftName, printState, printError, shiftClosed, reprint };
}
