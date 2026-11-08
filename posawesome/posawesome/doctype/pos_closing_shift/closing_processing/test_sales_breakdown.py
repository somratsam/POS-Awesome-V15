import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import sales_breakdown

SHIFT = "SHIFT-NOW"


def inv(name, grand_total, *, is_return=0, customer="CUST-1", qty=1, paid=None, change=0, redeemed=0,
        loyalty=0, write_off=0, rounded=None, return_against=None):
    return frappe._dict(
        doctype="Sales Invoice", name=name, customer=customer, is_return=is_return, return_against=return_against,
        grand_total=grand_total, base_grand_total=grand_total, rounded_total=rounded or 0,
        base_rounded_total=rounded or 0, conversion_rate=1, total_qty=qty if not is_return else -abs(qty),
        paid_amount=grand_total if paid is None else paid, base_paid_amount=grand_total if paid is None else paid,
        change_amount=change, base_change_amount=change, write_off_amount=write_off, base_write_off_amount=write_off,
        loyalty_amount=loyalty, posa_redeemed_customer_credit=redeemed,
    )


def breakdown(rows, returning=(), origin_shifts=None):
    origins = [frappe._dict(name=k, posa_pos_opening_shift=v) for k, v in (origin_shifts or {}).items()]
    with patch.object(sales_breakdown, "_rows", return_value=rows), patch.object(
        sales_breakdown, "get_customers_with_same_shift_return", return_value=list(returning)
    ), patch.object(sales_breakdown.frappe, "get_all", return_value=origins):
        return sales_breakdown.get_sales_breakdown(SHIFT, {"Sales Invoice": [r.name for r in rows]})


class TestSalesBreakdown(unittest.TestCase):
    def test_credit_note_not_used(self):
        # Sale 72.970 by card, returned for store credit in the same shift.
        b = breakdown([inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1")],
                      returning=["CUST-1"], origin_shifts={"S1": SHIFT})
        self.assertEqual((b["gross_sales"], b["returns"], b["net_sales"]), (72.97, 72.97, 0.0))
        self.assertEqual((b["credit_issued"], b["credit_redeemed"], b["left_as_store_credit"]), (72.97, 0, 72.97))
        self.assertEqual(b["takings"], 72.97)
        self.assertEqual(b["other"], 0)
        self.assertEqual((b["receipts"], b["exchange_count"]), (1, 0))
        self.assertEqual(b["sales_per_receipt"], 0.0)

    def test_same_shift_exchange(self):
        b = breakdown(
            [inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1"),
             inv("S2", 72.97, paid=0, redeemed=72.97)],
            returning=["CUST-1"], origin_shifts={"S1": SHIFT},
        )
        self.assertEqual((b["gross_sales"], b["net_sales"]), (145.94, 72.97))
        self.assertEqual((b["exchange_count"], b["exchange_sales"], b["same_shift_exchange_total"]), (1, 72.97, 72.97))
        self.assertEqual((b["sale_count"], b["receipts"]), (2, 1))
        self.assertEqual((b["sales_per_receipt"], b["items_per_receipt"], b["sales_per_item"]), (72.97, 1.0, 72.97))
        self.assertEqual((b["left_as_store_credit"], b["takings"], b["other"]), (0.0, 72.97, 0))

    def test_return_of_an_earlier_sale(self):
        b = breakdown([inv("R1", -139.3, customer="SANJU", is_return=1, paid=0, return_against="OLD")],
                      origin_shifts={"OLD": "SHIFT-OLD"})
        self.assertEqual((b["net_sales"], b["returns_this_shift"], b["returns_earlier"]), (-139.3, 0, 139.3))
        self.assertEqual((b["takings"], b["left_as_store_credit"], b["other"]), (0.0, 139.3, 0))
        self.assertIsNone(b["sales_per_receipt"])
        self.assertIsNone(b["items_per_receipt"])
        self.assertIsNone(b["sales_per_item"])

    def test_bridge_names_every_way_a_sale_was_settled_without_money(self):
        b = breakdown([
            inv("S1", 100, paid=60),                          # 40 left unpaid
            inv("S2", 50, paid=40, loyalty=10),               # loyalty points
            inv("S3", 30, paid=29.7, write_off=0.3),          # write-off
            inv("S4", 20.3, paid=20, rounded=20),             # rounding
            inv("S5", 10, paid=20, change=10),                # cash change
            inv("R1", -25, is_return=1, paid=-25, customer="X", return_against="OLD"),  # refund
        ], origin_shifts={"OLD": "SHIFT-OLD"})
        self.assertEqual((b["unpaid"], b["loyalty"], b["write_off"], b["rounding"], b["refunds"]), (40, 10, 0.3, 0.3, 25))
        # takings = 60 + 40 + 29.7 + 20 + 10 - 25
        self.assertEqual(b["takings"], 134.7)
        self.assertEqual(b["other"], 0)
        bridge = b["net_sales"] + b["credit_issued"] - b["credit_redeemed"] - b["refunds"] - b["loyalty"] - b["write_off"] - b["rounding"] - b["unpaid"]
        self.assertAlmostEqual(bridge, b["takings"])

    def test_credit_used_by_a_customer_without_a_same_shift_return_is_not_an_exchange(self):
        b = breakdown([inv("S1", 50, paid=0, redeemed=50, customer="OTHER")], returning=[])
        self.assertEqual((b["exchange_count"], b["receipts"], b["credit_redeemed"]), (0, 1, 50))

    def test_open_and_closed_shift_use_the_same_numbers(self):
        rows = [inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1")]
        self.assertEqual(breakdown(rows, ["CUST-1"], {"S1": SHIFT}), breakdown(list(rows), ["CUST-1"], {"S1": SHIFT}))


if __name__ == "__main__":
    unittest.main()
