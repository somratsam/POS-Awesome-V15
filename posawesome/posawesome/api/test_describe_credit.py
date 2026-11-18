"""Invoice Management's labels for returns, credit notes and exchanges
(credit_exchange.describe_credit), with the link lookups mocked. The links
themselves are tested on real invoices in test_exchange_links_db."""

import unittest
from unittest.mock import patch

import frappe
from frappe.utils import add_days, add_months, nowdate

from posawesome.posawesome.api import credit_exchange


def _link(sale, note, used, exchange):
    return frappe._dict(sale=sale, credit_note=note, used=used, exchange=exchange)


class TestDescribeCredit(unittest.TestCase):
    def _run(self, rows, links=(), returned=None):
        with patch.object(credit_exchange, "get_credit_links", return_value=list(links)) as get_links, \
             patch.object(credit_exchange, "get_returned_state", return_value=returned or {}):
            credit_exchange.describe_credit(rows)
        return {row["name"]: row for row in rows}, get_links

    def _sale(self, name, **kw):
        row = {"name": name, "is_return": 0, "grand_total": 50, "paid_amount": 50, "outstanding_amount": 0,
               "posting_date": nowdate(), "posa_redeemed_customer_credit": 0}
        row.update(kw)
        return row

    def _ret(self, name, value=30, left=30, paid=0, posted=None):
        return {"name": name, "is_return": 1, "grand_total": -value, "paid_amount": -paid,
                "outstanding_amount": -left, "posting_date": posted or nowdate()}

    def test_one_lookup_for_the_whole_page(self):
        _rows, get_links = self._run([self._sale("S-1"), self._ret("R-1")])
        get_links.assert_called_once_with(sales=["S-1"], credit_notes=["R-1"])

    def test_normal_sale(self):
        rows, _ = self._run([self._sale("S-1")])
        self.assertIsNone(rows["S-1"]["exchange_credit_badge"])
        self.assertEqual(rows["S-1"]["credit_kind"], "sale")
        self.assertEqual((rows["S-1"]["exchange_returns"], rows["S-1"]["returned_state"]), ([], None))

    def test_exchange_sale_and_its_return(self):
        rows, _ = self._run(
            [self._sale("S-1", posa_redeemed_customer_credit=30), self._ret("R-1", value=30, left=0)],
            [_link("S-1", "R-1", 30, True)],
        )
        self.assertEqual((rows["S-1"]["exchange_credit_badge"], rows["S-1"]["credit_kind"]), ("Exchange", "exchange"))
        self.assertEqual(rows["S-1"]["exchange_returns"], ["R-1"])
        self.assertEqual((rows["R-1"]["exchange_credit_badge"], rows["R-1"]["exchange_sales"]), ("Exchange", ["S-1"]))
        self.assertEqual((rows["R-1"]["exchange_used"], rows["R-1"]["credit_issued"]), (30, 0))

    def test_exchange_with_credit_left_issues_a_credit_note_for_the_rest(self):
        rows, _ = self._run([self._ret("R-1", value=92.4, left=31.5)], [_link("S-1", "R-1", 60.9, True)])
        self.assertEqual(rows["R-1"]["credit_issued"], 31.5)
        self.assertEqual(rows["R-1"]["credit_left"], 31.5)

    def test_sale_paid_with_an_older_credit_note(self):
        rows, _ = self._run([self._sale("S-1", posa_redeemed_customer_credit=20)], [_link("S-1", "R-0", 20, False)])
        self.assertEqual((rows["S-1"]["exchange_credit_badge"], rows["S-1"]["credit_kind"]), ("Credit note", "credit_note"))
        self.assertEqual((rows["S-1"]["credit_notes_used"], rows["S-1"]["exchange_returns"]), (["R-0"], []))

    def test_credit_note_unused_part_used_used_and_expired(self):
        old = add_days(add_months(nowdate(), -3), -2)
        rows, _ = self._run(
            [self._ret("R-1"), self._ret("R-2", left=12), self._ret("R-3", left=0), self._ret("R-4", posted=old)],
            [_link("S-2", "R-2", 18, False), _link("S-3", "R-3", 30, False)],
        )
        self.assertEqual((rows["R-1"]["exchange_credit_badge"], rows["R-1"]["credit_issued"], rows["R-1"]["credit_left"]),
                         ("Credit note", 30, 30))
        self.assertEqual(rows["R-2"]["credit_left"], 12)
        self.assertEqual(rows["R-2"]["credit_used_on"], [{"sale": "S-2", "used": 18, "exchange": False}])
        self.assertEqual(rows["R-3"]["credit_left"], 0)
        self.assertFalse(rows["R-1"]["credit_expired"])
        self.assertTrue(rows["R-4"]["credit_expired"])
        self.assertFalse(rows["R-3"]["credit_expired"])  # nothing left, so not "expired"

    def test_money_refund_gets_no_badge(self):
        rows, _ = self._run([self._ret("R-1", value=16.6, left=0, paid=16.6)])
        self.assertIsNone(rows["R-1"]["exchange_credit_badge"])
        self.assertEqual((rows["R-1"]["credit_kind"], rows["R-1"]["credit_value"]), ("refund", 0))

    def test_original_part_and_whole_returned(self):
        rows, _ = self._run(
            [self._sale("S-1"), self._sale("S-2")],
            returned={"S-1": {"state": "part", "returns": ["R-1"]}, "S-2": {"state": "whole", "returns": ["R-2", "R-3"]}},
        )
        self.assertEqual((rows["S-1"]["returned_state"], rows["S-1"]["returned_by"]), ("part", ["R-1"]))
        self.assertEqual((rows["S-2"]["returned_state"], rows["S-2"]["returned_by"]), ("whole", ["R-2", "R-3"]))


class TestInvoiceCreditDetails(unittest.TestCase):
    def test_reads_through_get_list_so_permissions_apply(self):
        with patch.object(credit_exchange.frappe, "get_list", return_value=[]) as get_list:
            self.assertEqual(credit_exchange.get_invoice_credit_details("X"), {})
        self.assertEqual(get_list.call_args.args[0], "Sales Invoice")
        self.assertEqual(get_list.call_args.kwargs["filters"], {"name": "X", "docstatus": 1})
