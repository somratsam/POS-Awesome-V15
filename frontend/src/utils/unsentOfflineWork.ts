/**
 * What clearing the till's saved data would lose: offline sales and other
 * offline records (customers, payments, cash movements) not yet sent to the
 * server. Clearing deletes the whole IndexedDB / localStorage, queues included,
 * so it is blocked while anything here is waiting.
 *
 * Sales are counted in both places they can wait: the legacy queue and the
 * invoice outbox. The larger of the two is used (in outbox mode the same sale
 * can sit in both), so a waiting sale is never counted as 0.
 */
export type UnsentOfflineWork = { sales: number; other: number };

export async function countUnsentOfflineWork(): Promise<UnsentOfflineWork> {
	// Loaded on demand: this file is imported by clearAllCaches.ts, which the
	// page bundle loads before the offline layer is needed.
	const offline = await import("../offline/index");
	await offline.initPromise;
	const legacySales = Number(offline.getPendingOfflineInvoiceCount()) || 0;
	const outboxSales = Number(await offline.getPendingInvoiceOutboxCount()) || 0;
	const other =
		(Number(offline.getPendingOfflineCustomerCount()) || 0) +
		(Number(offline.getPendingOfflinePaymentCount()) || 0) +
		(Number(offline.getPendingOfflineCashMovementCount()) || 0);
	return { sales: Math.max(legacySales, outboxSales), other };
}
