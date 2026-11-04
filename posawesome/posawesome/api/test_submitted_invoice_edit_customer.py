import json
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api.submitted_invoice_edits import (
    _validate_corrected_customer,
    build_submitted_invoice_amendment_payload,
)

CUSTOMERS = {
    "CUST-OK": frappe._dict(disabled=0, customer_group="Retail"),
    "CUST-OFF": frappe._dict(disabled=1, customer_group="Retail"),
    "CUST-WHOLESALE": frappe._dict(disabled=0, customer_group="Wholesale"),
}


def _fake_get_value(doctype, name, fields=None, as_dict=False, *args, **kwargs):
    if doctype == "Customer":
        return CUSTOMERS.get(name)
    return None


class TestValidateCorrectedCustomer(unittest.TestCase):
    def setUp(self):
        self.original = frappe._dict(customer="CUST-OLD", pos_profile="Main POS")
        patches = [
            patch.object(frappe.db, "get_value", side_effect=_fake_get_value),
            patch.object(frappe, "get_cached_doc", return_value=frappe._dict(as_dict=lambda: {})),
            patch(
                "posawesome.posawesome.api.customers.get_customer_groups",
                return_value=["Retail"],
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _check(self, customer):
        correction = {"customer": customer}
        _validate_corrected_customer(self.original, correction)
        return correction

    def test_accepts_enabled_customer_in_profile_groups(self):
        self.assertEqual(self._check(" CUST-OK ")["customer"], "CUST-OK")

    def test_unchanged_customer_is_not_rechecked(self):
        # The original customer may sit outside the profile's groups (e.g. a walk-in).
        frappe.db.get_value.side_effect = AssertionError("should not look the customer up")
        self.assertEqual(self._check("CUST-OLD")["customer"], "CUST-OLD")

    def test_no_customer_in_correction_is_left_alone(self):
        correction = {"discount_amount": 5}
        _validate_corrected_customer(self.original, correction)
        self.assertNotIn("customer", correction)

    def test_rejects_empty_customer(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Choose a customer"):
            self._check("  ")

    def test_rejects_unknown_customer_with_clear_message(self):
        with self.assertRaisesRegex(frappe.ValidationError, "No Such Person was not found"):
            self._check("No Such Person")

    def test_rejects_disabled_customer(self):
        with self.assertRaisesRegex(frappe.ValidationError, "CUST-OFF is disabled"):
            self._check("CUST-OFF")

    def test_rejects_customer_outside_profile_groups(self):
        with self.assertRaisesRegex(frappe.ValidationError, "not available in this POS Profile"):
            self._check("CUST-WHOLESALE")

    def test_any_group_allowed_when_profile_has_no_customer_groups(self):
        with patch(
            "posawesome.posawesome.api.customers.get_customer_groups",
            return_value=[],
        ):
            self.assertEqual(self._check("CUST-WHOLESALE")["customer"], "CUST-WHOLESALE")

    def test_amendment_payload_rejects_unknown_customer_before_copying(self):
        with patch.object(frappe, "copy_doc", side_effect=AssertionError("must not copy")):
            with self.assertRaisesRegex(frappe.ValidationError, "was not found"):
                build_submitted_invoice_amendment_payload(
                    self.original, json.dumps({"customer": "No Such Person"})
                )
