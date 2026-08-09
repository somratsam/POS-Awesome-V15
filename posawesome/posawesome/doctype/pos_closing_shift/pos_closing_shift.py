# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_cashiers,
    get_pos_invoices,
    get_payments_entries,
    get_shift_invoice_rows,
    get_same_shift_exchange_total,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.overview import (
    get_closing_shift_overview,
    get_payment_reconciliation_details,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
    make_closing_shift_from_opening,
    submit_closing_shift,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
    delete_draft_invoices,
    _set_closing_entry_invoices,
    _clear_closing_entry_invoices,
    consolidate_closing_shift_invoices,
)


class POSClosingShift(Document):
    def validate(self):
        user = frappe.get_all(
            "POS Closing Shift",
            filters={
                "user": self.user,
                "docstatus": 1,
                "pos_opening_shift": self.pos_opening_shift,
                "name": ["!=", self.name],
            },
        )

        if user:
            frappe.throw(
                _(
                    "POS Closing Shift {} against {} between selected period".format(
                        frappe.bold("already exists"), frappe.bold(self.user)
                    )
                ),
                title=_("Invalid Period"),
            )

        if frappe.db.get_value("POS Opening Shift", self.pos_opening_shift, "status") != "Open":
            frappe.throw(
                _("Selected POS Opening Shift should be open."),
                title=_("Invalid Opening Entry"),
            )
        self.update_payment_reconciliation()
        self.update_customer_credit_totals()
        self.update_same_shift_exchange_total()

    def update_payment_reconciliation(self):
        # update the difference values in Payment Reconciliation child table
        # get default precision for site
        precision = frappe.get_cached_value("System Settings", None, "currency_precision") or 3
        for d in self.payment_reconciliation:
            d.difference = +flt(d.closing_amount, precision) - flt(d.expected_amount, precision)

    def update_customer_credit_totals(self):
        # Credit Issued Today = abs(total of return invoices) for this shift.
        # Credit Redeemed Today = sum of posa_redeemed_customer_credit on
        # non-return invoices. Matches the figures already shown on the Z
        # Report print format.
        credit_issued = 0.0
        credit_redeemed = 0.0
        for row in get_shift_invoice_rows(self):
            conversion_rate = row.get("conversion_rate")
            if row.get("is_return"):
                credit_issued += abs(get_base_value(row, "grand_total", "base_grand_total", conversion_rate))
            else:
                credit_redeemed += get_base_value(
                    row,
                    "posa_redeemed_customer_credit",
                    conversion_rate=conversion_rate,
                )
        self.customer_credit_issued = flt(credit_issued)
        self.customer_credit_redeemed = flt(credit_redeemed)

    def update_same_shift_exchange_total(self):
        # "Exchanges Today": display-only breakdown of how much of
        # customer_credit_redeemed came from a customer who returned an item
        # and redeemed credit within this same shift (a genuine exchange),
        # as opposed to redeeming older, cross-visit credit. Deliberately a
        # separate, independent method -- does not feed into or get fed by
        # update_customer_credit_totals()'s own stored figures.
        self.same_shift_exchange_total = flt(
            get_same_shift_exchange_total(get_shift_invoice_rows(self))
        )

    def on_submit(self):
        opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
        opening_entry.pos_closing_shift = self.name
        opening_entry.set_status()
        self.delete_draft_invoices()
        opening_entry.save()
        # link invoices with this closing shift so ERPNext can block edits
        _set_closing_entry_invoices(self)
        consolidate_closing_shift_invoices(self)

    def on_cancel(self):
        if frappe.db.exists("POS Opening Shift", self.pos_opening_shift):
            opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
            if opening_entry.pos_closing_shift == self.name:
                opening_entry.pos_closing_shift = ""
                opening_entry.set_status()
                opening_entry.save()
        # remove links from invoices so they can be cancelled
        _clear_closing_entry_invoices(self)

    def delete_draft_invoices(self):
        delete_draft_invoices(self.pos_opening_shift, self.pos_profile)

    @frappe.whitelist()
    def get_payment_reconciliation_details(self):
        return get_payment_reconciliation_details(self)
