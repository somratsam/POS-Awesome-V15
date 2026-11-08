import html as html_lib
import json
import re
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import z_report
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.test_sales_breakdown import breakdown, inv, SHIFT
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.test_z_report_item_counts import _shift

TEMPLATE = json.load(open(frappe.get_app_path("posawesome", "posawesome", "print_format", "z_report", "z_report.json")))["html"]


def _invoice_rows(rows):
    return [frappe._dict(r, net_total=r.grand_total, base_net_total=r.grand_total, total_taxes_and_charges=0,
                         base_total_taxes_and_charges=0, discount_amount=0, base_discount_amount=0) for r in rows]


def printed(rows, returning=(), origin_shifts=None, payments=None):
    """The Z Report as printed (text only) for these invoices."""
    b = breakdown(rows, returning, origin_shifts)
    with patch.object(z_report.frappe, "get_doc", return_value=_shift()), patch.object(
        z_report, "get_authorized_pos_profile"
    ), patch.object(z_report, "_sales_breakdown", return_value=b), patch.object(
        z_report, "get_shift_invoice_rows", return_value=_invoice_rows(rows)
    ), patch.object(z_report, "get_shift_line_discount_totals", return_value={}), patch.object(
        z_report, "get_payment_mode_counts", return_value=payments or {}
    ), patch.object(z_report.frappe.db, "get_value", return_value=None), patch.object(
        z_report.frappe, "get_cached_value", return_value="OMR"
    ):
        report = z_report.get_z_report_data("CS-1")
    report["posting_date"] = frappe.utils.getdate("2026-11-07")
    html = TEMPLATE.replace(
        '{% set report = frappe.call("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report.get_z_report_data", pos_closing_shift=doc.name) %}', ""
    ).replace(
        '{% set logo_data_uri = frappe.call("posawesome.posawesome.api.print_assets.get_receipt_logo_data_uri", pos_profile=doc.pos_profile) %}', ""
    )
    out = frappe.render_template(html, {"doc": frappe._dict(name="CS-1", pos_profile="P"), "report": frappe._dict(report)})
    out = re.sub(r"<style.*?</style>", "", out, flags=re.S)
    out = re.sub(r"<(br|/div|/tr)\s*/?>", "\n", out)
    out = re.sub(r"<[^>]+>", " ", out)
    out = html_lib.unescape(out)
    return "\n".join(" ".join(line.split()) for line in out.splitlines() if line.strip())


VISA = lambda total: {"Visa": {"sale_count": 1, "sale_total": total, "return_count": 0, "return_total": 0}}


class TestZReportLayout(unittest.TestCase):
    def test_the_print_format_can_still_call_the_report_data_and_nothing_else_new(self):
        # The template reaches get_z_report_data through frappe.call, which only
        # allows whitelisted methods; the breakdown helpers must not be callable.
        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import overview

        self.assertIn(z_report.get_z_report_data, frappe.whitelisted)
        self.assertNotIn(z_report._sales_breakdown, frappe.whitelisted)
        self.assertNotIn(overview._shift_z_summary, frappe.whitelisted)
        self.assertIn(overview.get_closing_shift_overview, frappe.whitelisted)

    def test_both_template_calls_are_still_what_printed_patches_out(self):
        self.assertIn('frappe.call("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report.get_z_report_data"', TEMPLATE)

    def test_exchange(self):
        text = printed(
            [inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1"), inv("S2", 72.97, paid=0, redeemed=72.97)],
            ["CUST-1"], {"S1": SHIFT}, VISA(72.97),
        )
        for line in ("Gross Sales 145.940 OMR", "↳ of which exchanges (1) 72.970 OMR", "Returns -72.970 OMR",
                     "Net Sales 72.970 OMR", "Sales Count 1 + 1 exch.", "↳ used in exchanges today 72.970 OMR",
                     "Left as Store Credit 0.000 OMR", "= Takings 72.970 OMR", "Number of Receipts 1 + 1 exch.",
                     "Sales Figure/Receipt 72.970 OMR", "Gross Sales Receipts 2 / 145.940"):
            self.assertIn(line, text)
        self.assertNotIn("Total Sales", text)
        self.assertNotIn("of earlier sales", text)

    def test_credit_note_not_used(self):
        text = printed([inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1")],
                       ["CUST-1"], {"S1": SHIFT}, VISA(72.97))
        for line in ("Net Sales 0.000 OMR", "+ Credit Issued 72.970 OMR", "- Credit Redeemed 0.000 OMR",
                     "= Takings 72.970 OMR", "Left as Store Credit 72.970 OMR", "Sales Figure/Item -"):
            self.assertIn(line, text)
        self.assertNotIn("exch.", text)

    def test_return_of_an_earlier_sale(self):
        text = printed([inv("R1", -139.3, customer="SANJU", is_return=1, paid=0, return_against="OLD")],
                       origin_shifts={"OLD": "SHIFT-OLD"})
        for line in ("↳ of earlier sales 139.300 OMR", "Net Sales -139.300 OMR",
                     "Below zero: returns of earlier sales exceed today's sales.", "= Takings 0.000 OMR",
                     "Items/Receipt -", "Sales Figure/Receipt -"):
            self.assertIn(line, text)

    def test_bridge_lines_only_when_not_zero(self):
        text = printed([inv("S1", 100, paid=60)], payments=VISA(60))
        self.assertIn("- Unpaid 40.000 OMR", text)
        self.assertIn("= Takings 60.000 OMR", text)
        for absent in ("- Refunds", "- Loyalty Points", "- Write-off", "- Rounding", "- Other"):
            self.assertNotIn(absent, text)


if __name__ == "__main__":
    unittest.main()
