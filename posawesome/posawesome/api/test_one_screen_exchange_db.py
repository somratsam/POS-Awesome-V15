"""One-screen exchange on real invoices: both saved or neither.

Needs a Sales Invoice POS Profile to copy, three stock items priced in its
price list, a named customer and a generic (Anonymous) customer; skipped
otherwise. Each test runs on its own copy of that profile (TEST_PROFILE_PREFIX)
with its own open POS Opening Shift for Administrator, so no real profile or
shift is ever changed (a test once switched One-screen exchange off on the
profile of Administrator's open shift). Every test rolls back: nothing is
committed. The till's PIN cashier is stubbed to Administrator; everything
else (ERPNext validation, VAT, stock, GL, loyalty, the credit Journal Entry,
the submission ledger) runs for real.
"""

import json
import unittest
import uuid
from unittest import mock

import frappe
from frappe.utils import flt

from posawesome.posawesome.api import one_screen_exchange as ex
from posawesome.posawesome.api.invoice_processing import creation

COUNTED = (
    "Sales Invoice",
    "Journal Entry",
    "GL Entry",
    "Stock Ledger Entry",
    "POS Invoice Submission Ledger",
    "Loyalty Point Entry",
    "Payment Entry",
)


TEST_PROFILE_PREFIX = "_Test One-screen Exchange"


def _counts():
    return {dt: frappe.db.count(dt) for dt in COUNTED}


class TestOneScreenExchangeOnInvoices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        _delete_test_profiles()
        # The template only: read, never changed. Each test gets its own copy.
        template = frappe.db.get_value(
            "POS Profile",
            {
                "disabled": 0,
                "create_pos_invoice_instead_of_sales_invoice": 0,
                "name": ["not like", f"{TEST_PROFILE_PREFIX}%"],
            },
            "name",
            order_by="modified desc",
        )
        if not template:
            raise unittest.SkipTest("Needs a Sales Invoice POS Profile")
        profile = frappe.get_doc("POS Profile", template)
        items = frappe.db.sql(
            """
            select ip.item_code, ip.price_list_rate
            from `tabItem Price` ip
            join `tabItem` i on i.name = ip.item_code
            join `tabBin` b on b.item_code = ip.item_code and b.warehouse = %(warehouse)s
            where ip.price_list = %(price_list)s and i.disabled = 0 and i.has_variants = 0
                and i.is_stock_item = 1 and b.actual_qty >= 30 and ip.price_list_rate > 0
            group by ip.item_code
            order by ip.price_list_rate
            """,
            {"warehouse": profile.warehouse, "price_list": profile.selling_price_list},
            as_dict=True,
        )
        prices = {}
        for row in items:
            prices.setdefault(flt(row.price_list_rate, 3), row.item_code)
        distinct = sorted(prices.items())
        if len(distinct) < 3:
            raise unittest.SkipTest("Needs three stock items with different prices")
        named = frappe.db.get_value("Customer", {"posa_is_generic_customer": 0, "disabled": 0}, "name")
        generic = frappe.db.get_value("Customer", {"posa_is_generic_customer": 1, "disabled": 0}, "name")
        if not named or not generic:
            raise unittest.SkipTest("Needs a named and a generic customer")
        cls.template = profile
        cls.named, cls.generic = named, generic
        # cheap < mid < dear
        cls.cheap, cls.mid, cls.dear = distinct[0][1], distinct[len(distinct) // 2][1], distinct[-1][1]

    @classmethod
    def tearDownClass(cls):
        # Each test rolls back; this only catches a copy left by a commit
        # somewhere inside the code under test.
        _delete_test_profiles()

    def setUp(self):
        frappe.set_user("Administrator")
        self.addCleanup(frappe.db.rollback)
        self.profile, self.shift = self._own_profile_and_shift()
        for target in ("_resolve_authoritative_cashier", "get_active_terminal_cashier"):
            patcher = mock.patch.object(creation, target, return_value="Administrator")
            patcher.start()
            self.addCleanup(patcher.stop)

    def _own_profile_and_shift(self):
        """A copy of the template profile with One-screen exchange on, and an
        open shift for Administrator on it -- inside this test's transaction."""
        copy = frappe.copy_doc(self.template)
        copy.set("__newname", f"{TEST_PROFILE_PREFIX} {uuid.uuid4().hex[:8]}")
        copy.posa_one_screen_exchange = 1
        for row in copy.get("applicable_for_users") or []:
            row.default = 0  # the real profile keeps its users' default
        copy.insert(ignore_permissions=True)
        shift = frappe.get_doc(
            {
                "doctype": "POS Opening Shift",
                "period_start_date": frappe.utils.now_datetime(),
                "posting_date": frappe.utils.nowdate(),
                "company": copy.company,
                "pos_profile": copy.name,
                "user": "Administrator",
                "balance_details": [
                    {"mode_of_payment": row.mode_of_payment, "amount": 0} for row in copy.payments
                ],
            }
        )
        shift.insert(ignore_permissions=True)
        shift.submit()
        return frappe.get_doc("POS Profile", copy.name), shift.name

    # helpers ---------------------------------------------------------------

    def _base(self, customer, items, payments, **kw):
        doc = {
            "doctype": "Sales Invoice",
            "company": self.profile.company,
            "pos_profile": self.profile.name,
            "customer": customer,
            "posa_pos_opening_shift": self.shift,
            "is_pos": 1,
            "update_stock": 1,
            "selling_price_list": self.profile.selling_price_list,
            "currency": self.profile.currency,
            "items": items,
            "payments": payments,
        }
        doc.update(kw)
        return doc

    def _total(self, payload):
        doc = frappe.get_doc(json.loads(json.dumps(payload)))
        doc.set_missing_values(for_validate=True)
        doc.disable_rounded_total = self.profile.disable_rounded_total
        doc.calculate_taxes_and_totals()
        return flt(doc.rounded_total or doc.grand_total, 3)

    def _pay(self, cash=0, card=0):
        modes = {row.mode_of_payment: row for row in self.profile.payments}
        types = dict(frappe.get_all("Mode of Payment", fields=["name", "type"], as_list=True))
        cash_mode = next((m for m in modes if types.get(m) == "Cash"), None)
        card_mode = next((m for m in modes if types.get(m) == "Bank"), None)
        return [
            {"mode_of_payment": cash_mode, "amount": cash},
            {"mode_of_payment": card_mode, "amount": card},
        ]

    def _original(self, customer, item, qty):
        payload = self._base(customer, [{"item_code": item, "qty": qty}], self._pay())
        payload["payments"] = self._pay(card=self._total(payload))
        response = creation.submit_invoice(json.dumps(payload), "{}", 0)
        return frappe.get_doc("Sales Invoice", response["name"])

    def _return(self, original, qty=1, **line):
        """What the till sends: which line, how many. Prices come from the server."""
        row = original.items[0]
        item = {"sales_invoice_item": row.name, "qty": qty}
        item.update(line)
        return {
            "doctype": "Sales Invoice",
            "company": self.profile.company,
            "pos_profile": self.profile.name,
            "customer": original.customer,
            "posa_pos_opening_shift": self.shift,
            "is_return": 1,
            "return_against": original.name,
            "items": [item],
            "payments": [],
        }

    def _return_total(self, original, qty=1):
        row = original.items[0]
        return flt(abs(flt(original.rounded_total or original.grand_total)) * qty / flt(row.qty), 3)

    def _exchange(self, original, new_items=None, card=None, ret_qty=1, expected=None, sale_data=None, xid=None, customer=None):
        return_payload = self._return(original, ret_qty)
        returned = self._return_total(original, ret_qty)
        sale = sale_total = None
        if new_items is not None:
            sale = self._base(customer or original.customer, new_items, self._pay())
            sale_total = self._total(sale)
            sale["payments"] = self._pay(card=max(sale_total - returned, 0) if card is None else card)
        figures = {
            "returned": returned,
            "sale_total": sale_total,
            "pay": max(sale_total - returned, 0) if sale_total is not None else None,
        }
        figures.update(expected or {})
        return ex.submit_exchange(
            json.dumps(return_payload),
            "{}",
            json.dumps(sale) if sale else None,
            json.dumps(sale_data or {}),
            xid or uuid.uuid4().hex,
            json.dumps(figures),
        )

    def assertNothingSaved(self, fn, contains=None):
        before = _counts()
        with self.assertRaises(Exception) as ctx:
            fn()
        self.assertEqual(_counts(), before, f"something was saved: {ctx.exception}")
        if contains:
            self.assertIn(contains, str(ctx.exception))

    def _doc(self, name):
        return frappe.get_doc("Sales Invoice", name)

    # the three cases -------------------------------------------------------

    def test_customer_pays_more(self):
        original = self._original(self.named, self.cheap, 2)
        before = _counts()
        result = self._exchange(original, [{"item_code": self.dear, "qty": 1}])
        sale, ret = self._doc(result["sale"]["name"]), self._doc(result["return"]["name"])
        self.assertEqual(ret.return_against, original.name)
        self.assertEqual((sale.docstatus, ret.docstatus), (1, 1))
        self.assertAlmostEqual(flt(sale.outstanding_amount), 0, places=3)
        self.assertAlmostEqual(flt(ret.outstanding_amount), 0, places=3)
        self.assertEqual(result["credit_left"], 0)
        self.assertEqual(sale.posa_credit_authorized_by, f"{ret.name}: exchange")
        self.assertEqual(_counts()["Journal Entry"] - before["Journal Entry"], 1)
        self.assertEqual(flt(sale.paid_amount, 3), result["sale"]["pay"])
        # VAT: the return reverses VAT against the original, the sale charges it.
        if self.profile.taxes_and_charges:
            self.assertLess(flt(ret.total_taxes_and_charges), 0)
            self.assertGreater(flt(sale.total_taxes_and_charges), 0)

    def test_credit_left(self):
        original = self._original(self.named, self.mid, 3)
        result = self._exchange(original, [{"item_code": self.cheap, "qty": 1}], card=0)
        ret = self._doc(result["return"]["name"])
        self.assertEqual(result["sale"]["pay"], 0)
        self.assertGreater(result["credit_left"], 0)
        # The rest stays on the same return (section 87), for the BALANCE voucher.
        self.assertAlmostEqual(-flt(ret.outstanding_amount), result["credit_left"], places=3)
        self.assertEqual(result["credit_left"], flt(result["return"]["returned"] - result["sale"]["total"], 3))

    def test_even_exchange(self):
        original = self._original(self.named, self.mid, 2)
        result = self._exchange(original, [{"item_code": self.mid, "qty": 1}], card=0)
        self.assertEqual((result["sale"]["pay"], result["credit_left"]), (0, 0))
        # Reprinted later, the used voucher names the exchange sale.
        from posawesome.posawesome.api.credit_voucher import credit_note_used_in_exchange

        self.assertEqual(credit_note_used_in_exchange(result["return"]["name"]), result["sale"]["name"])

    def test_plain_return(self):
        original = self._original(self.named, self.mid, 2)
        result = self._exchange(original)
        self.assertIsNone(result["sale"])
        self.assertEqual(result["credit_left"], result["return"]["returned"])

    def test_generic_customer_spends_its_new_return_without_a_voucher(self):
        original = self._original(self.generic, self.cheap, 2)
        result = self._exchange(original, [{"item_code": self.dear, "qty": 1}])
        sale = self._doc(result["sale"]["name"])
        self.assertEqual(sale.customer, self.generic)
        self.assertAlmostEqual(flt(sale.outstanding_amount), 0, places=3)
        self.assertTrue(result["return"].get("posa_bearer_voucher"))

    def test_replay_returns_the_same_pair(self):
        original = self._original(self.named, self.mid, 3)
        xid = uuid.uuid4().hex
        first = self._exchange(original, [{"item_code": self.mid, "qty": 1}], card=0, xid=xid)
        after_first = _counts()
        again = self._exchange(original, [{"item_code": self.mid, "qty": 1}], card=0, xid=xid)
        self.assertEqual((first["return"]["name"], first["sale"]["name"]), (again["return"]["name"], again["sale"]["name"]))
        self.assertTrue(again["replayed"])
        self.assertEqual(_counts(), after_first)

    def test_background_submission_setting_is_ignored(self):
        frappe.db.set_value("POS Profile", self.profile.name, "posa_allow_submissions_in_background_job", 1)
        original = self._original(self.named, self.cheap, 2)
        with mock.patch.object(creation, "enqueue", side_effect=AssertionError("queued")):
            result = self._exchange(original, [{"item_code": self.dear, "qty": 1}])
        self.assertAlmostEqual(flt(self._doc(result["sale"]["name"]).outstanding_amount), 0, places=3)

    def test_client_credit_rows_are_ignored(self):
        original = self._original(self.named, self.mid, 2)
        result = self._exchange(
            original,
            [{"item_code": self.mid, "qty": 1}],
            card=0,
            sale_data={
                "customer_credit_redemption_requested": 1,
                "redeemed_customer_credit": 999,
                "customer_credit_dict": [{"type": "Invoice", "credit_origin": "SOMETHING-ELSE", "credit_to_redeem": 999}],
            },
        )
        sale = self._doc(result["sale"]["name"])
        self.assertEqual(sale.posa_credit_authorized_by, f"{result['return']['name']}: exchange")

    # a failure at each step: nothing saved ----------------------------------

    def _fail_at_submit(self, kind):
        real = creation._run_without_return_outstanding_prompts

        def run(doc, operation):
            if bool(doc.is_return) == (kind == "return") and operation == getattr(doc, "submit", None):
                raise frappe.ValidationError(f"injected: {kind} submit")
            return real(doc, operation)

        return mock.patch.object(creation, "_run_without_return_outstanding_prompts", side_effect=run)

    def test_return_submit_fails(self):
        original = self._original(self.named, self.cheap, 2)
        with self._fail_at_submit("return"):
            self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "injected")

    def test_sale_checks_fail(self):
        original = self._original(self.named, self.cheap, 2)
        real = creation.validate_invoice_item_sale_controls

        def check(doc):
            if not doc.is_return:
                raise frappe.ValidationError("injected: sale checks")
            return real(doc)

        with mock.patch.object(creation, "validate_invoice_item_sale_controls", side_effect=check):
            self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "injected")

    def test_sale_submit_fails_after_the_return_was_submitted(self):
        original = self._original(self.named, self.cheap, 2)
        with self._fail_at_submit("sale"):
            self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "injected")

    def test_credit_journal_entry_fails(self):
        original = self._original(self.named, self.cheap, 2)
        with mock.patch.object(creation, "redeeming_customer_credit", side_effect=frappe.ValidationError("injected: JE")):
            self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "injected")

    def test_deadlock_on_the_last_ledger_update(self):
        original = self._original(self.named, self.cheap, 2)
        real = creation._update_submission_ledger_by_name

        def update(name, state, **kw):
            if state == creation.STATE_POST_SUBMIT_DONE and ex.exchange_credit_origin():
                raise frappe.QueryDeadlockError("injected: deadlock")
            return real(name, state, **kw)

        with mock.patch.object(creation, "_update_submission_ledger_by_name", side_effect=update):
            self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "injected")

    def test_figures_the_till_showed_must_match(self):
        original = self._original(self.named, self.cheap, 3)
        new = [{"item_code": self.dear, "qty": 1}]
        self.assertNothingSaved(lambda: self._exchange(original, new, expected={"pay": 0.001}), "Totals changed")
        self.assertNothingSaved(lambda: self._exchange(original, new, expected={"returned": 0.001}), "Totals changed")
        self.assertNothingSaved(lambda: self._exchange(original, new, expected={"sale_total": 99999, "pay": 0}))

    def test_underpaid(self):
        original = self._original(self.named, self.cheap, 2)
        self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}], card=0))

    # receipts that can't be exchanged ---------------------------------------

    def test_cancelled_receipt(self):
        original = self._original(self.named, self.cheap, 1)
        original.cancel()
        self.assertNothingSaved(lambda: self._exchange(original), "This receipt was cancelled")

    def test_return_receipt(self):
        original = self._original(self.named, self.cheap, 2)
        credit_note = self._doc(self._exchange(original)["return"]["name"])

        def against_return():
            payload = self._return(original)
            payload["return_against"] = credit_note.name
            ex.submit_exchange(json.dumps(payload), "{}", None, "{}", uuid.uuid4().hex, json.dumps({"returned": 1}))

        self.assertNothingSaved(against_return, "This is a return receipt, not a sale")

    def test_past_the_return_date(self):
        from posawesome.posawesome.api.invoice_processing.utils import _get_return_validity_settings

        enabled, days = _get_return_validity_settings(self.profile.name)
        if not enabled:
            self.skipTest("Return validity is off on this profile")
        original = self._original(self.named, self.cheap, 1)
        frappe.db.set_value("Sales Invoice", original.name, "posting_date", frappe.utils.add_days(frappe.utils.nowdate(), -(days + 2)))
        original.reload()
        self.assertNothingSaved(lambda: self._exchange(original, [{"item_code": self.dear, "qty": 1}]), "Return period ended on")

    def test_prices_come_from_the_receipt(self):
        original = self._original(self.named, self.mid, 2)
        before = _counts()
        payload = self._return(original, 1, rate=0.001, discount_percentage=99, item_code=self.cheap)
        result = ex.submit_exchange(
            json.dumps(payload), "{}", None, "{}", uuid.uuid4().hex,
            json.dumps({"returned": self._return_total(original, 1)}),
        )
        ret = self._doc(result["return"]["name"])
        self.assertEqual(ret.items[0].item_code, original.items[0].item_code)
        self.assertEqual(flt(ret.items[0].rate, 3), flt(original.items[0].rate, 3))
        self.assertEqual(flt(ret.items[0].discount_percentage), flt(original.items[0].discount_percentage))
        self.assertEqual(_counts()["Sales Invoice"] - before["Sales Invoice"], 1)

    def test_more_than_is_left_is_refused(self):
        original = self._original(self.named, self.mid, 2)
        self._exchange(original)  # 1 returned, 1 left
        self.assertNothingSaved(lambda: self._exchange(original, ret_qty=2), "can still be returned")

    def test_a_line_from_another_receipt_is_refused(self):
        original = self._original(self.named, self.mid, 2)
        other = self._original(self.named, self.cheap, 2)
        payload = self._return(original, 1, sales_invoice_item=other.items[0].name)
        self.assertNothingSaved(
            lambda: ex.submit_exchange(json.dumps(payload), "{}", None, "{}", uuid.uuid4().hex, json.dumps({"returned": 1})),
            "isn't on this receipt",
        )

    def test_receipt_for_the_picker(self):
        original = self._original(self.named, self.mid, 3)
        self._exchange(original)  # returns 1
        receipt = ex.get_exchange_receipt(original.name, self.profile.name)
        self.assertEqual(receipt["found"], 1)
        self.assertNotIn("error", receipt)
        line = receipt["lines"][0]
        self.assertEqual((line["sold"], line["returned"], line["left"]), (3, 1, 2))
        self.assertEqual(len(line["history"]), 1)
        self.assertEqual(ex.get_exchange_receipt("NOT-A-RECEIPT-123", self.profile.name), {"found": 0})
        self.assertEqual(ex.get_exchange_receipt(self.cheap, self.profile.name), {"found": 0})

    def test_receipt_messages_for_the_picker(self):
        cancelled = self._original(self.named, self.cheap, 1)
        cancelled.cancel()
        self.assertEqual(ex.get_exchange_receipt(cancelled.name, self.profile.name)["error"], "This receipt was cancelled")
        original = self._original(self.named, self.cheap, 2)
        credit_note = self._exchange(original)["return"]["name"]
        self.assertEqual(
            ex.get_exchange_receipt(credit_note, self.profile.name)["error"], "This is a return receipt, not a sale"
        )

    def test_quote_matches_the_submit_and_saves_nothing(self):
        original = self._original(self.named, self.cheap, 2)
        sale = self._base(self.named, [{"item_code": self.dear, "qty": 1}], self._pay())
        before = _counts()
        quote = ex.quote_exchange(json.dumps(self._return(original, 1)), json.dumps(sale))
        self.assertEqual(_counts(), before)
        self.assertEqual(quote["returned"], self._return_total(original, 1))
        self.assertEqual(quote["sale_total"], self._total(sale))
        sale["payments"] = self._pay(card=quote["pay"])
        result = ex.submit_exchange(
            json.dumps(self._return(original, 1)), "{}", json.dumps(sale), "{}", uuid.uuid4().hex,
            json.dumps({k: quote[k] for k in ("returned", "sale_total", "pay")}),
        )
        self.assertEqual(result["sale"]["pay"], quote["pay"])
        self.assertEqual(result["credit_left"], quote["credit_left"])

    def _draft(self, key=None, is_return=False, original=None):
        payload = self._base(self.named, [{"item_code": self.cheap, "qty": -1 if is_return else 1}], self._pay())
        if is_return:
            payload.update(is_return=1, return_against=original.name)
        doc = frappe.get_doc(payload)
        if key:
            doc.posa_client_request_id = key
        doc.insert(ignore_permissions=True)
        return doc.name

    def test_discard_deletes_only_that_exchanges_own_draft(self):
        xid = uuid.uuid4().hex
        original = self._original(self.named, self.cheap, 2)
        own = self._draft(f"{xid}:sale")
        unrelated = self._draft()
        other_exchange = self._draft(f"{uuid.uuid4().hex}:sale")

        result = ex.discard_exchange_draft(xid, self.profile.name)

        self.assertEqual(result["deleted"], [own])
        self.assertFalse(frappe.db.exists("Sales Invoice", own))
        for name in (unrelated, other_exchange, original.name):
            self.assertTrue(frappe.db.exists("Sales Invoice", name), name)
        # nothing left to delete the second time
        self.assertEqual(ex.discard_exchange_draft(xid, self.profile.name)["deleted"], [])

    def test_discard_never_touches_a_submitted_sale_or_a_return(self):
        # The key is unique per invoice; even under it, only a sale draft goes.
        submitted_key, return_key = uuid.uuid4().hex, uuid.uuid4().hex
        submitted = self._original(self.named, self.cheap, 2)
        frappe.db.set_value("Sales Invoice", submitted.name, "posa_client_request_id", f"{submitted_key}:sale")
        return_draft = self._draft(f"{return_key}:sale", is_return=True, original=submitted)
        self.assertEqual(ex.discard_exchange_draft(submitted_key, self.profile.name)["deleted"], [])
        self.assertEqual(ex.discard_exchange_draft(return_key, self.profile.name)["deleted"], [])
        self.assertEqual(frappe.db.get_value("Sales Invoice", submitted.name, "docstatus"), 1)
        self.assertTrue(frappe.db.exists("Sales Invoice", return_draft))

    def test_discard_works_without_the_profiles_delete_setting(self):
        frappe.db.set_value("POS Profile", self.profile.name, "posa_allow_delete", 0)
        xid = uuid.uuid4().hex
        own = self._draft(f"{xid}:sale")
        ex.discard_exchange_draft(xid, self.profile.name)
        self.assertFalse(frappe.db.exists("Sales Invoice", own))

    def test_discard_refuses_a_bad_key(self):
        with self.assertRaises(frappe.ValidationError):
            ex.discard_exchange_draft("a:b", self.profile.name)
        with self.assertRaises(frappe.ValidationError):
            ex.discard_exchange_draft("", self.profile.name)

    def test_quote_leaves_no_notifications_behind(self):
        original = self._original(self.named, self.cheap, 2)
        sale = self._base(self.named, [{"item_code": self.dear, "qty": 1}], self._pay())
        for start in (None, []):  # no list yet, and an empty one
            if start is None:
                try:
                    del frappe.local._realtime_log
                except AttributeError:
                    pass
            else:
                frappe.local._realtime_log = start
            ex.quote_exchange(json.dumps(self._return(original, 1)), json.dumps(sale))
            self.assertEqual(getattr(frappe.local, "_realtime_log", []), [])

    def test_setting_off(self):
        original = self._original(self.named, self.cheap, 1)
        frappe.db.set_value("POS Profile", self.profile.name, "posa_one_screen_exchange", 0)
        self.assertNothingSaved(lambda: self._exchange(original), "not switched on")


def _delete_test_profiles():
    """Remove copies left behind by a commit inside the code under test.
    Only names starting with TEST_PROFILE_PREFIX are touched."""
    names = frappe.get_all("POS Profile", filters={"name": ["like", f"{TEST_PROFILE_PREFIX}%"]}, pluck="name")
    if not names:
        return
    shifts = frappe.get_all("POS Opening Shift", filters={"pos_profile": ["in", names]}, pluck="name")
    for doctype, parents in (("POS Opening Shift", shifts), ("POS Profile", names)):
        if not parents:
            continue
        for table in frappe.get_meta(doctype).get_table_fields():
            frappe.db.delete(table.options, {"parenttype": doctype, "parent": ["in", parents]})
        frappe.db.delete(doctype, {"name": ["in", parents]})
    frappe.db.commit()


if __name__ == "__main__":
    unittest.main()
