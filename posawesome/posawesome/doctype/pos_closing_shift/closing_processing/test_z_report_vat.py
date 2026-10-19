import json
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import data
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.test_z_report_item_counts import (
    _report,
    _row,
)


def _vat_row(name, qty, grand_total, vat, is_return=0, conversion_rate=1, net_total=None):
    # Amounts in transaction currency; the base fields are what the report uses.
    if net_total is None:
        net_total = grand_total - vat
    row = _row(name, qty, grand_total, is_return=is_return)
    row.update(
        conversion_rate=conversion_rate,
        base_grand_total=grand_total * conversion_rate,
        net_total=net_total,
        base_net_total=net_total * conversion_rate,
        total_taxes_and_charges=vat,
        base_total_taxes_and_charges=vat * conversion_rate,
    )
    return row


class TestZReportVat(unittest.TestCase):
    def test_exchange_nets_vat_like_the_closing_shift(self):
        # The reported exchange: 77.200 sale, 64.200 return, 13.000 by Visa.
        report = _report(
            [
                _vat_row("S1", 1, 77.2, 3.676),
                _vat_row("R1", -1, -64.2, -3.057, is_return=1),
            ]
        )
        self.assertAlmostEqual(report["vat_on_sales"], 3.676)
        self.assertAlmostEqual(report["vat_on_returns"], 3.057)
        self.assertAlmostEqual(report["total_vat"], 0.619)
        self.assertAlmostEqual(report["net_sales"], 13.0)
        self.assertAlmostEqual(report["net_excl_vat"], 12.381)

    def test_sales_based_figures_stay_gross(self):
        report = _report(
            [
                _vat_row("S1", 1, 77.2, 3.676),
                _vat_row("R1", -1, -64.2, -3.057, is_return=1),
            ]
        )
        self.assertAlmostEqual(report["total_sales"], 77.2)
        self.assertAlmostEqual(report["sales_per_receipt"], 77.2)
        self.assertAlmostEqual(report["sales_per_item"], 77.2)

    def test_returns_only_shift_goes_negative(self):
        report = _report([_vat_row("R1", -1, -21.0, -1.0, is_return=1)])
        self.assertAlmostEqual(report["vat_on_sales"], 0)
        self.assertAlmostEqual(report["vat_on_returns"], 1.0)
        self.assertAlmostEqual(report["total_vat"], -1.0)
        self.assertAlmostEqual(report["net_sales"], -21.0)
        self.assertAlmostEqual(report["net_excl_vat"], -20.0)

    def test_return_vat_uses_company_currency(self):
        report = _report(
            [
                _vat_row("S1", 1, 105.0, 5.0),
                _vat_row("R1", -1, -21.0, -1.0, is_return=1, conversion_rate=2),
            ]
        )
        self.assertAlmostEqual(report["vat_on_returns"], 2.0)
        self.assertAlmostEqual(report["total_vat"], 3.0)
        self.assertAlmostEqual(report["net_excl_vat"], 100.0 - 40.0)

    def test_net_excl_vat_is_the_invoices_own_net_total(self):
        # ACC-SINV-2026-00083 on staging: 178.96 net + 8.95 VAT = 187.91, but
        # its grand total is 187.90. The Closing Shift's net_total sums 178.96.
        report = _report([_vat_row("S1", 1, 187.9, 8.95, net_total=178.96)])
        self.assertAlmostEqual(report["net_excl_vat"], 178.96)
        self.assertAlmostEqual(report["net_sales"], 187.9)
        self.assertAlmostEqual(report["total_vat"], 8.95)

    def test_invoice_rows_fetch_net_totals(self):
        calls = []

        def fake_get_all(doctype, filters=None, fields=None):
            calls.append(fields)
            return []

        with patch.object(data, "_shift_invoice_names_by_doctype", return_value={"Sales Invoice": ["SI-1"]}), patch.object(
            data.frappe, "get_all", side_effect=fake_get_all
        ):
            data.get_shift_invoice_rows(frappe._dict())

        self.assertIn("net_total", calls[0])
        self.assertIn("base_net_total", calls[0])


class TestZReportPrintFormatVat(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = frappe.get_app_path("posawesome", "posawesome", "print_format", "z_report", "z_report.json")
        with open(path) as f:
            cls.html = json.load(f)["html"]

    def test_vat_lines(self):
        for label, key in (
            ("Net Sales incl. VAT", "net_sales"),
            ("VAT on Sales", "vat_on_sales"),
            ("VAT on Returns", "vat_on_returns"),
            ("VAT Amount", "total_vat"),
            ("Net Excl. VAT", "net_excl_vat"),
        ):
            with self.subTest(label):
                self.assertIn(
                    '<span>%s</span><span>{{ "%%.3f"|format(report.%s) }}' % (label, key), self.html
                )
        self.assertNotIn("Tax Incl. Sales Figure", self.html)

    def test_total_sales_receipts_stays_gross(self):
        self.assertIn(
            '<span>Total Sales Receipts</span><span>{{ report.sale_count }} / {{ "%.3f"|format(report.total_sales) }}',
            self.html,
        )


if __name__ == "__main__":
    unittest.main()
