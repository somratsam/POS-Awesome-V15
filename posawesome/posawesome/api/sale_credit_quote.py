"""Main screen, a sale with a credit note voucher on it (section 108).

The till shows "Credit note −X" and "Pay Y" under the cart. So that these are
exactly what the payment screen will show, they come from the same places:

- the sale's total as the server saves it when Pay is pressed (pricing rules,
  taxes, rounding): `update_invoice` inside a savepoint that is always rolled
  back, as one_screen_exchange.quote_exchange does;
- the customer's credit rows from `payments.get_available_credit`, the call
  the payment screen makes; the till picks and allocates them with the same
  code as the payment screen (useRedemptionLogic).

Nothing is saved. Spending is checked again at submit, under a row lock.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

QUOTE_SAVEPOINT = "posa_sale_credit_quote"


def _loads(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            frappe.throw(_("Invalid sale."))
    return value


@frappe.whitelist(methods=["POST"])
def quote_sale_credit(invoice):
    """{"total": the sale's total as Pay will save it (0 with no items),
    "credit": get_available_credit(customer, company, include_expired=1)}."""
    from posawesome.posawesome.api.invoice_processing import creation
    from posawesome.posawesome.api.payments import get_available_credit

    invoice = _loads(invoice)
    if not isinstance(invoice, dict):
        frappe.throw(_("Invalid sale."))
    if cint(invoice.get("is_return")):
        frappe.throw(_("A credit note pays for a sale, not a return."))
    # The profile from the request is re-checked against the session user
    # (and the till's company comes from it, not from the request).
    profile_doc = creation._resolve_authorized_invoice_profile(invoice)
    customer = cstr(invoice.get("customer")).strip()
    if not customer:
        frappe.throw(_("Select a customer"))
    company = profile_doc.get("company")
    invoice["company"] = company
    for key in ("posa_client_request_id", "_force_invoice_doctype"):
        invoice.pop(key, None)

    total = 0.0
    if invoice.get("items"):
        realtime_log = getattr(frappe.local, "_realtime_log", None)
        realtime_mark = len(realtime_log) if isinstance(realtime_log, list) else 0
        frappe.db.savepoint(QUOTE_SAVEPOINT)
        try:
            saved = creation.update_invoice(json.dumps(invoice, default=str))
            doc = frappe.get_doc(saved.get("doctype") or "Sales Invoice", saved.get("name"))
            precision = doc.precision("grand_total") or 2
            total = flt(doc.rounded_total or doc.grand_total, precision)
        finally:
            try:
                frappe.db.rollback(save_point=QUOTE_SAVEPOINT)
            except Exception:
                frappe.db.rollback()
            # The rolled-back draft queued "document changed" notifications.
            if isinstance(getattr(frappe.local, "_realtime_log", None), list):
                del frappe.local._realtime_log[realtime_mark:]

    return {
        "total": total,
        "credit": get_available_credit(customer, company, include_expired=1),
    }
