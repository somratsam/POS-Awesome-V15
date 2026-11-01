# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, flt
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.access import check_shift_close_allowed
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
    build_closing_shift,
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
        self.check_closer()
        self.refresh_expected_amounts()
        self.update_payment_reconciliation()
        self.check_closing_variance()
        self.update_customer_credit_totals()
        self.update_same_shift_exchange_total()

    def check_closer(self):
        # The same rule as the POS screen, for the Desk closing form too: only
        # the shift's own cashier, or a POS supervisor, may close it; the
        # company always follows the opening shift.
        if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
            return
        opening = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
        check_shift_close_allowed(opening, frappe.session.user)
        self.company = opening.company

    def refresh_expected_amounts(self):
        # The expected amounts always come from the shift's own records, never
        # from what the browser (or a Desk form) sent, so the variance check
        # below can't be dodged by editing them to match the count.
        if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
            return
        opening = frappe.get_doc("POS Opening Shift", self.pos_opening_shift).as_dict()
        fresh = {row.mode_of_payment: row for row in build_closing_shift(opening).payment_reconciliation}
        counted = {row.mode_of_payment: row for row in self.payment_reconciliation}
        for mode, row in fresh.items():
            if mode in counted:
                counted[mode].opening_amount = row.opening_amount
                counted[mode].expected_amount = row.expected_amount
            else:
                self.append(
                    "payment_reconciliation",
                    {
                        "mode_of_payment": mode,
                        "opening_amount": row.opening_amount,
                        "expected_amount": row.expected_amount,
                        "closing_amount": 0,
                    },
                )
        for mode, row in counted.items():
            if mode not in fresh:
                row.opening_amount = 0
                row.expected_amount = 0

    def check_closing_variance(self):
        # A payment method off by more than the POS Profile's tolerance (either
        # way) needs a reason, and a POS supervisor's approval when the profile
        # asks for it. The closing still records the real count.
        if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
            return
        profile = frappe.get_cached_doc("POS Profile", self.pos_profile)
        precision = cint(frappe.get_cached_value("System Settings", None, "currency_precision")) or 3
        tolerance = profile.get("posa_closing_variance_tolerance")
        tolerance = 0.5 if tolerance in (None, "") else flt(tolerance)
        factor = 10**precision
        off = [
            d.mode_of_payment
            for d in self.payment_reconciliation
            if round(abs(flt(d.difference)) * factor) > round(tolerance * factor)
        ]
        if not off:
            self.posa_variance_approved_by = None
            return
        if not cstr(self.posa_variance_reason).strip():
            frappe.throw(
                _(
                    "The closing amounts for {0} differ from the expected amounts by more than {1}. Enter a reason to close the shift."
                ).format(", ".join(off), frappe.format_value(tolerance, {"fieldtype": "Float", "precision": precision}))
            )
        if cint(profile.get("posa_closing_variance_needs_supervisor")):
            self.posa_variance_approved_by = closing_variance_approver(self.pos_profile)
        else:
            self.posa_variance_approved_by = None

    def update_payment_reconciliation(self):
        # update the difference values in Payment Reconciliation child table
        # get default precision for site
        precision = frappe.get_cached_value("System Settings", None, "currency_precision") or 3
        for d in self.payment_reconciliation:
            # A closing amount left empty is 0, never blank or null.
            d.closing_amount = flt(d.closing_amount, precision)
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
            get_same_shift_exchange_total(get_shift_invoice_rows(self), self.pos_opening_shift)
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


def closing_variance_approver(pos_profile):
    """The POS supervisor approving an over-tolerance closing: the signed-in
    user, or the terminal's active cashier (switched to by PIN) -- the same
    rule as a below-cost sale override."""
    from posawesome.posawesome.api.employees import _get_user_doc, _is_pos_supervisor
    from posawesome.posawesome.api.terminal_state import get_active_terminal_cashier

    session_user = frappe.session.user
    if _is_pos_supervisor(_get_user_doc(session_user)):
        return session_user
    try:
        cashier = get_active_terminal_cashier(pos_profile)
    except frappe.PermissionError:
        # Locked terminal / no PIN cashier: no supervisor is switched in.
        frappe.clear_last_message()
        cashier = None
    if cashier and _is_pos_supervisor(_get_user_doc(cashier)):
        return cashier
    frappe.throw(
        _(
            "A POS supervisor must approve this closing because it differs from the expected amounts. Switch to a POS supervisor, then close the shift again."
        ),
        frappe.PermissionError,
    )
