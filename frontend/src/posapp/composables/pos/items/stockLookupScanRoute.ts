// Routes scans to the Check Stock dialog only while that dialog is actually
// mounted and open. There is deliberately no "lookup mode" flag to switch
// off: the dialog registers a handler when it opens and removes it when it
// closes or unmounts, and every scan checks for that handler at the moment
// it arrives. No handler registered -> the scan goes to normal selling,
// exactly as it would without this module.
//
// Module state only (never persisted), so a page reload always starts with
// no handler, i.e. in normal selling.

type StockLookupScanHandler = (_code: string) => Promise<void> | void;
type StockLookupFailureHandler = (_error: unknown) => void;

let activeHandler: StockLookupScanHandler | null = null;
let activeFailureHandler: StockLookupFailureHandler | null = null;

export function registerStockLookupScanHandler(
	handler: StockLookupScanHandler,
	onFailure: StockLookupFailureHandler,
) {
	activeHandler = handler;
	activeFailureHandler = onFailure;
	return () => {
		if (activeHandler === handler) {
			activeHandler = null;
			activeFailureHandler = null;
		}
	};
}

export function isStockLookupScanActive() {
	return activeHandler !== null;
}

const failLookup = (error: unknown) => {
	const onFailure = activeFailureHandler;
	// Drop the route before notifying, so even a failure handler that itself
	// throws can't leave scans pointed at a broken dialog.
	activeHandler = null;
	activeFailureHandler = null;
	console.error("Check Stock lookup failed; scanner returned to selling", error);
	try {
		onFailure?.(error);
	} catch (notifyError) {
		console.error("Check Stock failure handler threw", notifyError);
	}
};

/**
 * Hand a scan to the Check Stock dialog if it is open. Returns true when the
 * scan was claimed (the caller must then not process it as a sale), false
 * when no lookup is active and the scan should proceed to normal selling.
 */
export function dispatchStockLookupScan(code: string): boolean {
	const handler = activeHandler;
	if (!handler) return false;
	try {
		const result = handler(code);
		if (result && typeof (result as Promise<void>).catch === "function") {
			(result as Promise<void>).catch(failLookup);
		}
	} catch (error) {
		failLookup(error);
	}
	return true;
}

/** Test-only: forget any registered handler. */
export function resetStockLookupScanRoute() {
	activeHandler = null;
	activeFailureHandler = null;
}
