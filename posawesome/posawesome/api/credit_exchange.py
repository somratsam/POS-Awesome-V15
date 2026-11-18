# -*- coding: utf-8 -*-
import frappe
from frappe.utils import cint, cstr, flt, getdate, nowdate


# ---------------------------------------------------------------------------
# The real link between a return and the sale its credit paid for.
#
# A credit redemption Journal Entry moves credit from a credit note (a debit
# row referencing the return) to a sale (a credit row referencing the sale).
# That entry is the one record that says which return paid for which sale,
# for the one-screen exchange and the older two-step flow alike, and for a
# shared customer such as Anonymous it names the exact return -- never "any
# return of this customer in the shift".
#
# Exchange: a sale paid, in whole or in part, with credit from a return made
# in the same POS Opening Shift. Credit from a return of another shift is a
# sale paid with a credit note (not an exchange).
# ---------------------------------------------------------------------------

_LINK_CHUNK = 500


def _chunks(names):
    names = sorted({cstr(n) for n in (names or []) if n})
    for start in range(0, len(names), _LINK_CHUNK):
        yield names[start : start + _LINK_CHUNK]


def _link_rows(column, names):
    """(credit note, sale, journal row, amount) for every credit move whose
    sale (column="sale") or credit note (column="credit_note") is in names.
    One row per debit row and sale, so an entry never counts twice."""
    rows = []
    for chunk in _chunks(names):
        rows += frappe.db.sql(
            f"""
            select distinct debit_row.name as row_name,
                debit_row.reference_name as credit_note,
                credit_row.reference_name as sale,
                debit_row.debit_in_account_currency as used
            from `tabJournal Entry Account` debit_row
            inner join `tabJournal Entry Account` credit_row on credit_row.parent = debit_row.parent
            inner join `tabJournal Entry` je on je.name = debit_row.parent
            where je.docstatus = 1
                and debit_row.reference_type = 'Sales Invoice'
                and debit_row.debit_in_account_currency > 0
                and credit_row.reference_type = 'Sales Invoice'
                and credit_row.credit_in_account_currency > 0
                and credit_row.reference_name != debit_row.reference_name
                and {"credit_row" if column == "sale" else "debit_row"}.reference_name in %(names)s
            """,
            {"names": tuple(chunk)},
            as_dict=True,
        )
    return rows


def _invoice_heads(names):
    heads = {}
    for chunk in _chunks(names):
        for row in frappe.get_all(
            "Sales Invoice",
            filters={"name": ["in", chunk]},
            fields=["name", "is_return", "docstatus", "posa_pos_opening_shift", "grand_total"],
        ):
            heads[row.name] = row
    return heads


def get_credit_links(sales=None, credit_notes=None):
    """Credit moved from submitted returns to submitted sales, for the given
    sales and/or credit notes: [{"sale", "credit_note", "used", "exchange"}],
    one row per (sale, credit note), ordered by sale then credit note.
    exchange is True when both were made in the same POS Opening Shift."""
    raw = []
    if sales:
        raw += _link_rows("sale", sales)
    if credit_notes:
        raw += _link_rows("credit_note", credit_notes)
    if not raw:
        return []

    seen, totals = set(), {}
    for row in raw:
        key = (row.row_name, row.sale)
        if key in seen:
            continue
        seen.add(key)
        pair = (row.sale, row.credit_note)
        totals[pair] = totals.get(pair, 0.0) + flt(row.used)

    heads = _invoice_heads({name for pair in totals for name in pair})
    links = []
    for (sale, credit_note), used in sorted(totals.items()):
        sale_head, note_head = heads.get(sale), heads.get(credit_note)
        if not sale_head or not note_head:
            continue
        if cint(sale_head.docstatus) != 1 or cint(sale_head.is_return):
            continue
        if cint(note_head.docstatus) != 1 or not cint(note_head.is_return):
            continue
        sale_shift = cstr(sale_head.posa_pos_opening_shift).strip()
        note_shift = cstr(note_head.posa_pos_opening_shift).strip()
        links.append(
            frappe._dict(
                sale=sale,
                credit_note=credit_note,
                used=used,
                exchange=bool(sale_shift) and sale_shift == note_shift,
            )
        )
    return links


def get_exchange_credit_by_sale(sales):
    """{sale: credit it used from returns made in its own shift} for the
    exchange sales among sales -- the shift Overview, the Z Report and the
    Closing Shift's "Exchanges Today" (credit from older credit notes
    is not counted)."""
    totals = {}
    for link in get_credit_links(sales=sales):
        if link.exchange:
            totals[link.sale] = totals.get(link.sale, 0.0) + flt(link.used)
    return totals


def get_returned_state(originals):
    """For each original sale with at least one submitted return:
    {"state": "whole" | "part", "returns": [return names, oldest first]}.
    Whole when every item sold has been returned in full (by item code, so a
    return made without line links still counts)."""
    originals = [cstr(n) for n in (originals or []) if n]
    if not originals:
        return {}
    returned, returns = {}, {}
    for chunk in _chunks(originals):
        for row in frappe.db.sql(
            """
            select r.return_against as original, r.name as return_name, r.posting_date,
                ri.item_code, abs(ri.qty) as qty
            from `tabSales Invoice` r
            inner join `tabSales Invoice Item` ri on ri.parent = r.name
            where r.docstatus = 1 and r.is_return = 1 and r.return_against in %(names)s
            order by r.posting_date, r.posting_time, r.name
            """,
            {"names": tuple(chunk)},
            as_dict=True,
        ):
            names = returns.setdefault(row.original, [])
            if row.return_name not in names:
                names.append(row.return_name)
            by_item = returned.setdefault(row.original, {})
            by_item[row.item_code] = by_item.get(row.item_code, 0.0) + flt(row.qty)
    if not returns:
        return {}

    sold = {}
    for chunk in _chunks(returns.keys()):
        for row in frappe.db.sql(
            """
            select parent as original, item_code, sum(qty) as qty
            from `tabSales Invoice Item`
            where parent in %(names)s
            group by parent, item_code
            """,
            {"names": tuple(chunk)},
            as_dict=True,
        ):
            sold.setdefault(row.original, {})[row.item_code] = flt(row.qty)

    result = {}
    for original, names in returns.items():
        back = returned.get(original, {})
        whole = all(back.get(item, 0.0) + 0.0005 >= qty for item, qty in sold.get(original, {}).items())
        result[original] = {"state": "whole" if whole else "part", "returns": names}
    return result


def describe_credit(rows):
    """Adds what Invoice Management shows about returns, credit notes and
    exchanges to submitted Sales Invoice list rows (each row needs name,
    is_return, grand_total, paid_amount, outstanding_amount, posting_date).

    Every row:  exchange_credit_badge "Exchange" | "Credit note" | None, and
                credit_kind (for the filter chips): sale | exchange |
                credit_note (a sale paid with an older credit note) for sales;
                exchange | credit_note | refund for returns.
    Sales:      exchange_returns (returns that paid for it in the same shift),
                credit_notes_used (older credit notes), returned_state
                "part" | "whole" | None and returned_by (its returns).
    Returns:    exchange_sales, credit_value (what it gave as store credit),
                exchange_used (of that, used in its exchange), credit_issued
                (the rest: the credit note), credit_left, credit_valid_until,
                credit_expired, credit_used_on [{sale, used, exchange}]."""
    from posawesome.posawesome.api.payments import get_customer_credit_expiry

    rows = [row for row in (rows or []) if row.get("name")]
    if not rows:
        return rows
    sale_names = [row["name"] for row in rows if not cint(row.get("is_return"))]
    return_names = [row["name"] for row in rows if cint(row.get("is_return"))]
    links = get_credit_links(sales=sale_names, credit_notes=return_names)
    by_sale, by_note = {}, {}
    for link in links:
        by_sale.setdefault(link.sale, []).append(link)
        by_note.setdefault(link.credit_note, []).append(link)
    returned = get_returned_state(sale_names)
    today = getdate(nowdate())

    for row in rows:
        name = row["name"]
        if not cint(row.get("is_return")):
            sale_links = by_sale.get(name, [])
            row["exchange_returns"] = [l.credit_note for l in sale_links if l.exchange]
            row["credit_notes_used"] = [l.credit_note for l in sale_links if not l.exchange]
            state = returned.get(name)
            row["returned_state"] = state["state"] if state else None
            row["returned_by"] = state["returns"] if state else []
            if row["exchange_returns"]:
                row["exchange_credit_badge"], row["credit_kind"] = "Exchange", "exchange"
            elif row["credit_notes_used"] or flt(row.get("posa_redeemed_customer_credit")) > 0:
                row["exchange_credit_badge"], row["credit_kind"] = "Credit note", "credit_note"
            else:
                row["exchange_credit_badge"], row["credit_kind"] = None, "sale"
            continue

        note_links = by_note.get(name, [])
        credit_value = max(abs(flt(row.get("grand_total"))) - abs(flt(row.get("paid_amount"))), 0.0)
        exchange_used = sum(flt(l.used) for l in note_links if l.exchange)
        credit_left = max(-flt(row.get("outstanding_amount")), 0.0)
        valid_until = get_customer_credit_expiry(row.get("posting_date")) if row.get("posting_date") else None
        row["exchange_sales"] = [l.sale for l in note_links if l.exchange]
        row["credit_value"] = flt(credit_value, 3)
        row["exchange_used"] = flt(exchange_used, 3)
        row["credit_issued"] = flt(max(credit_value - exchange_used, 0.0), 3)
        row["credit_left"] = flt(credit_left, 3)
        row["credit_valid_until"] = str(valid_until) if valid_until else None
        row["credit_expired"] = bool(credit_left > 0.0005 and valid_until and today > valid_until)
        row["credit_used_on"] = [{"sale": l.sale, "used": flt(l.used, 3), "exchange": l.exchange} for l in note_links]
        row["returned_state"], row["returned_by"] = None, []
        if row["exchange_sales"]:
            row["exchange_credit_badge"], row["credit_kind"] = "Exchange", "exchange"
        elif credit_value > 0.0005:
            row["exchange_credit_badge"], row["credit_kind"] = "Credit note", "credit_note"
        else:
            # Refunded in money (old data; returns are credit-only now).
            row["exchange_credit_badge"], row["credit_kind"] = None, "refund"
    return rows


@frappe.whitelist()
def get_invoice_credit_details(name):
    """Invoice Management's detail popup: the same description as the list
    row, for one submitted Sales Invoice the user can read."""
    rows = frappe.get_list(
        "Sales Invoice",
        filters={"name": cstr(name), "docstatus": 1},
        fields=[
            "name",
            "is_return",
            "return_against",
            "grand_total",
            "paid_amount",
            "outstanding_amount",
            "posting_date",
            "posa_redeemed_customer_credit",
        ],
        limit_page_length=1,
    )
    if not rows:
        return {}
    row = describe_credit(rows)[0]
    row["returned_qty_by_line"] = _returned_qty_by_line(row) if row.get("returned_by") else {}
    return row


def _returned_qty_by_line(row):
    """{original line name: qty returned} for the detail popup. A return line
    without a link to its original line counts against the first line of the
    same item."""
    lines = frappe.get_all(
        "Sales Invoice Item",
        filters={"parent": row["name"], "parenttype": "Sales Invoice"},
        fields=["name", "item_code"],
        order_by="idx asc",
    )
    first_by_item = {}
    for line in lines:
        first_by_item.setdefault(line.item_code, line.name)
    known = {line.name for line in lines}
    result = {}
    for back in frappe.get_all(
        "Sales Invoice Item",
        filters={"parent": ["in", row["returned_by"]], "parenttype": "Sales Invoice"},
        fields=["sales_invoice_item", "item_code", "qty"],
    ):
        target = back.sales_invoice_item if back.sales_invoice_item in known else first_by_item.get(back.item_code)
        if target:
            result[target] = flt(result.get(target, 0) + abs(flt(back.qty)), 3)
    return result
