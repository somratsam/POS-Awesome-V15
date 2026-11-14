"""Swan receipt (posawesome/templates/print/swan_receipt.html), the exact
exchange lookup behind it (credit_voucher.exchange_credit_sources) and the
Print Format record switch (receipt_record). Documents are unsaved: no
database writes."""

import html as html_lib
import pathlib
import re
import unittest
from unittest.mock import patch

import frappe
from frappe.utils import getdate

from posawesome.posawesome.api import credit_voucher, receipt_record

PRINT_DIR = pathlib.Path(credit_voucher.__file__).resolve().parents[2] / "templates" / "print"
RECEIPT = (PRINT_DIR / "swan_receipt.html").read_text()


def _text(html):
    html = re.sub(r"<svg.*?</svg>", " [BARCODE] ", html, flags=re.S)
    html = re.sub(r"<style.*?</style>", "", html, flags=re.S)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    return " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", html)).split())


def _doc(**overrides):
    data = {
        "doctype": "Sales Invoice",
        "name": "MCO-2026-00007",
        "docstatus": 1,
        "is_return": 0,
        "customer": "Anonymous",
        "pos_profile": None,
        "posa_cashier": "Administrator",
        "posa_pos_opening_shift": "SHIFT-1",
        "posting_date": getdate("2026-11-14"),
        "posting_time": "14:00:49.31",
        "net_total": 133.4,
        "grand_total": 140.07,
        "total_qty": 2,
        "discount_amount": 0,
        "change_amount": 0,
        "posa_redeemed_customer_credit": 0,
        "posa_remaining_customer_credit_balance": 409.15,
        "items": [
            {"item_code": "IT-1", "item_name": "ABITO IN JERSEY-3-L", "qty": 1, "amount": 43.47,
             "price_list_rate": 96.6, "rate": 43.47, "discount_percentage": 55},
            {"item_code": "IT-2", "item_name": "ABITO IN JERSEY-1-XL", "qty": 1, "amount": 96.6,
             "price_list_rate": 96.6, "rate": 96.6},
        ],
        "taxes": [{"description": "VAT - SI", "rate": 5, "tax_amount": 6.67}],
        "payments": [{"mode_of_payment": "Visa", "amount": 140.07}],
    }
    data.update(overrides)
    return frappe.get_doc(data)


def _return(**overrides):
    data = {
        "name": "ACC-SINV-2026-00398",
        "is_return": 1,
        "return_against": "ACC-SINV-2026-00397",
        "net_total": -73.6,
        "grand_total": -77.28,
        "total_qty": -1,
        "items": [{"item_code": "IT-9", "item_name": "ABITO IN JERSEY-1-L", "qty": -1, "amount": -77.28,
                   "price_list_rate": 96.6, "rate": 77.28, "discount_percentage": 20}],
        "taxes": [{"description": "VAT - SI", "rate": 5, "tax_amount": -3.68}],
        "payments": [{"mode_of_payment": "Visa", "amount": 0}],
    }
    data.update(overrides)
    return _doc(**data)


def _sources(returns=(), used=0.0, other_credit=0.0):
    return frappe._dict(
        returns=list(returns),
        used=used,
        returned=sum(abs(r.grand_total) for r in returns),
        other_credit=other_credit,
    )


class _ReceiptCase(unittest.TestCase):
    def setUp(self):
        # The logo lookup runs frappe.call, which checks the request's HTTP
        # method; tests have no request.
        patcher = patch("frappe.handler.is_valid_http_method", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def render(self, doc, sources=None, settings=None):
        template = RECEIPT.replace("exchange_credit_sources(doc)", "ex_sources")
        return frappe.render_template(
            template,
            {
                "doc": doc,
                "print_settings": frappe._dict(settings or {}),
                "ex_sources": sources or _sources(),
            },
        )


class TestSaleReceipt(_ReceiptCase):
    def test_header_title_and_vat_label(self):
        text = _text(self.render(_doc()))
        self.assertIn("SWAN INTERNATIONAL S.P.C البجعة الدولية ش ش و", text)
        self.assertIn("Simplified Tax Invoice فاتورة ضريبية مبسطة", text)
        self.assertIn("CR No: 1817094", text)
        # Tax table: fixed "VAT" label, rate and amounts from the tax row
        self.assertIn("VAT 6.670 5% 133.400", text)
        self.assertNotIn("VAT - SI", text)
        self.assertIn("**** OMR 140.070 ****", text)
        self.assertIn("Reference: MCO-2026-00007", text)
        self.assertIn("[BARCODE]", text)
        self.assertIn("You have been served by", text)
        self.assertNotIn("Tax Credit Note", text)
        self.assertNotIn("EXCHANGE", text)
        # No store name line (as production); no exchange date when the sale has none
        self.assertNotIn('class="store-name"', self.render(_doc()))
        self.assertNotIn("valid until", text)
        dated = _text(self.render(_doc(posa_return_valid_upto=getdate("2026-11-29"))))
        self.assertIn("[BARCODE] Exchange until 29-11-2026 · الاستبدال حتى", dated)

    def test_company_vat_number_from_tax_id(self):
        company = frappe.db.get_value("Company", {"tax_id": ["is", "set"]}, ["name", "tax_id"], as_dict=True)
        if not company:
            self.skipTest("no company with a Tax ID on this site")
        self.assertIn(f"VAT No: {company.tax_id} : الرقم الضريبي", _text(self.render(_doc(company=company.name))))
        self.assertNotIn("VAT No", _text(self.render(_doc(company=None))))

    def test_time_before_ten_has_two_digit_hours(self):
        text = _text(self.render(_doc(posting_time="3:41:18.350947")))
        self.assertIn("14-11-2026 03:41", text)
        self.assertNotIn("3:41:", text)

    def test_no_pooled_remaining_credit_line(self):
        # A sale paid with an older voucher: the exact amount used shows,
        # never posa_remaining_customer_credit_balance (pooled for Anonymous).
        doc = _doc(posa_redeemed_customer_credit=50, payments=[{"mode_of_payment": "Visa", "amount": 90.07}])
        text = _text(self.render(doc, _sources(other_credit=50)))
        self.assertIn("Credit Applied رصيد مستخدم -50.000 OMR", text)
        self.assertNotIn("Remaining Credit", text)
        self.assertNotIn("409.150", text)
        self.assertNotIn("Exchange Value", text)


class TestReturnReceipt(_ReceiptCase):
    def test_card_refund(self):
        doc = _return(name="ACC-SINV-2026-00355", payments=[{"mode_of_payment": "Visa", "amount": -77.28}])
        text = _text(self.render(doc))
        self.assertIn("Tax Credit Note إشعار دائن ضريبي", text)
        self.assertIn("Original invoice · الفاتورة الأصلية ACC-SINV-2026-00397", text)
        orig_date = frappe.db.get_value("Sales Invoice", "ACC-SINV-2026-00397", "posting_date")
        if orig_date:
            self.assertIn(f"ACC-SINV-2026-00397 {getdate(orig_date).strftime('%d-%m-%Y')}", text)
        self.assertIn("Refunded · Visa 77.280 OMR", text)
        self.assertNotIn("Store Credit Issued", text)
        self.assertNotIn("keep this receipt as your credit note", text)
        self.assertNotIn("Credit Valid Until", text)
        self.assertNotIn("[BARCODE]", text)

    def test_part_refund_keeps_the_rest_as_store_credit(self):
        doc = _return(payments=[{"mode_of_payment": "Visa", "amount": -27.28}], outstanding_amount=-50)
        text = _text(self.render(doc))
        expiry = getdate(credit_voucher.credit_voucher_valid_until(doc)).strftime("%d-%m-%Y")
        self.assertIn(f"Credit Valid Until صالح حتى {expiry}", text)
        self.assertIn("Refunded · Visa 27.280 OMR", text)
        self.assertIn("Store Credit Issued رصيد صادر 50.000 OMR", text)
        self.assertIn("Please keep this receipt as your credit note.", text)


class TestExchangeReceipt(_ReceiptCase):
    def _sale(self, **overrides):
        data = {
            "name": "ACC-SINV-2026-00399",
            "net_total": 150,
            "grand_total": 157.5,
            "posa_redeemed_customer_credit": 77.28,
            "items": [
                {"item_code": "IT-1", "item_name": "ABITO IN JERSEY-1-XL", "qty": 1, "amount": 91.35,
                 "price_list_rate": 91.35, "rate": 91.35},
                {"item_code": "IT-2", "item_name": "ABITO IN JERSEY-2-XL", "qty": 1, "amount": 66.15,
                 "price_list_rate": 66.15, "rate": 66.15},
            ],
            "taxes": [{"description": "VAT - SI", "rate": 5, "tax_amount": 7.5}],
            "payments": [{"mode_of_payment": "Visa", "amount": 80.22}],
        }
        data.update(overrides)
        return _doc(**data)

    def test_returned_items_new_items_vat_and_difference(self):
        text = _text(self.render(self._sale(), _sources([_return()], used=77.28)))
        self.assertIn("EXCHANGE · استبدال", text)
        self.assertIn("RETURNED ITEMS الأصناف المرتجعة Return No: ACC-SINV-2026-00398 "
                      "Original receipt: ACC-SINV-2026-00397", text)
        self.assertIn("-1x ABITO IN JERSEY-1-L -77.280", text)
        self.assertIn("20% on 96.600 is -19.320", text)
        self.assertNotIn("--19.320", text)
        self.assertIn("NEW ITEMS الأصناف الجديدة", text)
        self.assertIn("**** OMR 80.220 **** Difference paid", text)
        self.assertIn("VAT 7.500 5% 150.000", text)
        self.assertIn("VAT returned -3.680 5% -73.600", text)
        self.assertIn("Returned total المرتجع -77.280 OMR", text)
        self.assertIn("New items total الجديد 157.500 OMR", text)
        self.assertIn("Difference paid الفرق 80.220 OMR", text)
        self.assertIn("Visa 80.220 OMR", text)
        self.assertNotIn("BALANCE voucher", text)
        self.assertNotIn("Remaining Credit", text)
        self.assertIn("Simplified Tax Invoice", text)

    def test_leftover_credit_only_points_to_the_balance_voucher(self):
        ret = _return(name="ACC-SINV-2026-00390", grand_total=-92.4, net_total=-88)
        sale = self._sale(grand_total=60.9, net_total=58, posa_redeemed_customer_credit=60.9,
                          payments=[{"mode_of_payment": "Visa", "amount": 0}])
        text = _text(self.render(sale, _sources([ret], used=60.9)))
        self.assertIn("Difference paid الفرق 0.000 OMR", text)
        self.assertIn("Remaining credit is on the separate BALANCE voucher.", text)
        self.assertNotIn("31.500", text)

    def test_not_an_exchange_without_a_traced_return(self):
        # Same customer had a return this shift, but its credit didn't pay
        # for this sale: no exchange block.
        text = _text(self.render(self._sale(posa_redeemed_customer_credit=0), _sources()))
        self.assertNotIn("EXCHANGE", text)
        self.assertNotIn("Exchange Value", text)


class TestExchangeCreditSources(unittest.TestCase):
    def _run(self, sale, rows, docs):
        with patch.object(credit_voucher.frappe.db, "sql", return_value=[frappe._dict(r) for r in rows]) as sql, \
             patch.object(credit_voucher.frappe, "get_doc", side_effect=lambda dt, name: docs[name]):
            return credit_voucher.exchange_credit_sources(sale), sql

    def test_same_shift_return_is_an_exchange_older_credit_is_not(self):
        sale = _doc(name="S-1", posa_redeemed_customer_credit=100)
        same = _return(name="R-1", grand_total=-77.28)
        older = _return(name="R-0", grand_total=-40, posa_pos_opening_shift="SHIFT-0")
        result, sql = self._run(sale, [{"credit_note": "R-0", "used": 22.72}, {"credit_note": "R-1", "used": 77.28}],
                                {"R-1": same, "R-0": older})
        self.assertEqual([d.name for d in result.returns], ["R-1"])
        self.assertAlmostEqual(result.used, 77.28)
        self.assertAlmostEqual(result.returned, 77.28)
        self.assertAlmostEqual(result.other_credit, 22.72)
        # The sale's name is passed as a query parameter, never formatted in.
        self.assertEqual(sql.call_args.args[1], {"sale": "S-1"})

    def test_credit_with_no_entries_yet_counts_as_other_credit(self):
        result, _sql = self._run(_doc(name="S-2", posa_redeemed_customer_credit=30), [], {})
        self.assertEqual(result.returns, [])
        self.assertAlmostEqual(result.other_credit, 30)

    def test_returns_sales_and_sales_without_credit_are_skipped(self):
        for doc in (_doc(posa_redeemed_customer_credit=0), _return(), None):
            with patch.object(credit_voucher.frappe.db, "sql") as sql:
                result = credit_voucher.exchange_credit_sources(doc)
            sql.assert_not_called()
            self.assertEqual(result.returns, [])
            self.assertEqual(result.other_credit, 0)

    def test_no_shift_on_the_sale_is_never_an_exchange(self):
        sale = _doc(name="S-3", posa_redeemed_customer_credit=10, posa_pos_opening_shift=None)
        ret = _return(name="R-3", posa_pos_opening_shift=None)
        result, _sql = self._run(sale, [{"credit_note": "R-3", "used": 10}], {"R-3": ret})
        self.assertEqual(result.returns, [])
        self.assertAlmostEqual(result.other_credit, 10)


class TestRecordSwitch(unittest.TestCase):
    def setUp(self):
        patcher = patch("frappe.handler.is_valid_http_method", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_switch_prints_the_receipt_or_the_voucher(self):
        ctx = {"print_settings": frappe._dict()}
        refund = _return(payments=[{"mode_of_payment": "Visa", "amount": -77.28}])
        voucher = _return(outstanding_amount=-77.28)
        # A return: exchange_credit_sources returns at once, no lookup.
        receipt_html = frappe.render_template(receipt_record.SWITCH_HTML, {**ctx, "doc": refund})
        self.assertIn("Refunded · Visa", _text(receipt_html))
        self.assertIn("Credit note voucher", _text(frappe.render_template(receipt_record.SWITCH_HTML, {**ctx, "doc": voucher})))

    def test_switch_refuses_an_unexpected_record(self):
        fake = frappe._dict(html="hand edited", name=receipt_record.PRINT_FORMAT)
        with patch.object(receipt_record.frappe, "get_doc", return_value=fake), \
             patch.object(receipt_record, "_backup") as backup:
            with self.assertRaises(frappe.ValidationError):
                receipt_record.switch_swan_receipt(expected_md5="0" * 32)
        backup.assert_not_called()
        self.assertEqual(fake.html, "hand edited")
