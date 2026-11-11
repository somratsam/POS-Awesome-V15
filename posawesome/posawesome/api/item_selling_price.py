"""Item.posa_selling_price: each Item's current Standard Selling price, stored on
the Item so ERPNext reports can show it (Stock Balance -> Pick Columns -> Item
-> Selling Price).

Why a separate field and not ERPNext's own Item.standard_rate ("Standard Selling
Rate"): ERPNext's get_valuation_rate() falls back to standard_rate when an item
has no stock ledger entry yet in a warehouse, so filling it would value such
receipts at the selling price and post GL entries (perpetual inventory). This
module never writes standard_rate.

Kept in sync by:
- Item Price hooks (after_insert, on_update, after_delete): the item(s) the
  price belongs to (and belonged to, if its item or price list was edited) are
  recomputed. Bulk Data Import of prices goes through these hooks too.
- A daily full refresh just after midnight: catches prices whose Valid From /
  Valid Upto date starts or ends a validity window, item renames, and anything
  written to the database directly.

Writes go straight to the column (frappe.db.set_value, update_modified=False):
no Item save, no Item hooks, no Version rows, and the Item's `modified` stays
put, so POS item caches and the rewards sync don't see a catalog change.

An item with no valid price gets 0: Frappe v16 Currency columns are NOT NULL.
"""

import frappe
from frappe.utils import cstr, flt, getdate, today

PRICE_LIST = "Standard Selling"
FIELDNAME = "posa_selling_price"
# Stored like price_list_rate (decimal(21,9)); compare at that precision.
STORED_PRECISION = 9


def get_standard_selling_prices(item_codes, stock_uoms, on=None):
    """Standard Selling price per item, picked the way ERPNext's get_item_price
    does: the item's stock UOM (or no UOM), no customer/supplier/batch, valid on
    `on` (default today), newest Valid From first. Items with no such price are
    left out of the result."""
    item_codes = list(item_codes or [])
    if not item_codes:
        return {}
    on = getdate(on or today())
    candidates = frappe.get_all(
        "Item Price",
        filters={
            "price_list": PRICE_LIST,
            "selling": 1,
            "item_code": ["in", item_codes],
            "customer": ["is", "not set"],
            "supplier": ["is", "not set"],
            "batch_no": ["is", "not set"],
        },
        fields=["item_code", "uom", "price_list_rate", "valid_from", "valid_upto"],
    )
    best = {}
    for p in candidates:
        if cstr(p.uom) not in ("", cstr(stock_uoms.get(p.item_code))):
            continue
        if (p.valid_from and getdate(p.valid_from) > on) or (p.valid_upto and getdate(p.valid_upto) < on):
            continue
        key = (getdate(p.valid_from) if p.valid_from else getdate("1900-01-01"), cstr(p.uom))
        if p.item_code not in best or key > best[p.item_code][0]:
            best[p.item_code] = (key, flt(p.price_list_rate))
    return {code: rate for code, (_key, rate) in best.items()}


def refresh_items(item_codes=None):
    """Recompute posa_selling_price for the given items (all items when None).
    Only rows whose value actually changes are written. Returns
    {"checked", "updated", "priced"}."""
    if not frappe.db.has_column("Item", FIELDNAME):
        return {"checked": 0, "updated": 0, "priced": 0}

    filters = {}
    if item_codes is not None:
        item_codes = sorted({cstr(code) for code in item_codes if code})
        if not item_codes:
            return {"checked": 0, "updated": 0, "priced": 0}
        filters["name"] = ["in", item_codes]

    items = frappe.get_all("Item", filters=filters, fields=["name", "stock_uom", FIELDNAME])
    prices = get_standard_selling_prices(
        [i.name for i in items], {i.name: i.stock_uom for i in items}
    )

    updated = 0
    for item in items:
        new = flt(prices.get(item.name, 0), STORED_PRECISION)
        if flt(item.get(FIELDNAME), STORED_PRECISION) != new:
            frappe.db.set_value("Item", item.name, FIELDNAME, new, update_modified=False)
            updated += 1
    return {"checked": len(items), "updated": updated, "priced": len(prices)}


def _affected_items(doc):
    """Items whose price may have changed with this Item Price write: its own
    item, plus the previous item if the item or price list was edited."""
    codes = set()
    if doc.get("price_list") == PRICE_LIST:
        codes.add(doc.get("item_code"))
    before = doc.get_doc_before_save() if hasattr(doc, "get_doc_before_save") else None
    if before and before.get("price_list") == PRICE_LIST:
        codes.add(before.get("item_code"))
    return {c for c in codes if c}


def on_item_price_change(doc, method=None):
    """Item Price after_insert / on_update / after_delete."""
    codes = _affected_items(doc)
    if codes:
        refresh_items(codes)


def daily_refresh():
    """Scheduled: full recompute (validity dates, renames, direct DB writes)."""
    result = refresh_items()
    if result["updated"]:
        frappe.db.commit()
    return result
