"""Check Stock barcode suggestions against the real database.

Creates a throwaway item with ten barcodes inside the test and rolls it all
back afterwards. unittest.TestCase (not FrappeTestCase): FrappeTestCase's
test-record preload crashes on staging ("Standard Buying" already exists).
"""

import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api.item_processing import stock_lookup
from posawesome.posawesome.api.item_processing.stock_lookup import suggest_item_barcodes

PREFIX = "ZZSG"  # no real barcode starts with this
AUTH = "posawesome.posawesome.api.item_processing.stock_lookup.get_authorized_pos_profile"


class TestSuggestItemBarcodes(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        frappe.db.savepoint("suggest_test")
        leaf_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
        self.item = frappe.get_doc(
            {
                "doctype": "Item",
                "item_code": "ZZ-SUGGEST-TEST-1",
                "item_name": "Suggest Test Sweater",
                "item_group": leaf_group,
                "stock_uom": "Nos",
                "is_stock_item": 0,
                "barcodes": [{"barcode": f"{PREFIX}0000{i:02d}"} for i in range(10)]
                + [{"barcode": "ZZSG%_LITERAL"}],
            }
        ).insert(ignore_permissions=True)
        for attribute, value in (("Size", "L"), ("Color", "MIDNIGHT BLUE")):
            frappe.get_doc(
                {
                    "doctype": "Item Variant Attribute",
                    "parent": self.item.name,
                    "parenttype": "Item",
                    "parentfield": "attributes",
                    "attribute": attribute,
                    "attribute_value": value,
                }
            ).db_insert()
        patcher = patch(AUTH, return_value=frappe._dict(name="Test Pos"))
        self.auth = patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        frappe.db.rollback(save_point="suggest_test")

    def test_returns_barcode_name_size_and_colour(self):
        rows = suggest_item_barcodes("Test Pos", f"{PREFIX}000000")
        self.assertEqual(
            rows,
            [
                {
                    "barcode": f"{PREFIX}000000",
                    "item_code": "ZZ-SUGGEST-TEST-1",
                    "item_name": "Suggest Test Sweater",
                    "size": "L",
                    "color": "MIDNIGHT BLUE",
                }
            ],
        )

    def test_at_most_eight_even_if_more_are_asked_for(self):
        self.assertEqual(len(suggest_item_barcodes("Test Pos", PREFIX)), 8)
        self.assertEqual(len(suggest_item_barcodes("Test Pos", PREFIX, limit=500)), 8)
        self.assertEqual(len(suggest_item_barcodes("Test Pos", PREFIX, limit=3)), 3)

    def test_fewer_than_four_characters_returns_nothing_without_querying(self):
        with patch.object(frappe.db, "sql") as sql:
            self.assertEqual(suggest_item_barcodes("Test Pos", "ZZS"), [])
            self.assertEqual(suggest_item_barcodes("Test Pos", "   "), [])
            sql.assert_not_called()

    def test_percent_and_underscore_are_plain_text_not_wildcards(self):
        self.assertEqual(suggest_item_barcodes("Test Pos", "ZZS%"), [])
        self.assertEqual(suggest_item_barcodes("Test Pos", "ZZSG_____"), [])
        rows = suggest_item_barcodes("Test Pos", "ZZSG%_")
        self.assertEqual([r["barcode"] for r in rows], ["ZZSG%_LITERAL"])

    def test_disabled_items_are_not_suggested(self):
        frappe.db.set_value("Item", self.item.name, "disabled", 1)
        self.assertEqual(suggest_item_barcodes("Test Pos", PREFIX), [])

    def test_profile_is_authorized_first_and_a_refusal_stops_everything(self):
        suggest_item_barcodes("Test Pos", PREFIX)
        self.auth.assert_called_with("Test Pos")
        self.auth.side_effect = frappe.PermissionError("not your profile")
        with patch.object(frappe.db, "sql") as sql:
            with self.assertRaises(frappe.PermissionError):
                suggest_item_barcodes("Other Profile", PREFIX)
            sql.assert_not_called()

    def test_like_pattern_escapes_wildcards(self):
        self.assertEqual(stock_lookup._like_prefix_pattern("a%b_c\\"), "a\\%b\\_c\\\\%")
