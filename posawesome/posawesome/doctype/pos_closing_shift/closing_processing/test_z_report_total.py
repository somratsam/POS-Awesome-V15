"""The Z Report's TOTAL block (PROGRESS_NOTES 120).

Today's Payments lines, then Credit notes issued (a minus) and Credit notes
used (a plus) and the other ways a sale was settled without money, each only
when not 0, add up to TOTAL, which always equals Net Sales; Takings (cash +
card) is the sum of the payment lines. Every case reads the printed text back
and adds the printed lines up itself.
"""

import re
import unittest

import frappe

from posawesome.posawesome.api.invoice_processing.creation import _guard_return_cash_refund
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.sales_breakdown import payment_total_lines
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.test_sales_breakdown import SHIFT, breakdown, inv
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.test_z_report_layout import printed

MONEY = r"(-?[0-9]+\.[0-9]{3})"
TOTAL_LINE_LABELS = ("Credit notes issued", "Credit notes used", "Loyalty Points", "Write-off", "Rounding",
                     "Unpaid", "Other")


def mode(sales, total, returns=0, refunded=0.0):
    # As get_payment_mode_counts gives it: the refund rows hold negative amounts.
    return {"sale_count": sales, "sale_total": total, "return_count": returns, "return_total": -abs(refunded)}


def figures(text):
    """What the print says: Net Sales, the payment lines, the lines between
    them and TOTAL, TOTAL and Takings (cash + card)."""
    lines = text.splitlines()
    net = float(re.search(rf"^Net Sales {MONEY} OMR$", text, flags=re.M).group(1))
    payments = lines[lines.index("Today's Payments") + 1:]
    paid = 0.0
    previous = ""
    for line in payments[: next(i for i, l in enumerate(payments) if l in ("Credit Notes",) or l.startswith("TOTAL"))]:
        # "count / amount" under a payment mode; under "Refunds" it comes off.
        found = re.fullmatch(r"[0-9]+ / -*([0-9]+\.[0-9]{3})", line)
        if found:
            paid += -float(found.group(1)) if previous == "Refunds" else float(found.group(1))
        previous = line
    extra = {}
    for label in TOTAL_LINE_LABELS:
        found = re.search(rf"^{label} ([+-]?[0-9]+\.[0-9]{{3}}) OMR$", text, flags=re.M)
        if found:
            extra[label] = float(found.group(1))
    total = float(re.search(rf"^TOTAL {MONEY} OMR$", text, flags=re.M).group(1))
    takings = float(re.search(rf"^Takings \(cash \+ card\) {MONEY} OMR$", text, flags=re.M).group(1))
    return net, round(paid, 3), extra, total, takings


class TestZReportTotal(unittest.TestCase):
    def check(self, text, net_sales, takings, extra):
        """TOTAL = Net Sales = the payment lines plus the lines above TOTAL,
        and the printed figures are the expected ones."""
        net, paid, printed_extra, total, printed_takings = figures(text)
        self.assertEqual(net, net_sales)
        self.assertEqual(total, net_sales, "TOTAL must equal Net Sales")
        self.assertEqual(printed_takings, takings)
        self.assertEqual(paid, takings, "Takings (cash + card) is the sum of the payment lines")
        self.assertEqual(printed_extra, extra)
        self.assertAlmostEqual(paid + sum(printed_extra.values()), total, places=6)
        self.assertIn(f"TOTAL {net_sales:.3f} OMR\n= Net Sales\nTakings (cash + card) {takings:.3f} OMR", text)
        self.assertNotIn("= Takings", text)

    def test_normal_day(self):
        text = printed([inv("S1", 300), inv("S2", 131.047)], payments={"Visa": mode(2, 431.047)})
        self.check(text, 431.047, 431.047, {})
        self.assertNotIn("Credit Notes", text)
        self.assertNotIn("Left on credit notes", text)

    def test_issue_day(self):
        text = printed([inv("S1", 431.047), inv("R1", -64.44, is_return=1, paid=0, return_against="S1")],
                       {}, {"S1": SHIFT}, {"Visa": mode(6, 431.047)})
        self.check(text, 366.607, 431.047, {"Credit notes issued": -64.44})
        self.assertIn("Credit Notes\nCredit notes issued -64.440 OMR\nTOTAL", text)
        self.assertIn("Takings (cash + card) 431.047 OMR\nLeft on credit notes 64.440 OMR", text)

    def test_redeem_day(self):
        rows = [inv("S1", 117.241), inv("S2", 27.45), inv("S3", 301.52), inv("S4", 64.44, paid=0, redeemed=64.44)]
        payments = {"Cash": mode(3, 117.241), "Mastercard": mode(1, 27.45), "Visa": mode(5, 301.52)}
        text = printed(rows, payments=payments)
        self.check(text, 510.651, 446.211, {"Credit notes used": 64.44})
        self.assertIn("Credit Notes\nCredit notes used +64.440 OMR\nTOTAL 510.651 OMR", text)
        self.assertNotIn("Left on credit notes", text)

    def test_issue_and_redeem_on_the_same_day(self):
        # A return of an earlier sale gives 50.000 credit; a sale is paid 30.000
        # with an older credit note and 70.000 cash.
        rows = [inv("S1", 100, paid=70, redeemed=30), inv("R1", -50, is_return=1, paid=0, return_against="OLD")]
        text = printed(rows, origin_shifts={"OLD": "SHIFT-OLD"}, payments={"Cash": mode(1, 70)})
        self.check(text, 50.0, 70.0, {"Credit notes issued": -50.0, "Credit notes used": 30.0})
        self.assertIn("Credit notes issued -50.000 OMR\nCredit notes used +30.000 OMR\nTOTAL 50.000 OMR", text)

    def test_pure_exchange(self):
        rows = [inv("S1", 72.97), inv("R1", -72.97, is_return=1, paid=0, return_against="S1"),
                inv("S2", 72.97, paid=0, redeemed=72.97)]
        text = printed(rows, {"S2": 72.97}, {"S1": SHIFT}, {"Visa": mode(1, 72.97)})
        # Both lines print (they don't cancel into one 0.000 line).
        self.check(text, 72.97, 72.97, {"Credit notes issued": -72.97, "Credit notes used": 72.97})
        self.assertIn("↳ Exchanges Today 72.970 OMR", text)

    def test_return_only_day(self):
        text = printed([inv("R1", -64.44, is_return=1, paid=0, return_against="OLD")],
                       origin_shifts={"OLD": "SHIFT-OLD"})
        self.check(text, -64.44, 0.0, {"Credit notes issued": -64.44})
        self.assertIn("No payments recorded", text)
        self.assertIn("Takings (cash + card) 0.000 OMR\nLeft on credit notes 64.440 OMR", text)

    def test_cash_refund_of_old_data_issues_no_credit_note(self):
        # Returns are credit-only now (test below); an old return refunded in
        # money issued no credit note, so no Credit notes issued line, and the
        # TOTAL still equals Net Sales.
        rows = [inv("S1", 100), inv("R1", -40, is_return=1, paid=-40, return_against="S1")]
        text = printed(rows, {}, {"S1": SHIFT}, {"Visa": mode(1, 100, returns=1, refunded=40)})
        self.check(text, 60.0, 60.0, {})
        self.assertNotIn("Credit Notes", text)
        self.assertIn("Visa\n1 / 100.000\nRefunds\n", text)

    def test_cash_refund_is_still_rejected(self):
        profile = frappe._dict(posa_returns_credit_only=1)
        refund = frappe._dict(doctype="Sales Invoice", is_return=1, paid_amount=-40, return_against="S1")
        with self.assertRaisesRegex(frappe.ValidationError, "refunds are disabled by policy"):
            _guard_return_cash_refund(refund, profile, enforce_credit_only_policy=True)
        # No money back: allowed (the return becomes a credit note).
        _guard_return_cash_refund(frappe._dict(refund, paid_amount=0), profile, enforce_credit_only_policy=True)

    def test_other_lines_both_directions(self):
        # Rounded down: the customer paid less, Rounding is a plus.
        text = printed([inv("S1", 100.004, rounded=100.0, paid=100.0)], payments={"Visa": mode(1, 100.0)})
        self.check(text, 100.004, 100.0, {"Rounding": 0.004})
        # Rounded up: the customer paid more, Rounding keeps its minus.
        text = printed([inv("S1", 99.996, rounded=100.0, paid=100.0)], payments={"Visa": mode(1, 100.0)})
        self.check(text, 99.996, 100.0, {"Rounding": -0.004})

    def test_loyalty_points_are_not_money_taken(self):
        # ERPNext counts the points in paid_amount; the payment lines don't.
        text = printed([inv("S1", 161.7, loyalty=1, paid=161.7)], payments={"Visa": mode(1, 160.7)})
        self.check(text, 161.7, 160.7, {"Loyalty Points": 1.0})

    def test_anything_left_over_prints_as_other_both_directions(self):
        text = printed([inv("S1", 100)], payments={"Visa": mode(1, 90)})
        self.check(text, 100.0, 90.0, {"Other": 10.0})
        text = printed([inv("S1", 100)], payments={"Visa": mode(1, 110)})
        self.check(text, 100.0, 110.0, {"Other": -10.0})


class TestPaymentTotalLines(unittest.TestCase):
    """sales_breakdown.payment_total_lines, shared with the Closing Shift overview."""

    def test_issue_day(self):
        b = breakdown([inv("S1", 431.047), inv("R1", -64.44, is_return=1, paid=0, return_against="S1")],
                      origin_shifts={"S1": SHIFT})
        block = payment_total_lines(b, 431.047)
        self.assertEqual(block["credit_notes_issued"], 64.44)
        self.assertEqual(block["money_taken"], 431.047)
        self.assertEqual(block["total"], 366.607)
        self.assertEqual(block["total_lines"], {"loyalty": 0, "write_off": 0, "rounding": 0, "unpaid": 0, "other": 0.0})

    def test_stored_meaning_of_credit_issued_is_unchanged(self):
        # credit_issued (stored as customer_credit_issued) stays the total of the
        # returns; only the printed line leaves money refunds out.
        b = breakdown([inv("S1", 100), inv("R1", -40, is_return=1, paid=-40, return_against="S1")],
                      origin_shifts={"S1": SHIFT})
        self.assertEqual((b["credit_issued"], b["refunds"]), (40, 40))
        self.assertEqual(payment_total_lines(b, 60)["credit_notes_issued"], 0)

    def test_total_is_net_sales_whatever_the_money(self):
        b = breakdown([inv("S1", 100, paid=60, redeemed=40)])
        for money, other in ((60, 0.0), (55, 5.0), (65, -5.0)):
            with self.subTest(money):
                block = payment_total_lines(b, money)
                self.assertEqual(block["total"], 100)
                self.assertEqual(block["total_lines"]["other"], other)
                self.assertAlmostEqual(
                    money - block["credit_notes_issued"] + b["credit_redeemed"] + sum(block["total_lines"].values()),
                    block["total"], places=6,
                )


class TestOverviewTotalBlock(unittest.TestCase):
    """The Closing Shift screen gets the same TOTAL block as the print."""

    def test_takings_come_from_the_printed_payment_lines(self):
        from unittest.mock import patch

        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import data, overview, sales_breakdown

        rows = [inv("S1", 100, paid=110, change=10), inv("R1", -40, is_return=1, paid=0, return_against="S1")]
        b = breakdown(rows, {}, {"S1": SHIFT})
        asked = {}

        def counts(sales, returns, change_by_invoice=None, cash_mode_of_payment=None):
            asked.update(sales=sales, returns=returns, change=change_by_invoice, cash=cash_mode_of_payment)
            return {"Cash": mode(1, 100)}

        invoices = [{"name": "S1", "is_return": 0, "change_amount": 10}, {"name": "R1", "is_return": 1, "change_amount": 0}]
        with patch.object(sales_breakdown, "get_sales_breakdown", return_value=dict(b)), patch.object(
            data, "get_payment_mode_counts", side_effect=counts
        ):
            z = overview._shift_z_summary(SHIFT, "Sales Invoice", invoices, "Cash")
        self.assertEqual(asked, {"sales": ["S1"], "returns": ["R1"], "change": {"S1": 10.0}, "cash": "Cash"})
        self.assertEqual((z["money_taken"], z["credit_notes_issued"], z["total"]), (100, 40, 60))
        self.assertEqual(z["total"], z["net_sales"])
        self.assertEqual(z["total_lines"]["other"], 0.0)
        # The existing figures are still there, unchanged.
        self.assertEqual((z["credit_issued"], z["takings"]), (40, 100))


if __name__ == "__main__":
    unittest.main()
