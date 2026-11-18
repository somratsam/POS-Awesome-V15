import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate
from posawesome.posawesome.api.credit_exchange import get_exchange_credit_by_sale
from posawesome.posawesome.api.pos_access import get_authorized_pos_profile
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.access import authorize_shift_close
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
)


@frappe.whitelist()
def get_cashiers(doctype, txt, searchfield, start, page_len, filters):
    cashiers_list = frappe.get_all("POS Profile User", filters=filters, fields=["user"])
    result = []
    for cashier in cashiers_list:
        user_email = frappe.get_value("User", cashier.user, "email")
        if user_email:
            # Return list of tuples in format (value, label) where value is user ID and label shows both ID and email
            result.append([cashier.user, f"{cashier.user} ({user_email})"])
    return result


SHIFT_INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")


@frappe.whitelist()
def get_pos_invoices(pos_opening_shift, doctype=None, submit_printed=1):
    """Desk closing form: the shift's submitted invoices, for someone allowed to close it."""
    opening = authorize_shift_close(pos_opening_shift)
    return fetch_shift_invoices(opening.name, doctype, submit_printed)


def fetch_shift_invoices(pos_opening_shift, doctype=None, submit_printed=1):
    """The shift's submitted invoices. No permission check -- callers authorize."""
    if doctype and doctype not in SHIFT_INVOICE_DOCTYPES:
        frappe.throw(_("Invoice type must be Sales Invoice or POS Invoice."))
    if not doctype:
        pos_profile = frappe.db.get_value("POS Opening Shift", pos_opening_shift, "pos_profile")
        use_pos_invoice = frappe.db.get_value(
            "POS Profile",
            pos_profile,
            "create_pos_invoice_instead_of_sales_invoice",
        )
        doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"
    if cint(submit_printed):
        submit_printed_invoices(pos_opening_shift, doctype)
    cond = " and ifnull(consolidated_invoice,'') = ''" if doctype == "POS Invoice" else ""
    data = frappe.db.sql(
        f"""
	select
		name
	from
		`tab{doctype}`
	where
		docstatus = 1 and posa_pos_opening_shift = %s{cond}
	""",
        (pos_opening_shift),
        as_dict=1,
    )

    data = [frappe.get_doc(doctype, d.name).as_dict() for d in data]

    return data


def _shift_invoice_names_by_doctype(closing_shift_doc):
    names_by_doctype = {"Sales Invoice": [], "POS Invoice": []}
    for row in closing_shift_doc.get("pos_transactions") or []:
        if row.get("sales_invoice"):
            names_by_doctype["Sales Invoice"].append(row.get("sales_invoice"))
        elif row.get("pos_invoice"):
            names_by_doctype["POS Invoice"].append(row.get("pos_invoice"))
    return names_by_doctype


def get_shift_line_discount_totals(closing_shift_doc):
    """{invoice name: sum of its item-line discounts} in invoice currency.

    A line's discount_amount is per unit, so each line contributes
    discount_amount x qty. Only positive discounts count (a rate set above
    the price list leaves a negative discount_amount, which isn't a
    discount granted).
    """
    totals = {}
    for doctype, names in _shift_invoice_names_by_doctype(closing_shift_doc).items():
        if not names:
            continue
        for line in frappe.get_all(
            f"{doctype} Item",
            filters={"parent": ["in", names], "discount_amount": [">", 0]},
            fields=["parent", "qty", "discount_amount"],
        ):
            totals[line.parent] = totals.get(line.parent, 0.0) + flt(line.discount_amount) * abs(flt(line.qty))
    return totals


def get_shift_invoice_rows(closing_shift_doc):
    """Return invoice rows (is_return, grand_total, customer credit redeemed)
    for every invoice already linked to a closing shift's pos_transactions
    child table.

    Reads the invoice list from pos_transactions rather than re-querying by
    posa_pos_opening_shift like get_pos_invoices() does: a fresh POS Invoice
    query would incorrectly return zero rows post-close, since
    consolidate_closing_shift_invoices() (on_submit) sets consolidated_invoice
    on every invoice in the shift, and get_pos_invoices()'s own filter
    excludes consolidated POS Invoices.
    """
    names_by_doctype = _shift_invoice_names_by_doctype(closing_shift_doc)

    fields = [
        "name",
        "customer",
        "is_return",
        "grand_total",
        "base_grand_total",
        "net_total",
        "base_net_total",
        "conversion_rate",
        "total_qty",
        "discount_amount",
        "base_discount_amount",
        "posa_redeemed_customer_credit",
        "total_taxes_and_charges",
        "base_total_taxes_and_charges",
        "change_amount",
    ]

    rows = []
    for doctype, names in names_by_doctype.items():
        if not names:
            continue
        rows.extend(
            frappe.get_all(
                doctype,
                filters={"name": ["in", names]},
                fields=fields,
            )
        )
    return rows


def get_same_shift_exchange_total(invoice_rows, pos_opening_shift, exchange_credit_by_sale=None):
    """The Closing Shift's "Exchanges Today" (field same_shift_exchange_total):
    the credit the shift's sales used from returns made in the same shift,
    found through the credit Journal Entries (credit_exchange
    .get_exchange_credit_by_sale) -- the same figure as the Z Report and the
    Overview. Credit from older credit notes is not counted.

    exchange_credit_by_sale: optionally passed in (tests); otherwise read.
    Display-only: does not feed update_customer_credit_totals() or any other
    stored accounting figure.
    """
    sales = [row.get("name") for row in invoice_rows if row.get("name") and not row.get("is_return")]
    if exchange_credit_by_sale is None:
        exchange_credit_by_sale = get_exchange_credit_by_sale(sales) if sales and pos_opening_shift else {}
    return sum(flt(exchange_credit_by_sale.get(name)) for name in sales)


def get_payment_mode_counts(
    sale_invoice_names, return_invoice_names, change_by_invoice=None, cash_mode_of_payment=None
):
    """Return per-mode-of-payment transaction counts and totals, split by
    sale vs return invoices, for the given invoice name lists.

    Sales Invoice and POS Invoice both use the "Sales Invoice Payment" child
    doctype for their payments table, so a single query covers both. There is
    no stored field anywhere with these counts (the pos_payments child table
    on POS Closing Shift tracks a separate Payment Entry flow this app
    doesn't use for normal sales, and is empty in practice) -- this is a
    genuinely new query, not a duplicate of anything already computed.
    """
    result = {}

    def accumulate(names, sales_key, count_key, is_return):
        if not names:
            return
        condition = "amount < 0" if is_return else "amount > 0"
        rows = frappe.db.sql(
            f"""
            select mode_of_payment, count(*) as cnt, sum(amount) as total
            from `tabSales Invoice Payment`
            where parent in %(names)s and {condition}
            group by mode_of_payment
            """,
            {"names": tuple(names)},
            as_dict=1,
        )
        for row in rows:
            entry = result.setdefault(
                row.mode_of_payment,
                {"sale_count": 0, "sale_total": 0.0, "return_count": 0, "return_total": 0.0},
            )
            entry[count_key] = row.cnt or 0
            entry[sales_key] = frappe.utils.flt(row.total)

    accumulate(sale_invoice_names, "sale_total", "sale_count", is_return=False)
    accumulate(return_invoice_names, "return_total", "return_count", is_return=True)

    # Cash is net of the change handed back, as in Payment Reconciliation and
    # the ledger: a payment row holds what was tendered. Only for invoices
    # with a cash row -- change with no cash row isn't taken off anything.
    with_change = {name: flt(change) for name, change in (change_by_invoice or {}).items() if flt(change)}
    if with_change and cash_mode_of_payment and cash_mode_of_payment in result:
        with_cash_row = frappe.db.sql(
            """
            select distinct parent
            from `tabSales Invoice Payment`
            where parent in %(names)s and mode_of_payment = %(mode)s and amount > 0
            """,
            {"names": tuple(with_change), "mode": cash_mode_of_payment},
            pluck=True,
        )
        result[cash_mode_of_payment]["sale_total"] -= sum(with_change[name] for name in with_cash_row)

    return result


@frappe.whitelist()
def get_payments_entries(pos_opening_shift):
    """Desk closing form: the shift's Payment Entries, for someone allowed to close it."""
    opening = authorize_shift_close(pos_opening_shift)
    return fetch_shift_payment_entries(opening.name)


def fetch_shift_payment_entries(pos_opening_shift):
    """The shift's Payment Entries. No permission check -- callers authorize."""
    return frappe.get_all(
        "Payment Entry",
        filters={
            "docstatus": 1,
            "reference_no": pos_opening_shift,
            "payment_type": ["in", ["Receive", "Pay"]],
        },
        fields=[
            "name",
            "mode_of_payment",
            "paid_amount",
            "base_paid_amount",
            "paid_from_account_currency",
            "paid_to_account_currency",
            "target_exchange_rate",
            "reference_no",
            "posting_date",
            "party_type",
            "party",
            "payment_type",
        ],
    )


@frappe.whitelist()
def list_closing_shifts(pos_profile=None, search=None, from_date=None, to_date=None, limit=50):
    """Return submitted POS Closing Shift records for the Z Report lookup/reprint
    screen, scoped to the caller's authorized POS Profile.

    pos_profile is only a hint for resolving that authorization -- it is never
    trusted directly. get_authorized_pos_profile() re-validates the requesting
    user actually has access to whichever profile it resolves to (assigned via
    POS Profile User, or a profile-manager role) and throws otherwise, so there
    is no path to seeing another store's shifts by passing a different name.
    """
    profile_doc = get_authorized_pos_profile(pos_profile)

    filters = {
        "docstatus": 1,
        "pos_profile": profile_doc.name,
    }
    if from_date and to_date:
        filters["posting_date"] = ["between", [getdate(from_date), getdate(to_date)]]
    elif from_date:
        filters["posting_date"] = [">=", getdate(from_date)]
    elif to_date:
        filters["posting_date"] = ["<=", getdate(to_date)]

    or_filters = None
    search = cstr(search).strip()
    if search:
        or_filters = [["name", "like", f"%{search}%"]]

    return frappe.get_all(
        "POS Closing Shift",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "posting_date",
            "period_end_date",
            "user",
            "grand_total",
            "customer_credit_issued",
            "customer_credit_redeemed",
        ],
        order_by="posting_date desc, period_end_date desc",
        limit_page_length=max(1, min(cint(limit) or 50, 200)),
    )
