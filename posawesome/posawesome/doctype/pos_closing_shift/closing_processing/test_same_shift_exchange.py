import unittest

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_same_shift_exchange_total,
)


class TestSameShiftExchangeTotal(unittest.TestCase):
    """Exercises only get_same_shift_exchange_total()'s own summing logic,
    with `returning_customers` passed in directly so no live database is
    needed -- the "which customers had a same-shift return" question
    itself is now delegated to get_customers_with_same_shift_return()
    (posawesome/posawesome/api/credit_exchange.py), covered separately by
    api/test_credit_exchange.py's real-database tests (run via
    `bench execute ...run_site_assertions`, same pattern as the
    submission-ledger tests) since it needs a real Sales Invoice/POS
    Opening Shift to query against."""

    def test_sums_redemptions_from_customers_who_also_returned_this_shift(self):
        rows = [
            {"name": "SINV-1", "customer": "Anonymous", "is_return": 1, "posa_redeemed_customer_credit": 0},
            {"name": "SINV-2", "customer": "Anonymous", "is_return": 0, "posa_redeemed_customer_credit": 139.3},
            {"name": "SINV-3", "customer": "SomeoneElse", "is_return": 0, "posa_redeemed_customer_credit": 50},
        ]

        self.assertEqual(
            get_same_shift_exchange_total(rows, "SHIFT-1", returning_customers=["Anonymous"]),
            139.3,
        )

    def test_zero_when_no_returns_in_shift(self):
        rows = [
            {"name": "SINV-1", "customer": "A", "is_return": 0, "posa_redeemed_customer_credit": 40},
        ]

        self.assertEqual(
            get_same_shift_exchange_total(rows, "SHIFT-1", returning_customers=[]), 0.0
        )

    def test_zero_when_return_belongs_to_a_different_customer(self):
        rows = [
            {"name": "SINV-1", "customer": "A", "is_return": 1, "posa_redeemed_customer_credit": 0},
            {"name": "SINV-2", "customer": "B", "is_return": 0, "posa_redeemed_customer_credit": 40},
        ]

        self.assertEqual(
            get_same_shift_exchange_total(rows, "SHIFT-1", returning_customers=["A"]), 0.0
        )

    def test_sums_across_multiple_customers_independently(self):
        rows = [
            {"name": "SINV-1", "customer": "A", "is_return": 1, "posa_redeemed_customer_credit": 0},
            {"name": "SINV-2", "customer": "A", "is_return": 0, "posa_redeemed_customer_credit": 139.3},
            {"name": "SINV-3", "customer": "B", "is_return": 1, "posa_redeemed_customer_credit": 0},
            {"name": "SINV-4", "customer": "B", "is_return": 0, "posa_redeemed_customer_credit": 172.5},
        ]

        self.assertEqual(
            get_same_shift_exchange_total(rows, "SHIFT-1", returning_customers=["A", "B"]),
            311.8,
        )

    def test_ignores_returning_customer_invoice_with_no_redemption(self):
        rows = [
            {"name": "SINV-1", "customer": "A", "is_return": 1, "posa_redeemed_customer_credit": 0},
            {"name": "SINV-2", "customer": "A", "is_return": 0, "posa_redeemed_customer_credit": 0},
        ]

        self.assertEqual(
            get_same_shift_exchange_total(rows, "SHIFT-1", returning_customers=["A"]), 0.0
        )


if __name__ == "__main__":
    unittest.main()
