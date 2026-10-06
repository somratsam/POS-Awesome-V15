import json
import pathlib
import unittest
from unittest.mock import patch

import frappe

from posawesome import hooks
from posawesome.posawesome.api import invoice, invoice_reporting_fields as reporting

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "posawesome" / "fixtures"
CUSTOM_FIELDS = (
    "Sales Invoice Item-posa_item_size",
    "Sales Invoice Item-posa_item_color",
    "Sales Invoice-posa_cashier_name",
)
PROPERTY_SETTERS = ("Sales Invoice Item-brand-hidden", "Sales Invoice Item-brand-read_only")

ATTRIBUTE_ROWS = [
    frappe._dict(parent="VAR-1", attribute="Size", attribute_value="38"),
    frappe._dict(parent="VAR-1", attribute="Color", attribute_value="NAVY"),
    frappe._dict(parent="VAR-2", attribute="Size", attribute_value="M"),
]


class FakeRow(frappe._dict):
    def set(self, key, value):
        self[key] = value


class FakeDoc(frappe._dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _doc(items, cashier="cashier@example.com", doctype="Sales Invoice"):
    return FakeDoc(doctype=doctype, posa_cashier=cashier, items=[FakeRow(row) for row in items])


def _fake_get_all(doctype, filters=None, fields=None, order_by=None):
    if doctype == "Item Variant Attribute":
        wanted = set(filters["parent"][1])
        return [row for row in ATTRIBUTE_ROWS if row.parent in wanted]
    if doctype == "Item":
        brands = {"VAR-1": "MAX&CO.", "VAR-2": "GEOX"}
        return [frappe._dict(name=n, brand=brands.get(n)) for n in filters["name"][1]]
    return []


def _fake_get_value(doctype, name, fieldname):
    return {"cashier@example.com": "Aisha Al Balushi", "nofullname@example.com": None}.get(name)


@patch.object(reporting.frappe.db, "get_value", side_effect=_fake_get_value)
@patch.object(reporting.frappe, "get_all", side_effect=_fake_get_all)
class TestSetInvoiceReportingFields(unittest.TestCase):
    def test_variant_rows_get_size_color_and_brand(self, *_):
        doc = _doc([{"item_code": "VAR-1"}, {"item_code": "VAR-2"}])
        reporting.set_invoice_reporting_fields(doc)
        self.assertEqual((doc["items"][0].posa_item_size, doc["items"][0].posa_item_color), ("38", "NAVY"))
        self.assertEqual(doc["items"][0].brand, "MAX&CO.")
        # VAR-2 has a Size but no Color attribute: Color stays blank, nothing raises.
        self.assertEqual((doc["items"][1].posa_item_size, doc["items"][1].posa_item_color), ("M", None))

    def test_non_variant_row_left_blank(self, *_):
        doc = _doc([{"item_code": "Consulting"}])
        reporting.set_invoice_reporting_fields(doc)
        self.assertIsNone(doc["items"][0].posa_item_size)
        self.assertIsNone(doc["items"][0].posa_item_color)

    def test_client_supplied_brand_is_replaced_from_item(self, *_):
        doc = _doc([{"item_code": "VAR-1", "brand": "TAMPERED"}, {"item_code": "Consulting", "brand": "TAMPERED"}])
        reporting.set_invoice_reporting_fields(doc)
        self.assertEqual(doc["items"][0].brand, "MAX&CO.")
        self.assertIsNone(doc["items"][1].brand)

    def test_stale_values_are_replaced_when_item_changes(self, *_):
        doc = _doc([{"item_code": "Consulting", "posa_item_size": "38", "posa_item_color": "NAVY"}])
        reporting.set_invoice_reporting_fields(doc)
        self.assertIsNone(doc["items"][0].posa_item_size)
        self.assertIsNone(doc["items"][0].posa_item_color)

    def test_cashier_name_is_full_name(self, *_):
        doc = _doc([], cashier="cashier@example.com")
        reporting.set_invoice_reporting_fields(doc)
        self.assertEqual(doc.posa_cashier_name, "Aisha Al Balushi")

    def test_cashier_name_falls_back_to_user_id_without_full_name(self, *_):
        doc = _doc([], cashier="nofullname@example.com")
        reporting.set_invoice_reporting_fields(doc)
        self.assertEqual(doc.posa_cashier_name, "nofullname@example.com")

    def test_no_cashier_leaves_name_empty(self, *_):
        doc = _doc([], cashier=None)
        reporting.set_invoice_reporting_fields(doc)
        self.assertIsNone(doc.posa_cashier_name)

    def test_pos_invoice_is_not_touched(self, *_):
        doc = _doc([{"item_code": "VAR-1"}], doctype="POS Invoice")
        reporting.set_invoice_reporting_fields(doc)
        self.assertNotIn("posa_item_size", doc["items"][0])
        self.assertNotIn("posa_cashier_name", doc)


class TestValidateHookWiring(unittest.TestCase):
    def test_sales_invoice_validate_sets_reporting_fields(self):
        names = (
            "validate_shift",
            "validate_pos_invoice_item_sale_controls",
            "apply_discount_reasons",
            "set_patient",
            "auto_set_delivery_charges",
            "calc_delivery_charges",
            "apply_tax_inclusive",
        )
        patches = [patch.object(invoice, name) for name in names]
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch.object(invoice, "set_invoice_reporting_fields") as setter:
            doc = object()
            invoice.validate(doc, "validate")
        setter.assert_called_once_with(doc)


class TestReportingFixtures(unittest.TestCase):
    def _hook_names(self, doctype):
        names = []
        for entry in hooks.fixtures:
            if entry["doctype"] == doctype:
                names.extend(n for f in entry["filters"] if f[0] == "name" and f[1] == "in" for n in f[2])
        return names

    def test_custom_fields_defined_and_exported(self):
        fields = {f["name"]: f for f in json.loads((FIXTURES / "custom_field.json").read_text())}
        for name in CUSTOM_FIELDS:
            self.assertIn(name, fields)
            self.assertEqual(fields[name]["fieldtype"], "Data")
            self.assertEqual(fields[name]["read_only"], 1)
            self.assertIn(name, self._hook_names("Custom Field"))
        self.assertEqual(fields["Sales Invoice Item-posa_item_size"]["insert_after"], "brand")
        self.assertEqual(fields["Sales Invoice Item-posa_item_color"]["insert_after"], "posa_item_size")
        # posa_cashier already anchors posa_below_cost_override; sit after that hidden chain
        # instead of creating a second field anchored on posa_cashier.
        self.assertEqual(
            fields["Sales Invoice-posa_cashier_name"]["insert_after"], "posa_below_cost_override_details"
        )

    def test_brand_property_setters_defined_and_exported(self):
        setters = {p["name"]: p for p in json.loads((FIXTURES / "property_setter.json").read_text())}
        self.assertEqual(setters["Sales Invoice Item-brand-hidden"]["value"], "0")
        self.assertEqual(setters["Sales Invoice Item-brand-read_only"]["value"], "1")
        for name in PROPERTY_SETTERS:
            self.assertIn(name, self._hook_names("Property Setter"))


if __name__ == "__main__":
    unittest.main()
