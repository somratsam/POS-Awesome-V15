"""Discount reasons for POS cart lines.

Per store: everything here is off unless the POS Profile's "Ask for a
discount reason" switch (posa_require_discount_reason, default off) is on.
Cashiers then pick a reason (a POS Discount Reason) for each line discount
-- pick-only, no typing -- and the till won't go to payment until every
discounted line has one. The server never rejects an invoice over a missing one --
an offline sale has already been paid for by the time it syncs -- and,
as a safety net for queued offline sales and old clients only, marks such
lines "Not recorded" when the invoice is submitted, so they still show up
in reports for a manager to follow up.
"""

import frappe
from frappe.utils import cint, cstr, flt

NOT_RECORDED = "Not recorded"
REASON_DOCTYPE = "POS Discount Reason"
REASON_FIELD = "posa_discount_reason"
DISCOUNT_EPSILON = 0.0000001


def get_cashier_discount_reasons():
    """Enabled reasons offered at the till, in display order (boot data)."""
    return frappe.get_all(
        REASON_DOCTYPE,
        filters={"enabled": 1, "is_system": 0},
        fields=["name", "display_order"],
        order_by="display_order asc, name asc",
    )


def has_manual_line_discount(row):
    """True for a line discount a cashier gave (not an offer or free item)."""
    get = row.get if hasattr(row, "get") else (lambda *_args: None)
    if cint(get("posa_offer_applied")) or cint(get("posa_is_offer")) or cint(get("is_free_item")):
        return False
    return flt(get("discount_percentage")) > DISCOUNT_EPSILON or flt(get("discount_amount")) > DISCOUNT_EPSILON


def sanitize_discount_reason_payload(payload):
    """Replace reasons that no longer exist before the invoice doc is built.

    Frappe validates Link fields before any validate hook runs, so an
    offline invoice queued with a reason deleted since would otherwise fail
    to sync. Runs on the raw request payload in update_invoice/submit_invoice.
    """
    if not isinstance(payload, dict):
        return
    items = payload.get("items")
    if not isinstance(items, list):
        return

    known = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        reason = cstr(item.get(REASON_FIELD)).strip()
        if not reason:
            item[REASON_FIELD] = None
            continue
        if reason not in known:
            known[reason] = bool(frappe.db.exists(REASON_DOCTYPE, reason))
        item[REASON_FIELD] = reason if known[reason] else NOT_RECORDED


def _is_pos_document(doc):
    return doc.doctype == "POS Invoice" or bool(doc.get("is_pos")) or bool(doc.get("pos_profile"))


def _profile_asks_for_reasons(doc):
    """The per-store POS Profile switch (default off)."""
    profile = doc.get("pos_profile")
    if not profile:
        return False
    return bool(cint(frappe.get_cached_value("POS Profile", profile, "posa_require_discount_reason")))


def _copy_reasons_from_original_lines(doc):
    """Return lines carry the original sale line's reason (server-side truth)."""
    link_field = "pos_invoice_item" if doc.doctype == "POS Invoice" else "sales_invoice_item"
    rows = [row for row in doc.get("items") or [] if row.get(link_field)]
    if not rows:
        return
    originals = {
        r.name: r
        for r in frappe.get_all(
            f"{doc.doctype} Item",
            filters={"name": ["in", list({row.get(link_field) for row in rows})]},
            fields=["name", REASON_FIELD],
        )
    }
    for row in rows:
        original = originals.get(row.get(link_field))
        if original:
            row.set(REASON_FIELD, original.get(REASON_FIELD))


def apply_discount_reasons(doc):
    """Normalise each line's discount reason on save.

    Only for POS invoices from a store whose POS Profile asks for reasons;
    with the switch off nothing here runs, exactly as before the feature.
    """
    if not _is_pos_document(doc) or not _profile_asks_for_reasons(doc):
        return

    if cint(doc.get("is_return")):
        # Returns never need a reason; they inherit the sale line's.
        _copy_reasons_from_original_lines(doc)
        return

    submitting = cint(doc.get("docstatus")) == 1
    for row in doc.get("items") or []:
        if not has_manual_line_discount(row):
            row.set(REASON_FIELD, None)
            continue

        if cstr(row.get(REASON_FIELD)).strip():
            continue
        # Drafts keep a blank reason so the till still asks for it; only a
        # submitted sale gets the "Not recorded" marker.
        row.set(REASON_FIELD, NOT_RECORDED if submitting else None)
