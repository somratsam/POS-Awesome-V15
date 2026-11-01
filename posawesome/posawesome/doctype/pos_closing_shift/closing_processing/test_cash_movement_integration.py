import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import creation, overview


def _resolve_opening_shift(mock_exchange_frappe, returning_customers=()):
    """Point credit_exchange.get_customers_with_same_shift_return() -- called by
    the overview's "Exchanges Today" figure -- at the same opening shift this
    test's get_doc returns, instead of a real database lookup."""
    mock_exchange_frappe.db.get_value.return_value = ("POS-PROFILE-1", "My Co")
    mock_exchange_frappe.get_all.return_value = list(returning_customers)


class DummyClosingShift:
    def __init__(self):
        self.pos_opening_shift = None
        self.period_start_date = None
        self.period_end_date = None
        self.pos_profile = None
        self.user = None
        self.company = None
        self.grand_total = 0
        self.net_total = 0
        self.total_quantity = 0
        self.tables = {}

    def set(self, key, value):
        self.tables[key] = value


class TestClosingShiftCashMovementIntegration(unittest.TestCase):
    @patch("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation.fetch_shift_payment_entries")
    @patch("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation.fetch_shift_invoices")
    @patch(
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation.submit_printed_invoices"
    )
    @patch("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation.authorize_shift_close")
    @patch("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation.frappe")
    def test_make_closing_shift_deducts_cash_movements_from_cash_expected(
        self,
        mock_frappe,
        mock_authorize_shift_close,
        mock_submit_printed_invoices,
        mock_get_pos_invoices,
        mock_get_payments_entries,
    ):
        mock_submit_printed_invoices.return_value = []
        mock_get_pos_invoices.return_value = []
        mock_get_payments_entries.return_value = []
        mock_frappe.get_cached_value.return_value = "USD"
        mock_frappe.get_value.return_value = "Cash"
        mock_frappe.get_all.return_value = [{"amount": 20}]
        mock_frappe.utils.get_datetime.return_value = "2026-02-11 10:00:00"
        closing_doc = DummyClosingShift()
        mock_frappe.new_doc.return_value = closing_doc
        mock_frappe._dict.side_effect = lambda d: SimpleNamespace(**d)

        opening_shift = {
            "name": "POS-OPEN-1",
            "period_start_date": "2026-02-11 08:00:00",
            "pos_profile": "POS-PROFILE-1",
            "user": "cashier@example.com",
            "company": "My Co",
            "balance_details": [{"mode_of_payment": "Cash", "amount": 50}],
        }

        # The closing is built from the stored opening shift the check returns.
        mock_authorize_shift_close.return_value = SimpleNamespace(as_dict=lambda: opening_shift)
        result = creation.make_closing_shift_from_opening(json.dumps(opening_shift))

        self.assertEqual(result["closing_shift"], closing_doc)
        self.assertEqual(result["skipped_printed_invoices"], [])
        payment_rows = closing_doc.tables.get("payment_reconciliation") or []
        self.assertEqual(len(payment_rows), 1)
        row = payment_rows[0]
        self.assertEqual(row.mode_of_payment, "Cash")
        self.assertEqual(row.opening_amount, 50)
        self.assertEqual(row.expected_amount, 30)

    def test_overview_includes_cash_movements_and_adjusts_cash_expected(self):
        result, reconciliation = _overview_and_reconciliation(
            balance={"Cash": 0},
            invoices=[],
            movements=[
                {"movement_type": "Expense", "amount": 35},
                {"movement_type": "Deposit", "amount": 15},
            ],
        )

        self.assertEqual(result["cash_movements"]["count"], 2)
        self.assertEqual(result["cash_movements"]["company_currency_total"], 50)
        self.assertEqual(reconciliation["Cash"].expected_amount, -50)
        self.assertEqual(result["cash_expected"]["company_currency_total"], -50)
        by_type = {row["movement_type"]: row["total"] for row in result["cash_movements"]["by_type"]}
        self.assertEqual(by_type["Expense"], 35)
        self.assertEqual(by_type["Deposit"], 15)

    def test_overview_expected_cash_includes_opening_float(self):
        # 50 opening cash, 20 out as a cash movement, no sales.
        result, reconciliation = _overview_and_reconciliation(
            balance={"Cash": 50, "Visa": 7},
            invoices=[],
            movements=[{"movement_type": "Expense", "amount": 20}],
        )

        self.assertEqual(reconciliation["Cash"].expected_amount, 30)
        cash_expected = result["cash_expected"]
        self.assertEqual(cash_expected["company_currency_total"], 30)
        self.assertEqual(cash_expected["opening_amount"], 50)
        self.assertEqual(cash_expected["cash_taken"], -20)
        self.assertEqual([(row["currency"], row["total"]) for row in cash_expected["by_currency"]], [("OMR", 30)])
        cash_payments = [row for row in result["payments_by_mode"] if row["mode_of_payment"] == "Cash"]
        self.assertEqual([row["company_currency_total"] for row in cash_payments], [-20])

    def test_overview_expected_cash_takes_off_change_given(self):
        # Hand test on staging: 20.000 opening, one 139.300 sale, the customer
        # paid 150.000 in cash and got 10.700 change. The drawer should hold
        # 159.300 -- the card used to say 170.000.
        result, reconciliation = _overview_and_reconciliation(
            balance={"Cash": 20, "Visa": 0},
            invoices=[_invoice("SINV-1", 139.3, [("Cash", 150)], change=10.7)],
        )

        self.assertAlmostEqual(reconciliation["Cash"].expected_amount, 159.3, places=3)
        cash_expected = result["cash_expected"]
        self.assertAlmostEqual(cash_expected["company_currency_total"], 159.3, places=3)
        self.assertEqual(cash_expected["opening_amount"], 20)
        self.assertAlmostEqual(cash_expected["cash_taken"], 139.3, places=3)
        self.assertEqual(len(cash_expected["by_currency"]), 1)
        self.assertAlmostEqual(cash_expected["by_currency"][0]["total"], 159.3, places=3)
        self.assertAlmostEqual(result["change_returned"]["company_currency_total"], 10.7, places=3)

    def test_overview_expected_cash_matches_reconciliation_with_split_payments_and_returns(self):
        # Split card + cash with change, a cash-only sale, a credit-only return
        # (no payment rows) and a cash refund return, plus a cash movement.
        result, reconciliation = _overview_and_reconciliation(
            balance={"Cash": 20, "Visa": 0},
            invoices=[
                _invoice("SINV-1", 100, [("Visa", 60), ("Cash", 50)], change=10),
                _invoice("SINV-2", 30, [("Cash", 30)]),
                _invoice("SINV-RET-1", -20, [], is_return=1),
                _invoice("SINV-RET-2", -15, [("Cash", -15)], is_return=1),
            ],
            movements=[{"movement_type": "Expense", "amount": 5}],
        )

        # 20 opening + 40 (50 less 10 change) + 30 - 15 refunded - 5 out = 70
        self.assertAlmostEqual(reconciliation["Cash"].expected_amount, 70, places=3)
        self.assertAlmostEqual(result["cash_expected"]["company_currency_total"], 70, places=3)
        self.assertAlmostEqual(result["cash_expected"]["cash_taken"], 50, places=3)
        self.assertAlmostEqual(reconciliation["Visa"].expected_amount, 60, places=3)


OVERVIEW = "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.overview"
CREATION = "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation"


class _OpeningShift(SimpleNamespace):
    def as_dict(self):
        return dict(vars(self))


class _ClosingShift(DummyClosingShift):
    def get(self, key, default=None):
        return self.tables.get(key, default)


class _Row(dict):
    __getattr__ = dict.get


def _invoice(name, grand_total, payments, change=0, is_return=0):
    return _Row(
        name=name,
        currency="OMR",
        conversion_rate=1,
        posting_date="2026-11-01",
        customer="Sample Customer",
        is_return=is_return,
        grand_total=grand_total,
        base_grand_total=grand_total,
        rounded_total=grand_total,
        net_total=grand_total,
        base_net_total=grand_total,
        total_qty=1,
        taxes=[],
        change_amount=change,
        base_change_amount=change,
        payments=[_Row(mode_of_payment=mode, amount=amount, base_amount=amount) for mode, amount in payments],
    )


def _overview_and_reconciliation(balance, invoices, movements=()):
    """Run the closing overview and the Payment Reconciliation build
    (creation.build_closing_shift, which the closing variance rule uses) on
    the same shift, so a test can check the two agree."""
    opening = _OpeningShift(
        doctype="POS Opening Shift",
        name="POS-OPEN-1",
        pos_profile="POS-PROFILE-1",
        company="My Co",
        user="cashier@example.com",
        period_start_date="2026-11-01 08:00:00",
        balance_details=[{"mode_of_payment": mode, "amount": amount} for mode, amount in balance.items()],
    )
    movements = list(movements)
    with patch(f"{OVERVIEW}.frappe.get_doc", return_value=opening), patch(
        f"{OVERVIEW}.frappe.get_cached_value", return_value="OMR"
    ), patch(
        f"{OVERVIEW}.frappe.db.get_value",
        side_effect=lambda doctype, name, field, *args, **kwargs: (
            0 if field == "create_pos_invoice_instead_of_sales_invoice" else "Cash"
        ),
    ), patch(f"{OVERVIEW}.frappe.get_all", return_value=movements), patch(
        f"{OVERVIEW}.fetch_shift_invoices", return_value=invoices
    ), patch(f"{OVERVIEW}.fetch_shift_payment_entries", return_value=[]), patch(
        f"{OVERVIEW}.get_authorized_pos_profile"
    ), patch("posawesome.posawesome.api.credit_exchange.get_authorized_pos_profile"), patch(
        "posawesome.posawesome.api.credit_exchange.frappe"
    ) as exchange_frappe, patch(f"{CREATION}.frappe") as creation_frappe, patch(
        f"{CREATION}.fetch_shift_invoices", return_value=invoices
    ), patch(f"{CREATION}.fetch_shift_payment_entries", return_value=[]):
        creation_frappe.get_cached_value.return_value = "OMR"
        creation_frappe.get_value.return_value = "Cash"
        creation_frappe.db.get_value.return_value = 0
        creation_frappe.get_all.return_value = [{"amount": row["amount"]} for row in movements]
        creation_frappe.utils.get_datetime.return_value = "2026-11-01 20:00:00"
        creation_frappe.new_doc.side_effect = lambda doctype: _ClosingShift()
        creation_frappe._dict.side_effect = lambda d: SimpleNamespace(**d)
        _resolve_opening_shift(exchange_frappe)

        result = overview.get_closing_shift_overview("POS-OPEN-1")
        closing = creation.build_closing_shift(opening.as_dict())
    reconciliation = {row.mode_of_payment: row for row in closing.get("payment_reconciliation")}
    return result, reconciliation


if __name__ == "__main__":
    unittest.main()
