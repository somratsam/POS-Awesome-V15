// One-screen exchange and the scanner (useScannerInput.onBarcodeScanned):
// - while the "Items on receipt" picker is open, every scan ticks a line in
//   it (the picker registers a handler) and never reaches the cart;
// - otherwise, with the POS Profile's "One-screen exchange" on, a scan shaped
//   like a receipt number opens that receipt's picker. When the server says
//   it isn't a receipt, the code goes back through normal selling once.
// - with the setting off, a complete receipt number opens the old Return
//   dialog with that receipt searched (section 110), on profiles that allow
//   returns; anything else proceeds exactly as before.

import { peekExchangeStore, useExchangeStore } from "../../../stores/exchangeStore";
import { useUIStore } from "../../../stores/uiStore";
import { looksLikeReceipt } from "../../../utils/oneScreenExchange";
import { isFullReceiptCode } from "../../../utils/keyboardScan";

const oldReturnAllowed = () => {
	try {
		// Same rule as the Return button (posa_allow_return == 1): the
		// profile carries 1, "1" or true.
		const value = useUIStore().posProfile?.posa_allow_return;
		return value === true || Number(value) === 1;
	} catch {
		return false;
	}
};

/** A scanned or typed receipt has somewhere to go on this profile. */
export function receiptRouteAvailable(): boolean {
	return Boolean(peekExchangeStore()?.enabled) || oldReturnAllowed();
}

/**
 * One-screen exchange off: a complete receipt number opens the old Return
 * dialog with it searched (Returns.vue loads the exact match). True when it
 * did.
 */
export function openOldReturnFor(code: string): boolean {
	const value = String(code || "").trim();
	if (peekExchangeStore()?.enabled || !isFullReceiptCode(value) || !oldReturnAllowed()) return false;
	try {
		const ui = useUIStore();
		ui.requestReturnFor(value, ui.posProfile?.company || "");
	} catch {
		return false;
	}
	return true;
}

type PickerScanHandler = (_code: string) => void;

let pickerHandler: PickerScanHandler | null = null;
const passThrough = new Set<string>();

export function registerExchangePickerScan(handler: PickerScanHandler) {
	pickerHandler = handler;
	return () => {
		if (pickerHandler === handler) pickerHandler = null;
	};
}

/**
 * True when the scan was claimed by the exchange (the caller must not sell
 * it). `rescan` sends a code that turned out not to be a receipt back
 * through normal selling.
 */
export function dispatchExchangeScan(code: string, rescan: (_code: string) => void): boolean {
	const value = String(code || "").trim();
	if (!value) return false;
	if (pickerHandler) {
		pickerHandler(value);
		return true;
	}
	if (passThrough.delete(value)) return false;
	let store: ReturnType<typeof useExchangeStore>;
	try {
		store = useExchangeStore();
	} catch {
		return false;
	}
	if (!store.enabled) return openOldReturnFor(value);
	if (!looksLikeReceipt(value)) return false;
	void store
		.openReceipt(value)
		.then((handled) => {
			if (handled) return;
			passThrough.add(value);
			rescan(value);
		})
		.catch((error) => console.error("Exchange receipt scan failed", error));
	return true;
}

/** Test-only. */
export function resetExchangeScanRoute() {
	pickerHandler = null;
	passThrough.clear();
}
