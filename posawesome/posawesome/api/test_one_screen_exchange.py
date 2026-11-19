"""One-screen exchange, without a database: the checks before anything is
saved, the credit row the server builds itself, and the rollback when any
step fails. test_one_screen_exchange_db.py runs the same flow on real
invoices."""

import json
import unittest
from types import SimpleNamespace
from unittest import mock

import frappe

REAL_GET_DOC = frappe.get_doc
PAYMENT_TYPES = {"Cash": "Cash", "Visa": "Bank", "M-Pesa": "Phone"}

from posawesome.posawesome.api import credit_voucher
from posawesome.posawesome.api import one_screen_exchange as ex
from posawesome.posawesome.api.invoice_processing import creation

PROFILE = frappe._dict(name="Shop", company="Co", posa_one_screen_exchange=1)
ORIGINAL = frappe._dict(
    name="SINV-1", docstatus=1, is_return=0, company="Co", customer="Cust", posting_date="2026-11-17"
)


def _return(**kw):
    doc = {
        "doctype": "Sales Invoice",
        "is_return": 1,
        "return_against": "SINV-1",
        "customer": "Cust",
        "pos_profile": "Shop",
        "company": "Co",
        "items": [{"item_code": "A", "qty": -1, "rate": 10}],
        "payments": [{"mode_of_payment": "Cash", "amount": 0}],
    }
    doc.update(kw)
    return doc


def _sale(**kw):
    doc = {
        "doctype": "Sales Invoice",
        "customer": "Cust",
        "pos_profile": "Shop",
        "company": "Co",
        "items": [{"item_code": "B", "qty": 1, "rate": 15}],
        "payments": [{"mode_of_payment": "Cash", "amount": 5}],
    }
    doc.update(kw)
    return doc


class _Doc(SimpleNamespace):
    doctype = "Sales Invoice"

    def get(self, key, default=None):
        return getattr(self, key, default)

    def precision(self, _field):
        return 3

    def reload(self):
        return self


class _Base(unittest.TestCase):
    def setUp(self):
        frappe.flags.posa_exchange_atomic = None
        frappe.flags.posa_exchange_credit_origin = None
        patches = [
            mock.patch.object(creation, "_resolve_authorized_invoice_profile", return_value=PROFILE),
            mock.patch.object(ex, "_get_original", side_effect=lambda name: self.original if name == self.original.name else None),
            mock.patch.object(ex, "_payment_types", side_effect=lambda modes: {m: PAYMENT_TYPES.get(m) for m in modes}),
            mock.patch.object(ex, "_lock_original"),
            # The return payload as sent (test_one_screen_exchange_db builds it for real).
            mock.patch.object(ex, "_build_return", side_effect=lambda ret, original, profile: ret),
            mock.patch("frappe.db.savepoint"),
            mock.patch("frappe.db.rollback"),
            mock.patch(
                "posawesome.posawesome.api.invoice_processing.utils._get_return_validity_settings",
                return_value=(1, 15),
            ),
        ]
        self.mocks = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)
        self.rollback = self.mocks[6]
        self.savepoint = self.mocks[5]
        self.original = frappe._dict(ORIGINAL)
        self.docs = {}
        self.calls = []

    def _submit(self, return_total=10, sale_total=15, outstanding=0, posted=None, fail_on=None):
        """A stand-in for submit_invoice: records what it was sent."""

        def submit(invoice, data, submit_in_background=False):
            invoice, data = json.loads(invoice), json.loads(data)
            self.calls.append(
                {"invoice": invoice, "data": data, "background": submit_in_background,
                 "atomic": ex.in_atomic_exchange(), "origin": ex.exchange_credit_origin()}
            )
            kind = "return" if invoice.get("is_return") else "sale"
            if fail_on == kind:
                raise frappe.ValidationError(f"injected: {kind}")
            if kind == "return":
                doc = _Doc(name="CN-1", rounded_total=0, grand_total=-return_total,
                           outstanding_amount=-return_total, currency="OMR")
            else:
                doc = _Doc(name="SINV-2", rounded_total=0, grand_total=sale_total,
                           outstanding_amount=outstanding, currency="OMR",
                           posa_redeemed_customer_credit=data.get("redeemed_customer_credit", 0))
                # The credit Journal Entry: the return's balance goes down.
                self.docs["CN-1"].outstanding_amount += data.get("redeemed_customer_credit", 0)
            self.docs[doc.name] = doc
            return {"name": doc.name, "doctype": "Sales Invoice", "docstatus": 1}

        used = posted

        def balance_use(credit_note, sale):
            if used is not None:
                return used
            return self.calls[-1]["data"].get("redeemed_customer_credit", 0)

        p1 = mock.patch.object(creation, "submit_invoice", side_effect=submit)
        p2 = mock.patch(
            "frappe.get_doc",
            side_effect=lambda dt, name=None, *a, **k: self.docs[name] if name in self.docs else REAL_GET_DOC(dt, name, *a, **k),
        )
        p3 = mock.patch.object(credit_voucher, "credit_voucher_balance_use", side_effect=balance_use)
        for p in (p1, p2, p3):
            p.start()
            self.addCleanup(p.stop)

    def run_exchange(self, ret=None, sale=None, sale_data=None, expected=None, xid="X1", return_data=None):
        exp = {"returned": 10, "sale_total": 15, "pay": 5}
        exp.update(expected or {})
        return ex.submit_exchange(
            json.dumps(ret or _return()),
            json.dumps(return_data or {}),
            json.dumps(sale) if sale is not None else None,
            json.dumps(sale_data or {}),
            xid,
            json.dumps(exp),
        )


class TestBeforeSaving(_Base):
    """Refused before anything is written: no savepoint, no submit."""

    def assertRefused(self, contains, **kw):
        self._submit()
        with self.assertRaises(frappe.ValidationError) as ctx:
            self.run_exchange(**kw)
        self.assertIn(contains, str(ctx.exception))
        self.assertEqual(self.calls, [])
        self.savepoint.assert_not_called()

    def test_setting_off(self):
        with mock.patch.object(creation, "_resolve_authorized_invoice_profile", return_value=frappe._dict(PROFILE, posa_one_screen_exchange=0)):
            self.assertRefused("not switched on", sale=_sale())

    def test_pos_invoice_profiles(self):
        profile = frappe._dict(PROFILE, create_pos_invoice_instead_of_sales_invoice=1)
        with mock.patch.object(creation, "_resolve_authorized_invoice_profile", return_value=profile):
            self.assertRefused("Sales Invoices only", sale=_sale())

    def test_no_receipt(self):
        self.assertRefused("needs the original receipt", ret=_return(return_against=None))

    def test_cancelled_receipt(self):
        self.original.docstatus = 2
        self.assertRefused("This receipt was cancelled")

    def test_return_receipt(self):
        self.original.is_return = 1
        self.assertRefused("This is a return receipt, not a sale")

    def test_other_company(self):
        self.original.company = "Other"
        self.assertRefused("was not found")

    def test_past_the_return_date(self):
        self.original.posting_date = "2026-10-01"
        self.assertRefused("Return period ended on")

    def test_return_to_another_customer(self):
        self.assertRefused("receipt's customer", ret=_return(customer="Someone"))

    def test_return_refunds_money(self):
        self.assertRefused("gives no money back", ret=_return(payments=[{"mode_of_payment": "Cash", "amount": -10}]))

    def test_sale_to_another_customer(self):
        self.assertRefused("same customer", sale=_sale(customer="Someone"))

    def test_sale_that_is_a_return(self):
        self.assertRefused("must be a sale", sale=_sale(is_return=1))

    def test_gift_card(self):
        self.assertRefused("Cash or Card only", sale=_sale(), sale_data={"gift_card_redemptions": [{"amount": 1}]})

    def test_credit_change(self):
        self.assertRefused("Cash or Card only", sale=_sale(), sale_data={"credit_change": 1})

    def test_credit_sale(self):
        self.assertRefused("Cash or Card only", sale=_sale(), sale_data={"is_credit_sale": 1})

    def test_loyalty(self):
        self.assertRefused("Loyalty points", sale=_sale(redeem_loyalty_points=1))

    def test_phone_payment(self):
        self.assertRefused("only Cash or Card", sale=_sale(payments=[{"mode_of_payment": "M-Pesa", "amount": 5}]))

    def test_gift_card_payment_row(self):
        self.assertRefused("only Cash or Card", sale=_sale(payments=[{"mode_of_payment": "Gift Card", "amount": 5}]))

    def test_no_exchange_id(self):
        self.assertRefused("request id", xid="")

    def test_bad_exchange_id(self):
        self.assertRefused("Invalid exchange", xid="a:b")


class TestPair(_Base):
    def test_pays_more(self):
        self._submit()
        result = self.run_exchange(sale=_sale(), sale_data={"idempotency_key": "client", "customer_credit_dict": [{"type": "Invoice", "credit_origin": "OLD", "credit_to_redeem": 99}], "redeemed_customer_credit": 99})
        ret_call, sale_call = self.calls
        self.assertEqual(ret_call["invoice"]["posa_client_request_id"], "X1:return")
        self.assertEqual(sale_call["invoice"]["posa_client_request_id"], "X1:sale")
        self.assertNotIn("idempotency_key", sale_call["data"])
        # The client's credit row is replaced by the server's own.
        self.assertEqual(sale_call["data"]["customer_credit_dict"], [
            {"type": "Invoice", "credit_origin": "CN-1", "total_credit": 10.0, "credit_to_redeem": 10.0}
        ])
        self.assertEqual(sale_call["data"]["redeemed_customer_credit"], 10.0)
        self.assertEqual(sale_call["origin"], "CN-1")
        self.assertIsNone(ret_call["origin"])
        self.assertTrue(all(c["atomic"] and not c["background"] for c in self.calls))
        self.assertEqual(result["sale"]["pay"], 5.0)
        self.assertEqual(result["credit_left"], 0.0)
        self.savepoint.assert_called_once_with(ex.SAVEPOINT)
        self.rollback.assert_not_called()
        self.assertFalse(ex.in_atomic_exchange())

    def test_credit_left(self):
        self._submit(return_total=20, sale_total=15)
        result = self.run_exchange(sale=_sale(payments=[]), expected={"returned": 20, "sale_total": 15, "pay": 0})
        self.assertEqual(result["credit_left"], 5.0)
        self.assertEqual(self.calls[1]["data"]["redeemed_customer_credit"], 15.0)
        self.assertEqual(self.calls[1]["data"]["customer_credit_dict"][0]["total_credit"], 20.0)
        self.assertEqual(result["sale"]["pay"], 0.0)

    def test_even(self):
        self._submit(return_total=15, sale_total=15)
        result = self.run_exchange(sale=_sale(payments=[]), expected={"returned": 15, "sale_total": 15, "pay": 0})
        self.assertEqual(result["sale"]["pay"], 0.0)
        self.assertEqual(result["credit_left"], 0.0)

    def test_plain_return(self):
        self._submit()
        result = self.run_exchange()
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(result["sale"])
        self.assertEqual(result["credit_left"], 10.0)


class TestFailureAtEachStep(_Base):
    """Every failure rolls back to the savepoint and clears the flags."""

    def assertRolledBack(self, contains, **kw):
        with self.assertRaises(Exception) as ctx:
            self.run_exchange(**kw)
        self.assertIn(contains, str(ctx.exception))
        self.savepoint.assert_called_once_with(ex.SAVEPOINT)
        self.rollback.assert_called_once_with(save_point=ex.SAVEPOINT)
        self.assertFalse(ex.in_atomic_exchange())
        self.assertIsNone(frappe.flags.posa_exchange_credit_origin)

    def test_return_fails(self):
        self._submit(fail_on="return")
        self.assertRolledBack("injected: return", sale=_sale())
        self.assertEqual(len(self.calls), 1)

    def test_sale_fails_after_the_return(self):
        self._submit(fail_on="sale")
        self.assertRolledBack("injected: sale", sale=_sale())
        self.assertEqual(len(self.calls), 2)

    def test_credit_not_posted(self):
        self._submit(posted=0)
        self.assertRolledBack("wasn't applied", sale=_sale())

    def test_sale_not_fully_paid(self):
        self._submit(outstanding=5)
        self.assertRolledBack("isn't fully paid", sale=_sale())

    def test_wrong_returned_value(self):
        self._submit()
        self.assertRolledBack("Totals changed", sale=_sale(), expected={"returned": 9.999})

    def test_wrong_sale_total(self):
        self._submit()
        self.assertRolledBack("Totals changed", sale=_sale(), expected={"sale_total": 15.001, "pay": 5.001})

    def test_wrong_pay(self):
        self._submit()
        self.assertRolledBack("Totals changed", sale=_sale(), expected={"pay": 4})

    def test_missing_sale_total(self):
        self._submit()
        self.assertRolledBack("new items total", sale=_sale(), expected={"sale_total": None})

    def test_queued_submit_is_a_failure(self):
        def queued(invoice, data, submit_in_background=False):
            return {"name": "CN-1", "docstatus": 0, "queued": True}

        with mock.patch.object(creation, "submit_invoice", side_effect=queued):
            self.assertRolledBack("could not be submitted", sale=_sale())

    def test_deadlock_already_ended_the_transaction(self):
        self._submit(fail_on="sale")
        self.rollback.side_effect = [Exception("SAVEPOINT does not exist"), None]
        with self.assertRaises(frappe.ValidationError):
            self.run_exchange(sale=_sale())
        self.assertEqual(self.rollback.call_args_list, [mock.call(save_point=ex.SAVEPOINT), mock.call()])


class TestCreditAuthorization(unittest.TestCase):
    def setUp(self):
        frappe.flags.posa_exchange_atomic = None
        frappe.flags.posa_exchange_credit_origin = None
        self.addCleanup(setattr, frappe.flags, "posa_exchange_atomic", None)
        self.addCleanup(setattr, frappe.flags, "posa_exchange_credit_origin", None)
        meta = mock.patch("frappe.get_meta", return_value=SimpleNamespace(has_field=lambda f: True))
        meta.start()
        self.addCleanup(meta.stop)

    def _doc(self, customer="Anonymous"):
        doc = _Doc(customer=customer, posa_pos_opening_shift="S", pos_profile="Shop")
        doc.set = lambda key, value: setattr(doc, key, value)
        return doc

    def test_exchange_return_needs_no_voucher(self):
        frappe.flags.posa_exchange_atomic = True
        frappe.flags.posa_exchange_credit_origin = "CN-1"
        doc = self._doc()
        credit_voucher.authorize_customer_credit(doc, [{"type": "Invoice", "credit_origin": "CN-1"}])
        self.assertEqual(doc.posa_credit_authorized_by, "CN-1: exchange")

    def test_other_credit_in_an_exchange_is_refused(self):
        frappe.flags.posa_exchange_atomic = True
        frappe.flags.posa_exchange_credit_origin = "CN-1"
        with self.assertRaises(frappe.ValidationError):
            credit_voucher.authorize_customer_credit(
                self._doc(), [{"type": "Invoice", "credit_origin": "CN-1"}, {"type": "Invoice", "credit_origin": "CN-OLD"}]
            )

    def test_origin_without_the_exchange_flag_is_ignored(self):
        # Only submit_exchange sets both; a stray origin alone authorizes nothing.
        frappe.flags.posa_exchange_credit_origin = "CN-1"
        self.assertIsNone(ex.exchange_credit_origin())
        with mock.patch.object(credit_voucher, "_authorize_bearer_credit") as bearer, \
                mock.patch.object(credit_voucher, "is_generic_customer", return_value=True):
            credit_voucher.authorize_customer_credit(self._doc(), [{"type": "Invoice", "credit_origin": "CN-1"}])
        bearer.assert_called_once()


class TestNothingQueued(unittest.TestCase):
    def tearDown(self):
        frappe.flags.posa_exchange_atomic = None

    def test_ledger_does_not_retry_after_a_deadlock_in_an_exchange(self):
        frappe.flags.posa_exchange_atomic = True
        operation = mock.Mock(side_effect=frappe.QueryDeadlockError("deadlock"))
        with self.assertRaises(frappe.QueryDeadlockError):
            creation._save_ledger_with_lock_retry(SimpleNamespace(name=None), operation, retries=2)
        self.assertEqual(operation.call_count, 1)

    def test_ledger_still_retries_outside_an_exchange(self):
        operation = mock.Mock(side_effect=[frappe.QueryDeadlockError("deadlock"), None])
        creation._save_ledger_with_lock_retry(SimpleNamespace(name=None), operation, retries=2)
        self.assertEqual(operation.call_count, 2)

    def test_submit_invoice_runs_the_credit_entry_now_in_an_exchange(self):
        source = open(creation.__file__).read()
        submit = source[source.index("def submit_invoice("):source.index("def submit_in_background_job(")]
        self.assertIn("bool(allow_background_submit) and not _in_atomic_exchange()", submit)
        # A credit sale is never queued either (section 108).
        self.assertIn("if _in_atomic_exchange() or _uses_customer_credit(data):\n        submit_in_background = 0", submit)


if __name__ == "__main__":
    unittest.main()
