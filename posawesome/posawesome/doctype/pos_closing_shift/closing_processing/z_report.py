import frappe
from frappe import _
from frappe.utils import flt

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_shift_invoice_rows,
    get_payment_mode_counts,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value


# Currency amounts are rounded to this precision before returning, so the
# printed report never shows floating-point artifacts like 77.69999999999999.
CURRENCY_PRECISION = 3


def get_store_name(pos_profile_doc):
    """Resolve a customer-facing store name for the report header.

    Prefers the POS Profile's custom brand name (if enabled and set --
    that's an explicit, opt-in choice by the business), then falls back to
    the linked Warehouse's human-readable name, then finally the POS
    Profile's own name as a last resort. The POS Profile name alone
    (e.g. "Test Pos") is usually an internal identifier, not a real store
    name, so it's only used when nothing better is configured.
    """
    if pos_profile_doc.get("posa_enable_custom_branding") and pos_profile_doc.get("posa_brand_name"):
        return pos_profile_doc.get("posa_brand_name")

    warehouse = pos_profile_doc.get("warehouse")
    if warehouse:
        warehouse_name = frappe.db.get_value("Warehouse", warehouse, "warehouse_name")
        if warehouse_name:
            return warehouse_name

    return pos_profile_doc.get("name")


@frappe.whitelist()
def get_z_report_data(pos_closing_shift):
    """Assemble the full Z Report dataset for a submitted POS Closing Shift.

    Combines fields already stored on the submitted doc (net/grand total,
    per-mode cash reconciliation, customer credit issued/redeemed) with
    fresh invoice-derived totals that have no stored equivalent anywhere:
    sales-only quantity (doc.total_quantity nets in returns, confirmed wrong
    for this purpose), discount totals, VAT, and per-payment-mode transaction
    counts.

    VAT is summed row-wise from each sale invoice's actual
    total_taxes_and_charges (not back-calculated from total_sales via a
    hardcoded rate), so it stays correct regardless of tax rate changes or
    future per-item/per-customer tax exceptions.
    """
    doc = frappe.get_doc("POS Closing Shift", pos_closing_shift)
    if doc.docstatus != 1:
        frappe.throw(_("Z Report can only be generated for a submitted POS Closing Shift."))

    invoice_rows = get_shift_invoice_rows(doc)

    total_sales = 0.0
    total_returns = 0.0
    sale_count = 0
    return_count = 0
    total_qty = 0.0
    total_discount = 0.0
    total_vat = 0.0
    sale_names = []
    return_names = []

    for row in invoice_rows:
        conversion_rate = row.get("conversion_rate")
        base_grand_total = get_base_value(row, "grand_total", "base_grand_total", conversion_rate)
        if row.get("is_return"):
            total_returns += abs(base_grand_total)
            return_count += 1
            return_names.append(row.get("name"))
        else:
            total_sales += base_grand_total
            sale_count += 1
            sale_names.append(row.get("name"))
            total_qty += flt(row.get("total_qty"))
            total_discount += get_base_value(
                row, "discount_amount", "base_discount_amount", conversion_rate
            )
            total_vat += get_base_value(
                row, "total_taxes_and_charges", "base_total_taxes_and_charges", conversion_rate
            )

    net_excl_vat = total_sales - total_vat
    items_per_receipt = flt(total_qty / sale_count, 2) if sale_count else 0.0
    sales_per_receipt = flt(total_sales / sale_count, CURRENCY_PRECISION) if sale_count else 0.0
    sales_per_item = flt(total_sales / total_qty, CURRENCY_PRECISION) if total_qty else 0.0
    total_register_count = sale_count + return_count

    pos_profile_doc = frappe.db.get_value(
        "POS Profile",
        doc.pos_profile,
        ["name", "posa_enable_custom_branding", "posa_brand_name", "warehouse"],
        as_dict=True,
    )
    store_name = get_store_name(pos_profile_doc) if pos_profile_doc else doc.pos_profile

    payment_modes = {
        mode: {
            "sale_count": entry.get("sale_count", 0),
            "sale_total": flt(entry.get("sale_total"), CURRENCY_PRECISION),
            "return_count": entry.get("return_count", 0),
            "return_total": flt(entry.get("return_total"), CURRENCY_PRECISION),
        }
        for mode, entry in get_payment_mode_counts(sale_names, return_names).items()
    }

    payment_reconciliation = [
        {
            "mode_of_payment": d.mode_of_payment,
            "opening_amount": flt(d.opening_amount, CURRENCY_PRECISION),
            "expected_amount": flt(d.expected_amount, CURRENCY_PRECISION),
            "closing_amount": flt(d.closing_amount, CURRENCY_PRECISION),
            "difference": flt(d.difference, CURRENCY_PRECISION),
        }
        for d in doc.payment_reconciliation
    ]

    return {
        "name": doc.name,
        "pos_profile": doc.pos_profile,
        "store_name": store_name,
        "posting_date": doc.posting_date,
        "company": doc.company,
        "company_currency": frappe.get_cached_value("Company", doc.company, "default_currency"),
        "net_total": flt(doc.net_total, CURRENCY_PRECISION),
        "grand_total": flt(doc.grand_total, CURRENCY_PRECISION),
        "customer_credit_issued": flt(doc.customer_credit_issued, CURRENCY_PRECISION),
        "customer_credit_redeemed": flt(doc.customer_credit_redeemed, CURRENCY_PRECISION),
        "same_shift_exchange_total": flt(doc.same_shift_exchange_total, CURRENCY_PRECISION),
        "total_sales": flt(total_sales, CURRENCY_PRECISION),
        "total_returns": flt(total_returns, CURRENCY_PRECISION),
        "net_sales": flt(total_sales - total_returns, CURRENCY_PRECISION),
        "sale_count": sale_count,
        "return_count": return_count,
        "total_qty": flt(total_qty),
        "total_discount": flt(total_discount, CURRENCY_PRECISION),
        "total_vat": flt(total_vat, CURRENCY_PRECISION),
        "net_excl_vat": flt(net_excl_vat, CURRENCY_PRECISION),
        "items_per_receipt": items_per_receipt,
        "sales_per_receipt": sales_per_receipt,
        "sales_per_item": sales_per_item,
        "total_register_count": total_register_count,
        "payment_modes": payment_modes,
        "payment_reconciliation": payment_reconciliation,
    }
