"""Section 108 on real invoices: credit note row lock, unfinished exchange
drafts at Closing Shift, and a return's Sales Person.

Same set-up as test_one_screen_exchange_db (open POS Opening Shift for
Administrator, three priced stock items, a named and a generic customer);
skipped otherwise. Every test rolls back. The lock tests use a second real
database connection, as another till would.
"""

import json
import unittest
import uuid
from unittest import mock

import frappe
from frappe.utils import flt

from posawesome.posawesome.api import invoices as invoices_api
from posawesome.posawesome.api import one_screen_exchange as ex
from posawesome.posawesome.api import sales_credit
from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api import test_one_screen_exchange_db as _exchange_db

_HELPERS = ("_base", "_total", "_pay", "_original", "_return", "_return_total", "_exchange", "_doc", "_draft")


def _second_connection():
    conf = frappe.conf
    db = frappe.database.get_db(
        host=conf.db_host,
        user=conf.db_user or conf.db_name,
        password=conf.db_password,
        port=conf.db_port,
        cur_db_name=conf.db_name,
    )
    db.connect()
    return db


class _OnInvoices(unittest.TestCase):
    # The exchange tests' set-up and helpers, without running their tests here.
    setUpClass = classmethod(_exchange_db.TestOneScreenExchangeOnInvoices.setUpClass.__func__)
    setUp = _exchange_db.TestOneScreenExchangeOnInvoices.setUp


for _name in _HELPERS:
    setattr(_OnInvoices, _name, getattr(_exchange_db.TestOneScreenExchangeOnInvoices, _name))


# (a) credit note row lock ----------------------------------------------------


class TestCreditNoteLock(_OnInvoices):
    def _committed_credit_note(self):
        name = frappe.db.sql(
            """SELECT name FROM `tabSales Invoice`
               WHERE is_return = 1 AND docstatus = 1 AND outstanding_amount < 0
               ORDER BY creation DESC LIMIT 1"""
        )
        if not name:
            self.skipTest("Needs a submitted return with credit left")
        return name[0][0]

    def _data(self, *names):
        return {
            "customer_credit_redemption_requested": 1,
            "customer_credit_dict": [
                {"type": "Invoice", "credit_origin": n, "credit_to_redeem": 1} for n in names
            ],
        }

    def test_another_till_holding_the_credit_note_makes_this_sale_wait(self):
        name = self._committed_credit_note()
        other = _second_connection()
        try:
            other.sql("START TRANSACTION")
            other.sql("SELECT name FROM `tabSales Invoice` WHERE name = %s FOR UPDATE", name)
            frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 1")
            with self.assertRaisesRegex(frappe.ValidationError, "just used on another till"):
                creation._lock_credit_origins(self._data(name))
        finally:
            frappe.db.sql("SET SESSION innodb_lock_wait_timeout = DEFAULT")
            other.sql("ROLLBACK")
            other.close()

    def test_a_credit_note_changed_after_this_sale_read_it_is_not_spent_twice(self):
        name = self._committed_credit_note()
        # This request has read the credit note (its snapshot)...
        frappe.db.get_value("Sales Invoice", name, "outstanding_amount")
        snapshot_isolation = frappe.db.sql("SELECT @@innodb_snapshot_isolation")[0][0]
        seen = frappe.db.sql("SELECT `_seen` FROM `tabSales Invoice` WHERE name = %s", name)[0][0]
        other = _second_connection()
        try:
            # ...then another till's sale changes and commits it.
            other.sql("UPDATE `tabSales Invoice` SET `_seen` = %s WHERE name = %s", ((seen or "") + " ", name))
            other.commit()
            if int(snapshot_isolation or 0):
                with self.assertRaisesRegex(frappe.ValidationError, "just used on another till"):
                    creation._lock_credit_origins(self._data(name))
            else:
                # Without snapshot isolation the locking read sees the latest
                # balance: nothing was spent meanwhile here.
                self.assertEqual(creation._lock_credit_origins(self._data(name)), {name: 0})
        finally:
            other.sql("UPDATE `tabSales Invoice` SET `_seen` = %s WHERE name = %s", (seen, name))
            other.commit()
            other.close()

    def test_the_locked_read_is_used_for_the_balance(self):
        name = self._committed_credit_note()
        used = creation._lock_credit_origins(self._data(name))
        self.assertEqual(used, {name: 0})

    def test_a_credit_sale_is_never_queued_for_the_background(self):
        frappe.db.set_value("POS Profile", self.profile.name, "posa_allow_submissions_in_background_job", 1)
        original = self._original(self.named, self.cheap, 2)
        ret = self._exchange(original)["return"]["name"]
        sale = self._base(self.named, [{"item_code": self.cheap, "qty": 1}], self._pay())
        total = self._total(sale)
        draft = creation.update_invoice(json.dumps(sale))
        sale = dict(draft)
        sale["payments"] = self._pay()
        data = {
            "customer_credit_redemption_requested": 1,
            "redeemed_customer_credit": total,
            "customer_credit_dict": [
                {"type": "Invoice", "credit_origin": ret, "credit_to_redeem": total, "total_credit": total}
            ],
        }
        # The return was made in this shift: its credit needs no voucher.
        with mock.patch.object(creation, "_enqueue_payload_background_submission") as queued:
            response = creation.submit_invoice(json.dumps(sale, default=str), json.dumps(data), 1)
        queued.assert_not_called()
        self.assertEqual(frappe.db.get_value("Sales Invoice", response["name"], "docstatus"), 1)
        # The credit Journal Entry was posted in the same request.
        self.assertTrue(
            frappe.db.exists("Journal Entry Account", {"reference_name": ret, "reference_type": "Sales Invoice"})
        )


# (b) unfinished exchange drafts ---------------------------------------------


class TestUnfinishedExchangeDrafts(_OnInvoices):
    def _move(self, name, **values):
        frappe.db.set_value("Sales Invoice", name, values, update_modified=False)

    def test_closing_deletes_only_this_shifts_unfinished_exchange_drafts(self):
        original = self._original(self.named, self.cheap, 2)
        own = self._draft(f"{uuid.uuid4().hex}:sale")
        own2 = self._draft(f"{uuid.uuid4().hex}:sale")
        plain = self._draft()
        normal_key = self._draft(uuid.uuid4().hex)
        other_shift = self._draft(f"{uuid.uuid4().hex}:sale")
        self._move(other_shift, posa_pos_opening_shift="POSA-OS-NOT-THIS-ONE")
        other_profile = self._draft(f"{uuid.uuid4().hex}:sale")
        self._move(other_profile, pos_profile="Some Other Profile")
        return_key = f"{uuid.uuid4().hex}:sale"
        return_draft = self._draft(return_key, is_return=True, original=original)
        submitted = self._original(self.named, self.cheap, 1)
        self._move(submitted.name, posa_client_request_id=f"{uuid.uuid4().hex}:sale")
        bad_key = self._draft("a:b:sale")

        deleted = ex.delete_shift_exchange_drafts(self.shift, self.profile.name)

        self.assertEqual(sorted(deleted), sorted([own, own2]))
        for name in (own, own2):
            self.assertFalse(frappe.db.exists("Sales Invoice", name))
        for name in (plain, normal_key, other_shift, other_profile, return_draft, submitted.name, original.name, bad_key):
            self.assertTrue(frappe.db.exists("Sales Invoice", name), name)
        self.assertEqual(frappe.db.get_value("Sales Invoice", submitted.name, "docstatus"), 1)
        # The shift itself is untouched.
        self.assertTrue(frappe.db.exists("POS Opening Shift", self.shift))
        self.assertEqual(ex.delete_shift_exchange_drafts(self.shift, self.profile.name), [])

    def test_closing_deletes_them_without_the_profiles_delete_setting(self):
        frappe.db.set_value("POS Profile", self.profile.name, "posa_allow_delete", 0)
        own = self._draft(f"{uuid.uuid4().hex}:sale")
        plain = self._draft()
        closing = frappe._dict(pos_opening_shift=self.shift, pos_profile=self.profile.name)
        from posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift import POSClosingShift

        POSClosingShift.delete_draft_invoices(closing)
        self.assertFalse(frappe.db.exists("Sales Invoice", own))
        # Auto Delete Draft Invoice is off: an ordinary draft stays.
        self.assertTrue(frappe.db.exists("Sales Invoice", plain))

    def test_nothing_without_a_shift_or_profile(self):
        own = self._draft(f"{uuid.uuid4().hex}:sale")
        self.assertEqual(ex.delete_shift_exchange_drafts(None, self.profile.name), [])
        self.assertEqual(ex.delete_shift_exchange_drafts(self.shift, None), [])
        self.assertTrue(frappe.db.exists("Sales Invoice", own))

    def test_drafts_list_hides_unfinished_exchanges(self):
        own = self._draft(f"{uuid.uuid4().hex}:sale")
        plain = self._draft()
        keyed = self._draft(uuid.uuid4().hex)
        listed = {row["name"] for row in invoices_api.get_draft_invoices(self.shift)}
        self.assertNotIn(own, listed)
        self.assertIn(plain, listed)
        self.assertIn(keyed, listed)

    def test_exchange_key_shape(self):
        self.assertTrue(ex.is_exchange_sale_key(f"{uuid.uuid4().hex}:sale"))
        for value in ("", ":sale", "a:b:sale", "abc", "abc:return", None, "x" * 101 + ":sale"):
            self.assertFalse(ex.is_exchange_sale_key(value), value)


# (c) a return's Sales Person ------------------------------------------------


class TestReturnSalesPerson(_OnInvoices):
    def _sales_person(self, enabled=1):
        root = frappe.db.get_value("Sales Person", {"is_group": 1, "parent_sales_person": ["in", ["", None]]}, "name")
        doc = frappe.get_doc(
            {
                "doctype": "Sales Person",
                "sales_person_name": f"_T108 {uuid.uuid4().hex[:8]}",
                "parent_sales_person": root,
                "is_group": 0,
                "enabled": 1,
            }
        ).insert(ignore_permissions=True)
        if not enabled:
            frappe.db.set_value("Sales Person", doc.name, "enabled", 0)
        return doc.name

    def _set_team(self, invoice, sales_person=None):
        frappe.db.delete("Sales Team", {"parent": invoice, "parenttype": "Sales Invoice"})
        if sales_person:
            frappe.get_doc(
                {
                    "doctype": "Sales Team",
                    "parent": invoice,
                    "parenttype": "Sales Invoice",
                    "parentfield": "sales_team",
                    "idx": 1,
                    "sales_person": sales_person,
                    "allocated_percentage": 100,
                }
            ).db_insert()

    def _team(self, invoice):
        return frappe.get_all(
            "Sales Team", filters={"parent": invoice, "parenttype": "Sales Invoice"}, pluck="sales_person"
        )

    def _cashier_sp(self):
        own = sales_credit.linked_sales_person("Administrator")
        if not own:
            self.skipTest("Needs a Sales Person linked to Administrator")
        return own

    def test_return_follows_the_originals_sales_person(self):
        sp = self._sales_person()
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, sp)
        ret = self._exchange(original)["return"]["name"]
        self.assertEqual(self._team(ret), [sp])

    def test_return_follows_a_sales_person_disabled_since(self):
        sp = self._sales_person()
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, sp)
        frappe.db.set_value("Sales Person", sp, "enabled", 0)
        ret = self._exchange(original)["return"]["name"]
        self.assertEqual(frappe.db.get_value("Sales Invoice", ret, "docstatus"), 1)
        self.assertEqual(self._team(ret), [sp])

    def test_original_without_one_goes_to_the_pin_cashier(self):
        own = self._cashier_sp()
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, None)
        ret = self._exchange(original)["return"]["name"]
        self.assertEqual(self._team(ret), [own])

    def test_original_without_one_and_cashier_without_one_stays_empty(self):
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, None)
        with mock.patch.object(sales_credit, "linked_sales_person", return_value=None):
            ret = self._exchange(original)["return"]["name"]
        self.assertEqual(self._team(ret), [])

    def test_a_sale_with_a_disabled_sales_person_is_still_refused(self):
        sp = self._sales_person(enabled=0)
        doc = frappe.get_doc(self._base(self.named, [{"item_code": self.cheap, "qty": 1}], self._pay()))
        doc.append("sales_team", {"sales_person": sp, "allocated_percentage": 100})
        with self.assertRaisesRegex(frappe.ValidationError, "is disabled"):
            doc.validate_sales_team(doc.sales_team)

    def test_a_return_with_a_disabled_sales_person_not_on_the_original_is_refused(self):
        original_sp = self._sales_person()
        stranger = self._sales_person(enabled=0)
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, original_sp)
        doc = frappe.get_doc(self._base(self.named, [{"item_code": self.cheap, "qty": -1}], self._pay()))
        doc.is_return, doc.return_against = 1, original.name
        doc.append("sales_team", {"sales_person": stranger, "allocated_percentage": 100})
        with self.assertRaisesRegex(frappe.ValidationError, "is disabled"):
            doc.validate_sales_team(doc.sales_team)

    def test_quote_shows_the_same_sales_person_the_return_gets(self):
        own = self._cashier_sp()
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, None)
        with mock.patch(
            "posawesome.posawesome.api.terminal_state.get_active_terminal_cashier", return_value="Administrator"
        ):
            quote = ex.quote_exchange(json.dumps(self._return(original, 1)))
        self.assertEqual(quote["return_sales_person"]["sales_person"], own)
        self.assertEqual(quote["return_sales_person"]["source"], "cashier")
        ret = self._exchange(original)["return"]["name"]
        self.assertEqual(self._team(ret), [own])

        sp = self._sales_person()
        original2 = self._original(self.named, self.cheap, 2)
        self._set_team(original2.name, sp)
        with mock.patch(
            "posawesome.posawesome.api.terminal_state.get_active_terminal_cashier", return_value="Administrator"
        ):
            quote = ex.quote_exchange(json.dumps(self._return(original2, 1)))
        self.assertEqual(quote["return_sales_person"], {**quote["return_sales_person"], "sales_person": sp, "source": "original"})

    def test_existing_returns_are_not_changed(self):
        # A past return with an empty Sales Team stays empty: the new rule is
        # applied at submit only, and the fill command does not strip the
        # cashier fallback from a new one.
        original = self._original(self.named, self.cheap, 2)
        self._set_team(original.name, None)
        # Rung up by a cashier with no Sales Person of their own: the fill
        # command leaves the original empty too.
        frappe.db.set_value(
            "Sales Invoice", original.name, "posa_cashier", "no-sales-person@example.invalid", update_modified=False
        )
        before = sales_credit.fill_pos_sales_team(dry_run=True, verbose=False)
        self._cashier_sp()
        ret = self._exchange(original)["return"]["name"]
        self.assertTrue(self._team(ret))
        after = sales_credit.fill_pos_sales_team(dry_run=True, verbose=False)
        self.assertEqual(after["changed"], before["changed"])
        self.assertNotIn(ret, [row["return"] for row in after["returns_overwritten"]])
