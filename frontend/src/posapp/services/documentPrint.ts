import { printDocumentViaQz, type QzPrintDocumentOptions } from "./qzTray";
import { parseBooleanSetting } from "../utils/stock";
import { useToastStore } from "../stores/toastStore.js";
import {
	printRawDocumentViaQz,
	shouldUseRawDocumentPrinting,
	type RawDocumentPrintOptions,
} from "./rawDocumentPrint";

export { shouldUseRawDocumentPrinting } from "./rawDocumentPrint";

export interface ConfiguredQzDocumentPrintOptions extends QzPrintDocumentOptions {
	doc?: Record<string, any> | null;
	profile?: Record<string, any> | null;
	rawWidthChars?: number;
}

export async function printDocumentViaConfiguredQz(options: ConfiguredQzDocumentPrintOptions) {
	if (shouldUseRawDocumentPrinting(options.profile)) {
		const rawOptions: RawDocumentPrintOptions = {
			doctype: options.doctype,
			name: options.name,
			doc: options.doc,
			profile: options.profile,
			printerName: options.printerName,
			widthChars: options.rawWidthChars,
		};
		await printRawDocumentViaQz(rawOptions);
		return;
	}

	await printDocumentViaQz(options);
}

export function shouldUseConfiguredQzDocumentPrinting(profile?: Record<string, any> | null) {
	return shouldUseRawDocumentPrinting(profile) || parseBooleanSetting(profile?.posa_silent_print);
}

export interface ZReportPrintResult {
	ok: boolean;
	// Why it failed, for staff (e.g. "QZ Tray is not available.").
	error?: string;
}

// ok means QZ Tray accepted the job. QZ can't tell us about an out-of-paper
// or switched-off printer, so ok is not proof it came out of the printer.
export async function printZReport(closingShiftName: string): Promise<ZReportPrintResult> {
	try {
		await printDocumentViaQz({
			doctype: "POS Closing Shift",
			name: closingShiftName,
			printFormat: "Z Report",
			noLetterhead: 1,
		});
		return { ok: true };
	} catch (err: any) {
		console.warn("Failed to print Z Report", err);
		useToastStore().show({
			title: translate("Z Report print failed"),
			color: "warning",
		});
		return { ok: false, error: String(err?.message || err || "") };
	}
}

function translate(text: string) {
	const translator = (globalThis as any).__ || (globalThis as any).frappe?._;
	return typeof translator === "function" ? translator(text) : text;
}

export function getQzPrintErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === "string" && error.trim()) {
		return error.trim();
	}
	return translate("Unknown QZ Tray printing error.");
}

export function confirmDocumentPrintFallback(
	error: unknown,
	options: { raw?: boolean; offline?: boolean } = {},
) {
	const reason = getQzPrintErrorMessage(error);
	const title = options.offline
		? translate("Raw/QZ printing is not available while the POS is offline.")
		: options.raw
			? translate("Raw/QZ printing failed.")
			: translate("QZ Tray printing failed.");
	const message = `${title}\n\n${translate("Reason")}: ${reason}\n\n${translate("Do you want to print using the browser fallback instead?")}`;
	return window.confirm(message);
}
