import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from posawesome.posawesome.api.submitted_invoice_edits import _apply_credit_exchange_badges


class TestApplyCreditExchangeBadges(FrappeTestCase):
    """Tests _apply_credit_exchange_badges()'s own glue logic (return-row
    short-circuit, batching redemption rows by shift, mapping the shared
    function's result back onto each row) with
    get_customers_with_same_shift_return() mocked out -- the real,
    database-backed behavior of that shared function itself is covered by
    api/test_credit_exchange.py. No real invoices/shifts are needed here."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")

    def test_a_return_row_is_always_credit_note_without_calling_the_shared_function(self):
        rows = [{"name": "SINV-1", "customer": "A", "is_return": 1}]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return"
        ) as mocked:
            _apply_credit_exchange_badges(rows)

        self.assertEqual(rows[0]["exchange_credit_badge"], "Credit Note")
        mocked.assert_not_called()

    def test_a_redemption_row_is_exchange_when_the_shared_function_confirms_it(self):
        rows = [
            {
                "name": "SINV-2",
                "customer": "A",
                "is_return": 0,
                "posa_redeemed_customer_credit": 40,
                "posa_pos_opening_shift": "SHIFT-1",
            }
        ]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return",
            return_value=["A"],
        ) as mocked:
            _apply_credit_exchange_badges(rows)

        self.assertEqual(rows[0]["exchange_credit_badge"], "Exchange")
        mocked.assert_called_once_with(["A"], "SHIFT-1")

    def test_a_redemption_row_is_credit_note_when_the_shared_function_finds_no_same_shift_return(self):
        rows = [
            {
                "name": "SINV-3",
                "customer": "A",
                "is_return": 0,
                "posa_redeemed_customer_credit": 40,
                "posa_pos_opening_shift": "SHIFT-1",
            }
        ]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return",
            return_value=[],
        ):
            _apply_credit_exchange_badges(rows)

        self.assertEqual(rows[0]["exchange_credit_badge"], "Credit Note")

    def test_a_row_with_no_return_and_no_redemption_gets_no_badge(self):
        rows = [{"name": "SINV-4", "customer": "A", "is_return": 0, "posa_redeemed_customer_credit": 0}]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return"
        ) as mocked:
            _apply_credit_exchange_badges(rows)

        self.assertIsNone(rows[0]["exchange_credit_badge"])
        mocked.assert_not_called()

    def test_rows_from_different_shifts_are_batched_into_separate_calls(self):
        rows = [
            {
                "name": "SINV-5",
                "customer": "A",
                "is_return": 0,
                "posa_redeemed_customer_credit": 10,
                "posa_pos_opening_shift": "SHIFT-1",
            },
            {
                "name": "SINV-6",
                "customer": "B",
                "is_return": 0,
                "posa_redeemed_customer_credit": 20,
                "posa_pos_opening_shift": "SHIFT-2",
            },
        ]

        def fake(customers, shift):
            return customers if shift == "SHIFT-1" else []

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return",
            side_effect=fake,
        ) as mocked:
            _apply_credit_exchange_badges(rows)

        self.assertEqual(rows[0]["exchange_credit_badge"], "Exchange")
        self.assertEqual(rows[1]["exchange_credit_badge"], "Credit Note")
        self.assertEqual(mocked.call_count, 2)

    def test_rows_from_the_same_shift_are_batched_into_one_call(self):
        rows = [
            {
                "name": "SINV-7",
                "customer": "A",
                "is_return": 0,
                "posa_redeemed_customer_credit": 10,
                "posa_pos_opening_shift": "SHIFT-1",
            },
            {
                "name": "SINV-8",
                "customer": "B",
                "is_return": 0,
                "posa_redeemed_customer_credit": 20,
                "posa_pos_opening_shift": "SHIFT-1",
            },
        ]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return",
            return_value=["A", "B"],
        ) as mocked:
            _apply_credit_exchange_badges(rows)

        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(rows[0]["exchange_credit_badge"], "Exchange")
        self.assertEqual(rows[1]["exchange_credit_badge"], "Exchange")

    def test_an_authorization_failure_for_one_shift_falls_back_to_credit_note_without_raising(self):
        rows = [
            {
                "name": "SINV-9",
                "customer": "A",
                "is_return": 0,
                "posa_redeemed_customer_credit": 10,
                "posa_pos_opening_shift": "SHIFT-UNAUTHORIZED",
            }
        ]

        with patch(
            "posawesome.posawesome.api.credit_exchange.get_customers_with_same_shift_return",
            side_effect=frappe.PermissionError("not authorized for this profile"),
        ):
            _apply_credit_exchange_badges(rows)

        self.assertEqual(rows[0]["exchange_credit_badge"], "Credit Note")


def run_site_assertions():
    """Run the focused assertions without ERPNext's global test-record
    bootstrap, matching the sibling pattern in
    pos_invoice_submission_ledger/test_pos_invoice_submission_ledger.py."""

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestApplyCreditExchangeBadges)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise AssertionError(
            f"Credit-exchange badge assertions failed: {len(result.failures)} failures, "
            f"{len(result.errors)} errors"
        )
    return {"tests_run": result.testsRun, "skipped": len(result.skipped)}
