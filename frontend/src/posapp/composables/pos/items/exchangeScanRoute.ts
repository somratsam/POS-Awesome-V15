// One-screen exchange and the scanner (useScannerInput.onBarcodeScanned):
// - while the "Items on receipt" picker is open, every scan ticks a line in
//   it (the picker registers a handler) and never reaches the cart;
// - otherwise, with the POS Profile's "One-screen exchange" on, a scan shaped
//   like a receipt number opens that receipt's picker. When the server says
//   it isn't a receipt, the code goes back through normal selling once.
// No handler and the setting off -> the scan proceeds exactly as before.

import { useExchangeStore } from "../../../stores/exchangeStore";
import { looksLikeReceipt } from "../../../utils/oneScreenExchange";

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
	if (!store.enabled || !looksLikeReceipt(value)) return false;
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
