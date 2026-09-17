# -*- coding: utf-8 -*-
import frappe
from frappe import _

from posawesome.posawesome.api.pos_access import get_authorized_pos_profile


@frappe.whitelist()
def get_customers_with_same_shift_return(customers, pos_opening_shift):
    """Return the subset of `customers` that have at least one submitted
    return posted under the given POS Opening Shift.

    The single canonical "same-shift return" check, reused everywhere this
    concept is shown: the receipt print format, the live pre-close Closing
    Shift Overview, the post-close Z Report (via
    closing_processing/data.py's get_same_shift_exchange_total()), and
    Invoice Management's per-invoice badge. Before this, each of those had
    its own independently-written version of this same check, and they
    disagreed in real, confirmed ways -- see PROGRESS_NOTES.md.

    Deliberately an existence check per customer, not a per-source dollar
    -amount attribution: a customer with ANY same-shift return counts,
    regardless of whether the specific credit later redeemed actually
    traces back to that exact return. This mirrors the receipt's own
    original logic, kept as-is by deliberate decision -- the one change
    from that original is the docstatus=1 guard below, closing a real gap
    (the receipt's own inline SQL had no such guard and could match a
    draft or cancelled return).

    Only queries Sales Invoice, matching every site this app runs on
    today. Would need doctype-awareness (like get_pos_invoices()'s own
    create_pos_invoice_instead_of_sales_invoice check) if a site using
    POS Invoice instead ever needed this -- not built here since nothing
    live needs it yet.

    Batch-shaped deliberately: a caller with many customers (the Z Report,
    the Overview) passes them all in one call rather than querying once
    per customer.
    """
    if not pos_opening_shift:
        return []

    scope = frappe.db.get_value(
        "POS Opening Shift", pos_opening_shift, ["pos_profile", "company"]
    )
    if not scope or not scope[0]:
        frappe.throw(_("Invalid POS Opening Shift."))
    pos_profile, company = scope
    get_authorized_pos_profile(pos_profile, company=company)

    if isinstance(customers, str):
        customers = frappe.parse_json(customers)
    customers = list({c for c in (customers or []) if c})
    if not customers:
        return []

    rows = frappe.get_all(
        "Sales Invoice",
        filters={
            "customer": ["in", customers],
            "is_return": 1,
            "docstatus": 1,
            "posa_pos_opening_shift": pos_opening_shift,
        },
        pluck="customer",
    )
    return list(set(rows))
