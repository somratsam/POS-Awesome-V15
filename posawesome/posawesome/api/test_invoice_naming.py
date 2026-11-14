"""Invoice numbering per store (invoice_naming.py) and what depends on the
number: voucher codes with the store prefix, the store-only lost-voucher
lookup, the receipt barcode and the Returns scan of an old receipt."""

import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import credit_voucher, invoice_naming, print_barcode
from posawesome.posawesome.api.invoice_processing import returns

OPTIONS = [
    "ACC-SINV-.YYYY.-",
    "ACC-SINV-RET-.YYYY.-",
    "MCO-.YYYY.-",
    "MCO-CN-.YYYY.-",
    "VMO-.YYYY.-",  # its -CN series is not listed
    "SG-M-.YYYY.-",
    "SG-M-CN-.YYYY.-",
    "LONGX-.YYYY.-",
    "LONGX-CN-.YYYY.-",
    "mco-.YYYY.-",
    "MCO-.#####",
]


def _options():
    return patch.object(invoice_naming, "sales_invoice_series_options", return_value=list(OPTIONS))


def _profile_series(series_by_profile):
    real = frappe.db.get_value

    def get_value(*args, **kwargs):
        if len(args) >= 3 and args[0] == "POS Profile" and args[2] == invoice_naming.SERIES_FIELD:
            return series_by_profile.get(args[1])
        return real(*args, **kwargs)

    return patch("frappe.db.get_value", side_effect=get_value)


def _profile(series):
    doc = frappe.new_doc("POS Profile")  # unsaved
    doc.set(invoice_naming.SERIES_FIELD, series)
    return doc


def _invoice(**fields):
    data = {"doctype": "Sales Invoice", "naming_series": "HACK-.YYYY.-", "is_return": 0}
    data.update(fields)
    return frappe.get_doc(data)  # unsaved


class TestSeriesChoice(unittest.TestCase):
    def test_store_series_choices_need_their_credit_note_series(self):
        with _options():
            self.assertEqual(invoice_naming.store_series_choices(), ["MCO-.YYYY.-", "SG-M-.YYYY.-"])

    def test_return_series(self):
        self.assertEqual(invoice_naming.return_series_for("MCO-.YYYY.-"), "MCO-CN-.YYYY.-")
        self.assertEqual(invoice_naming.return_series_for("SG-M-.YYYY.-"), "SG-M-CN-.YYYY.-")

    def test_problems(self):
        with _options():
            self.assertIsNone(invoice_naming.series_problem("MCO-.YYYY.-"))
            for series, words in (
                ("ACC-SINV-.YYYY.-", "default series"),
                ("MCO-CN-.YYYY.-", "credit note series"),
                ("VMO-.YYYY.-", "Add VMO-CN-.YYYY.-"),
                ("NEW-.YYYY.-", "Add NEW-.YYYY.- and NEW-CN-.YYYY.-"),
                ("LONGX-.YYYY.-", "longer than 4"),
                ("mco-.YYYY.-", "capital letters"),
                ("MCO-.#####", "capital letters"),
                ("M2-.YYYY.-", "capital letters"),
            ):
                self.assertIn(words, invoice_naming.series_problem(series), series)

    def test_pos_profile_save_refuses_a_bad_series_and_accepts_blank(self):
        with _options():
            invoice_naming.validate_pos_profile(_profile(""))
            invoice_naming.validate_pos_profile(_profile("MCO-.YYYY.-"))
            with self.assertRaisesRegex(frappe.ValidationError, "Document Naming Settings"):
                invoice_naming.validate_pos_profile(_profile("VMO-.YYYY.-"))


class TestInvoiceSeries(unittest.TestCase):
    def _named(self, doc, profiles, originals=None):
        real = frappe.db.get_value

        def get_value(*args, **kwargs):
            if len(args) >= 3 and args[0] == "POS Profile" and args[2] == invoice_naming.SERIES_FIELD:
                return profiles.get(args[1])
            if len(args) >= 3 and args[0] == "Sales Invoice" and args[2] == "naming_series":
                return (originals or {}).get(args[1])
            return real(*args, **kwargs)

        with patch("frappe.db.get_value", side_effect=get_value):
            invoice_naming.set_invoice_naming_series(doc)
        return doc.naming_series

    def test_store_sales_and_returns_get_the_store_series_whatever_the_till_sent(self):
        profiles = {"MAX&Co": "MCO-.YYYY.-"}
        self.assertEqual(self._named(_invoice(pos_profile="MAX&Co"), profiles), "MCO-.YYYY.-")
        self.assertEqual(self._named(_invoice(pos_profile="MAX&Co", is_return=1), profiles), "MCO-CN-.YYYY.-")

    def test_a_store_without_a_series_keeps_acc_sinv(self):
        profiles = {"Expo": None}
        self.assertEqual(self._named(_invoice(pos_profile="Expo"), profiles), "ACC-SINV-.YYYY.-")
        self.assertEqual(self._named(_invoice(pos_profile="Expo", is_return=1), profiles), "ACC-SINV-.YYYY.-")

    def test_an_unusable_saved_series_falls_back_to_acc_sinv(self):
        for saved in ("ACC-SINV-.YYYY.-", "MCO-.#####", "junk"):
            self.assertEqual(
                self._named(_invoice(pos_profile="P"), {"P": saved}), "ACC-SINV-.YYYY.-", saved
            )

    def test_an_amendment_keeps_the_original_series(self):
        profiles = {"MAX&Co": "MCO-.YYYY.-"}
        doc = _invoice(pos_profile="MAX&Co", amended_from="ACC-SINV-2026-00213")
        originals = {"ACC-SINV-2026-00213": "ACC-SINV-.YYYY.-"}
        self.assertEqual(self._named(doc, profiles, originals), "ACC-SINV-.YYYY.-")

    def test_a_desk_invoice_without_a_pos_profile_is_left_alone(self):
        doc = _invoice(naming_series="ACC-SINV-RET-.YYYY.-")
        self.assertEqual(self._named(doc, {}), "ACC-SINV-RET-.YYYY.-")

    def test_frappe_names_the_invoice_from_the_store_series(self):
        """Real naming (set_new_name, which runs before_naming hooks), rolled back."""
        from frappe.model.naming import set_new_name

        profile = frappe.get_all("POS Profile", pluck="name", limit=1)
        if not profile:
            self.skipTest("no POS Profile on this site")
        frappe.db.savepoint("posa_naming_test")
        try:
            with _profile_series({profile[0]: "ZQT-.YYYY.-"}):
                sale = _invoice(pos_profile=profile[0])
                set_new_name(sale)
                credit = _invoice(pos_profile=profile[0], is_return=1)
                set_new_name(credit)
            year = frappe.utils.nowdate()[:4]
            self.assertEqual(sale.name, f"ZQT-{year}-00001")
            self.assertEqual(credit.name, f"ZQT-CN-{year}-00001")
        finally:
            frappe.db.rollback(save_point="posa_naming_test")


class TestStoreVoucherCode(unittest.TestCase):
    def test_store_credit_note_code_carries_the_prefix(self):
        code = credit_voucher.credit_voucher_code("MCO-CN-2026-00001")
        self.assertTrue(code.startswith("C26MCO00001"), code)
        self.assertEqual(len(code), 15)
        self.assertEqual(credit_voucher.credit_voucher_label(code), f"C26-MCO-00001-{code[-4:]}")
        self.assertTrue(credit_voucher.verify_credit_voucher_code("MCO-CN-2026-00001", "c26-mco-00001-" + code[-4:]))

    def test_old_codes_are_unchanged(self):
        name = "ACC-SINV-2026-00247"
        self.assertEqual(credit_voucher.credit_voucher_code(name), f"C2600247{credit_voucher._check(name)}")
        code = credit_voucher.credit_voucher_code(name)
        self.assertEqual(credit_voucher.credit_voucher_label(code), f"C26-00247-{code[-4:]}")

    def test_multi_part_prefix_and_amendment(self):
        self.assertTrue(credit_voucher.credit_voucher_code("SG-M-CN-2026-00003").startswith("C26SGM00003"))
        amended = credit_voucher.credit_voucher_code("MCO-CN-2026-00001-1")
        self.assertTrue(amended.startswith("C26MCO00001"))
        self.assertNotEqual(amended, credit_voucher.credit_voucher_code("MCO-CN-2026-00001"))

    def test_a_code_works_only_for_its_own_store(self):
        code = credit_voucher.credit_voucher_code("MCO-CN-2026-00001")
        for other in ("VMO-CN-2026-00001", "ACC-SINV-2026-00001", "MCO-2026-00001"):
            self.assertFalse(credit_voucher.verify_credit_voucher_code(other, code), other)

    def _find(self, code, candidates):
        seen = {}

        def get_all(doctype, filters=None, **kwargs):
            seen["name"] = filters["name"]
            return list(candidates)

        with patch("frappe.get_all", side_effect=get_all):
            found = credit_voucher.find_voucher_invoice(code)
        return found, seen["name"]

    def test_lookup_of_a_store_voucher(self):
        code = credit_voucher.credit_voucher_code("MCO-CN-2026-00001")
        found, name_filter = self._find(code, ["VMO-CN-2026-00001", "MCO-CN-2026-00001"])
        self.assertEqual(found, "MCO-CN-2026-00001")
        self.assertEqual(name_filter, ["like", "%-CN-2026-00001"])

    def test_lookup_of_an_old_voucher_among_store_returns_with_the_same_number(self):
        code = credit_voucher.credit_voucher_code("ACC-SINV-2026-00247")
        found, name_filter = self._find(code, ["MCO-CN-2026-00247", "ACC-SINV-2026-00247"])
        self.assertEqual(found, "ACC-SINV-2026-00247")
        self.assertEqual(name_filter, ["like", "%-2026-00247"])


class TestLostVoucherByNumberIsStoreOnly(unittest.TestCase):
    def _find(self, text, pos_profile, exists=False, matches=()):
        calls = {}

        def db_exists(doctype, filters=None, *args, **kwargs):
            calls["exists"] = dict(filters)
            return exists

        def get_all(doctype, filters=None, **kwargs):
            calls["get_all"] = dict(filters)
            return list(matches)

        with patch("frappe.db.exists", side_effect=db_exists), patch("frappe.get_all", side_effect=get_all):
            found = credit_voucher.find_return_by_number(text, pos_profile)
        return found, calls

    def test_number_part_searches_the_current_store_only(self):
        found, calls = self._find("2026-00257", "MAX&Co", matches=["MCO-CN-2026-00257"])
        self.assertEqual(found, "MCO-CN-2026-00257")
        self.assertEqual(calls["get_all"]["pos_profile"], "MAX&Co")
        self.assertEqual(calls["exists"]["pos_profile"], "MAX&Co")

    def test_full_name_of_another_store_is_not_found(self):
        found, calls = self._find("VMO-CN-2026-00257", "MAX&Co", exists=False)
        self.assertIsNone(found)
        self.assertEqual(calls["exists"], {"docstatus": 1, "is_return": 1, "pos_profile": "MAX&Co", "name": "VMO-CN-2026-00257"})

    def test_two_matches_in_the_store_are_ambiguous(self):
        found, _calls = self._find("2026-00257", "MAX&Co", matches=["MCO-CN-2026-00257", "ACC-SINV-2026-00257"])
        self.assertIsNone(found)

    def test_lookup_credit_voucher_passes_the_authorized_profile(self):
        with patch(
            "posawesome.posawesome.api.pos_access.get_authorized_pos_profile",
            return_value=frappe._dict(name="MAX&Co", company="Swan"),
        ), patch.object(credit_voucher, "_guard_lookup_attempts"), patch.object(
            credit_voucher, "_record_lookup_failure"
        ), patch.object(credit_voucher, "find_voucher_invoice", return_value=None), patch.object(
            credit_voucher, "_credit_supervisor", return_value="sara@x.test"
        ), patch.object(credit_voucher, "find_return_by_number", return_value=None) as by_number:
            with self.assertRaises(frappe.ValidationError):
                credit_voucher.lookup_credit_voucher("2026-00257", "MAX&Co")
        by_number.assert_called_once_with("2026-00257", "MAX&Co")


class TestReceiptBarcode(unittest.TestCase):
    def test_store_names_are_encoded_whole(self):
        self.assertEqual(print_barcode.invoice_scan_code("MCO-2026-00210"), "MCO-2026-00210")
        self.assertEqual(print_barcode.invoice_scan_code("MCO-2026-00210-1"), "MCO-2026-00210-1")
        self.assertEqual(print_barcode.invoice_scan_code("ABCD-2026-00210-1"), "ABCD-2026-00210-1")

    def test_default_series_keeps_the_number_part(self):
        self.assertEqual(print_barcode.invoice_scan_code("ACC-SINV-2026-00210"), "2026-00210")
        self.assertEqual(print_barcode.invoice_scan_code("ACC-SINV-2026-00210-1"), "2026-00210-1")

    def test_longest_store_name_and_voucher_fit_16_characters(self):
        # 4-character prefix (the limit), 5-digit number.
        self.assertEqual(len(print_barcode.invoice_scan_code("ABCD-2026-00210")), 15)
        self.assertEqual(len(credit_voucher.credit_voucher_code("ABCD-CN-2026-00210")), 16)


class TestOldReceiptScan(unittest.TestCase):
    def _match(self, text, existing):
        def db_exists(doctype, filters=None, *args, **kwargs):
            return filters["name"] in existing

        with patch("frappe.db.exists", side_effect=db_exists):
            return returns._default_series_scan_match("Sales Invoice", text, "Swan")

    def test_number_part_opens_the_default_series_sale(self):
        self.assertEqual(self._match("2026-00210", {"ACC-SINV-2026-00210"}), "ACC-SINV-2026-00210")
        self.assertEqual(self._match("2026-00210-1", {"ACC-SINV-2026-00210-1"}), "ACC-SINV-2026-00210-1")

    def test_other_text_uses_the_normal_search(self):
        self.assertIsNone(self._match("2026-00210", set()))
        self.assertIsNone(self._match("MCO-2026-00210", {"ACC-SINV-2026-00210"}))
        self.assertIsNone(self._match("00210", {"ACC-SINV-2026-00210"}))
        self.assertIsNone(returns._default_series_scan_match("POS Invoice", "2026-00210", "Swan"))

    def test_search_filters_by_the_exact_old_name(self):
        captured = {}

        def get_list(doctype, filters=None, **kwargs):
            captured.update(filters)
            return []

        with patch.object(returns, "_default_series_scan_match", return_value="ACC-SINV-2026-00210"), patch(
            "frappe.get_list", side_effect=get_list
        ), patch.object(returns, "_get_return_validity_settings", return_value=(0, 0)):
            returns.search_invoices_for_return("2026-00210", "Swan")
        self.assertEqual(captured["name"], ["=", "ACC-SINV-2026-00210"])

        with patch.object(returns, "_default_series_scan_match", return_value=None), patch(
            "frappe.get_list", side_effect=get_list
        ), patch.object(returns, "_get_return_validity_settings", return_value=(0, 0)):
            returns.search_invoices_for_return("MCO-2026-00210", "Swan")
        self.assertEqual(captured["name"], ["like", "%MCO-2026-00210%"])
