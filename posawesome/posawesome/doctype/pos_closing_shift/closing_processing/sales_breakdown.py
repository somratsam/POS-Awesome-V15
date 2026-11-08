"""Sales figures shared by the Z Report and the live Closing Shift overview.

One function, so the overview a cashier checks before closing and the Z
Report printed after it can never disagree. It reads the invoices itself
from their names, so an open shift and a closed one give the same answer,
and every reprint of an old closing is recalculated the same way.

- Gross Sales: every sale in the shift, exchange sales included (so it still
  matches ERPNext's Sales Register). "Of which exchanges" names the part that
  came from customers who returned something and used that credit in the same
  shift -- the same rule as the receipt, the overview badge and Invoice
  Management (credit_exchange.get_customers_with_same_shift_return).
- Returns are split into returns of sales made in this shift and returns of
  earlier sales (a return can make Net Sales go below zero).
- Receipts and the per-receipt / per-item averages leave exchange sales out
  and are based on Net Sales and net items (sold minus returned), the usual
  retail measure; None when there is nothing to divide by.
- Takings bridge: Net Sales + Credit Issued - Credit Redeemed, less refunds,
  loyalty points, write-offs, rounding and amounts left unpaid, equals the
  money taken (Today's Payments). Each sale's unpaid part is worked out from
  the invoice's own figures, not today's outstanding amount, so a reprint
  gives the same bridge after the customer pays later.
- Left as Store Credit: credit issued minus credit used in same-shift
  exchanges -- what the shop owes customers because of this shift.

Credit Issued keeps its existing meaning: the total of the shift's returns.
"""

import frappe
from frappe.utils import flt

from posawesome.posawesome.api.credit_exchange import get_customers_with_same_shift_return

from .utils import get_base_value

PRECISION = 3

_FIELDS = [
    "name",
    "customer",
    "is_return",
    "return_against",
    "grand_total",
    "base_grand_total",
    "rounded_total",
    "base_rounded_total",
    "conversion_rate",
    "total_qty",
    "paid_amount",
    "base_paid_amount",
    "change_amount",
    "base_change_amount",
    "write_off_amount",
    "base_write_off_amount",
    "loyalty_amount",
    "posa_redeemed_customer_credit",
]


def _ratio(numerator, denominator):
    return flt(numerator / denominator, PRECISION) if denominator else None


def _rows(names_by_doctype):
    rows = []
    for doctype, names in (names_by_doctype or {}).items():
        names = [name for name in (names or []) if name]
        if not names:
            continue
        meta = frappe.get_meta(doctype)
        fields = [f for f in _FIELDS if f == "name" or meta.has_field(f)]
        for row in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=fields):
            row["doctype"] = doctype
            rows.append(row)
    return rows


def get_sales_breakdown(pos_opening_shift, names_by_doctype):
    """Figures for one shift. names_by_doctype: {"Sales Invoice": [names...]}.
    The caller has already checked the user may see this shift."""
    rows = _rows(names_by_doctype)

    customers = list({row.get("customer") for row in rows if row.get("customer")})
    returning_customers = (
        set(get_customers_with_same_shift_return(customers, pos_opening_shift))
        if customers and pos_opening_shift
        else set()
    )

    # Shift of each returned invoice, to split returns of this shift's sales
    # from returns of earlier sales.
    origin_shift = {}
    for doctype in {row["doctype"] for row in rows}:
        origins = [r.get("return_against") for r in rows if r["doctype"] == doctype and r.get("is_return") and r.get("return_against")]
        if origins:
            for origin in frappe.get_all(
                doctype, filters={"name": ["in", origins]}, fields=["name", "posa_pos_opening_shift"]
            ):
                origin_shift[origin.name] = origin.posa_pos_opening_shift

    gross_sales = returns_this_shift = returns_earlier = 0.0
    sale_count = return_count = exchange_count = 0
    exchange_sales = exchange_credit = 0.0
    items_sold = items_returned = 0.0
    credit_issued = credit_redeemed = 0.0
    takings = refunds = loyalty = write_off = rounding = unpaid = 0.0

    for row in rows:
        rate = row.get("conversion_rate")
        grand = get_base_value(row, "grand_total", "base_grand_total", rate)
        paid = get_base_value(row, "paid_amount", "base_paid_amount", rate)
        change = get_base_value(row, "change_amount", "base_change_amount", rate)
        rounded = get_base_value(row, "rounded_total", "base_rounded_total", rate)
        rounding_diff = grand - rounded if rounded else 0.0

        if row.get("is_return"):
            amount = abs(grand)
            return_count += 1
            items_returned += abs(flt(row.get("total_qty")))
            credit_issued += amount
            refunded = abs(paid)
            refunds += refunded
            takings -= refunded
            if origin_shift.get(row.get("return_against")) == pos_opening_shift and pos_opening_shift:
                returns_this_shift += amount
            else:
                returns_earlier += amount
            rounding -= rounding_diff
            continue

        sale_count += 1
        gross_sales += grand
        items_sold += flt(row.get("total_qty"))
        redeemed = get_base_value(row, "posa_redeemed_customer_credit", conversion_rate=rate)
        row_loyalty = get_base_value(row, "loyalty_amount", conversion_rate=rate)
        row_write_off = get_base_value(row, "write_off_amount", "base_write_off_amount", rate)
        paid_net = paid - change

        credit_redeemed += redeemed
        loyalty += row_loyalty
        write_off += row_write_off
        rounding += rounding_diff
        takings += paid_net
        unpaid += max(grand - rounding_diff - paid_net - redeemed - row_loyalty - row_write_off, 0.0)

        if row.get("customer") in returning_customers and redeemed > 0:
            exchange_count += 1
            exchange_sales += grand
            exchange_credit += redeemed

    returns = returns_this_shift + returns_earlier
    net_sales = gross_sales - returns
    net_items = items_sold - items_returned
    receipts = sale_count - exchange_count
    bridge = net_sales + credit_issued - credit_redeemed - refunds - loyalty - write_off - rounding - unpaid
    other = flt(takings - bridge, PRECISION)

    def money(value):
        return flt(value, PRECISION)

    return {
        "gross_sales": money(gross_sales),
        "returns": money(returns),
        "returns_this_shift": money(returns_this_shift),
        "returns_earlier": money(returns_earlier),
        "net_sales": money(net_sales),
        "sale_count": sale_count,
        "return_count": return_count,
        "exchange_count": exchange_count,
        "exchange_sales": money(exchange_sales),
        "receipts": receipts,
        "items_sold": flt(items_sold, 3),
        "items_returned": flt(items_returned, 3),
        "net_items": flt(net_items, 3),
        "sales_per_receipt": _ratio(net_sales, receipts) if receipts > 0 else None,
        "items_per_receipt": flt(net_items / receipts, 2) if receipts > 0 else None,
        "sales_per_item": _ratio(net_sales, net_items) if net_items > 0 else None,
        "credit_issued": money(credit_issued),
        "credit_redeemed": money(credit_redeemed),
        "same_shift_exchange_total": money(exchange_credit),
        "left_as_store_credit": money(credit_issued - exchange_credit),
        "takings": money(takings),
        "refunds": money(refunds),
        "loyalty": money(loyalty),
        "write_off": money(write_off),
        "rounding": money(rounding),
        "unpaid": money(unpaid),
        "other": other if abs(other) >= 0.0005 else 0.0,
    }
