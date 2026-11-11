"""Sales Invoice List/Report view: Posting Date as one From - To range at the
top (sales_invoice_list.js via doctype_list_js), with ERPNext's single-date
top filter switched off by a Property Setter. Frontend behaviour is covered by
frontend/tests/salesInvoicePostingDateRange.spec.ts."""

import json
import pathlib

import frappe
from frappe.desk.form.meta import get_meta as get_desk_meta
from frappe.tests import IntegrationTestCase

APP_ROOT = pathlib.Path(__file__).resolve().parents[2]
LIST_JS = "posawesome/api/sales_invoice_list.js"
PROPERTY_SETTER = "Sales Invoice-posting_date-in_standard_filter"


class TestSalesInvoicePostingDateRange(IntegrationTestCase):
    def test_list_js_is_registered_and_exists(self):
        self.assertEqual(frappe.get_hooks("doctype_list_js", app_name="posawesome").get("Sales Invoice"), [LIST_JS])
        self.assertTrue((APP_ROOT / LIST_JS).is_file())

    def test_list_js_loads_after_erpnext_and_extends_its_settings(self):
        list_js = get_desk_meta("Sales Invoice").get("__list_js") or ""
        erpnext_at = list_js.find('frappe.listview_settings["Sales Invoice"] = {')
        ours_at = list_js.find("posa_posting_date_range")
        self.assertGreaterEqual(erpnext_at, 0)
        self.assertGreater(ours_at, erpnext_at)
        source = (APP_ROOT / LIST_JS).read_text()
        # extends, never replaces, ERPNext's object; keeps its onload
        self.assertNotIn('frappe.listview_settings[DOCTYPE] = {', source)
        self.assertIn("erpnextOnload.call(this, listview)", source)
        self.assertIn('fieldtype: "DateRange"', source)
        self.assertIn('condition: "Between"', source)

    def test_property_setter_fixture_and_live_meta(self):
        fixture = {
            row["name"]: row
            for row in json.loads((APP_ROOT / "fixtures" / "property_setter.json").read_text())
        }
        entry = fixture[PROPERTY_SETTER]
        self.assertEqual(
            (entry["doc_type"], entry["field_name"], entry["property"], entry["value"]),
            ("Sales Invoice", "posting_date", "in_standard_filter", "0"),
        )
        names = [
            name
            for spec in frappe.get_hooks("fixtures", app_name="posawesome")
            if isinstance(spec, dict) and spec.get("doctype") == "Property Setter"
            for flt in spec.get("filters", [])
            for name in flt[2]
        ]
        self.assertIn(PROPERTY_SETTER, names)

        field = frappe.get_meta("Sales Invoice").get_field("posting_date")
        self.assertEqual(field.in_standard_filter, 0)
        # Still a list column, so Report View's default columns keep Posting Date.
        self.assertEqual(field.in_list_view, 1)

    def test_pos_invoice_untouched(self):
        self.assertIsNone(frappe.get_hooks("doctype_list_js", app_name="posawesome").get("POS Invoice"))
        self.assertFalse(
            frappe.db.exists("Property Setter", {"doc_type": "POS Invoice", "property": "in_standard_filter"})
        )
