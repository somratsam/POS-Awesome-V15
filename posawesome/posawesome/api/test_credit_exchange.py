import unittest
import uuid

import frappe
from frappe.tests.utils import FrappeTestCase

from posawesome.posawesome.api.credit_exchange import get_customers_with_same_shift_return


class TestGetCustomersWithSameShiftReturn(FrappeTestCase):
    """Uses an already-existing POS Opening Shift purely as a reference
    name -- never opens or closes a shift itself, so it can't collide with
    a real, currently-open shift on this site (POS Opening Shift enforces
    one open shift per user per profile). Only the temporary Customer and
    Sales Invoice test fixtures this file creates are ever written or
    cleaned up."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._scope = self._require_scope()
        self._opening_shift = self._require_existing_opening_shift()
        self._customers = []
        self._invoices = []

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in self._invoices:
            if not frappe.db.exists("Sales Invoice", name):
                continue
            docstatus = frappe.db.get_value("Sales Invoice", name, "docstatus")
            if docstatus == 1:
                frappe.get_doc("Sales Invoice", name).cancel()
            frappe.delete_doc("Sales Invoice", name, force=True, ignore_permissions=True)
        for name in self._customers:
            if frappe.db.exists("Customer", name):
                frappe.delete_doc("Customer", name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDown()

    def _require_scope(self):
        profile = frappe.db.get_value(
            "POS Profile", {}, ["name", "company", "selling_price_list", "warehouse"], as_dict=True
        )
        if not profile:
            self.skipTest("A POS Profile is required for this database test")
        item = frappe.db.get_value("Item", {"disabled": 0, "is_stock_item": 0}, "name")
        if not item:
            item = frappe.db.get_value("Item", {"disabled": 0}, "name")
        if not item:
            self.skipTest("A non-stock Item is required for this database test")
        profile["item"] = item
        return profile

    def _require_existing_opening_shift(self):
        name = frappe.db.get_value(
            "POS Opening Shift",
            {"pos_profile": self._scope.name, "docstatus": 1},
            "name",
        )
        if not name:
            self.skipTest("An existing submitted POS Opening Shift is required for this database test")
        return name

    def _insert_customer(self):
        name = f"Same-Shift Exchange Test {uuid.uuid4().hex[:8]}"
        doc = frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": name,
                "customer_group": frappe.db.get_value("Customer Group", {}, "name"),
                "territory": frappe.db.get_value("Territory", {}, "name"),
            }
        ).insert(ignore_permissions=True)
        self._customers.append(doc.name)
        return doc.name

    def _insert_return_invoice(self, customer, docstatus=1, pos_opening_shift=None):
        doc = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "customer": customer,
                "company": self._scope.company,
                "is_pos": 1,
                "pos_profile": self._scope.name,
                "is_return": 1,
                "selling_price_list": self._scope.selling_price_list,
                "set_warehouse": self._scope.warehouse,
                "posa_pos_opening_shift": pos_opening_shift or self._opening_shift,
                "items": [
                    {
                        "item_code": self._scope.item,
                        "qty": -1,
                        "rate": 10,
                        "warehouse": self._scope.warehouse,
                    }
                ],
            }
        )
        doc.insert(ignore_permissions=True)
        if docstatus == 1:
            doc.submit()
        elif docstatus == 2:
            doc.submit()
            doc.cancel()
        self._invoices.append(doc.name)
        return doc.name

    def test_finds_customer_with_a_submitted_same_shift_return(self):
        customer = self._insert_customer()
        self._insert_return_invoice(customer)

        result = get_customers_with_same_shift_return([customer], self._opening_shift)

        self.assertEqual(result, [customer])

    def test_excludes_a_draft_return(self):
        customer = self._insert_customer()
        self._insert_return_invoice(customer, docstatus=0)

        result = get_customers_with_same_shift_return([customer], self._opening_shift)

        self.assertEqual(result, [])

    def test_excludes_a_cancelled_return(self):
        customer = self._insert_customer()
        self._insert_return_invoice(customer, docstatus=2)

        result = get_customers_with_same_shift_return([customer], self._opening_shift)

        self.assertEqual(result, [])

    def test_excludes_a_return_from_a_different_shift(self):
        # posa_pos_opening_shift is a Link field -- an arbitrary string
        # would fail link validation, so this needs a second real,
        # already-existing shift. Reused purely as a reference value (its
        # own open/closed state is never touched), same as self._opening_shift.
        different_shift = frappe.db.get_value(
            "POS Opening Shift",
            {"name": ["!=", self._opening_shift], "docstatus": 1},
            "name",
        )
        if not different_shift:
            self.skipTest("A second existing POS Opening Shift is required for this test")

        customer = self._insert_customer()
        self._insert_return_invoice(customer, pos_opening_shift=different_shift)

        result = get_customers_with_same_shift_return([customer], self._opening_shift)

        self.assertEqual(result, [])

    def test_batch_call_returns_only_the_matching_subset(self):
        returning_customer = self._insert_customer()
        unrelated_customer = self._insert_customer()
        self._insert_return_invoice(returning_customer)

        result = get_customers_with_same_shift_return(
            [returning_customer, unrelated_customer], self._opening_shift
        )

        self.assertEqual(result, [returning_customer])

    def test_empty_customer_list_returns_empty_without_error(self):
        self.assertEqual(get_customers_with_same_shift_return([], self._opening_shift), [])

    def test_missing_opening_shift_returns_empty_without_error(self):
        customer = self._insert_customer()
        self.assertEqual(get_customers_with_same_shift_return([customer], None), [])


def run_site_assertions():
    """Run the focused DB assertions without ERPNext's global test-record
    bootstrap, matching the sibling pattern in
    pos_invoice_submission_ledger/test_pos_invoice_submission_ledger.py."""

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(
        TestGetCustomersWithSameShiftReturn
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise AssertionError(
            f"Same-shift exchange assertions failed: {len(result.failures)} failures, "
            f"{len(result.errors)} errors"
        )
    return {
        "tests_run": result.testsRun,
        "skipped": len(result.skipped),
    }
