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
LINE_FIELDS = (
    "Sales Invoice Item-posa_item_variant_of",
    "Sales Invoice Item-posa_item_season",
    "Sales Invoice Item-posa_item_collection",
    "Sales Invoice Item-posa_item_vat",
)
PROPERTY_SETTERS = (
    "Sales Invoice Item-brand-hidden",
    "Sales Invoice Item-brand-read_only",
    "Sales Invoice Item-item_group-hidden",
)
ITEM_ROWS = {
    "VAR-1": dict(brand="MAX&CO.", variant_of="STYLE-1", custom_season="SS26 1ST DEL", custom_collection="SS26 1ST DEL"),
    "VAR-2": dict(brand="GEOX", variant_of="STYLE-2", custom_season=None, custom_collection="  "),
    "Consulting": dict(brand=None, variant_of=None, custom_season=None, custom_collection=None),
}

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


def _doc(items, cashier="cashier@example.com", doctype="Sales Invoice", taxes=None):
    return FakeDoc(
        doctype=doctype, posa_cashier=cashier, items=[FakeRow(row) for row in items],
        taxes=[FakeRow(t) for t in (taxes or [])],
    )


def _fake_get_all(doctype, filters=None, fields=None, order_by=None):
    if doctype == "Item Variant Attribute":
        wanted = set(filters["parent"][1])
        return [row for row in ATTRIBUTE_ROWS if row.parent in wanted]
    if doctype == "Item":
        out = []
        for n in filters["name"][1]:
            values = ITEM_ROWS.get(n, {})
            # Only the columns actually asked for, like the real query.
            out.append(frappe._dict(name=n, **{f: values.get(f) for f in fields if f != "name"}))
        return out
    return []


def _fake_get_value(doctype, name, fieldname):
    return {"cashier@example.com": "Aisha Al Balushi", "nofullname@example.com": None}.get(name)


@patch.object(reporting, "get_available_optional_item_fields", return_value=["custom_season", "custom_collection"])
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


@patch.object(reporting.frappe.db, "get_value", side_effect=_fake_get_value)
@patch.object(reporting.frappe, "get_all", side_effect=_fake_get_all)
class TestLineSnapshotFields(unittest.TestCase):
    def _run(self, rows, available=("custom_season", "custom_collection")):
        doc = _doc(rows)
        with patch.object(reporting, "get_available_optional_item_fields", return_value=list(available)):
            reporting.set_invoice_reporting_fields(doc)
        return doc

    def test_parent_style_season_and_collection_from_the_variant(self, *_):
        doc = self._run([{"item_code": "VAR-1"}])
        row = doc["items"][0]
        self.assertEqual(row.posa_item_variant_of, "STYLE-1")
        self.assertEqual((row.posa_item_season, row.posa_item_collection), ("SS26 1ST DEL", "SS26 1ST DEL"))

    def test_blank_season_or_collection_stays_blank_without_parent_fallback(self, *_):
        doc = self._run([{"item_code": "VAR-2", "posa_item_season": "STALE", "posa_item_collection": "STALE"}])
        row = doc["items"][0]
        # VAR-2's own values are blank / whitespace: copied as blank, never the parent's or a placeholder.
        self.assertIsNone(row.posa_item_season)
        self.assertIsNone(row.posa_item_collection)
        self.assertEqual(row.posa_item_variant_of, "STYLE-2")

    def test_non_variant_has_no_parent_style(self, *_):
        doc = self._run([{"item_code": "Consulting"}])
        self.assertIsNone(doc["items"][0].posa_item_variant_of)

    def test_site_without_the_item_fields_still_saves_and_leaves_them_untouched(self, get_all, *_):
        doc = self._run([{"item_code": "VAR-1", "posa_item_season": "KEEP"}], available=())
        row = doc["items"][0]
        self.assertEqual(row.posa_item_season, "KEEP")
        self.assertNotIn("posa_item_collection", row)
        self.assertEqual(row.posa_item_variant_of, "STYLE-1")
        item_query = [c for c in get_all.call_args_list if c.args[0] == "Item"][-1]
        self.assertEqual(item_query.kwargs["fields"], ["name", "brand", "variant_of"])

    def test_optional_fields_are_detected_from_the_item_meta(self, *_):
        class Meta:
            def __init__(self, fields):
                self.fields = fields

            def has_field(self, fieldname):
                return fieldname in self.fields

        with patch.object(reporting.frappe, "get_meta", return_value=Meta({"custom_season"})):
            self.assertEqual(reporting.get_available_optional_item_fields(), ["custom_season"])
        with patch.object(reporting.frappe, "get_meta", return_value=Meta(set())):
            self.assertEqual(reporting.get_available_optional_item_fields(), [])


class TestLineVat(unittest.TestCase):
    def _doc(self, items, taxes):
        return _doc(items, taxes=taxes)

    def test_vat_from_the_in_memory_breakdown_including_the_rounding_cent(self):
        doc = self._doc(
            [{"item_code": "A", "amount": 40.82, "net_amount": 38.88}, {"item_code": "B", "amount": 77.10, "net_amount": 73.43}],
            [{"charge_type": "On Net Total", "rate": 5}],
        )
        vat = doc.taxes[0]
        doc._item_wise_tax_details = [
            frappe._dict(item=doc["items"][0], tax=vat, amount=1.94),
            frappe._dict(item=doc["items"][1], tax=vat, amount=3.68),  # amount - net_amount would say 3.67
        ]
        reporting.set_line_vat(doc)
        self.assertEqual([r.posa_item_vat for r in doc["items"]], [1.94, 3.68])
        self.assertAlmostEqual(sum(r.posa_item_vat for r in doc["items"]), 5.62)

    def test_actual_charges_such_as_delivery_are_not_vat(self):
        doc = self._doc([{"item_code": "A", "amount": 105, "net_amount": 100}],
                        [{"charge_type": "On Net Total", "rate": 5}, {"charge_type": "Actual", "rate": 0}])
        vat, delivery = doc.taxes
        doc._item_wise_tax_details = [
            frappe._dict(item=doc["items"][0], tax=vat, amount=5.0),
            frappe._dict(item=doc["items"][0], tax=delivery, amount=2.0),
        ]
        reporting.set_line_vat(doc)
        self.assertEqual(doc["items"][0].posa_item_vat, 5.0)

    def test_returns_are_negative(self):
        doc = self._doc([{"item_code": "A", "amount": -16.04, "net_amount": -15.28}], [{"charge_type": "On Net Total", "rate": 5}])
        doc._item_wise_tax_details = [frappe._dict(item=doc["items"][0], tax=doc.taxes[0], amount=-0.76)]
        reporting.set_line_vat(doc)
        self.assertEqual(doc["items"][0].posa_item_vat, -0.76)

    def test_untaxed_invoice_lines_are_zero(self):
        doc = self._doc([{"item_code": "A", "amount": 10, "net_amount": 10, "posa_item_vat": 9}], [])
        reporting.set_line_vat(doc)
        self.assertEqual(doc["items"][0].posa_item_vat, 0)
        doc = self._doc([{"item_code": "A", "amount": 10, "net_amount": 10}], [{"charge_type": "Actual"}])
        reporting.set_line_vat(doc)
        self.assertEqual(doc["items"][0].posa_item_vat, 0)

    def test_stored_breakdown_rows_when_not_recalculated(self):
        doc = self._doc([{"item_code": "A", "name": "row-1", "amount": 10.5, "net_amount": 10}],
                        [{"charge_type": "On Net Total", "name": "tax-1"}, {"charge_type": "Actual", "name": "tax-2"}])
        doc["item_wise_tax_details"] = [FakeRow(item_row="row-1", tax_row="tax-1", amount=0.5),
                                         FakeRow(item_row="row-1", tax_row="tax-2", amount=3)]
        reporting.set_line_vat(doc)
        self.assertEqual(doc["items"][0].posa_item_vat, 0.5)

    def test_falls_back_to_amount_minus_net_without_any_breakdown(self):
        doc = self._doc([{"item_code": "A", "idx": 1, "amount": 77.10, "net_amount": 73.43}], [{"charge_type": "On Net Total"}])
        with patch.object(reporting.frappe, "logger") as logger:
            reporting.set_line_vat(doc)
        self.assertAlmostEqual(doc["items"][0].posa_item_vat, 3.67)
        logger.return_value.warning.assert_called_once()


class TestLineFieldFixtures(unittest.TestCase):
    def _hook_names(self, doctype):
        names = []
        for entry in hooks.fixtures:
            if entry["doctype"] == doctype:
                names.extend(n for f in entry["filters"] if f[0] == "name" and f[1] == "in" for n in f[2])
        return names

    def test_line_fields_defined_and_exported_after_size_color(self):
        fields = {f["name"]: f for f in json.loads((FIXTURES / "custom_field.json").read_text())}
        chain = ["posa_item_color", "posa_item_variant_of", "posa_item_season", "posa_item_collection", "posa_item_vat"]
        for name, after in zip(LINE_FIELDS, chain):
            self.assertIn(name, fields)
            self.assertEqual(fields[name]["read_only"], 1)
            self.assertEqual(fields[name]["insert_after"], after)
            self.assertIn(name, self._hook_names("Custom Field"))

    def test_item_season_and_collection_are_never_shipped(self):
        # They exist by hand on production: shipping a fixture with the same
        # name could overwrite or duplicate them on migrate.
        for path in FIXTURES.glob("*.json"):
            for row in json.loads(path.read_text()):
                if not isinstance(row, dict):
                    continue
                self.assertFalse(
                    row.get("dt") == "Item" and row.get("fieldname") in ("custom_season", "custom_collection"),
                    f"{path.name} ships Item {row.get('fieldname')}",
                )
                self.assertNotIn(row.get("name"), ("Item-custom_season", "Item-custom_collection"))
        for names in (self._hook_names("Custom Field"), self._hook_names("Property Setter")):
            self.assertNotIn("Item-custom_season", names)
            self.assertNotIn("Item-custom_collection", names)

    def test_item_group_is_unhidden_by_a_property_setter(self):
        setters = {p["name"]: p for p in json.loads((FIXTURES / "property_setter.json").read_text())}
        self.assertEqual(setters["Sales Invoice Item-item_group-hidden"]["value"], "0")
        self.assertEqual(setters["Sales Invoice Item-item_group-hidden"]["field_name"], "item_group")
        self.assertIn("Sales Invoice Item-item_group-hidden", self._hook_names("Property Setter"))


if __name__ == "__main__":
    unittest.main()
