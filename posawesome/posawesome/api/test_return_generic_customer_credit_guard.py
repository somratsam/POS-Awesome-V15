import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api.invoice_processing.creation import (
    _guard_generic_customer_stored_credit,
)


def _return_invoice_doc(**overrides):
    """An unsaved Sales Invoice doc -- enough to exercise precision() and
    field access without touching the database."""
    data = {
        "doctype": "Sales Invoice",
        "is_return": 1,
        "customer": "Anonymous",
        "return_against": "SINV-0001",
        "paid_amount": 0,
        "grand_total": -100,
        "rounded_total": -100,
    }
    data.update(overrides)
    return frappe.get_doc(data)


class TestGenericCustomerStoredCreditGuard(unittest.TestCase):
    def test_noop_for_non_return_invoice(self):
        doc = _return_invoice_doc(is_return=0)
        with patch("frappe.db.get_value") as mocked:
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
            mocked.assert_not_called()

    def test_noop_during_draft_save_even_if_it_would_leave_credit_on_a_generic_customer(self):
        # enforce_credit_only_policy=False mirrors update_invoice's draft-save/
        # cart-building calls, where amounts aren't final yet.
        doc = _return_invoice_doc(paid_amount=0)
        with patch("frappe.db.get_value") as mocked:
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=False)
            mocked.assert_not_called()

    def test_blocks_return_without_invoice_leaving_credit_on_a_generic_customer(self):
        # "Return without Invoice" to Anonymous: nothing ties it to a sale, so
        # its credit must go to a real customer -- no bearer voucher.
        doc = _return_invoice_doc(return_against=None, paid_amount=0)
        with patch("frappe.db.get_value", return_value=1):
            with self.assertRaises(Exception) as ctx:
                _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
        message = str(ctx.exception)
        self.assertIn("without an invoice", message)
        self.assertIn("Anonymous", message)

    def test_return_without_invoice_to_a_real_customer_is_unaffected(self):
        doc = _return_invoice_doc(return_against=None, customer="Real Customer", paid_amount=0)
        with patch("frappe.db.get_value", return_value=0):
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)

    def test_noop_when_fully_refunded_in_cash(self):
        # No credit left behind, so who the customer is doesn't matter here.
        doc = _return_invoice_doc(paid_amount=-100, grand_total=-100, rounded_total=-100)
        with patch("frappe.db.get_value", return_value=1) as mocked:
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
        mocked.assert_not_called()

    def test_noop_when_customer_is_not_generic(self):
        doc = _return_invoice_doc(customer="Real Customer", paid_amount=0)
        with patch("frappe.db.get_value", return_value=0) as mocked:
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
        mocked.assert_called_once_with("Customer", "Real Customer", "posa_is_generic_customer")

    def test_linked_return_with_no_refund_is_allowed_as_a_bearer_voucher(self):
        doc = _return_invoice_doc(customer="Anonymous", paid_amount=0)
        with patch("frappe.db.get_value", return_value=1):
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)

    def test_blocks_partial_refund_that_still_leaves_credit_on_a_generic_customer(self):
        # Part refund + part credit: no voucher would print for the credit.
        doc = _return_invoice_doc(customer="Anonymous", paid_amount=-40, grand_total=-100, rounded_total=-100)
        with patch("frappe.db.get_value", return_value=1):
            with self.assertRaises(Exception) as ctx:
                _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
        self.assertIn("in full or not at all", str(ctx.exception))

    def test_boundary_refund_within_tolerance_of_full_amount_is_not_blocked(self):
        # 99.999 vs 100 rounded_total, within a 2-decimal tolerance of "fully paid".
        doc = _return_invoice_doc(
            customer="Anonymous", paid_amount=-99.999, grand_total=-100, rounded_total=-100
        )
        with patch("frappe.db.get_value", return_value=1) as mocked:
            _guard_generic_customer_stored_credit(doc, enforce_credit_only_policy=True)
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
