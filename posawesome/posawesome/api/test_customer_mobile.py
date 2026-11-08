"""One mobile number per customer, stored clean (customer_mobile.py).

Runs against the real database (real Customer and Contact saves, real hooks);
everything is rolled back after each test. Only the POS Profile access check
is replaced, so create_customer can be called without a till session.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import customers
from posawesome.posawesome.api.customer_mobile import clean_mobile

GROUP = "_Test Customer Group"
TERRITORY = "_Test Territory"


def _customer(name, mobile=None, **extra):
    doc = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": name,
            "customer_type": "Individual",
            "customer_group": GROUP,
            "territory": TERRITORY,
            "mobile_no": mobile,
            **extra,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


def _contact_phones(customer):
    contact = frappe.db.get_value("Customer", customer, "customer_primary_contact")
    return contact, frappe.get_all("Contact Phone", filters={"parent": contact}, pluck="phone")


class TestCleanMobile(unittest.TestCase):
    def test_formats(self):
        cases = {
            "9123 4567": "91234567",
            "91234567": "91234567",
            "+968 91234567": "91234567",
            "+968 9123-4567": "91234567",
            "00968 9123 4567": "91234567",
            "968 91234567": "91234567",
            "(968) 9123 4567": "91234567",
            "+44 7700 900123": "+447700900123",
            "0044 7700 900123": "+447700900123",
            "447700900123": "+447700900123",
            "923001234567": "+923001234567",
            "+971 50 123 4567": "+971501234567",
            "123456": "123456",
            "": "",
            None: "",
            "n/a": "",
        }
        for raw, expected in cases.items():
            self.assertEqual(clean_mobile(raw), expected, raw)


class TestOneCustomerPerMobile(unittest.TestCase):
    def setUp(self):
        # A POS Profile with "Allow Duplicate Customer Names" on, as on the tills.
        profile = SimpleNamespace(as_dict=lambda: {"posa_allow_duplicate_customer_names": 1})
        self.access = patch.object(customers, "_assert_customer_write_allowed", return_value=profile)
        self.access.start()
        self.first = _customer("ZZ Mobile First", "+968 7999 0001")

    def tearDown(self):
        self.access.stop()
        frappe.db.rollback()

    def _create(self, name, mobile, **extra):
        return customers.create_customer(
            customer_name=name,
            company=None,
            pos_profile_doc=None,
            mobile_no=mobile,
            customer_group=GROUP,
            territory=TERRITORY,
            customer_type="Individual",
            **extra,
        )

    def test_customer_and_contact_store_the_clean_number(self):
        self.assertEqual(frappe.db.get_value("Customer", self.first.name, "mobile_no"), "79990001")
        contact, phones = _contact_phones(self.first.name)
        self.assertTrue(contact)
        self.assertEqual(phones, ["79990001"])
        self.assertEqual(frappe.db.get_value("Contact", contact, "mobile_no"), "79990001")

    def test_a_new_customer_with_the_same_number_in_any_format_is_refused(self):
        for mobile in ("79990001", "7999 0001", "+968 7999-0001", "0096879990001"):
            with self.assertRaises(frappe.ValidationError) as caught:
                self._create("ZZ Mobile Second", mobile)
            self.assertIn("Customer already exists: ZZ Mobile First, 79990001", str(caught.exception))
            # The Customer save hook refuses it too (Desk, imports).
            with self.assertRaises(frappe.ValidationError):
                _customer("ZZ Mobile Second", mobile)

    def test_same_name_with_another_number_is_allowed(self):
        second = self._create("ZZ Mobile First", "7999 0002")
        self.assertNotEqual(second.name, self.first.name)
        self.assertEqual(frappe.db.get_value("Customer", second.name, "mobile_no"), "79990002")

    def test_an_edit_to_another_customers_number_is_refused_every_way(self):
        second = _customer("ZZ Mobile Second", "79990002")
        with self.assertRaises(frappe.ValidationError) as caught:
            self._create("ZZ Mobile Second", "+968 79990001", method="update", customer_id=second.name)
        self.assertIn("ZZ Mobile First", str(caught.exception))
        with self.assertRaises(frappe.ValidationError):
            customers.set_customer_info(second.name, "mobile_no", "7999 0001")
        contact, _phones = _contact_phones(second.name)
        contact_doc = frappe.get_doc("Contact", contact)
        contact_doc.phone_nos[0].phone = "+968 7999 0001"
        with self.assertRaises(frappe.ValidationError):
            contact_doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Customer", second.name, "mobile_no"), "79990002")

    def test_an_edit_to_a_free_number_is_saved_clean_on_customer_and_contact(self):
        second = _customer("ZZ Mobile Second", "79990002")
        self._create("ZZ Mobile Second", "+968 7999 0003", method="update", customer_id=second.name)
        self.assertEqual(frappe.db.get_value("Customer", second.name, "mobile_no"), "79990003")
        contact, phones = _contact_phones(second.name)
        self.assertEqual(phones, ["79990003"])
        self.assertEqual(frappe.db.get_value("Contact", contact, "mobile_no"), "79990003")

    def test_keeping_your_own_number_is_not_a_duplicate(self):
        self._create("ZZ Mobile First Renamed", "+968 79990001", method="update", customer_id=self.first.name)
        self.assertEqual(frappe.db.get_value("Customer", self.first.name, "customer_name"), "ZZ Mobile First Renamed")

    def test_an_old_pair_sharing_a_number_can_still_be_saved(self):
        second = _customer("ZZ Mobile Second", "79990002")
        frappe.db.set_value("Customer", second.name, "mobile_no", "7999 0001", update_modified=False)
        contact, _phones = _contact_phones(second.name)
        frappe.db.set_value("Contact", contact, "mobile_no", "7999 0001", update_modified=False)
        frappe.db.set_value("Contact Phone", {"parent": contact}, "phone", "7999 0001", update_modified=False)
        doc = frappe.get_doc("Customer", second.name)
        doc.customer_details = "still saves"
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Customer", second.name, "mobile_no"), "79990001")

    def test_a_disabled_customers_number_can_be_reused(self):
        frappe.db.set_value("Customer", self.first.name, "disabled", 1)
        second = self._create("ZZ Mobile Second", "79990001")
        self.assertEqual(frappe.db.get_value("Customer", second.name, "mobile_no"), "79990001")

    def test_foreign_numbers_keep_the_plus_and_match_00(self):
        foreign = self._create("ZZ Mobile Foreign", "+44 7700 900123")
        self.assertEqual(frappe.db.get_value("Customer", foreign.name, "mobile_no"), "+447700900123")
        with self.assertRaises(frappe.ValidationError):
            self._create("ZZ Mobile Foreign 2", "0044 7700 900123")

    def test_offline_sync_links_the_sale_to_the_existing_customer(self):
        before = frappe.db.count("Customer")
        result = self._create("ZZ Mobile Offline", "+968 7999 0001", offline_sync=1)
        self.assertEqual(result["name"], self.first.name)
        self.assertEqual(result["posa_linked_existing_customer"], 1)
        self.assertEqual(frappe.db.count("Customer"), before)
        created = self._create("ZZ Mobile Offline", "7999 0009", offline_sync=1)
        self.assertEqual(frappe.db.get_value("Customer", created.name, "mobile_no"), "79990009")

    def test_live_check_finds_the_customer_in_any_format(self):
        found = customers.find_customer_by_mobile("+968 7999 0001", None, None)
        self.assertEqual(found, {"name": self.first.name, "customer_name": "ZZ Mobile First", "mobile_no": "79990001"})
        self.assertIsNone(customers.find_customer_by_mobile("7999", None, None))
        self.assertIsNone(customers.find_customer_by_mobile("79990001", None, None, customer_id=self.first.name))
        self.assertIsNone(customers.find_customer_by_mobile("79990099", None, None))

    def test_submit_duplicate_check_reports_the_mobile_first(self):
        matches = customers._find_duplicate_customer_records(
            customer_name="Someone Else", mobile_no="+968 7999-0001", allow_duplicate_names=True
        )
        self.assertEqual([m["name"] for m in matches], [self.first.name])
        self.assertEqual(matches[0]["matching_fields"], ["mobile_no"])

    def test_search_finds_the_customer_whatever_format_is_typed(self):
        with patch.object(customers, "get_customer_groups", return_value=[]):
            for term in ("79990001", "7999 0001", "+968 7999 0001", "0096879990001"):
                found = customers.search_customers("{}", term)
                self.assertIn(self.first.name, [row["name"] for row in found], term)
