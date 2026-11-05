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
    def _call(self, doc, cashier="cashier@x.test", locked=False, readable=True):
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
        ), patch.object(doc, "add_comment", side_effect=lambda kind, text: comments.append((kind, text))):
            try:
                return credit_voucher.record_credit_note_reprint("Sales Invoice", doc.name, "Test Pos"), comments
            finally:
                self.comments = comments

    def test_voucher_reprint_records_the_pin_cashier(self):
        result, comments = self._call(_credit_return())
        self.assertEqual(result, {"credit_note": True, "cashier": "cashier@x.test"})
        self.assertEqual(comments[0], ("checked", "read"))
        [(kind, text)] = comments[1:]
        self.assertEqual(kind, "Info")
        self.assertIn("cashier@x.test", text)
        self.assertIn("Test Pos", text)
        self.assertIn("DUPLICATE", text)
        self.assertNotIn("<b>", text)  # the full name is escaped

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

    def _render(self, doc, reprint=False):
        return frappe.render_template(
            TEMPLATE, {"doc": doc, "print_settings": frappe._dict({"is_reprint": 1} if reprint else {})}
        )

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
