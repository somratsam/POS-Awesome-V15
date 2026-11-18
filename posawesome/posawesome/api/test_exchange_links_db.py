"""The real return <-> sale link (credit_exchange.get_credit_links) on real
invoices, made through the one-screen exchange. Same setup and skips as
test_one_screen_exchange_db; every test rolls back."""

import unittest

import frappe
from posawesome.posawesome.api.credit_exchange import get_credit_links, get_returned_state
from posawesome.posawesome.api.credit_voucher import credit_note_used_in_exchange, exchange_credit_sources
from posawesome.posawesome.api import test_one_screen_exchange_db as _db

_Base = _db.TestOneScreenExchangeOnInvoices


class TestExchangeLinks(unittest.TestCase):
    setUpClass = classmethod(_Base.setUpClass.__func__)
    setUp = _Base.setUp
    _base, _total, _pay, _original = _Base._base, _Base._total, _Base._pay, _Base._original
    _return, _return_total, _exchange, _doc = _Base._return, _Base._return_total, _Base._exchange, _Base._doc

    def test_exchange_sale_is_linked_to_its_own_return(self):
        original = self._original(self.named, self.cheap, 2)
        result = self._exchange(original, [{"item_code": self.dear, "qty": 1}])
        sale, ret = result["sale"]["name"], result["return"]["name"]
        links = get_credit_links(sales=[sale])
        self.assertEqual([(l.sale, l.credit_note, l.exchange) for l in links], [(sale, ret, True)])
        self.assertAlmostEqual(links[0].used, result["return"]["returned"], places=3)
        # The same link, found from the return's side.
        self.assertEqual([(l.sale, l.exchange) for l in get_credit_links(credit_notes=[ret])], [(sale, True)])

    def test_credit_from_a_return_of_another_shift_is_not_an_exchange(self):
        original = self._original(self.named, self.mid, 2)
        result = self._exchange(original, [{"item_code": self.mid, "qty": 1}], card=0)
        frappe.db.set_value("Sales Invoice", result["return"]["name"], "posa_pos_opening_shift", "OTHER-SHIFT")
        links = get_credit_links(sales=[result["sale"]["name"]])
        self.assertEqual(len(links), 1)
        self.assertFalse(links[0].exchange)
        self.assertEqual(credit_note_used_in_exchange(result["return"]["name"]), "")
        sources = exchange_credit_sources(self._doc(result["sale"]["name"]))
        self.assertEqual(sources.returns, [])
        self.assertGreater(sources.other_credit, 0)

    def test_anonymous_sale_never_matches_another_anonymous_return(self):
        # Two Anonymous returns in the same shift: only the one that paid counts.
        other = self._exchange(self._original(self.generic, self.mid, 2))
        result = self._exchange(self._original(self.generic, self.cheap, 2), [{"item_code": self.dear, "qty": 1}])
        sale = result["sale"]["name"]
        self.assertEqual([l.credit_note for l in get_credit_links(sales=[sale])], [result["return"]["name"]])
        self.assertEqual(get_credit_links(credit_notes=[other["return"]["name"]]), [])
        self.assertEqual(credit_note_used_in_exchange(other["return"]["name"]), "")
        sources = exchange_credit_sources(self._doc(sale))
        self.assertEqual([d.name for d in sources.returns], [result["return"]["name"]])

    def test_plain_return_has_no_link(self):
        result = self._exchange(self._original(self.named, self.mid, 2))
        self.assertEqual(get_credit_links(credit_notes=[result["return"]["name"]]), [])

    def test_returned_part_and_whole(self):
        part = self._original(self.named, self.mid, 2)
        whole = self._original(self.named, self.cheap, 1)
        untouched = self._original(self.named, self.cheap, 1)
        part_return = self._exchange(part)["return"]["name"]
        whole_return = self._exchange(whole)["return"]["name"]
        state = get_returned_state([part.name, whole.name, untouched.name])
        self.assertEqual(state[part.name], {"state": "part", "returns": [part_return]})
        self.assertEqual(state[whole.name], {"state": "whole", "returns": [whole_return]})
        self.assertNotIn(untouched.name, state)
        # The rest of the part-returned receipt: now whole, both returns listed.
        second = self._exchange(part)["return"]["name"]
        state = get_returned_state([part.name])
        self.assertEqual(state[part.name]["state"], "whole")
        self.assertEqual(state[part.name]["returns"], sorted([part_return, second]))

    def test_original_status_follows_its_returns(self):
        original = self._original(self.named, self.mid, 2)
        self.assertEqual(self._doc(original.name).status, "Paid")
        ret = self._exchange(original)["return"]["name"]
        self.assertEqual(self._doc(original.name).status, "Credit Note Issued")
        modified = frappe.db.get_value("Sales Invoice", original.name, "modified")
        self._doc(ret).cancel()
        self.assertEqual(self._doc(original.name).status, "Paid")
        # Status only: the original's modified date is left alone.
        self.assertEqual(frappe.db.get_value("Sales Invoice", original.name, "modified"), modified)

    def test_patch_brings_a_stale_original_in_line(self):
        from posawesome.patches import refresh_returned_invoice_status as patch

        original = self._original(self.named, self.mid, 2)
        self._exchange(original)
        frappe.db.set_value("Sales Invoice", original.name, "status", "Paid", update_modified=False)
        self.assertIn((original.name, "Paid", "Credit Note Issued"), patch._changes())
        patch.execute()
        self.assertEqual(frappe.db.get_value("Sales Invoice", original.name, "status"), "Credit Note Issued")
        self.assertNotIn(original.name, [name for name, _b, _a in patch._changes()])

    def test_cancelled_sale_is_not_linked(self):
        original = self._original(self.named, self.cheap, 2)
        result = self._exchange(original, [{"item_code": self.dear, "qty": 1}])
        frappe.db.set_value("Sales Invoice", result["sale"]["name"], "docstatus", 2)
        self.assertEqual(get_credit_links(credit_notes=[result["return"]["name"]]), [])

    def test_empty_input(self):
        self.assertEqual(get_credit_links(), [])
        self.assertEqual(get_credit_links(sales=[], credit_notes=[None, ""]), [])
        self.assertEqual(get_returned_state([]), {})


# Only this module's own tests are collected, not the base class's.
del _Base


class TestLinkQueryParameters(unittest.TestCase):
    def test_names_are_query_parameters_never_formatted_in(self):
        from unittest import mock

        from posawesome.posawesome.api import credit_exchange

        evil = "S-1') or 1=1 -- "
        with mock.patch.object(credit_exchange.frappe.db, "sql", return_value=[]) as sql:
            credit_exchange.get_credit_links(sales=[evil], credit_notes=[evil])
            credit_exchange.get_returned_state([evil])
        for call in sql.call_args_list:
            self.assertNotIn(evil, call.args[0])
            self.assertEqual(call.args[1], {"names": (evil,)})
