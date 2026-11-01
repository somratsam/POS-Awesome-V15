import frappe
from frappe import _
from frappe.utils import flt, json
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.access import authorize_shift_close
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    fetch_shift_invoices,
    fetch_shift_payment_entries,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
)


def build_pos_payment_reference(payment_entry):
    party_type = payment_entry.get("party_type")
    party = payment_entry.get("party")
    row = frappe._dict(
        {
            "payment_entry": payment_entry.name,
            "mode_of_payment": payment_entry.mode_of_payment,
            "paid_amount": payment_entry.paid_amount,
            "posting_date": payment_entry.posting_date,
            "party_type": party_type,
            "party": party,
        }
    )

    if party_type == "Customer":
        row.customer = party

    return row


def _get_payment_entry_party(payment_entry):
    if not payment_entry:
        return {}

    return (
        frappe.db.get_value(
            "Payment Entry",
            payment_entry,
            ["party_type", "party"],
            as_dict=True,
        )
        or {}
    )


def _is_legacy_customer_required():
    customer_field = frappe.get_meta("POS Payment Entry Reference").get_field("customer")
    return bool(customer_field and customer_field.reqd)


def normalize_pos_payment_references(closing_shift_doc):
    has_non_customer_payment = False

    for row in closing_shift_doc.get("pos_payments", []):
        party_type = row.get("party_type")
        party = row.get("party")

        if row.get("payment_entry") and (not party_type or not party):
            payment_party = _get_payment_entry_party(row.get("payment_entry"))
            party_type = party_type or payment_party.get("party_type")
            party = party or payment_party.get("party")
            row.party_type = party_type
            row.party = party

        if party_type == "Customer":
            if party and not row.get("customer"):
                row.customer = party
            continue

        has_non_customer_payment = True
        if row.get("customer"):
            row.customer = None

    if has_non_customer_payment and _is_legacy_customer_required():
        closing_shift_doc.flags.ignore_mandatory = True


@frappe.whitelist()
def make_closing_shift_from_opening(opening_shift):
    # Only the shift's name is taken from the browser; the closing is built
    # from the stored opening shift (its user, profile and opening amounts).
    try:
        sent = json.loads(opening_shift)
    except (TypeError, ValueError):
        sent = opening_shift
    opening_shift = authorize_shift_close(sent).as_dict()
    skipped_printed_invoices = submit_printed_invoices(
        opening_shift.get("name"), _shift_invoice_doctype(opening_shift)
    )
    return {
        "closing_shift": build_closing_shift(opening_shift),
        "skipped_printed_invoices": skipped_printed_invoices,
    }


def _shift_invoice_doctype(opening_shift):
    use_pos_invoice = frappe.db.get_value(
        "POS Profile",
        opening_shift.get("pos_profile"),
        "create_pos_invoice_instead_of_sales_invoice",
    )
    return "POS Invoice" if use_pos_invoice else "Sales Invoice"


def build_closing_shift(opening_shift):
    """An unsaved POS Closing Shift for `opening_shift` (a dict of the stored
    opening shift), with the expected amounts worked out from the shift's own
    invoices, Payment Entries and cash movements. No side effects, so the
    server can rebuild it at submit time instead of trusting the browser's
    expected figures."""
    doctype = _shift_invoice_doctype(opening_shift)
    closing_shift = frappe.new_doc("POS Closing Shift")
    closing_shift.pos_opening_shift = opening_shift.get("name")
    closing_shift.period_start_date = opening_shift.get("period_start_date")
    closing_shift.period_end_date = frappe.utils.get_datetime()
    closing_shift.pos_profile = opening_shift.get("pos_profile")
    closing_shift.user = opening_shift.get("user")
    closing_shift.company = opening_shift.get("company")
    closing_shift.grand_total = 0
    closing_shift.net_total = 0
    closing_shift.total_quantity = 0

    company_currency = frappe.get_cached_value("Company", closing_shift.company, "default_currency")
    cash_mode_of_payment = (
        frappe.get_value(
            "POS Profile",
            opening_shift.get("pos_profile"),
            "posa_cash_mode_of_payment",
        )
        or "Cash"
    )

    invoices = fetch_shift_invoices(opening_shift.get("name"), doctype, submit_printed=0)

    pos_transactions = []
    taxes = []
    payments = []
    pos_payments_table = []
    for detail in opening_shift.get("balance_details"):
        payments.append(
            frappe._dict(
                {
                    "mode_of_payment": detail.get("mode_of_payment"),
                    "opening_amount": detail.get("amount") or 0,
                    "expected_amount": detail.get("amount") or 0,
                }
            )
        )

    invoice_field = "pos_invoice" if doctype == "POS Invoice" else "sales_invoice"

    for d in invoices:
        conversion_rate = d.get("conversion_rate")
        pos_transactions.append(
            frappe._dict(
                {
                    invoice_field: d.name,
                    "posting_date": d.posting_date,
                    "grand_total": get_base_value(d, "grand_total", "base_grand_total", conversion_rate),
                    "transaction_currency": d.get("currency") or company_currency,
                    "transaction_amount": flt(d.get("grand_total")),
                    "customer": d.customer,
                }
            )
        )
        base_grand_total = get_base_value(d, "grand_total", "base_grand_total", conversion_rate)
        base_net_total = get_base_value(d, "net_total", "base_net_total", conversion_rate)
        closing_shift.grand_total += base_grand_total
        closing_shift.net_total += base_net_total
        closing_shift.total_quantity += flt(d.total_qty)

        for t in d.taxes:
            existing_tax = [tx for tx in taxes if tx.account_head == t.account_head and tx.rate == t.rate]
            if existing_tax:
                existing_tax[0].amount += get_base_value(
                    t, "tax_amount", "base_tax_amount", d.get("conversion_rate")
                )
            else:
                taxes.append(
                    frappe._dict(
                        {
                            "account_head": t.account_head,
                            "rate": t.rate,
                            "amount": get_base_value(
                                t, "tax_amount", "base_tax_amount", d.get("conversion_rate")
                            ),
                        }
                    )
                )

        for p in d.payments:
            existing_pay = [pay for pay in payments if pay.mode_of_payment == p.mode_of_payment]
            if existing_pay:
                conversion_rate = d.get("conversion_rate")
                if existing_pay[0].mode_of_payment == cash_mode_of_payment:
                    amount = get_base_value(p, "amount", "base_amount", conversion_rate) - get_base_value(
                        d, "change_amount", "base_change_amount", conversion_rate
                    )
                else:
                    amount = get_base_value(p, "amount", "base_amount", conversion_rate)
                existing_pay[0].expected_amount += flt(amount)
            else:
                payments.append(
                    frappe._dict(
                        {
                            "mode_of_payment": p.mode_of_payment,
                            "opening_amount": 0,
                            "expected_amount": get_base_value(
                                p, "amount", "base_amount", d.get("conversion_rate")
                            ),
                        }
                    )
                )

    pos_payments = fetch_shift_payment_entries(opening_shift.get("name"))

    for py in pos_payments:
        pos_payments_table.append(build_pos_payment_reference(py))
        existing_pay = [pay for pay in payments if pay.mode_of_payment == py.mode_of_payment]
        multiplier = -1 if py.payment_type == "Pay" else 1
        signed_amount = multiplier * abs(get_base_value(py, "paid_amount", "base_paid_amount"))
        if existing_pay:
            existing_pay[0].expected_amount += signed_amount
        else:
            payments.append(
                frappe._dict(
                    {
                        "mode_of_payment": py.mode_of_payment,
                        "opening_amount": 0,
                        "expected_amount": signed_amount,
                    }
                )
            )

    cash_movements = frappe.get_all(
        "POS Cash Movement",
        filters={"pos_opening_shift": opening_shift.get("name"), "docstatus": 1},
        fields=["amount"],
    )
    cash_movement_total = sum(flt(row.get("amount")) for row in cash_movements)
    if cash_movement_total:
        existing_cash = [pay for pay in payments if pay.mode_of_payment == cash_mode_of_payment]
        if existing_cash:
            existing_cash[0].expected_amount -= cash_movement_total
        else:
            payments.append(
                frappe._dict(
                    {
                        "mode_of_payment": cash_mode_of_payment,
                        "opening_amount": 0,
                        "expected_amount": -cash_movement_total,
                    }
                )
            )

    closing_shift.set("pos_transactions", pos_transactions)
    closing_shift.set("payment_reconciliation", payments)
    closing_shift.set("taxes", taxes)
    closing_shift.set("pos_payments", pos_payments_table)

    return closing_shift


@frappe.whitelist()
def submit_closing_shift(closing_shift):
    closing_shift = json.loads(closing_shift)
    opening = authorize_shift_close(closing_shift.get("pos_opening_shift"))
    # Who and which store the closing is for always come from the opening shift.
    closing_shift.update(
        {
            "doctype": "POS Closing Shift",
            "pos_opening_shift": opening.name,
            "user": opening.user,
            "pos_profile": opening.pos_profile,
            "company": opening.company,
        }
    )
    existing = closing_shift.get("name") and frappe.db.get_value(
        "POS Closing Shift", closing_shift.get("name"), ["pos_opening_shift", "docstatus"], as_dict=True
    )
    if existing and (existing.pos_opening_shift != opening.name or existing.docstatus != 0):
        frappe.throw(_("This closing doesn't belong to the shift being closed."), frappe.PermissionError)
    closing_shift_doc = frappe.get_doc(closing_shift)
    closing_shift_doc.flags.ignore_permissions = True
    normalize_pos_payment_references(closing_shift_doc)
    closing_shift_doc.save()
    closing_shift_doc.submit()
    return closing_shift_doc.name
