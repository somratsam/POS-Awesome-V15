import pathlib
import re
import unittest
from unittest.mock import patch

import frappe
from frappe.utils import add_days, getdate, nowdate

from posawesome.posawesome.api import credit_voucher

TEMPLATE = (
    pathlib.Path(credit_voucher.__file__).resolve().parents[2] / "templates" / "print" / "credit_note_voucher.html"
).read_text()


def _credit_return(**overrides):
    data = {
        "doctype": "Sales Invoice",
        "name": "ACC-SINV-2026-00247",
        "docstatus": 1,
        "is_return": 1,
        "return_against": "ACC-SINV-2026-00241",
        "customer": "CUST-1",
        "customer_name": "Sanju",
        "pos_profile": None,
        "posting_date": getdate(nowdate()),
        "posting_time": "16:53:10",
        "grand_total": -139.3,
        "outstanding_amount": -139.3,
        "discount_amount": 0,
        "items": [{"item_code": "JKT-40", "item_name": "JACKET-BROWN PATTERN-40", "qty": -1, "amount": -139.3}],
        "payments": [{"mode_of_payment": "Cash", "amount": 0}, {"mode_of_payment": "Visa", "amount": 0}],
    }
    data.update(overrides)
    return frappe.get_doc(data)  # unsaved: no database writes


class TestVoucherCode(unittest.TestCase):
    def test_code_is_C_year_number_and_a_4_character_check(self):
        code = credit_voucher.credit_voucher_code("ACC-SINV-2026-00247")
        self.assertRegex(code, r"^C2600247[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$")
        self.assertEqual(credit_voucher.credit_voucher_label(code), f"C26-00247-{code[-4:]}")

    def test_code_is_the_same_every_time(self):
        self.assertEqual(
            credit_voucher.credit_voucher_code("ACC-SINV-2026-00247"),
            credit_voucher.credit_voucher_code("ACC-SINV-2026-00247"),
        )

    def test_check_depends_on_the_site_secret_not_only_the_number(self):
        name = "ACC-SINV-2026-00247"
        with patch.object(credit_voucher, "_secret", return_value=b"another-site"):
            other = credit_voucher.credit_voucher_code(name)
        self.assertNotEqual(other, credit_voucher.credit_voucher_code(name))
        self.assertEqual(other[:-4], credit_voucher.credit_voucher_code(name)[:-4])

    def test_neighbouring_invoices_have_unrelated_checks(self):
        checks = {credit_voucher.credit_voucher_code(f"ACC-SINV-2026-{n:05d}")[-4:] for n in range(200, 260)}
        self.assertGreater(len(checks), 55)

    def test_verify_accepts_the_code_as_printed_typed_or_scanned(self):
        name = "ACC-SINV-2026-00247"
        code = credit_voucher.credit_voucher_code(name)
        label = credit_voucher.credit_voucher_label(code)
        for given in (code, label, label.lower(), f" {label[:3]} {label[4:]} "):
            self.assertTrue(credit_voucher.verify_credit_voucher_code(name, given), given)

    def test_verify_rejects_a_wrong_check_or_another_invoice(self):
        name = "ACC-SINV-2026-00247"
        code = credit_voucher.credit_voucher_code(name)
        wrong = code[:-1] + ("2" if code[-1] != "2" else "3")
        self.assertFalse(credit_voucher.verify_credit_voucher_code(name, wrong))
        self.assertFalse(credit_voucher.verify_credit_voucher_code("ACC-SINV-2026-00248", code))
        self.assertFalse(credit_voucher.verify_credit_voucher_code(name, ""))

    def test_names_without_year_and_number_get_no_code(self):
        self.assertEqual(credit_voucher.credit_voucher_code("SINV-ABC"), "")
        self.assertEqual(credit_voucher.credit_voucher_code(""), "")
        self.assertEqual(credit_voucher.credit_voucher_code(None), "")
        self.assertFalse(credit_voucher.verify_credit_voucher_code("SINV-ABC", ""))


class TestIsCreditNoteVoucher(unittest.TestCase):
    def test_submitted_return_with_no_money_moved(self):
        self.assertTrue(credit_voucher.is_credit_note_voucher(_credit_return()))
        self.assertTrue(credit_voucher.is_credit_note_voucher(_credit_return(payments=[])))

    def test_refunds_sales_drafts_are_not_vouchers(self):
        refund = _credit_return(payments=[{"mode_of_payment": "Cash", "amount": -139.3}])
        self.assertFalse(credit_voucher.is_credit_note_voucher(refund))
        self.assertFalse(credit_voucher.is_credit_note_voucher(_credit_return(is_return=0, grand_total=139.3)))
        self.assertFalse(credit_voucher.is_credit_note_voucher(_credit_return(docstatus=0)))
        self.assertFalse(credit_voucher.is_credit_note_voucher(_credit_return(grand_total=0)))
        self.assertFalse(credit_voucher.is_credit_note_voucher(None))


class TestRecordCreditNoteReprint(unittest.TestCase):
    def _call(self, doc, cashier="cashier@x.test", locked=False, readable=True, balance_for=None, used=0):
        comments = []

        def active_cashier(pos_profile=None):
            if locked:
                raise frappe.PermissionError("This POS terminal is locked.")
            return cashier

        def check_permission(ptype):
            comments.append(("checked", ptype))
            if not readable:
                raise frappe.PermissionError("no")

        with patch("frappe.db.exists", return_value=True), patch("frappe.get_doc", return_value=doc), patch(
            "posawesome.posawesome.api.terminal_state.get_active_terminal_cashier", side_effect=active_cashier
        ), patch("frappe.db.get_value", return_value="Cash <b>Ier</b>"), patch.object(
            doc, "check_permission", side_effect=check_permission
        ), patch.object(doc, "add_comment", side_effect=lambda kind, text: comments.append((kind, text))), patch.object(
            credit_voucher, "credit_voucher_balance_use", return_value=used
        ):
            try:
                return (
                    credit_voucher.record_credit_note_reprint("Sales Invoice", doc.name, "Test Pos", balance_for=balance_for),
                    comments,
                )
            finally:
                self.comments = comments

    def test_voucher_reprint_records_the_pin_cashier(self):
        result, comments = self._call(_credit_return())
        self.assertEqual(result, {"credit_note": True, "balance": False, "cashier": "cashier@x.test"})
        self.assertEqual(comments[0], ("checked", "read"))
        [(kind, text)] = comments[1:]
        self.assertEqual(kind, "Info")
        self.assertIn("cashier@x.test", text)
        self.assertIn("Test Pos", text)
        self.assertIn("DUPLICATE", text)
        self.assertNotIn("<b>", text)  # the full name is escaped

    def test_balance_voucher_after_a_sale_is_recorded_with_the_sale_and_amounts(self):
        doc = _credit_return(outstanding_amount=-5)
        result, comments = self._call(doc, balance_for="ACC-SINV-2026-00330", used=45)
        self.assertEqual(result, {"credit_note": True, "balance": True, "cashier": "cashier@x.test"})
        [(kind, text)] = comments[1:]
        self.assertIn("Balance voucher printed", text)
        self.assertIn("ACC-SINV-2026-00330", text)
        self.assertIn("cashier@x.test", text)
        self.assertNotIn("DUPLICATE", text)

    def test_balance_for_a_sale_that_did_not_use_it_is_an_ordinary_reprint(self):
        result, comments = self._call(_credit_return(), balance_for="ACC-SINV-2026-00999", used=0)
        self.assertEqual(result["balance"], False)
        self.assertIn("DUPLICATE", comments[1][1])

    def test_balance_voucher_on_a_locked_till_refuses(self):
        with self.assertRaises(frappe.PermissionError):
            self._call(_credit_return(outstanding_amount=-5), locked=True, balance_for="S", used=45)
        self.assertEqual(self.comments, [("checked", "read")])

    def test_other_invoices_record_nothing_and_need_no_cashier(self):
        sale = _credit_return(is_return=0, grand_total=50, payments=[{"mode_of_payment": "Cash", "amount": 50}])
        result, comments = self._call(sale, locked=True)
        self.assertEqual(result, {"credit_note": False})
        self.assertEqual(comments, [("checked", "read")])

    def test_locked_till_refuses_and_records_nothing(self):
        with self.assertRaises(frappe.PermissionError):
            self._call(_credit_return(), locked=True)
        self.assertEqual(self.comments, [("checked", "read")])

    def test_no_read_permission_refuses_and_records_nothing(self):
        with self.assertRaises(frappe.PermissionError):
            self._call(_credit_return(), readable=False)
        self.assertEqual(self.comments, [("checked", "read")])

    def test_only_invoice_doctypes(self):
        with self.assertRaises(frappe.ValidationError):
            credit_voucher.record_credit_note_reprint("User", "Administrator", "Test Pos")

    def test_unknown_invoice_is_not_a_voucher(self):
        with patch("frappe.db.exists", return_value=False):
            self.assertEqual(
                credit_voucher.record_credit_note_reprint("Sales Invoice", "ACC-SINV-2026-99999", "Test Pos"),
                {"credit_note": False},
            )


def _text(html):
    html = re.sub(r"<svg.*?</svg>", " [BARCODE] ", html, flags=re.S)
    html = re.sub(r"<style.*?</style>", "", html, flags=re.S)
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


class TestVoucherTemplate(unittest.TestCase):
    def setUp(self):
        # The logo lookup runs frappe.call, which checks the HTTP method of a
        # request; tests have none.
        patcher = patch("frappe.handler.is_valid_http_method", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _render(self, doc, reprint=False, settings=None):
        print_settings = frappe._dict({"is_reprint": 1} if reprint else {})
        print_settings.update(settings or {})
        return frappe.render_template(TEMPLATE, {"doc": doc, "print_settings": print_settings})

    def test_valid_voucher(self):
        doc = _credit_return()
        html = self._render(doc)
        text = _text(html)
        label = credit_voucher.credit_voucher_label(credit_voucher.credit_voucher_code(doc.name))
        self.assertIn("Credit note voucher", text)
        self.assertIn("**** OMR 139.300 ****", text)
        self.assertIn(f"Number: {label}", text)
        self.assertIn("Customer: Sanju", text)
        self.assertIn("[BARCODE]", text)
        self.assertEqual(html.count("<svg"), 1)
        self.assertIn("JACKET-BROWN PATTERN-40 1 139.300", text)
        self.assertIn("Total · الإجمالي 139.300", text)
        expiry = credit_voucher.credit_voucher_valid_until(doc)
        self.assertIn(f"Validity ending date: {getdate(expiry).strftime('%d-%m-%Y')}", text)
        self.assertNotIn("DUPLICATE", text)
        self.assertNotIn("NOT VALID", text)
        self.assertNotIn("VAT", text)

    def test_reprint_says_duplicate_and_keeps_the_code(self):
        text = _text(self._render(_credit_return(), reprint=True))
        self.assertIn("*** DUPLICATE ***", text)
        self.assertIn("[BARCODE]", text)

    def test_used_voucher_has_no_code_to_scan(self):
        text = _text(self._render(_credit_return(outstanding_amount=0)))
        self.assertIn("USED — NOT VALID", text)
        self.assertNotIn("[BARCODE]", text)

    def test_expired_voucher_has_no_code_to_scan(self):
        old = add_days(getdate(nowdate()), -200)
        text = _text(self._render(_credit_return(posting_date=old)))
        self.assertIn("EXPIRED — NOT VALID", text)
        self.assertNotIn("[BARCODE]", text)

    def test_partly_used_voucher_is_worth_what_is_left(self):
        text = _text(self._render(_credit_return(outstanding_amount=-39.3)))
        self.assertIn("**** OMR 39.300 ****", text)
        self.assertIn("Remaining from original OMR 139.300", text)

    def _render_balance(self, doc, sale, used):
        calls = []

        def balance_use(credit_note, for_sale):
            calls.append((credit_note, for_sale))
            return used

        html = frappe.render_template(
            TEMPLATE.replace("credit_voucher_balance_use(", "balance_use("),
            {"doc": doc, "print_settings": frappe._dict({"balance_for": sale}), "balance_use": balance_use},
        )
        return html, calls

    def test_balance_voucher_shows_banner_use_and_rest_and_keeps_the_code(self):
        doc = _credit_return(grand_total=-50, outstanding_amount=-5)
        html, calls = self._render_balance(doc, "ACC-SINV-2026-00330", 45)
        text = _text(html)
        self.assertIn("*** BALANCE · رصيد ***", text)
        self.assertIn("Used 45.000 on sale ACC-SINV-2026-00330. Remaining 5.000.", text)
        self.assertIn("**** OMR 5.000 ****", text)
        self.assertIn("[BARCODE]", text)
        self.assertNotIn("DUPLICATE", text)
        self.assertEqual(calls, [(doc.name, "ACC-SINV-2026-00330")])

    def test_balance_settings_for_a_sale_that_did_not_use_it_print_the_plain_voucher(self):
        html, _calls = self._render_balance(_credit_return(), "X", 0)
        self.assertNotIn("BALANCE", _text(html))

    def test_voucher_says_the_rest_stays_on_it(self):
        text = _text(self._render(_credit_return()))
        self.assertIn("Any amount not used stays on this voucher.", text)
        self.assertNotIn("in one purchase of this value or more", text)

    def test_balance_use_with_no_matching_journal_entry_is_zero(self):
        self.assertEqual(credit_voucher.credit_voucher_balance_use("ACC-SINV-2026-99998", "ACC-SINV-2026-99999"), 0)
        self.assertEqual(credit_voucher.credit_voucher_balance_use("", "X"), 0)

    def test_quantities_discount_and_escaping(self):
        doc = _credit_return(
            customer_name="<script>x</script>",
            discount_amount=-10,
            grand_total=-129.3,
            outstanding_amount=-129.3,
            items=[
                {"item_name": "Belt <b>", "qty": -2, "amount": -40},
                {"item_name": "Fabric", "qty": -1.5, "amount": -99.3},
            ],
        )
        html = self._render(doc)
        text = _text(html)
        self.assertNotIn("<script>x", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("2 40.000", text)
        self.assertIn("Fabric 1.500 99.300", text)
        self.assertIn("Discount · خصم -10.000", text)
        self.assertIn("Total · الإجمالي 129.300", text)

    def test_posting_date_as_string_works(self):
        doc = _credit_return(posting_date=str(getdate(nowdate())))
        self.assertIn("Validity starting date", _text(self._render(doc)))


class TestReceiptSwitch(unittest.TestCase):
    """The receipt format includes the voucher for credit notes only."""

    SWITCH = (
        '{%- if is_credit_note_voucher(doc) -%}'
        '{% include "posawesome/templates/print/credit_note_voucher.html" %}'
        "{%- else -%}RECEIPT{%- endif -%}"
    )

    def test_switch(self):
        patcher = patch("frappe.handler.is_valid_http_method", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        ctx = {"print_settings": frappe._dict()}
        self.assertIn("Credit note voucher", frappe.render_template(self.SWITCH, {**ctx, "doc": _credit_return()}))
        refund = _credit_return(payments=[{"amount": -139.3}])
        self.assertEqual(frappe.render_template(self.SWITCH, {**ctx, "doc": refund}), "RECEIPT")


def _sale(**overrides):
    data = {
        "doctype": "Sales Invoice",
        "customer": "CUST-1",
        "company": "Swan",
        "pos_profile": "Test Pos",
        "posa_pos_opening_shift": "SHIFT-NOW",
        "is_return": 0,
    }
    data.update(overrides)
    return frappe.get_doc(data)


class TestAuthorizeCustomerCredit(unittest.TestCase):
    """Each credit note spent needs a same-shift return, its voucher, or a
    POS supervisor; shared customers can't spend credit."""

    def _run(self, doc, rows, generic=False, supervisor=None, shifts=None):
        shifts = shifts or {}

        def get_value(doctype, name, field=None, *args, **kwargs):
            if doctype == "Customer" and field == "posa_is_generic_customer":
                return 1 if generic else 0
            if doctype == "User" and field == "full_name":
                return "Sara Supervisor"
            return None

        def get_all(doctype, filters=None, fields=None, **kwargs):
            names = filters["name"][1]
            return [frappe._dict(name=n, posa_pos_opening_shift=shifts.get(n)) for n in names]

        with patch("frappe.db.get_value", side_effect=get_value), patch("frappe.get_all", side_effect=get_all), patch.object(
            credit_voucher, "_credit_supervisor", return_value=supervisor
        ):
            credit_voucher.authorize_customer_credit(doc, rows)
        return doc.get("posa_credit_authorized_by")

    def test_same_shift_return_needs_nothing_more(self):
        lines = self._run(_sale(), [{"type": "Invoice", "credit_origin": "CN-1"}], shifts={"CN-1": "SHIFT-NOW"})
        self.assertEqual(lines, "CN-1: same-shift exchange")

    def test_return_from_another_shift_is_not_an_exchange(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            self._run(_sale(), [{"type": "Invoice", "credit_origin": "CN-1"}], shifts={"CN-1": "SHIFT-OLD"})
        self.assertIn("needs the customer's credit note voucher", str(ctx.exception))
        self.assertIn("CN-1", str(ctx.exception))

    def test_no_shift_on_either_side_is_not_an_exchange(self):
        with self.assertRaises(frappe.ValidationError):
            self._run(_sale(posa_pos_opening_shift=None), [{"type": "Invoice", "credit_origin": "CN-1"}])

    def test_the_vouchers_own_code_authorizes_it(self):
        name = "ACC-SINV-2026-00269"
        code = credit_voucher.credit_voucher_label(credit_voucher.credit_voucher_code(name))
        lines = self._run(_sale(), [{"type": "Invoice", "credit_origin": name, "voucher_code": code.lower()}])
        self.assertEqual(lines, f"{name}: voucher {code}")

    def test_another_vouchers_code_does_not(self):
        other = credit_voucher.credit_voucher_code("ACC-SINV-2026-00270")
        with self.assertRaises(frappe.ValidationError):
            self._run(_sale(), [{"type": "Invoice", "credit_origin": "ACC-SINV-2026-00269", "voucher_code": other}])

    def test_supervisor_covers_a_lost_voucher_and_is_named(self):
        lines = self._run(
            _sale(), [{"type": "Invoice", "credit_origin": "CN-1"}], supervisor="sara@x.test"
        )
        self.assertEqual(lines, "CN-1: supervisor Sara Supervisor (sara@x.test)")

    def test_advances_need_a_supervisor(self):
        with self.assertRaises(frappe.ValidationError):
            self._run(_sale(), [{"type": "Advance", "credit_origin": "ACC-PAY-1"}])
        lines = self._run(_sale(), [{"type": "Advance", "credit_origin": "ACC-PAY-1"}], supervisor="sara@x.test")
        self.assertIn("ACC-PAY-1: supervisor", lines)

    def test_one_line_per_credit_note(self):
        name = "ACC-SINV-2026-00269"
        lines = self._run(
            _sale(),
            [
                {"type": "Invoice", "credit_origin": "CN-1"},
                {"type": "Invoice", "credit_origin": name, "voucher_code": credit_voucher.credit_voucher_code(name)},
                {"type": "Invoice", "credit_origin": "CN-3"},
            ],
            shifts={"CN-1": "SHIFT-NOW"},
            supervisor="sara@x.test",
        )
        self.assertEqual(
            lines.split("\n"),
            [
                "CN-1: same-shift exchange",
                f"{name}: voucher {credit_voucher.credit_voucher_label(credit_voucher.credit_voucher_code(name))}",
                "CN-3: supervisor Sara Supervisor (sara@x.test)",
            ],
        )

    def _bearer(self, rows, bearer_names=("ACC-SINV-2026-00269",), supervisor="sara@x.test", shifts=None):
        """A sale to Anonymous; bearer_names are the returns linked to a sale
        to Anonymous (is_bearer_credit_note)."""
        with patch.object(credit_voucher, "is_bearer_credit_note", side_effect=lambda name: name in bearer_names):
            return self._run(
                _sale(customer="Anonymous"), rows, generic=True, supervisor=supervisor, shifts=shifts
            )

    def test_shared_customer_spends_a_bearer_voucher_with_its_own_code(self):
        name = "ACC-SINV-2026-00269"
        code = credit_voucher.credit_voucher_code(name)
        lines = self._bearer([{"type": "Invoice", "credit_origin": name, "voucher_code": code}])
        self.assertEqual(lines, f"{name}: voucher {credit_voucher.credit_voucher_label(code)}")

    def test_shared_customer_without_a_voucher_gets_nothing_even_same_shift_or_supervisor(self):
        # "Choosing Anonymous alone gives nothing."
        with self.assertRaisesRegex(frappe.ValidationError, "only be used with its own voucher"):
            self._bearer(
                [{"type": "Invoice", "credit_origin": "ACC-SINV-2026-00269"}],
                shifts={"ACC-SINV-2026-00269": "SHIFT-NOW"},
            )

    def test_shared_customer_cannot_use_another_bearer_vouchers_code(self):
        other = credit_voucher.credit_voucher_code("ACC-SINV-2026-00270")
        with self.assertRaises(frappe.ValidationError):
            self._bearer(
                [{"type": "Invoice", "credit_origin": "ACC-SINV-2026-00269", "voucher_code": other}],
                bearer_names=("ACC-SINV-2026-00269", "ACC-SINV-2026-00270"),
            )

    def test_shared_credit_not_from_a_linked_return_cannot_be_spent_even_with_its_code(self):
        # e.g. a return without an invoice to Anonymous from before this rule.
        name = "ACC-SINV-2026-00292"
        with self.assertRaises(frappe.ValidationError):
            self._bearer(
                [{"type": "Invoice", "credit_origin": name, "voucher_code": credit_voucher.credit_voucher_code(name)}],
                bearer_names=(),
            )

    def test_shared_customer_cannot_spend_advances(self):
        with self.assertRaises(frappe.ValidationError):
            self._bearer([{"type": "Advance", "credit_origin": "ACC-PAY-1"}])

    def test_each_bearer_voucher_only_with_its_own_code(self):
        a, b = "ACC-SINV-2026-00269", "ACC-SINV-2026-00270"
        rows = [
            {"type": "Invoice", "credit_origin": a, "voucher_code": credit_voucher.credit_voucher_code(a)},
            {"type": "Invoice", "credit_origin": b},
        ]
        with self.assertRaisesRegex(frappe.ValidationError, b):
            self._bearer(rows, bearer_names=(a, b))


class TestLookupCreditVoucher(unittest.TestCase):
    NAME = "ACC-SINV-2026-00269"

    def setUp(self):
        frappe.cache.delete_value(credit_voucher._failure_key())
        self.addCleanup(frappe.cache.delete_value, credit_voucher._failure_key())
        self.code = credit_voucher.credit_voucher_code(self.NAME)

    def _lookup(self, code, company="Swan", customer="CUST-1", credit=None, expired=None, generic=False, candidates=None, linked=True):
        credit = [{"type": "Invoice", "credit_origin": self.NAME, "total_credit": 139.3, "expires_on": getdate("2027-02-05")}] if credit is None else credit

        real_get_value = frappe.db.get_value
        real_get_all = frappe.get_all

        def get_all(doctype, *args, **kwargs):
            if doctype == "Sales Invoice":
                return [self.NAME] if candidates is None else candidates
            return real_get_all(doctype, *args, **kwargs)

        def get_value(doctype, *args, **kwargs):
            name = args[0] if args else kwargs.get("filters")
            fields = args[1] if len(args) > 1 else kwargs.get("fieldname")
            if doctype == "Sales Invoice":
                return frappe._dict(
                    name=name,
                    customer=customer,
                    customer_name="Sanju",
                    company=company,
                    is_return=1,
                    docstatus=1,
                    return_against="ACC-SINV-2026-00260" if linked else "",
                )
            if doctype == "Customer" and fields == "posa_is_generic_customer":
                return 1 if generic else 0
            if doctype == "Customer" and fields == "mobile_no":
                return "99887766"
            return real_get_value(doctype, *args, **kwargs)

        with patch(
            "posawesome.posawesome.api.pos_access.get_authorized_pos_profile",
            return_value=frappe._dict(name="Test Pos", company="Swan"),
        ), patch("frappe.get_all", side_effect=get_all), patch(
            "frappe.db.get_value", side_effect=get_value
        ), patch(
            "posawesome.posawesome.api.payments.get_available_credit",
            return_value={"credit": credit, "expired": expired or [], "generic_customer": generic},
        ), patch.object(credit_voucher, "_credit_supervisor", return_value=None):
            return credit_voucher.lookup_credit_voucher(code, "Test Pos")

    def test_valid_voucher_returns_its_credit_and_customer(self):
        result = self._lookup(credit_voucher.credit_voucher_label(self.code))
        self.assertEqual(result["credit_origin"], self.NAME)
        self.assertEqual(result["customer"], "CUST-1")
        self.assertEqual(result["amount"], 139.3)
        self.assertEqual(result["code"], self.code)
        self.assertEqual(result["mobile_no"], "99887766")

    def test_wrong_check_is_refused(self):
        wrong = self.code[:-1] + ("2" if self.code[-1] != "2" else "3")
        with self.assertRaisesRegex(frappe.ValidationError, "not a valid credit note voucher"):
            self._lookup(wrong)

    def test_not_a_voucher_shape_is_refused(self):
        for text in ("", "hello", "ACC-SINV-2026-00269", "2026-00269"):
            with self.assertRaisesRegex(frappe.ValidationError, "not a valid"):
                self._lookup(text)

    def test_guessing_is_stopped_after_ten_wrong_numbers(self):
        wrong = self.code[:-1] + ("2" if self.code[-1] != "2" else "3")
        for _ in range(credit_voucher.LOOKUP_FAILURE_LIMIT):
            with self.assertRaises(frappe.ValidationError):
                self._lookup(wrong)
        with self.assertRaisesRegex(frappe.PermissionError, "Too many wrong voucher numbers"):
            self._lookup(self.code)

    def test_another_companys_voucher_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "another company"):
            self._lookup(self.code, company="Other Co")

    def test_used_voucher_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "already been used"):
            self._lookup(self.code, credit=[])

    def test_expired_voucher_is_refused_with_its_date(self):
        expired = [{"type": "Invoice", "credit_origin": self.NAME, "total_credit": 10, "expires_on": getdate("2026-01-05")}]
        with self.assertRaisesRegex(frappe.ValidationError, "expired on"):
            self._lookup(self.code, credit=[], expired=expired)

    def test_valid_voucher_is_not_a_bearer_voucher(self):
        self.assertEqual(self._lookup(self.code)["bearer"], 0)

    def test_bearer_voucher_of_a_linked_return_to_a_shared_customer_is_accepted(self):
        result = self._lookup(self.code, customer="Anonymous", generic=True)
        self.assertEqual(result["customer"], "Anonymous")
        self.assertEqual(result["bearer"], 1)
        self.assertEqual(result["code"], self.code)

    def test_shared_customer_voucher_without_an_original_sale_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "shared customer account"):
            self._lookup(self.code, customer="Anonymous", generic=True, linked=False)

    def test_parse(self):
        self.assertEqual(credit_voucher.parse_voucher_code("c26-00269-env2"), ("26", "", "00269", "C2600269ENV2"))
        self.assertEqual(
            credit_voucher.parse_voucher_code("c26-mco-00001-env2"), ("26", "MCO", "00001", "C26MCO00001ENV2")
        )
        self.assertIsNone(credit_voucher.parse_voucher_code("C26-M2O-00001-ENV2"))  # letters inside the number
        self.assertIsNone(credit_voucher.parse_voucher_code("C26-00269-EN01"))  # 0 and 1 are never in a check
        self.assertIsNone(credit_voucher.parse_voucher_code("X2600269ENV2"))


class TestLostVoucherBySupervisor(unittest.TestCase):
    """A POS supervisor on the till may name a return by its number instead
    of the voucher code; nobody else can."""

    NAME = "ACC-SINV-2026-00257"

    def setUp(self):
        frappe.cache.delete_value(credit_voucher._failure_key())
        self.addCleanup(frappe.cache.delete_value, credit_voucher._failure_key())

    def _lookup(self, text, supervisor, generic=False):
        real_get_value = frappe.db.get_value
        real_get_all = frappe.get_all

        def get_value(doctype, *args, **kwargs):
            fields = args[1] if len(args) > 1 else kwargs.get("fieldname")
            if doctype == "Sales Invoice":
                return frappe._dict(
                    name=self.NAME,
                    customer="Anonymous" if generic else "CUST-1",
                    customer_name="Anonymous" if generic else "Sanju",
                    company="Swan",
                    is_return=1,
                    docstatus=1,
                    return_against="ACC-SINV-2026-00250",
                )
            if doctype == "Customer":
                if fields == "posa_is_generic_customer":
                    return 1 if generic else 0
                return ""
            return real_get_value(doctype, *args, **kwargs)

        def get_all(doctype, *args, **kwargs):
            if doctype == "Sales Invoice":
                name_filter = kwargs.get("filters", {}).get("name", ["", ""])[1]
                return [self.NAME] if self.NAME.endswith(name_filter.lstrip("%")) else []
            return real_get_all(doctype, *args, **kwargs)

        credit = [{"type": "Invoice", "credit_origin": self.NAME, "total_credit": 139.3, "expires_on": getdate("2027-02-05")}]
        with patch(
            "posawesome.posawesome.api.pos_access.get_authorized_pos_profile",
            return_value=frappe._dict(name="Test Pos", company="Swan"),
        ), patch("frappe.get_all", side_effect=get_all), patch("frappe.db.get_value", side_effect=get_value), patch(
            "frappe.db.exists", return_value=False
        ), patch.object(credit_voucher, "_credit_supervisor", return_value=supervisor), patch(
            "posawesome.posawesome.api.payments.get_available_credit",
            return_value={"credit": credit, "expired": [], "generic_customer": False},
        ):
            return credit_voucher.lookup_credit_voucher(text, "Test Pos")

    def test_supervisor_can_use_the_return_number_and_no_code_is_revealed(self):
        result = self._lookup("2026-00257", supervisor="sara@x.test")
        self.assertEqual(result["credit_origin"], self.NAME)
        self.assertEqual(result["approved_by"], "sara@x.test")
        self.assertEqual(result["code"], "")
        self.assertEqual(result["voucher"], self.NAME)

    def test_a_lost_bearer_voucher_cannot_be_replaced_even_by_a_supervisor(self):
        with self.assertRaisesRegex(frappe.ValidationError, "works like cash"):
            self._lookup("2026-00257", supervisor="sara@x.test", generic=True)

    def test_a_cashier_cannot(self):
        with self.assertRaisesRegex(frappe.ValidationError, "not a valid credit note voucher"):
            self._lookup("2026-00257", supervisor=None)

    def test_text_that_is_not_a_number_finds_nothing(self):
        self.assertIsNone(credit_voucher.find_return_by_number("hello"))
        self.assertIsNone(credit_voucher.find_return_by_number(""))


class TestBearerVoucherHelpers(unittest.TestCase):
    """is_bearer_credit_note / bearer_voucher_for: a return linked to its sale,
    to a shared customer, refunding nothing."""

    def _generic(self, *names):
        return patch.object(credit_voucher, "is_generic_customer", side_effect=lambda c: c in names)

    def test_is_bearer_credit_note(self):
        with self._generic("Anonymous"):
            self.assertTrue(credit_voucher.is_bearer_credit_note(_credit_return(customer="Anonymous")))
            self.assertFalse(credit_voucher.is_bearer_credit_note(_credit_return()))
            self.assertFalse(credit_voucher.is_bearer_credit_note(_credit_return(customer="Anonymous", return_against=None)))
            self.assertFalse(credit_voucher.is_bearer_credit_note(_credit_return(customer="Anonymous", docstatus=0)))
            self.assertFalse(credit_voucher.is_bearer_credit_note(None))

    def test_bearer_voucher_for_a_no_refund_return_to_a_shared_customer(self):
        doc = _credit_return(customer="Anonymous", customer_name="Anonymous", docstatus=0)
        with self._generic("Anonymous"):
            voucher = credit_voucher.bearer_voucher_for(doc)
        code = credit_voucher.credit_voucher_code(doc.name)
        self.assertEqual(voucher["credit_origin"], doc.name)
        self.assertEqual(voucher["code"], code)
        self.assertEqual(voucher["voucher"], credit_voucher.credit_voucher_label(code))
        self.assertEqual(voucher["customer"], "Anonymous")
        self.assertEqual(voucher["bearer"], 1)
        self.assertAlmostEqual(voucher["amount"], 139.3)

    def test_no_bearer_voucher_otherwise(self):
        with self._generic("Anonymous"):
            self.assertIsNone(credit_voucher.bearer_voucher_for(_credit_return()))  # named customer
            self.assertIsNone(
                credit_voucher.bearer_voucher_for(_credit_return(customer="Anonymous", return_against=None))
            )
            refunded = _credit_return(
                customer="Anonymous", payments=[{"mode_of_payment": "Cash", "amount": -139.3}]
            )
            self.assertIsNone(credit_voucher.bearer_voucher_for(refunded))
            self.assertIsNone(credit_voucher.bearer_voucher_for(_credit_return(customer="Anonymous", is_return=0)))

    def test_bearer_voucher_print_says_it_works_like_cash(self):
        with patch("frappe.handler.is_valid_http_method", return_value=None), self._generic("Anonymous"):
            bearer = _text(
                frappe.render_template(
                    TEMPLATE, {"doc": _credit_return(customer="Anonymous", customer_name="Anonymous"), "print_settings": frappe._dict()}
                )
            )
            named = _text(frappe.render_template(TEMPLATE, {"doc": _credit_return(), "print_settings": frappe._dict()}))
        self.assertIn("works like cash", bearer)
        self.assertIn("A lost voucher can't be replaced.", bearer)
        self.assertNotIn("supervisor", bearer)
        self.assertIn("A lost voucher can only be replaced by a supervisor.", named)
        self.assertNotIn("works like cash", named)
        self.assertIn("[BARCODE]", bearer)
