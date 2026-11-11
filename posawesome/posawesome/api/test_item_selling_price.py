"""Item.posa_selling_price: kept equal to the Item's current Standard Selling
price by Item Price hooks and a daily refresh; never touches standard_rate,
the Item's modified, or Version history. Readable through Pick Columns."""

import json
import pathlib
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, today

from posawesome.posawesome.api import item_selling_price
from posawesome.posawesome.api.item_selling_price import (
    FIELDNAME,
    daily_refresh,
    get_standard_selling_prices,
    refresh_items,
)

PREFIX = "ISP-TEST"
APP_ROOT = pathlib.Path(item_selling_price.__file__).resolve().parents[2]
HOOK = "posawesome.posawesome.api.item_selling_price.on_item_price_change"


def _value(code):
    return flt(frappe.db.get_value("Item", code, FIELDNAME))


class TestItemSellingPrice(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.customer = frappe.db.get_value("Customer", {}, "name")
        if not frappe.db.exists("UOM", "Box"):
            frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).db_insert()
        for suffix in ("A", "B", "C", "D", "E", "F", "G"):
            cls._item(f"{PREFIX}-{suffix}")

    @classmethod
    def _item(cls, code):
        frappe.get_doc(
            {
                "doctype": "Item",
                "name": code,
                "item_code": code,
                "item_name": f"{code} name",
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "is_stock_item": 1,
                "description": code,
            }
        ).db_insert()
        for idx, (uom, factor) in enumerate((("Nos", 1), ("Box", 12)), start=1):
            frappe.get_doc(
                {
                    "doctype": "UOM Conversion Detail",
                    "parent": code,
                    "parenttype": "Item",
                    "parentfield": "uoms",
                    "idx": idx,
                    "uom": uom,
                    "conversion_factor": factor,
                }
            ).db_insert()

    def _price(self, item_code, rate, price_list="Standard Selling", **extra):
        doc = frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": item_code,
                "price_list": price_list,
                "uom": "Nos",
                "price_list_rate": rate,
                **extra,
            }
        )
        doc.insert()
        return doc

    # -- hooks ----------------------------------------------------------------

    def test_create_edit_delete_keep_item_in_sync(self):
        code = f"{PREFIX}-A"
        self.assertEqual(_value(code), 0)
        price = self._price(code, 97.65)
        self.assertEqual(_value(code), 97.65)

        price.reload()
        price.price_list_rate = 105.5
        price.save()
        self.assertEqual(_value(code), 105.5)

        price.delete()
        self.assertEqual(_value(code), 0)

    def test_moving_a_price_to_another_item_updates_both(self):
        old, new = f"{PREFIX}-B", f"{PREFIX}-C"
        price = self._price(old, 40)
        self.assertEqual(_value(old), 40)
        price.reload()
        price.item_code = new
        price.save()
        self.assertEqual(_value(old), 0)
        self.assertEqual(_value(new), 40)

    def test_moving_a_price_off_standard_selling_clears_it(self):
        code = f"{PREFIX}-D"
        price = self._price(code, 33)
        self.assertEqual(_value(code), 33)
        price.reload()
        price.price_list = "Standard Buying"
        price.save()
        self.assertEqual(_value(code), 0)

    def test_other_price_lists_customer_prices_and_other_uoms_are_ignored(self):
        code = f"{PREFIX}-E"
        self._price(code, 11, price_list="Standard Buying")
        self._price(code, 22, customer=self.customer)
        self._price(code, 33, uom="Box")
        self.assertEqual(_value(code), 0)
        self._price(code, 44)
        self.assertEqual(_value(code), 44)

    def test_never_writes_standard_rate_modified_or_versions(self):
        code = f"{PREFIX}-F"
        versions = frappe.db.count("Version", {"ref_doctype": "Item", "docname": code})
        modified = frappe.db.get_value("Item", code, "modified")
        price = self._price(code, 61.2)
        price.reload()
        price.price_list_rate = 62.3
        price.save()
        price.delete()
        refresh_items([code])
        self.assertEqual(flt(frappe.db.get_value("Item", code, "standard_rate")), 0)
        self.assertEqual(_value(code), 0)
        self.assertEqual(frappe.db.get_value("Item", code, "modified"), modified)
        self.assertEqual(frappe.db.count("Version", {"ref_doctype": "Item", "docname": code}), versions)

    # -- picking rule / daily refresh -----------------------------------------

    def test_validity_dates_and_newest_valid_from(self):
        code = f"{PREFIX}-G"
        rows = [
            (80, add_days(today(), -30), None),
            (97.65, add_days(today(), -1), None),  # today's price
            (120, add_days(today(), 5), None),  # not yet valid
            (10, add_days(today(), -60), add_days(today(), -40)),  # expired
        ]
        for rate, valid_from, valid_upto in rows:
            frappe.get_doc(
                {
                    "doctype": "Item Price",
                    "item_code": code,
                    "price_list": "Standard Selling",
                    "selling": 1,
                    "uom": "Nos",
                    "price_list_rate": rate,
                    "valid_from": valid_from,
                    "valid_upto": valid_upto,
                }
            ).db_insert()  # no hooks: the daily refresh has to catch these
        stock_uoms = {code: "Nos"}
        self.assertEqual(get_standard_selling_prices([code], stock_uoms), {code: 97.65})
        self.assertEqual(get_standard_selling_prices([code], stock_uoms, on=add_days(today(), 5)), {code: 120})
        self.assertEqual(get_standard_selling_prices([code], stock_uoms, on=add_days(today(), -50)), {code: 10})

        self.assertEqual(_value(code), 0)
        with patch.object(frappe.db, "commit") as commit:
            result = daily_refresh()
        self.assertEqual(_value(code), 97.65)
        self.assertGreaterEqual(result["updated"], 1)
        commit.assert_called_once()

    def test_refresh_is_idempotent_and_matches_item_price(self):
        refresh_items()
        self.assertEqual(refresh_items()["updated"], 0)
        mismatches = frappe.db.sql(
            f"""
            SELECT ip.item_code FROM `tabItem Price` ip
            JOIN `tabItem` i ON i.name = ip.item_code
            WHERE ip.price_list = 'Standard Selling' AND ip.selling = 1
              AND IFNULL(ip.customer, '') = '' AND IFNULL(ip.supplier, '') = ''
              AND IFNULL(ip.batch_no, '') = '' AND IFNULL(ip.uom, i.stock_uom) = i.stock_uom
              AND (ip.valid_from IS NULL OR ip.valid_from <= CURDATE())
              AND (ip.valid_upto IS NULL OR ip.valid_upto >= CURDATE())
              AND NOT EXISTS (
                SELECT 1 FROM `tabItem Price` other
                WHERE other.item_code = ip.item_code AND other.name != ip.name
                  AND other.price_list = 'Standard Selling'
              )
              AND ROUND(ip.price_list_rate, 9) != ROUND(i.`{FIELDNAME}`, 9)
            """,
            pluck=True,
        )
        self.assertEqual(mismatches, [])

    # -- Pick Columns / copying -----------------------------------------------

    def test_pick_columns_data_path_returns_the_price(self):
        from frappe.desk.query_report import get_data_for_custom_field

        code = f"{PREFIX}-A"
        self._price(code, 55.5)
        data = get_data_for_custom_field("Item", FIELDNAME, json.dumps([code]))
        self.assertEqual(flt(data[code]), 55.5)

    def test_field_is_read_only_no_copy_and_not_copied_to_variants(self):
        df = frappe.get_meta("Item").get_field(FIELDNAME)
        self.assertEqual((df.fieldtype, df.label, df.read_only, df.no_copy), ("Currency", "Selling Price", 1, 1))
        self.assertEqual(frappe.get_meta("Item").get_field(FIELDNAME).insert_after, "sales_uom")
        copied = frappe.get_all(
            "Variant Field", filters={"parent": "Item Variant Settings", "field_name": FIELDNAME}
        )
        self.assertEqual(copied, [])
        from erpnext.controllers.item_variant import copy_attributes_to_variant

        item = frappe.get_doc("Item", f"{PREFIX}-A")
        item.set(FIELDNAME, 12)
        # Desk's Duplicate honours no_copy (Python's copy_doc ignores it by default).
        self.assertEqual(flt(frappe.copy_doc(item, ignore_no_copy=False).get(FIELDNAME)), 0)
        variant = frappe.new_doc("Item")
        copy_attributes_to_variant(item, variant)
        self.assertEqual(flt(variant.get(FIELDNAME)), 0)

    # -- wiring ---------------------------------------------------------------

    def test_hooks_fixture_and_patch_are_wired(self):
        hooks = frappe.get_hooks("doc_events", app_name="posawesome")
        for event in ("after_insert", "on_update", "after_delete"):
            self.assertIn(HOOK, frappe.get_hooks("doc_events")["Item Price"][event])
        self.assertTrue(hooks)
        cron = frappe.get_hooks("scheduler_events")["cron"]
        self.assertIn("posawesome.posawesome.api.item_selling_price.daily_refresh", cron["5 0 * * *"])

        fixture = {r["name"]: r for r in json.loads((APP_ROOT / "fixtures" / "custom_field.json").read_text())}
        entry = fixture["Item-posa_selling_price"]
        self.assertEqual((entry["insert_after"], entry["read_only"], entry["no_copy"]), ("sales_uom", 1, 1))
        fixture_names = [
            f for spec in frappe.get_hooks("fixtures", app_name="posawesome")
            if isinstance(spec, dict) and spec.get("doctype") == "Custom Field"
            for flt_ in spec.get("filters", []) for f in flt_[2]
        ]
        self.assertIn("Item-posa_selling_price", fixture_names)
        patches = (APP_ROOT / "patches.txt").read_text().split()
        self.assertIn("posawesome.patches.backfill_item_selling_price", patches)

    def test_module_never_writes_standard_rate(self):
        source = pathlib.Path(item_selling_price.__file__).read_text()
        code_lines = [line for line in source.splitlines() if "standard_rate" in line]
        # Only the module docstring mentions it; no code line reads or writes it.
        self.assertTrue(all(not line.strip().startswith(("frappe.", "item", "doc")) for line in code_lines))
        self.assertNotIn('"standard_rate"', source)
