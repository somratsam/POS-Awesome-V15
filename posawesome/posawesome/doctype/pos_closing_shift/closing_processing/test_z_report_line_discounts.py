import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import data, z_report


def _shift(**overrides):
    doc = frappe._dict(
        name="CS-1",
        doctype="POS Closing Shift",
        docstatus=1,
        pos_profile="Test Pos",
        company="My Co",
        posting_date="2026-10-06",
        net_total=0,
        grand_total=0,
        customer_credit_issued=0,
        customer_credit_redeemed=0,
        same_shift_exchange_total=0,
        payment_reconciliation=[],
        pos_transactions=[
            frappe._dict(sales_invoice="SI-1"),
            frappe._dict(sales_invoice="SI-2"),
            frappe._dict(pos_invoice="PI-1"),
        ],
    )
    doc.update(overrides)
    return doc


class TestShiftLineDiscountTotals(unittest.TestCase):
    def test_sums_discount_amount_times_qty_per_invoice_from_both_item_tables(self):
        lines = {
            "Sales Invoice Item": [
                frappe._dict(parent="SI-1", qty=2, discount_amount=4.31),
                frappe._dict(parent="SI-1", qty=1, discount_amount=1.5),
                frappe._dict(parent="SI-2", qty=-1, discount_amount=3),
            ],
            "POS Invoice Item": [frappe._dict(parent="PI-1", qty=3, discount_amount=1)],
        }
        calls = []

        def fake_get_all(doctype, filters=None, fields=None):
            calls.append((doctype, filters))
            return lines[doctype]

        with patch.object(data.frappe, "get_all", side_effect=fake_get_all):
            totals = data.get_shift_line_discount_totals(_shift())

        self.assertAlmostEqual(totals["SI-1"], 2 * 4.31 + 1.5)
        self.assertAlmostEqual(totals["SI-2"], 3)
        self.assertAlmostEqual(totals["PI-1"], 3)
        # Only positive line discounts are fetched (a rate above the price
        # list leaves a negative discount_amount, which isn't a discount).
        for _doctype, filters in calls:
            self.assertEqual(filters["discount_amount"], [">", 0])
        self.assertEqual(calls[0][1]["parent"], ["in", ["SI-1", "SI-2"]])


class TestZReportDiscountsGranted(unittest.TestCase):
    def test_counts_item_line_discounts_in_company_currency_on_sales_only(self):
        rows = [
            frappe._dict(name="SI-1", is_return=0, grand_total=100, base_grand_total=100, conversion_rate=1,
                         total_qty=3, discount_amount=0, base_discount_amount=0, total_taxes_and_charges=0,
                         base_total_taxes_and_charges=0),
            frappe._dict(name="SI-2", is_return=0, grand_total=50, base_grand_total=100, conversion_rate=2,
                         total_qty=1, discount_amount=5, base_discount_amount=10, total_taxes_and_charges=0,
                         base_total_taxes_and_charges=0),
            frappe._dict(name="SI-3", is_return=1, grand_total=-20, base_grand_total=-20, conversion_rate=1,
                         total_qty=-1, discount_amount=0, base_discount_amount=0, total_taxes_and_charges=0,
                         base_total_taxes_and_charges=0),
        ]
        line_totals = {"SI-1": 10.12, "SI-2": 4, "SI-3": 99}
        with patch.object(z_report.frappe, "get_doc", return_value=_shift()), patch.object(
            z_report, "get_authorized_pos_profile"
        ), patch.object(z_report, "get_shift_invoice_rows", return_value=rows), patch.object(
            z_report, "get_shift_line_discount_totals", return_value=line_totals
        ), patch.object(z_report, "get_payment_mode_counts", return_value={}), patch.object(
            z_report.frappe.db, "get_value", return_value=None
        ), patch.object(z_report.frappe, "get_cached_value", return_value="OMR"):
            report = z_report.get_z_report_data("CS-1")

        # SI-1: 10.12 line; SI-2: 10 invoice-level + 4 x 2 line; SI-3 is a return.
        self.assertAlmostEqual(report["total_discount"], 10.12 + 10 + 8)


if __name__ == "__main__":
    unittest.main()
