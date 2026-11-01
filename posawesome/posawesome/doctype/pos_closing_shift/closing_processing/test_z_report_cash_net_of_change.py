import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import data, z_report


def _payments_sql(payments):
    """Stand-in for the `tabSales Invoice Payment` queries in
    get_payment_mode_counts, answered from {invoice: [(mode, amount), ...]}."""

    def sql(query, values=None, as_dict=0, pluck=False, **kwargs):
        names = values["names"]
        if "distinct parent" in query:
            return [
                name
                for name in names
                if any(mode == values["mode"] and amount > 0 for mode, amount in payments.get(name, []))
            ]
        positive = "amount > 0" in query
        totals = {}
        for name in names:
            for mode, amount in payments.get(name, []):
                if amount and (amount > 0) == positive:
                    count, total = totals.get(mode, (0, 0.0))
                    totals[mode] = (count + 1, total + amount)
        return [frappe._dict(mode_of_payment=mode, cnt=count, total=total) for mode, (count, total) in totals.items()]

    return sql


def _counts(payments, sales, returns=(), change=None):
    with patch.object(data.frappe.db, "sql", side_effect=_payments_sql(payments)):
        return data.get_payment_mode_counts(
            list(sales), list(returns), change_by_invoice=change or {}, cash_mode_of_payment="Cash"
        )


class TestZReportCashNetOfChange(unittest.TestCase):
    def test_cash_sale_with_change(self):
        # Staging hand test: a 139.300 sale paid 150.000 in cash, 10.700 change.
        counts = _counts({"SINV-1": [("Cash", 150)]}, ["SINV-1"], change={"SINV-1": 10.7})
        self.assertAlmostEqual(counts["Cash"]["sale_total"], 139.3, places=3)
        self.assertEqual(counts["Cash"]["sale_count"], 1)

    def test_split_payment_with_change(self):
        # 100 sale: Visa 60 + Cash 50, 10 change -> Cash 40; cards never carry change.
        counts = _counts(
            {"SINV-1": [("Visa", 60), ("Cash", 50)], "SINV-2": [("Cash", 30)]},
            ["SINV-1", "SINV-2"],
            change={"SINV-1": 10},
        )
        self.assertAlmostEqual(counts["Visa"]["sale_total"], 60, places=3)
        self.assertAlmostEqual(counts["Cash"]["sale_total"], 70, places=3)
        self.assertEqual(counts["Cash"]["sale_count"], 2)

    def test_change_without_a_cash_row_is_not_taken_off_cash(self):
        # An older card-only overpayment turned into change: no cash row, so
        # nothing comes off -- the same as Payment Reconciliation.
        counts = _counts(
            {"SINV-1": [("Visa", 110)], "SINV-2": [("Cash", 30)]},
            ["SINV-1", "SINV-2"],
            change={"SINV-1": 10},
        )
        self.assertAlmostEqual(counts["Visa"]["sale_total"], 110, places=3)
        self.assertAlmostEqual(counts["Cash"]["sale_total"], 30, places=3)

    def test_returns_untouched(self):
        counts = _counts(
            {"SINV-1": [("Cash", 150)], "SINV-RET-1": [("Cash", -20)]},
            ["SINV-1"],
            returns=["SINV-RET-1"],
            change={"SINV-1": 10.7},
        )
        self.assertAlmostEqual(counts["Cash"]["sale_total"], 139.3, places=3)
        self.assertAlmostEqual(counts["Cash"]["return_total"], -20, places=3)

    def test_z_report_prints_cash_net_of_change(self):
        # The Z Report passes each sale's change and the profile's cash mode
        # through; Cash Balance keeps reading Payment Reconciliation.
        shift = frappe._dict(
            name="CS-1",
            doctype="POS Closing Shift",
            docstatus=1,
            pos_profile="Test Pos",
            company="My Co",
            posting_date="2026-11-01",
            net_total=132.667,
            grand_total=139.3,
            customer_credit_issued=0,
            customer_credit_redeemed=0,
            same_shift_exchange_total=0,
            payment_reconciliation=[
                frappe._dict(
                    mode_of_payment="Cash",
                    opening_amount=20,
                    expected_amount=159.3,
                    closing_amount=159.3,
                    difference=0,
                )
            ],
        )
        sale = frappe._dict(
            name="SINV-1",
            is_return=0,
            grand_total=139.3,
            base_grand_total=139.3,
            net_total=132.667,
            base_net_total=132.667,
            conversion_rate=1,
            total_qty=1,
            discount_amount=0,
            base_discount_amount=0,
            total_taxes_and_charges=6.633,
            base_total_taxes_and_charges=6.633,
            change_amount=10.7,
        )
        with patch.object(z_report.frappe, "get_doc", return_value=shift), patch.object(
            z_report, "get_authorized_pos_profile"
        ), patch.object(z_report, "get_shift_invoice_rows", return_value=[sale]), patch.object(
            z_report, "get_shift_line_discount_totals", return_value={}
        ), patch.object(z_report.frappe.db, "get_value", return_value=None), patch.object(
            z_report.frappe, "get_cached_value", return_value="OMR"
        ), patch.object(z_report.frappe.db, "sql", side_effect=_payments_sql({"SINV-1": [("Cash", 150)]})):
            report = z_report.get_z_report_data("CS-1")

        self.assertAlmostEqual(report["payment_modes"]["Cash"]["sale_total"], 139.3, places=3)
        self.assertAlmostEqual(report["net_sales"], 139.3, places=3)
        cash_balance = report["payment_reconciliation"][0]
        self.assertEqual(cash_balance["opening_amount"], 20)
        self.assertAlmostEqual(cash_balance["expected_amount"], 159.3, places=3)


if __name__ == "__main__":
    unittest.main()
