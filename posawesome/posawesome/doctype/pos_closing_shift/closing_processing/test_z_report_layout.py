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


def printed(rows, exchange=None, origin_shifts=None, payments=None, reconciliation=None):
    """The Z Report as printed (text only) for these invoices. exchange:
    {sale: credit used from same-shift returns} (the credit Journal Entries).
    reconciliation: the shift's Cash Balance rows."""
    b = breakdown(rows, exchange, origin_shifts)
    shift = _shift()
    shift.payment_reconciliation = [frappe._dict(r) for r in (reconciliation or [])]
    with patch.object(z_report.frappe, "get_doc", return_value=shift), patch.object(
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
            {"S2": 72.97}, {"S1": SHIFT}, VISA(72.97),
        )
        for line in ("Gross Sales 145.940 OMR", "↳ of which exchanges (1) 72.970 OMR", "Returned -72.970 OMR",
                     "Net Sales 72.970 OMR", "Sales Count 1 + 1 exch.", "↳ Exchanges Today 72.970 OMR",
                     "= Takings 72.970 OMR", "Sales Figure/Receipt 72.970 OMR", "Gross Sales Receipts 2 / 145.940",
                     "Total Register 3 / 72.970"):
            self.assertIn(line, text)
        # 0 left on credit notes: the line doesn't print.
        self.assertNotIn("Left on credit notes", text)
        self.assertNotIn("Total Sales", text)
        self.assertNotIn("of earlier sales", text)
        # "Exchanges Today" is the sub-line under Credit notes issued, as in the Overview.
        self.assertRegex(text, r"Credit notes issued [0-9.]+ OMR\n↳ Exchanges Today 72\.970 OMR\nCredit notes used ")

    def test_credit_note_not_used(self):
        text = printed([inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1")],
                       {}, {"S1": SHIFT}, VISA(72.97))
        for line in ("Net Sales 0.000 OMR", "+ Credit notes issued 72.970 OMR",
                     "= Takings 72.970 OMR", "Left on credit notes 72.970 OMR", "Sales Figure/Item -"):
            self.assertIn(line, text)
        # Nothing used: neither the Credit Notes line nor the Takings term prints.
        self.assertNotIn("Credit notes used", text)
        self.assertNotIn("exch.", text)

    def test_return_of_an_earlier_sale(self):
        text = printed([inv("R1", -139.3, customer="SANJU", is_return=1, paid=0, return_against="OLD")],
                       origin_shifts={"OLD": "SHIFT-OLD"})
        for line in ("↳ of earlier sales 139.300 OMR", "Net Sales -139.300 OMR", "= Takings 0.000 OMR",
                     "Items/Receipt -", "Sales Figure/Receipt -"):
            self.assertIn(line, text)
        self.assertIn("Net Sales -139.300 OMR\nBelow zero: returns of earlier sales exceed today's sales.", text)
        # 0 returned from this shift doesn't print.
        self.assertNotIn("of sales made in this shift", text)

    def test_bridge_lines_only_when_not_zero(self):
        text = printed([inv("S1", 100, paid=60)], payments=VISA(60))
        self.assertIn("- Unpaid 40.000 OMR", text)
        self.assertIn("= Takings 60.000 OMR", text)
        for absent in ("- Refunds", "- Loyalty Points", "- Write-off", "- Rounding", "- Other"):
            self.assertNotIn(absent, text)

    def test_sales_only_shift_has_no_credit_note_or_return_lines(self):
        text = printed([inv("S1", 100)], payments=VISA(100))
        for line in ("Gross Sales 100.000 OMR", "Net Sales 100.000 OMR", "Sales Count 1", "Items Sold",
                     "Total Quantity", "Discounts Granted", "= Takings 100.000 OMR", "VAT on Sales", "VAT Amount"):
            self.assertIn(line, text)
        for absent in ("Returned", "Items returned", "exch.", "Credit Notes", "Credit notes issued",
                       "Credit notes used", "Exchanges Today", "Left on credit notes", "VAT on returned items"):
            self.assertNotIn(absent, text)
        # Takings goes straight from Net Sales to the total.
        self.assertIn("Net Sales 100.000 OMR\n= Takings 100.000 OMR", text)

    def test_credit_notes_heading_only_with_a_line_under_it(self):
        text = printed([inv("S1", 100, paid=60, redeemed=40)], payments=VISA(60))
        self.assertRegex(text, r"Credit Notes\nCredit notes used 40\.000 OMR\nTakings")
        self.assertNotIn("Credit notes issued", text)

    def test_additional_information_drops_the_repeated_lines(self):
        text = printed([inv("S1", 100), inv("R1", -40, is_return=1, paid=0, return_against="S1")],
                       {}, {"S1": SHIFT}, VISA(100))
        info = text.split("Additional Information", 1)[1]
        for line in ("Items/Receipt", "VAT on Sales", "VAT Amount", "Net Excl. VAT", "Sales Figure/Receipt",
                     "Sales Figure/Item", "END OF Z REPORT"):
            self.assertIn(line, info)
        # Still in Today's Operations, no longer repeated here.
        for repeated in ("Items Sold", "Items returned", "Discounts Granted"):
            self.assertIn(repeated, text)
            self.assertNotIn(repeated, info)
        for absent in ("Number of Receipts", "Number of returns", "Number of Items", "Net Sales incl. VAT",
                       "Per receipt and per item"):
            self.assertNotIn(absent, text)
        self.assertIn("Equals Today's Payments above.", text)

    def test_payment_modes_with_nothing_do_not_print(self):
        payments = {"Visa": {"sale_count": 1, "sale_total": 100, "return_count": 0, "return_total": 0},
                    "Maal": {"sale_count": 0, "sale_total": 0, "return_count": 0, "return_total": 0}}
        zero = {"opening_amount": 0, "expected_amount": 0, "closing_amount": 0, "difference": 0}
        recon = [dict(zero, mode_of_payment="Maal"),
                 dict(zero, mode_of_payment="Cash", opening_amount=20, expected_amount=20, closing_amount=20),
                 dict(zero, mode_of_payment="Master Card", closing_amount=5, difference=5)]
        text = printed([inv("S1", 100)], payments=payments, reconciliation=recon)
        self.assertNotIn("Maal", text)
        self.assertIn("Today's Payments\nVisa\n1 / 100.000\nTakings", text)
        balance = text.split("Cash Balance", 1)[1]
        self.assertIn("Cash\nOpening 20.000", balance)
        # Counted something that wasn't expected: it prints.
        self.assertIn("Master Card\nOpening 0.000\nExpected 0.000\nActual Closing 5.000\nDifference 5.000", balance)
        self.assertNotIn("Nothing opened, expected or counted", text)

    def test_empty_shift(self):
        zero = {"opening_amount": 0, "expected_amount": 0, "closing_amount": 0, "difference": 0}
        text = printed([], reconciliation=[dict(zero, mode_of_payment="Cash")])
        self.assertIn("No payments recorded", text)
        self.assertIn("Cash Balance\nNothing opened, expected or counted", text)
        self.assertIn("= Takings 0.000 OMR", text)

    def test_below_zero_hint_only_under_a_negative_net_sales(self):
        self.assertNotIn("Below zero", printed([inv("S1", 100)], payments=VISA(100)))
        # A return that exactly cancels a sale: Net Sales 0.000, no hint.
        text = printed([inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1")],
                       {}, {"S1": SHIFT}, VISA(72.97))
        self.assertIn("Net Sales 0.000 OMR", text)
        self.assertNotIn("Below zero", text)

    def test_refund_of_nothing_has_no_minus(self):
        payments = {"Visa": {"sale_count": 1, "sale_total": 100, "return_count": 1, "return_total": 0}}
        text = printed([inv("S1", 100)], payments=payments)
        self.assertIn("Refunds\n1 / 0.000", text)
        self.assertNotIn("-0.000", text)


class TestZReportNumberFormat(unittest.TestCase):
    """amt() never prints "-0.000"; minus() puts "-" only in front of a non-zero amount."""

    def _macro(self, call, **values):
        macros = "".join(re.findall(r"{% macro (?:amt|minus)\(.*?{% endmacro %}", TEMPLATE, flags=re.S))
        return frappe.render_template(macros + "{{ " + call + " }}", values).strip()

    def test_amt(self):
        for value, expected in ((-0.0, "0.000"), (-1e-13, "0.000"), (-0.0004, "0.000"), (0, "0.000"), (None, "0.000"),
                                (1.5, "1.500"), (-0.0005001, "-0.001"), (-139.3, "-139.300")):
            with self.subTest(value):
                self.assertEqual(self._macro("amt(v)", v=value), expected)
        self.assertEqual(self._macro("amt(v, 2)", v=-0.001), "0.00")

    def test_minus(self):
        for value, expected in ((0, "0.000"), (-0.0, "0.000"), (0.0001, "0.000"), (40, "-40.000"), (2116.358, "-2116.358")):
            with self.subTest(value):
                self.assertEqual(self._macro("minus(v)", v=value), expected)

    def test_every_amount_goes_through_amt(self):
        self.assertNotIn('"%.3f"|format(report', TEMPLATE)
        self.assertNotIn('"%.3f"|format(row', TEMPLATE)
        self.assertNotIn('"%.3f"|format(data', TEMPLATE)
        self.assertNotIn("-{{", TEMPLATE)


if __name__ == "__main__":
    unittest.main()
