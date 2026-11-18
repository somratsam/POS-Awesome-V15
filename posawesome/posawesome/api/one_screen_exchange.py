"""One-screen exchange: a return and the new sale it pays for, saved together.

The till sends the return (linked to the original receipt) and, when there
are new items, the new sale. Both go through the normal submit_invoice, one
after the other, inside one database transaction:

- a savepoint is taken first; any error (in either submit, the credit
  Journal Entry, the loyalty or stock postings, or the checks below) rolls
  back to it, so neither invoice, no Journal Entry and no submission-ledger
  row is left behind;
- nothing is queued: background submission and the background credit
  Journal Entry are switched off for this request (in_atomic_exchange), and
  the ledger does not retry after a deadlock, because a deadlock has already
  rolled back the return;
- the new sale is paid with credit from the return this request has just
  created -- the server builds that credit row itself and authorizes it
  (exchange_credit_origin); any credit, voucher, gift card or loyalty
  redemption sent by the client is refused;
- one exchange id from the till: the return is submitted under
  "<id>:return" and the sale under "<id>:sale", so a retry replays both;
- the figures the cashier saw (expected) must match the server's own to the
  last baisa, or nothing is saved.

Credit left over (the return is worth more than the new items) stays on the
return as today (PROGRESS_NOTES section 87): the till prints the BALANCE
voucher for it. Only behind the POS Profile tick box "One-screen exchange".
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, formatdate

EXCHANGE_FLAG = "posa_exchange_atomic"
CREDIT_ORIGIN_FLAG = "posa_exchange_credit_origin"
SAVEPOINT = "posa_one_screen_exchange"
MAX_EXCHANGE_ID_LENGTH = 100
ALLOWED_PAYMENT_TYPES = {"Cash", "Bank"}
# Client fields that would spend something other than the exchange credit.
REFUSED_SALE_DATA_KEYS = ("gift_card_redemptions", "credit_change", "is_credit_sale")
CLIENT_CREDIT_KEYS = (
    "customer_credit_dict",
    "redeemed_customer_credit",
    "customer_credit_redemption_requested",
)
CLIENT_IDENTITY_KEYS = ("idempotency_key", "client_request_id")


def in_atomic_exchange():
    """True while submit_exchange runs: nothing may be queued or committed."""
    return bool(getattr(frappe.flags, EXCHANGE_FLAG, None))


def exchange_credit_origin():
    """The return this request has just created, whose credit the new sale
    may use without a voucher. Set only by submit_exchange, never from the
    request."""
    if not in_atomic_exchange():
        return None
    return getattr(frappe.flags, CREDIT_ORIGIN_FLAG, None)


def _loads(value):
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _money(value, precision):
    return flt(value, precision)


def _exchange_id(value):
    exchange_id = cstr(value).strip()
    if not exchange_id:
        frappe.throw(_("The exchange has no request id. Reload the till and try again."))
    if len(exchange_id) > MAX_EXCHANGE_ID_LENGTH or ":" in exchange_id:
        frappe.throw(_("Invalid exchange request id."))
    return exchange_id


def _assert_enabled(profile_doc):
    if not cint(profile_doc.get("posa_one_screen_exchange")):
        frappe.throw(_("One-screen exchange is not switched on for this POS Profile."))
    if cint(profile_doc.get("create_pos_invoice_instead_of_sales_invoice")):
        frappe.throw(_("One-screen exchange works with Sales Invoices only."))


def _get_original(original_name):
    return frappe.db.get_value(
        "Sales Invoice",
        original_name,
        ["name", "docstatus", "is_return", "company", "customer", "posting_date"],
        as_dict=True,
    )


def _original_problem(original, company, pos_profile):
    """Why a receipt can't be exchanged (today's return rules), or None."""
    from posawesome.posawesome.api.invoice_processing.utils import (
        _get_return_validity_settings,
        get_return_deadline,
        is_return_window_expired,
    )

    if cint(original.docstatus) == 2:
        return _("This receipt was cancelled")
    if cint(original.docstatus) != 1 or cstr(original.company) != cstr(company):
        # Today's rule: any store of the same company; another company's
        # receipts (and drafts) are never found.
        return _("Receipt {0} was not found.").format(original.name)
    if cint(original.is_return):
        return _("This is a return receipt, not a sale")
    enabled, days = _get_return_validity_settings(pos_profile)
    if is_return_window_expired(original.posting_date, enabled, days):
        return _("Return period ended on {0}").format(formatdate(get_return_deadline(original.posting_date, days)))
    return None


def _check_original(original_name, company, pos_profile):
    """Today's return rules, with the picker's messages."""
    if not original_name:
        frappe.throw(_("An exchange needs the original receipt. Use Return Without Invoice instead."))
    original = _get_original(original_name)
    if not original:
        frappe.throw(_("Receipt {0} was not found.").format(original_name))
    problem = _original_problem(original, company, pos_profile)
    if problem:
        frappe.throw(problem)
    return original


def _check_return(return_invoice, return_data, profile_doc):
    if not cint(return_invoice.get("is_return")):
        frappe.throw(_("The exchange's return must be a return."))
    original = _check_original(
        cstr(return_invoice.get("return_against")).strip(),
        profile_doc.get("company"),
        profile_doc.get("name"),
    )
    if return_invoice.get("customer") and cstr(return_invoice.get("customer")) != cstr(original.customer):
        frappe.throw(_("The return must be to the receipt's customer, {0}.").format(original.customer))
    for row in return_invoice.get("payments") or []:
        if abs(flt((row or {}).get("amount"))) > 0:
            frappe.throw(_("An exchange gives no money back: the return becomes credit."))
    for key in CLIENT_CREDIT_KEYS + ("gift_card_redemptions", "paid_change", "credit_change"):
        if return_data.get(key):
            frappe.throw(_("An exchange's return can't carry {0}.").format(key))
    return original


# What a return line takes from the original line. Price, discount and its
# reason are the original's: whatever the till sends for them is ignored.
RETURN_LINE_FIELDS = (
    "item_code",
    "item_name",
    "description",
    "uom",
    "stock_uom",
    "conversion_factor",
    "warehouse",
    "batch_no",
    "serial_no",
    "rate",
    "price_list_rate",
    "discount_percentage",
    "discount_amount",
    "is_free_item",
    "posa_discount_reason",
    "item_tax_template",
    "income_account",
    "cost_center",
)


def _original_lines(original_name):
    fields = ["name", "idx", "qty", "amount", "net_amount"] + [
        f for f in RETURN_LINE_FIELDS if frappe.get_meta("Sales Invoice Item").has_field(f)
    ]
    return frappe.get_all(
        "Sales Invoice Item",
        filters={"parent": original_name, "parenttype": "Sales Invoice"},
        fields=list(dict.fromkeys(fields)),
        order_by="idx asc",
    )


def _returns_by_line(original_name, lines):
    """{line name: {"returned": qty, "history": [{qty, date, name}]}} from the
    submitted returns of a receipt. Returns linked to a line count for it;
    older unlinked return rows count against lines with the same item."""
    rows = frappe.db.sql(
        """
        select ri.sales_invoice_item, ri.item_code, abs(ri.qty) as qty,
            r.posting_date, r.name
        from `tabSales Invoice Item` ri
        inner join `tabSales Invoice` r on r.name = ri.parent
        where r.return_against = %s and r.docstatus = 1 and r.is_return = 1
        order by r.posting_date, r.name, ri.idx
        """,
        original_name,
        as_dict=True,
    )
    result = {line.name: {"returned": 0.0, "history": []} for line in lines}
    by_name = {line.name: line for line in lines}
    unlinked = []
    for row in rows:
        target = result.get(cstr(row.sales_invoice_item))
        if target is None:
            unlinked.append(row)
            continue
        target["returned"] += flt(row.qty)
        target["history"].append({"qty": flt(row.qty), "date": row.posting_date, "name": row.name})
    for row in unlinked:
        remaining = flt(row.qty)
        for line in lines:
            if remaining <= 0:
                break
            if line.item_code != row.item_code:
                continue
            entry = result[line.name]
            room = flt(by_name[line.name].qty) - entry["returned"]
            if room <= 0:
                continue
            used = min(room, remaining)
            entry["returned"] += used
            entry["history"].append({"qty": used, "date": row.posting_date, "name": row.name})
            remaining -= used
    return result


def _build_return(return_invoice, original, profile_doc):
    """The return the server books: the picked lines of the original receipt
    at the original's price, discount and discount reason, and the invoice
    discount in proportion (as the Returns screen does). The till sends only
    which lines and how many: {"items": [{"sales_invoice_item", "qty"}]}."""
    picks = {}
    for row in return_invoice.get("items") or []:
        line = cstr((row or {}).get("sales_invoice_item")).strip()
        qty = flt(abs(flt((row or {}).get("qty"))), 3)
        if line and qty > 0:
            picks[line] = flt(picks.get(line, 0) + qty, 3)
    if not picks:
        frappe.throw(_("Select at least one item to return"))

    lines = _original_lines(original.name)
    by_name = {line.name: line for line in lines}
    returned = _returns_by_line(original.name, lines)
    head = frappe.db.get_value(
        "Sales Invoice",
        original.name,
        ["total", "discount_amount", "apply_discount_on", "taxes_and_charges", "selling_price_list",
         "currency", "conversion_rate", "set_warehouse"],
        as_dict=True,
    ) or frappe._dict()

    items, picked_total = [], 0.0
    for line_name, qty in picks.items():
        line = by_name.get(line_name)
        if not line:
            frappe.throw(_("This item isn't on this receipt"))
        left = flt(flt(line.qty) - returned[line_name]["returned"], 3)
        if qty > left:
            frappe.throw(
                _("Only {0} of {1} can still be returned.").format(frappe.format(left), line.item_name or line.item_code)
            )
        item = {field: line.get(field) for field in RETURN_LINE_FIELDS if line.get(field) is not None}
        factor = flt(line.get("conversion_factor")) or 1
        item.update(
            {
                "qty": -qty,
                "stock_qty": -flt(qty * factor, 6),
                "amount": -flt(flt(line.rate) * qty, 6),
                "sales_invoice_item": line_name,
            }
        )
        if flt(line.qty):
            picked_total += abs(flt(line.amount)) * qty / abs(flt(line.qty))
        items.append(item)

    discount = 0.0
    if flt(head.discount_amount) and flt(head.total):
        ratio = min(1.0, picked_total / abs(flt(head.total)))
        discount = -abs(flt(head.discount_amount) * ratio)

    payments = [
        {"mode_of_payment": row.mode_of_payment, "amount": 0, "default": row.get("default")}
        for row in profile_doc.get("payments") or []
    ]
    payload = {
        "doctype": "Sales Invoice",
        "company": profile_doc.get("company"),
        "pos_profile": profile_doc.get("name"),
        "customer": original.customer,
        "posa_pos_opening_shift": return_invoice.get("posa_pos_opening_shift"),
        "is_return": 1,
        "return_against": original.name,
        "is_pos": 1,
        "update_stock": 1,
        "selling_price_list": head.selling_price_list,
        "currency": head.currency,
        "conversion_rate": head.conversion_rate or 1,
        "taxes_and_charges": head.taxes_and_charges,
        "apply_discount_on": head.apply_discount_on,
        "discount_amount": discount,
        "additional_discount_percentage": 0,
        "items": items,
        "payments": payments,
    }
    if head.set_warehouse:
        payload["set_warehouse"] = head.set_warehouse
    if return_invoice.get("posa_client_request_id"):
        payload["posa_client_request_id"] = return_invoice.get("posa_client_request_id")
    return payload


def _payment_types(modes):
    if not modes:
        return {}
    return {
        row.name: row.type
        for row in frappe.get_all(
            "Mode of Payment", filters={"name": ["in", list(modes)]}, fields=["name", "type"]
        )
    }


def _check_sale(sale_invoice, sale_data, return_invoice, profile_doc):
    if cint(sale_invoice.get("is_return")) or sale_invoice.get("return_against"):
        frappe.throw(_("The exchange's new items must be a sale."))
    if cstr(sale_invoice.get("customer")) != cstr(return_invoice.get("customer")):
        frappe.throw(_("The new items must be sold to the same customer as the return."))
    for key in ("pos_profile", "company"):
        if sale_invoice.get(key) and cstr(sale_invoice.get(key)) != cstr(profile_doc.get(key if key == "company" else "name")):
            frappe.throw(_("The return and the new items must be on the same till."))
    for key in REFUSED_SALE_DATA_KEYS:
        if sale_data.get(key):
            frappe.throw(
                _("An exchange is paid with the exchange credit and Cash or Card only; {0} can't be used.").format(key)
            )
    if cint(sale_invoice.get("redeem_loyalty_points")) or flt(sale_invoice.get("loyalty_amount")):
        frappe.throw(_("Loyalty points can't be redeemed in an exchange. Redeem them on a separate sale."))
    payments = [row or {} for row in sale_invoice.get("payments") or []]
    types = _payment_types({cstr(row.get("mode_of_payment")) for row in payments if flt(row.get("amount"))})
    for row in payments:
        amount = flt(row.get("amount"))
        if not amount:
            continue
        mode = cstr(row.get("mode_of_payment"))
        if amount < 0 or mode == "Gift Card" or types.get(mode) not in ALLOWED_PAYMENT_TYPES:
            frappe.throw(_("{0} can't be used in an exchange: only Cash or Card.").format(mode))


def _keyed(payload, data, key):
    """Submit under the derived key; client keys are dropped."""
    for name in CLIENT_IDENTITY_KEYS:
        data.pop(name, None)
    payload["posa_client_request_id"] = key
    payload.pop("_force_invoice_doctype", None)
    data.pop("_force_invoice_doctype", None)


def _submitted_doc(response, label):
    if not response or response.get("queued") or cint(response.get("docstatus")) != 1:
        frappe.throw(_("The {0} could not be submitted. Nothing was saved.").format(label))
    return frappe.get_doc(response.get("doctype") or "Sales Invoice", response.get("name"))


def _assert_matches(label, server_value, expected_value, precision, currency):
    if expected_value is None:
        frappe.throw(_("The till didn't send the {0}. Nothing was saved.").format(label))
    if _money(server_value, precision) != _money(expected_value, precision):
        fmt = frappe.utils.fmt_money
        frappe.throw(
            _("Totals changed: the {0} is {1}, the till showed {2}. Nothing was saved; check the cart.").format(
                label,
                fmt(server_value, precision, currency=currency),
                fmt(expected_value, precision, currency=currency),
            )
        )


def _lock_original(original_name):
    """Two tills can't run an exchange against the same receipt at once."""
    frappe.db.sql("select name from `tabSales Invoice` where name = %s for update", original_name)


@frappe.whitelist(methods=["POST"])
def submit_exchange(return_invoice, return_data=None, sale_invoice=None, sale_data=None, exchange_id=None, expected=None):
    """Submit an exchange's return and new sale together, or neither.

    expected: what the cashier saw -- {"returned": credit from the return,
    "sale_total": new items total, "pay": amount paid by Cash/Card}.
    Returns {"return": ..., "sale": ... or None, "credit_left": ...}."""
    from posawesome.posawesome.api.invoice_processing import creation

    return_invoice = _loads(return_invoice)
    return_data = _loads(return_data) or {}
    sale_invoice = _loads(sale_invoice) or None
    sale_data = _loads(sale_data) or {}
    expected = _loads(expected) or {}
    if not isinstance(return_invoice, dict):
        frappe.throw(_("The exchange has no return."))
    exchange_id = _exchange_id(exchange_id)

    if in_atomic_exchange():
        frappe.throw(_("An exchange is already being submitted."))

    profile_doc = creation._resolve_authorized_invoice_profile(return_invoice, return_data)
    if sale_invoice is not None:
        sale_profile = creation._resolve_authorized_invoice_profile(sale_invoice, sale_data)
        if sale_profile.get("name") != profile_doc.get("name"):
            frappe.throw(_("The return and the new items must be on the same till."))
    _assert_enabled(profile_doc)
    original = _check_return(return_invoice, return_data, profile_doc)
    return_invoice = _build_return(return_invoice, original, profile_doc)
    if sale_invoice is not None:
        _check_sale(sale_invoice, sale_data, return_invoice, profile_doc)

    _keyed(return_invoice, return_data, f"{exchange_id}:return")
    if sale_invoice is not None:
        _keyed(sale_invoice, sale_data, f"{exchange_id}:sale")
        for key in CLIENT_CREDIT_KEYS:
            sale_data.pop(key, None)

    _lock_original(original.name)
    frappe.db.savepoint(SAVEPOINT)
    setattr(frappe.flags, EXCHANGE_FLAG, True)
    try:
        result = _submit_pair(creation, return_invoice, return_data, sale_invoice, sale_data, expected)
    except Exception:
        _rollback_exchange()
        raise
    finally:
        setattr(frappe.flags, EXCHANGE_FLAG, None)
        setattr(frappe.flags, CREDIT_ORIGIN_FLAG, None)
    return result


def _rollback_exchange():
    """Back to the savepoint. A deadlock has already rolled back the whole
    transaction (and the savepoint with it): roll back everything then."""
    try:
        frappe.db.rollback(save_point=SAVEPOINT)
    except Exception:
        frappe.db.rollback()


def _submit_pair(creation, return_invoice, return_data, sale_invoice, sale_data, expected):
    return_response = creation.submit_invoice(json.dumps(return_invoice), json.dumps(return_data), 0)
    return_doc = _submitted_doc(return_response, _("return"))
    precision = return_doc.precision("grand_total") or 2
    currency = return_doc.get("currency")
    returned = _money(abs(flt(return_doc.rounded_total or return_doc.grand_total)), precision)
    credit = _money(max(-flt(return_doc.outstanding_amount), 0), precision)
    replayed = bool(return_response.get("replayed"))
    if not replayed:
        if credit != returned:
            frappe.throw(_("The return's credit doesn't match its total. Nothing was saved."))
        _assert_matches(_("returned value"), returned, expected.get("returned"), precision, currency)

    result = {
        "return": {"name": return_doc.name, "doctype": return_doc.doctype, "returned": returned},
        "sale": None,
        "credit_left": credit,
        "replayed": replayed,
    }
    bearer = return_response.get("posa_bearer_voucher")
    if bearer:
        result["return"]["posa_bearer_voucher"] = bearer

    if sale_invoice is None:
        return result

    sale_total = flt(expected.get("sale_total"))
    if expected.get("sale_total") is None or sale_total < 0:
        frappe.throw(_("The till didn't send the new items total. Nothing was saved."))
    credit_used = _money(min(credit, sale_total), precision)
    if credit_used > 0:
        sale_data.update(
            {
                "customer_credit_redemption_requested": 1,
                "redeemed_customer_credit": credit_used,
                "customer_credit_dict": [
                    {
                        "type": "Invoice",
                        "credit_origin": return_doc.name,
                        "total_credit": credit,
                        "credit_to_redeem": credit_used,
                    }
                ],
            }
        )
    setattr(frappe.flags, CREDIT_ORIGIN_FLAG, return_doc.name)
    sale_response = creation.submit_invoice(json.dumps(sale_invoice), json.dumps(sale_data), 0)
    sale_doc = _submitted_doc(sale_response, _("sale"))
    sale_replayed = bool(sale_response.get("replayed"))

    if not sale_replayed:
        server_total = flt(sale_doc.rounded_total or sale_doc.grand_total)
        _assert_matches(_("new items total"), server_total, sale_total, precision, currency)
        _assert_matches(
            _("amount to pay"), max(server_total - credit_used, 0), expected.get("pay"), precision, currency
        )
        _assert_credit_posted(return_doc.name, sale_doc, credit_used, precision)
        sale_doc.reload()
        if abs(flt(sale_doc.outstanding_amount)) > 0.5 / (10**precision):
            frappe.throw(
                _("The new sale isn't fully paid ({0} outstanding). Nothing was saved.").format(
                    frappe.utils.fmt_money(sale_doc.outstanding_amount, precision, currency=currency)
                )
            )

    return_doc.reload()
    result["sale"] = {
        "name": sale_doc.name,
        "doctype": sale_doc.doctype,
        "total": _money(sale_doc.rounded_total or sale_doc.grand_total, precision),
        "credit_used": _money(sale_doc.get("posa_redeemed_customer_credit"), precision),
        "pay": _money(
            max(flt(sale_doc.rounded_total or sale_doc.grand_total) - flt(sale_doc.get("posa_redeemed_customer_credit")), 0),
            precision,
        ),
    }
    result["credit_left"] = _money(max(-flt(return_doc.outstanding_amount), 0), precision)
    result["replayed"] = replayed and sale_replayed
    return result


def _assert_credit_posted(return_name, sale_doc, credit_used, precision):
    """The credit Journal Entry was made in this request, for the full amount."""
    if credit_used <= 0:
        return
    from posawesome.posawesome.api.credit_voucher import credit_voucher_balance_use

    posted = flt(credit_voucher_balance_use(return_name, sale_doc.name), precision)
    if posted != flt(credit_used, precision):
        frappe.throw(_("The exchange credit wasn't applied to the new sale. Nothing was saved."))



def _resolve_receipt_name(text):
    """A scanned or typed receipt: its full name, or the number part a receipt
    in the default series prints as its barcode ("2026-00210"). None when
    there is no such Sales Invoice."""
    from posawesome.posawesome.api.invoice_naming import DEFAULT_SERIES
    from posawesome.posawesome.api.invoice_processing.returns import _NUMBER_PART

    value = cstr(text).strip().upper()
    if not value or len(value) > 140:
        return None
    candidates = [value]
    if _NUMBER_PART.match(value):
        candidates.insert(0, f"{DEFAULT_SERIES.split('.')[0]}{value}")
    for name in candidates:
        if frappe.db.exists("Sales Invoice", name):
            return name
    return None


@frappe.whitelist()
def get_exchange_receipt(receipt, pos_profile=None):
    """The picker's receipt: every line with what was sold, returned (when)
    and is left, or why the receipt can't be exchanged.

    {"found": 0} when the text isn't a receipt this till may see (the till then
    treats it as an item scan); {"found": 1, "error": message} when it can't
    be exchanged; otherwise the receipt."""
    from posawesome.posawesome.api.invoice_processing import creation
    from posawesome.posawesome.api.invoice_processing.utils import (
        _get_return_validity_settings,
        get_return_deadline,
    )

    profile_doc = creation._resolve_authorized_invoice_profile({"pos_profile": pos_profile})
    _assert_enabled(profile_doc)
    name = _resolve_receipt_name(receipt)
    if not name or not frappe.has_permission("Sales Invoice", "read", doc=name):
        return {"found": 0}
    original = _get_original(name)
    if cstr(original.company) != cstr(profile_doc.get("company")):
        return {"found": 0}
    problem = _original_problem(original, profile_doc.get("company"), profile_doc.get("name"))
    if problem:
        return {"found": 1, "name": name, "error": problem}

    head = frappe.db.get_value(
        "Sales Invoice", name, ["customer_name", "currency", "grand_total", "discount_amount"], as_dict=True
    )
    lines = _original_lines(name)
    returned = _returns_by_line(name, lines)
    barcodes = {}
    item_codes = list({line.item_code for line in lines})
    if item_codes:
        for row in frappe.get_all(
            "Item Barcode", filters={"parent": ["in", item_codes]}, fields=["parent", "barcode"]
        ):
            barcodes.setdefault(row.parent, []).append(row.barcode)
    enabled, days = _get_return_validity_settings(profile_doc.get("name"))
    out_lines = []
    for line in lines:
        info = returned[line.name]
        sold = flt(line.qty)
        out_lines.append(
            {
                "name": line.name,
                "idx": line.idx,
                "item_code": line.item_code,
                "item_name": line.item_name,
                "uom": line.uom,
                "barcodes": barcodes.get(line.item_code, []),
                "sold": sold,
                "returned": flt(info["returned"], 3),
                "left": max(flt(sold - info["returned"], 3), 0),
                "history": [
                    {"qty": flt(h["qty"], 3), "date": str(h["date"]), "name": h["name"]} for h in info["history"]
                ],
                "rate": flt(line.rate),
                "price_list_rate": flt(line.get("price_list_rate")),
                "discount_percentage": flt(line.get("discount_percentage")),
                "discount_amount": flt(line.get("discount_amount")),
                "discount_reason": line.get("posa_discount_reason"),
                "is_free_item": cint(line.get("is_free_item")),
            }
        )
    return {
        "found": 1,
        "name": name,
        "customer": original.customer,
        "customer_name": head.customer_name,
        "is_generic_customer": cint(frappe.db.get_value("Customer", original.customer, "posa_is_generic_customer")),
        "posting_date": str(original.posting_date),
        "returnable_until": str(get_return_deadline(original.posting_date, days)) if enabled else None,
        "currency": head.currency,
        "grand_total": flt(head.grand_total),
        "has_invoice_discount": 1 if flt(head.discount_amount) else 0,
        "lines": out_lines,
    }


QUOTE_SAVEPOINT = "posa_exchange_quote"


@frappe.whitelist(methods=["POST"])
def quote_exchange(return_invoice, sale_invoice=None):
    """The server's own figures for an exchange, without saving anything:
    both drafts are built exactly as submit will build them, inside a
    savepoint that is always rolled back. {"returned", "sale_total", "pay",
    "credit_left"}; the till shows these and sends them back as `expected`."""
    from posawesome.posawesome.api.invoice_processing import creation

    return_invoice = _loads(return_invoice)
    sale_invoice = _loads(sale_invoice) or None
    if not isinstance(return_invoice, dict):
        frappe.throw(_("The exchange has no return."))
    profile_doc = creation._resolve_authorized_invoice_profile(return_invoice)
    if sale_invoice is not None:
        sale_profile = creation._resolve_authorized_invoice_profile(sale_invoice)
        if sale_profile.get("name") != profile_doc.get("name"):
            frappe.throw(_("The return and the new items must be on the same till."))
    _assert_enabled(profile_doc)
    original = _check_return(return_invoice, {}, profile_doc)
    payload = _build_return(return_invoice, original, profile_doc)
    if sale_invoice is not None:
        _check_sale(sale_invoice, {}, payload, profile_doc)
        for key in ("posa_client_request_id", "_force_invoice_doctype"):
            sale_invoice.pop(key, None)
    payload.pop("posa_client_request_id", None)

    realtime_log = getattr(frappe.local, "_realtime_log", None)
    realtime_mark = len(realtime_log) if isinstance(realtime_log, list) else 0
    frappe.db.savepoint(QUOTE_SAVEPOINT)
    try:
        ret = creation.update_invoice(json.dumps(payload))
        return_doc = frappe.get_doc("Sales Invoice", ret.get("name"))
        precision = return_doc.precision("grand_total") or 2
        returned = _money(abs(flt(return_doc.rounded_total or return_doc.grand_total)), precision)
        result = {"returned": returned, "sale_total": None, "pay": None, "credit_left": returned}
        if sale_invoice is not None:
            sale = creation.update_invoice(json.dumps(sale_invoice))
            sale_doc = frappe.get_doc("Sales Invoice", sale.get("name"))
            sale_total = _money(sale_doc.rounded_total or sale_doc.grand_total, precision)
            used = min(returned, sale_total)
            result.update(
                {
                    "sale_total": sale_total,
                    "pay": _money(sale_total - used, precision),
                    "credit_left": _money(returned - used, precision),
                }
            )
    finally:
        try:
            frappe.db.rollback(save_point=QUOTE_SAVEPOINT)
        except Exception:
            frappe.db.rollback()
        # The rolled-back drafts queued "document changed" notifications for
        # after the commit; they never existed, so nobody is told.
        if isinstance(getattr(frappe.local, "_realtime_log", None), list):
            del frappe.local._realtime_log[realtime_mark:]
    return result


@frappe.whitelist(methods=["POST"])
def discard_exchange_draft(exchange_id, pos_profile=None):
    """A discarded exchange leaves nothing behind: deletes the exchange's own
    sale draft (saved when Pay opened Payments), whatever the profile's
    "Auto Delete Draft Invoice" setting says.

    Only that draft: an unsubmitted sale on this till's profile and company
    whose request key is exactly "<exchange id>:sale" -- the key the till
    stamps on the exchange's sale and submit_exchange submits it under.
    Never another draft, never a submitted or cancelled invoice, never a
    return. Returns {"deleted": [names]}."""
    from posawesome.posawesome.api.invoice import delete_invoice_submission_ledger_entries_for_invoice
    from posawesome.posawesome.api.invoice_processing import creation

    profile_doc = creation._resolve_authorized_invoice_profile({"pos_profile": pos_profile})
    _assert_enabled(profile_doc)
    key = f"{_exchange_id(exchange_id)}:sale"
    names = frappe.get_all(
        "Sales Invoice",
        filters={
            "posa_client_request_id": key,
            "docstatus": 0,
            "is_return": 0,
            "pos_profile": profile_doc.get("name"),
            "company": profile_doc.get("company"),
        },
        pluck="name",
    )
    for name in names:
        # The cashier has no delete right on Sales Invoice; the filters above
        # are the boundary.
        frappe.delete_doc("Sales Invoice", name, force=1, ignore_permissions=True)
        delete_invoice_submission_ledger_entries_for_invoice("Sales Invoice", name)
    return {"deleted": names}
