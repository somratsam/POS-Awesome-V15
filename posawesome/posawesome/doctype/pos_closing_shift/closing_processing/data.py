import frappe
from frappe.utils import cint
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


@frappe.whitelist()
def get_pos_invoices(pos_opening_shift, doctype=None, submit_printed=1):
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
    names_by_doctype = {"Sales Invoice": [], "POS Invoice": []}
    for row in closing_shift_doc.get("pos_transactions") or []:
        if row.get("sales_invoice"):
            names_by_doctype["Sales Invoice"].append(row.get("sales_invoice"))
        elif row.get("pos_invoice"):
            names_by_doctype["POS Invoice"].append(row.get("pos_invoice"))

    fields = [
        "name",
        "is_return",
        "grand_total",
        "base_grand_total",
        "conversion_rate",
        "total_qty",
        "discount_amount",
        "base_discount_amount",
        "posa_redeemed_customer_credit",
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


@frappe.whitelist()
def get_payments_entries(pos_opening_shift):
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
