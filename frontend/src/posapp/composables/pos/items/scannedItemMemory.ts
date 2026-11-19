// Items the server found by barcode (get_items_from_barcode), remembered so
// the same barcode scanned again soon is added without asking the server.
// Needed because Limit Search empties the barcode index every time the
// search box clears, i.e. after every scan.
//
// - An entry is used only for the same profile, warehouse, price lists and
//   currency it was fetched under (the scope); any change misses.
// - Entries expire after 5 minutes: the remembered stock figure is what the
//   scan's stock check reads, so it must not be old.
// - Only raw barcodes are remembered, never scale barcodes or serial/batch
//   numbers (those carry a quantity, price or assignment of their own).

export const SCANNED_ITEM_TTL_MS = 5 * 60 * 1000;
export const SCANNED_ITEM_MAX = 500;

type Entry = { scope: string; item: any; at: number };

export function createScannedItemMemory(
	ttlMs = SCANNED_ITEM_TTL_MS,
	maxEntries = SCANNED_ITEM_MAX,
) {
	const entries = new Map<string, Entry>();

	const remember = (code: string, scope: string, item: any, now = Date.now()) => {
		const key = String(code || "").trim();
		if (!key || !scope || !item || !item.item_code) return;
		entries.delete(key);
		entries.set(key, { scope, item: { ...item }, at: now });
		while (entries.size > maxEntries) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
		}
	};

	/** A copy of the remembered item, or null (unknown, expired or other scope). */
	const recall = (code: string, scope: string, now = Date.now()) => {
		const key = String(code || "").trim();
		const entry = key ? entries.get(key) : undefined;
		if (!entry) return null;
		if (entry.scope !== scope || now - entry.at > ttlMs || now < entry.at) {
			entries.delete(key);
			return null;
		}
		return { ...entry.item };
	};

	const clear = () => entries.clear();

	return { remember, recall, clear, size: () => entries.size };
}
