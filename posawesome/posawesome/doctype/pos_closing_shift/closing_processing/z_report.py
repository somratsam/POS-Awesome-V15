import frappe
from frappe import _
from frappe.utils import flt

from posawesome.posawesome.api.pos_access import get_authorized_pos_profile
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_shift_invoice_rows,
    get_shift_line_discount_totals,
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
    items sold and items returned (pieces), discount totals, VAT, and
    per-payment-mode transaction counts.

    Total Quantity / Number of Items is the net, items sold minus items
    returned -- the same figure as the Closing Shift's own total_quantity.
    Items/Receipt and Sales Figure/Item stay based on items sold.

    VAT is summed row-wise from each invoice's actual
    total_taxes_and_charges (not back-calculated from total_sales via a
    hardcoded rate), so it stays correct regardless of tax rate changes or
    future per-item/per-customer tax exceptions. VAT on sales and VAT on
    returns are kept apart; VAT Amount, Net Sales incl. VAT and Net Excl. VAT
    are the nets, matching the Closing Shift. Net Excl. VAT is the sum of each
    invoice's own net total, like the Closing Shift's net_total -- not Net
    Sales minus VAT, which can be off by a rounding cent when an invoice's
    net + VAT differs from its grand total.

    This is a directly-callable whitelisted endpoint (the print format's own
    permission check on the POS Closing Shift doc does not protect it), so
    get_authorized_pos_profile() re-validates the requesting user actually
    has access to this shift's POS Profile before any report data is built --
    otherwise any authenticated user could read another store's full Z
    Report by passing a different closing shift name.
    """
    doc = frappe.get_doc("POS Closing Shift", pos_closing_shift)
    get_authorized_pos_profile(doc.pos_profile, company=doc.company)
    if doc.docstatus != 1:
        frappe.throw(_("Z Report can only be generated for a submitted POS Closing Shift."))

    invoice_rows = get_shift_invoice_rows(doc)
    line_discounts = get_shift_line_discount_totals(doc)

    total_sales = 0.0
    total_returns = 0.0
    sale_count = 0
    return_count = 0
    items_sold = 0.0
    items_returned = 0.0
    total_discount = 0.0
    vat_on_sales = 0.0
    vat_on_returns = 0.0
    net_excl_vat = 0.0
    sale_names = []
    return_names = []

    for row in invoice_rows:
        conversion_rate = row.get("conversion_rate")
        base_grand_total = get_base_value(row, "grand_total", "base_grand_total", conversion_rate)
        # Returns carry a negative net total.
        net_excl_vat += get_base_value(row, "net_total", "base_net_total", conversion_rate)
        if row.get("is_return"):
            total_returns += abs(base_grand_total)
            return_count += 1
            return_names.append(row.get("name"))
            items_returned += abs(flt(row.get("total_qty")))
            vat_on_returns += abs(
                get_base_value(row, "total_taxes_and_charges", "base_total_taxes_and_charges", conversion_rate)
            )
        else:
            total_sales += base_grand_total
            sale_count += 1
            sale_names.append(row.get("name"))
            items_sold += flt(row.get("total_qty"))
            # Invoice-level discount plus the discounts on its item lines
            # (Disc %), which the parent discount_amount doesn't include.
            total_discount += get_base_value(
                row, "discount_amount", "base_discount_amount", conversion_rate
            )
            total_discount += flt(line_discounts.get(row.get("name"))) * flt(conversion_rate or 1)
            vat_on_sales += get_base_value(
                row, "total_taxes_and_charges", "base_total_taxes_and_charges", conversion_rate
            )

    net_sales = total_sales - total_returns
    total_vat = vat_on_sales - vat_on_returns
    # flt() also turns a rounded -0.0 into 0.0, so the net never prints as "-0".
    total_qty = flt(items_sold - items_returned, 3)
    items_per_receipt = flt(items_sold / sale_count, 2) if sale_count else 0.0
    sales_per_receipt = flt(total_sales / sale_count, CURRENCY_PRECISION) if sale_count else 0.0
    sales_per_item = flt(total_sales / items_sold, CURRENCY_PRECISION) if items_sold else 0.0
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
        "net_sales": flt(net_sales, CURRENCY_PRECISION),
        "sale_count": sale_count,
        "return_count": return_count,
        "items_sold": flt(items_sold, 3),
        "items_returned": flt(items_returned, 3),
        "total_qty": total_qty,
        "total_discount": flt(total_discount, CURRENCY_PRECISION),
        "vat_on_sales": flt(vat_on_sales, CURRENCY_PRECISION),
        "vat_on_returns": flt(vat_on_returns, CURRENCY_PRECISION),
        "total_vat": flt(total_vat, CURRENCY_PRECISION),
        "net_excl_vat": flt(net_excl_vat, CURRENCY_PRECISION),
        "items_per_receipt": items_per_receipt,
        "sales_per_receipt": sales_per_receipt,
        "sales_per_item": sales_per_item,
        "total_register_count": total_register_count,
        "payment_modes": payment_modes,
        "payment_reconciliation": payment_reconciliation,
    }
