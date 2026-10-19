import json
import re
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import z_report


def _shift():
    return frappe._dict(
        name="CS-1",
        doctype="POS Closing Shift",
        docstatus=1,
        pos_profile="Test Pos",
        company="My Co",
        posting_date="2026-10-19",
        net_total=0,
        grand_total=0,
        customer_credit_issued=0,
        customer_credit_redeemed=0,
        same_shift_exchange_total=0,
        payment_reconciliation=[],
    )


def _row(name, qty, grand_total, is_return=0):
    return frappe._dict(
        name=name,
        is_return=is_return,
        grand_total=grand_total,
        base_grand_total=grand_total,
        conversion_rate=1,
        total_qty=qty,
        discount_amount=0,
        base_discount_amount=0,
        total_taxes_and_charges=0,
        base_total_taxes_and_charges=0,
    )


def _sale(name, qty, amount=10.0):
    return _row(name, qty, amount)


def _return(name, qty, amount=10.0):
    # Return invoices carry negative quantities and amounts.
    return _row(name, -qty, -amount, is_return=1)


def _report(rows):
    with patch.object(z_report.frappe, "get_doc", return_value=_shift()), patch.object(
        z_report, "get_authorized_pos_profile"
    ), patch.object(z_report, "get_shift_invoice_rows", return_value=rows), patch.object(
        z_report, "get_shift_line_discount_totals", return_value={}
    ), patch.object(z_report, "get_payment_mode_counts", return_value={}), patch.object(
        z_report.frappe.db, "get_value", return_value=None
    ), patch.object(z_report.frappe, "get_cached_value", return_value="OMR"):
        return z_report.get_z_report_data("CS-1")


class TestZReportItemCounts(unittest.TestCase):
    def test_items_sold_returned_and_net(self):
        cases = [
            ("sale 1 only", [_sale("S1", 1)], 1, 0, 1),
            ("return 1 only", [_return("R1", 1)], 0, 1, -1),
            ("sale 1 + return 1", [_sale("S1", 1), _return("R1", 1)], 1, 1, 0),
            ("sale 3 + return 1", [_sale("S1", 1), _sale("S2", 1), _sale("S3", 1), _return("R1", 1)], 3, 1, 2),
            ("sale 2 + return 3", [_sale("S1", 1), _sale("S2", 1), _return("R1", 2), _return("R2", 1)], 2, 3, -1),
            ("one sale line with qty 2", [_sale("S1", 2)], 2, 0, 2),
        ]
        for label, rows, sold, returned, net in cases:
            with self.subTest(label):
                report = _report(rows)
                self.assertEqual(report["items_sold"], sold)
                self.assertEqual(report["items_returned"], returned)
                # Number of Items and Total Quantity both print total_qty.
                self.assertEqual(report["total_qty"], net)

    def test_counts_stay_receipt_counts(self):
        report = _report([_sale("S1", 2), _sale("S2", 1), _return("R1", 3)])
        self.assertEqual(report["sale_count"], 2)
        self.assertEqual(report["return_count"], 1)

    def test_per_item_figures_use_items_sold(self):
        # 77.200 sale and 64.200 return: net 0 pieces, but per-item figures
        # are still based on the one piece sold.
        report = _report([_sale("S1", 1, 77.2), _return("R1", 1, 64.2)])
        self.assertEqual(report["total_qty"], 0)
        self.assertEqual(report["items_per_receipt"], 1)
        self.assertAlmostEqual(report["sales_per_item"], 77.2)

    def test_nothing_sold_shows_zero_per_item_figures(self):
        report = _report([_return("R1", 2)])
        self.assertEqual(report["items_per_receipt"], 0)
        self.assertEqual(report["sales_per_item"], 0)

    def test_net_never_negative_zero(self):
        # 0.3 - 0.1 - 0.2 leaves a tiny negative float that rounds to -0.0.
        report = _report([_sale("S1", 0.3), _return("R1", 0.1), _return("R2", 0.2)])
        self.assertEqual(str(report["total_qty"]), "0.0")


class TestZReportPrintFormatQuantities(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = frappe.get_app_path("posawesome", "posawesome", "print_format", "z_report", "z_report.json")
        with open(path) as f:
            cls.html = json.load(f)["html"]

    def _render_qty(self, value):
        macro = re.search(r"{% macro qty\(value\) %}.*?{% endmacro %}", self.html).group(0)
        return frappe.render_template(macro + "{{ qty(v) }}", {"v": value}).strip()

    def test_quantities_print_as_whole_numbers(self):
        self.assertEqual(self._render_qty(0.0), "0")
        self.assertEqual(self._render_qty(2.0), "2")
        self.assertEqual(self._render_qty(-1.0), "-1")
        self.assertEqual(self._render_qty(1.5), "1.50")

    def test_both_sections_show_sold_returned_and_the_net(self):
        self.assertEqual(self.html.count("<span>Items Sold</span><span>{{ qty(report.items_sold) }}</span>"), 2)
        self.assertEqual(
            self.html.count("<span>Items Returned</span><span>{{ qty(report.items_returned) }}</span>"), 2
        )
        self.assertIn("<span>Total Quantity</span><span>{{ qty(report.total_qty) }}</span>", self.html)
        self.assertIn("<span>Number of Items</span><span>{{ qty(report.total_qty) }}</span>", self.html)


if __name__ == "__main__":
    unittest.main()
