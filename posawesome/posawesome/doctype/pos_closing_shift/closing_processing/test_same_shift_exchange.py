import unittest

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_same_shift_exchange_total,
)


class TestSameShiftExchangeTotal(unittest.TestCase):
    """The Closing Shift's "Exchanges Today": the summing over the
    shift's sales, with the credit each one used from same-shift returns
    passed in. The link itself (credit Journal Entries, same shift) is
    credit_exchange.get_exchange_credit_by_sale, tested on real invoices in
    api/test_exchange_links_db."""

    rows = [
        {"name": "SINV-1", "customer": "Anonymous", "is_return": 1},
        {"name": "SINV-2", "customer": "Anonymous", "is_return": 0, "posa_redeemed_customer_credit": 139.3},
        {"name": "SINV-3", "customer": "Anonymous", "is_return": 0, "posa_redeemed_customer_credit": 50},
    ]

    def test_counts_only_credit_from_same_shift_returns(self):
        # SINV-3 used an older credit note (no exchange link): not counted,
        # although the same shared customer returned something this shift.
        self.assertEqual(get_same_shift_exchange_total(self.rows, "SHIFT-1", {"SINV-2": 139.3}), 139.3)

    def test_part_of_a_sales_credit_from_an_older_credit_note(self):
        self.assertEqual(get_same_shift_exchange_total(self.rows, "SHIFT-1", {"SINV-2": 60.0}), 60.0)

    def test_no_exchange(self):
        self.assertEqual(get_same_shift_exchange_total(self.rows, "SHIFT-1", {}), 0)

    def test_return_rows_are_never_summed(self):
        self.assertEqual(get_same_shift_exchange_total(self.rows, "SHIFT-1", {"SINV-1": 10.0}), 0)

    def test_no_shift_reads_nothing(self):
        self.assertEqual(get_same_shift_exchange_total(self.rows, None), 0)
