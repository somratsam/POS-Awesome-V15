import io
import json

import frappe
import openpyxl
from frappe.desk.query_report import export_query, run
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from posawesome.posawesome.report.upload_stock_check.upload_stock_check import (
    REPORT_NAME,
    get_uploads,
    get_warehouses,
)

PREFIX = "USC-TEST"
STORE_A_USER = "usc-store-a@test.invalid"
STORE_B_USER = "usc-store-b@test.invalid"
SALES_ONLY_USER = "usc-sales-only@test.invalid"
OTHER_DOCTYPE_USER = "usc-other-doctype@test.invalid"
TWO_STORES_USER = "usc-two-stores@test.invalid"


class TestUploadStockCheck(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.company = frappe.db.get_value("Company", {}, "name")
        cls.wh_a = cls._warehouse("Store A")
        cls.wh_b = cls._warehouse("Store B")
        cls.wh_group = cls._warehouse("Group", is_group=1)
        cls.wh_disabled = cls._warehouse("Closed Store")
        frappe.db.set_value("Warehouse", cls.wh_disabled, "disabled", 1)

        cls._item(f"{PREFIX}-STYLE", None, has_variants=1)
        cls._item(f"{PREFIX}-A1", f"{PREFIX}-STYLE", description="<p>Wool <b>jacket</b></p>", season="SS26 1ST DEL", collection="SS26 MAIN")
        cls._item(f"{PREFIX}-A2", f"{PREFIX}-STYLE")
        cls._item(f"{PREFIX}-B1", f"{PREFIX}-STYLE")
        cls._item(f"{PREFIX}-OLD", f"{PREFIX}-STYLE")
        cls._attribute(f"{PREFIX}-A1", "Size", "M")
        cls._attribute(f"{PREFIX}-A1", "Color", "NAVY")
        # Older variants used the "Colour" attribute instead of "Color".
        cls._attribute(f"{PREFIX}-A2", "Size", "L")
        cls._attribute(f"{PREFIX}-A2", "Colour", "RED")

        cls._price(f"{PREFIX}-A1", 80, valid_from=add_days(today(), -30))
        cls._price(f"{PREFIX}-A1", 97.65, valid_from=add_days(today(), -1))  # today's price
        cls._price(f"{PREFIX}-A1", 120, valid_from=add_days(today(), 5))  # not yet valid
        cls._price(f"{PREFIX}-A1", 50, valid_from=add_days(today(), -1), customer=frappe.db.get_value("Customer", {}, "name"))
        cls._price(f"{PREFIX}-A2", 10, valid_from=add_days(today(), -1), valid_upto=add_days(today(), -1))  # expired

        cls.upload_old = cls._upload("OLD", "2026-08-01", "09:00:00", [(f"{PREFIX}-OLD", cls.wh_a, 7)])
        cls.upload_mixed = cls._upload(
            "MIXED",
            "2026-08-05",
            "13:07:14",
            [(f"{PREFIX}-A1", cls.wh_a, 50), (f"{PREFIX}-A2", cls.wh_a, 3), (f"{PREFIX}-B1", cls.wh_b, 9)],
        )
        cls.upload_b_only = cls._upload("BONLY", "2026-08-06", "10:00:00", [(f"{PREFIX}-B1", cls.wh_b, 4)])
        cls.upload_draft = cls._upload("DRAFT", "2026-08-07", "10:00:00", [(f"{PREFIX}-A1", cls.wh_a, 1)], docstatus=0)

        cls._user(STORE_A_USER, "Stock User", warehouse=cls.wh_a)
        cls._user(STORE_B_USER, "Stock User", warehouse=cls.wh_b)
        cls._user(SALES_ONLY_USER, "Sales User", warehouse=cls.wh_a)
        cls._user(OTHER_DOCTYPE_USER, "Stock User", warehouse=cls.wh_b, applicable_for="Sales Invoice")
        cls._user(TWO_STORES_USER, "Stock User", warehouse=cls.wh_a)
        cls._user_permission(TWO_STORES_USER, cls.wh_b)

    def tearDown(self):
        frappe.set_user("Administrator")

    # -- fixtures -------------------------------------------------------------

    @classmethod
    def _warehouse(cls, label, is_group=0):
        return (
            frappe.get_doc(
                {
                    "doctype": "Warehouse",
                    "warehouse_name": f"{PREFIX} {label}",
                    "company": cls.company,
                    "is_group": is_group,
                }
            )
            .insert(ignore_permissions=True)
            .name
        )

    @classmethod
    def _item(cls, code, variant_of, has_variants=0, description=None, season=None, collection=None):
        doc = frappe.get_doc(
            {
                "doctype": "Item",
                "name": code,
                "item_code": code,
                "item_name": f"{code} name",
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "variant_of": variant_of,
                "has_variants": has_variants,
                "brand": None,
                "description": description or code,
            }
        )
        meta = frappe.get_meta("Item")
        if meta.has_field("custom_season"):
            doc.custom_season = season
        if meta.has_field("custom_collection"):
            doc.custom_collection = collection
        doc.db_insert()

    @classmethod
    def _attribute(cls, item_code, attribute, value):
        frappe.get_doc(
            {
                "doctype": "Item Variant Attribute",
                "parent": item_code,
                "parenttype": "Item",
                "parentfield": "attributes",
                "attribute": attribute,
                "attribute_value": value,
            }
        ).db_insert()

    @classmethod
    def _price(cls, item_code, rate, valid_from=None, valid_upto=None, customer=None):
        frappe.get_doc(
            {
                "doctype": "Item Price",
                "item_code": item_code,
                "price_list": "Standard Selling",
                "selling": 1,
                "uom": "Nos",
                "price_list_rate": rate,
                "valid_from": valid_from,
                "valid_upto": valid_upto,
                "customer": customer,
            }
        ).db_insert()

    @classmethod
    def _upload(cls, suffix, posting_date, posting_time, rows, docstatus=1):
        name = f"{PREFIX}-RECO-{suffix}"
        frappe.get_doc(
            {
                "doctype": "Stock Reconciliation",
                "name": name,
                "company": cls.company,
                "purpose": "Opening Stock",
                "posting_date": posting_date,
                "posting_time": posting_time,
                "docstatus": docstatus,
            }
        ).db_insert()
        for idx, (item_code, warehouse, qty) in enumerate(rows, start=1):
            frappe.get_doc(
                {
                    "doctype": "Stock Reconciliation Item",
                    "parent": name,
                    "parenttype": "Stock Reconciliation",
                    "parentfield": "items",
                    "idx": idx,
                    "item_code": item_code,
                    "warehouse": warehouse,
                    "qty": qty,
                    "docstatus": docstatus,
                }
            ).db_insert()
        return name

    @classmethod
    def _user(cls, email, role, warehouse=None, applicable_for=None):
        frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "send_welcome_email": 0,
                "roles": [{"role": role}],
            }
        ).insert(ignore_permissions=True)
        if warehouse:
            cls._user_permission(email, warehouse, applicable_for)

    @classmethod
    def _user_permission(cls, email, warehouse, applicable_for=None):
        frappe.get_doc(
            {
                "doctype": "User Permission",
                "user": email,
                "allow": "Warehouse",
                "for_value": warehouse,
                "apply_to_all_doctypes": 0 if applicable_for else 1,
                "applicable_for": applicable_for,
            }
        ).insert(ignore_permissions=True)

    # -- helpers --------------------------------------------------------------

    def _filters(self, upload, warehouse=None):
        return {"upload": upload, **({"warehouse": warehouse} if warehouse else {})}

    def _run(self, upload, warehouse=None):
        return run(REPORT_NAME, self._filters(upload, warehouse))["result"]

    def _codes(self, upload, warehouse=None):
        return [row["item_code"] for row in self._run(upload, warehouse)]

    def _export(self, upload, warehouse=None):
        frappe.local.form_dict = frappe._dict(
            {
                "report_name": REPORT_NAME,
                "file_format_type": "Excel",
                "filters": json.dumps(self._filters(upload, warehouse)),
                "visible_idx": "[]",
            }
        )
        frappe.local.response = frappe._dict()
        export_query()
        sheet = openpyxl.load_workbook(io.BytesIO(frappe.response["filecontent"])).active
        return [list(r) for r in sheet.iter_rows(values_only=True)]

    def _upload_values(self):
        return [u["value"] for u in get_uploads()]

    # -- tests ----------------------------------------------------------------

    def test_only_the_chosen_upload_is_returned(self):
        self.assertEqual(self._codes(self.upload_mixed), [f"{PREFIX}-A1", f"{PREFIX}-A2", f"{PREFIX}-B1"])
        self.assertEqual(self._codes(self.upload_old), [f"{PREFIX}-OLD"])

    def test_draft_reconciliation_is_not_an_upload(self):
        self.assertEqual(self._codes(self.upload_draft), [])
        self.assertNotIn(self.upload_draft, self._upload_values())

    def test_columns_and_values(self):
        fieldnames = [c["fieldname"] for c in run(REPORT_NAME, {"upload": self.upload_mixed})["columns"]]
        self.assertEqual(
            fieldnames,
            [
                "item_code", "variant_of", "item_name", "description", "brand", "size", "colour",
                "season", "collection", "price", "qty", "upload_datetime",
            ],
        )
        a1, a2 = self._run(self.upload_mixed)[:2]
        self.assertEqual(a1["variant_of"], f"{PREFIX}-STYLE")
        self.assertEqual(a1["description"], "Wool jacket")
        self.assertEqual((a1["size"], a1["colour"]), ("M", "NAVY"))
        self.assertEqual((a2["size"], a2["colour"]), ("L", "RED"))
        self.assertEqual(a1["qty"], 50)
        self.assertEqual(str(a1["upload_datetime"]), "2026-08-05 13:07:14")
        if frappe.get_meta("Item").has_field("custom_season"):
            self.assertEqual(a1["season"], "SS26 1ST DEL")
        if frappe.get_meta("Item").has_field("custom_collection"):
            self.assertEqual(a1["collection"], "SS26 MAIN")

    def test_price_is_todays_standard_selling_price(self):
        a1, a2 = self._run(self.upload_mixed)[:2]
        self.assertEqual(a1["price"], 97.65)  # not the future, older, or customer-specific price
        self.assertIsNone(a2["price"])  # only an expired price exists

    def test_store_user_sees_only_their_warehouse(self):
        frappe.set_user(STORE_A_USER)
        self.assertEqual(self._codes(self.upload_mixed), [f"{PREFIX}-A1", f"{PREFIX}-A2"])
        self.assertEqual(self._codes(self.upload_b_only), [])
        frappe.set_user(STORE_B_USER)
        self.assertEqual(self._codes(self.upload_mixed), [f"{PREFIX}-B1"])

    def test_excel_export_is_limited_to_the_users_warehouse(self):
        frappe.set_user(STORE_A_USER)
        rows = self._export(self.upload_mixed)
        flat = [str(v) for row in rows for v in row if v is not None]
        self.assertIn(f"{PREFIX}-A1", flat)
        self.assertIn(f"{PREFIX}-A2", flat)
        self.assertNotIn(f"{PREFIX}-B1", flat)
        header = next(row for row in rows if row and row[0] == "Item Code (Barcode)")
        self.assertEqual(header[-1], "Upload Date and Time")
        self.assertEqual(len(header), 12)

    def test_upload_list_respects_warehouses_and_counts_permitted_rows(self):
        frappe.set_user(STORE_A_USER)
        uploads = {u["value"]: u["label"] for u in get_uploads()}
        self.assertIn(self.upload_mixed, uploads)
        self.assertIn(self.upload_old, uploads)
        self.assertNotIn(self.upload_b_only, uploads)
        self.assertIn("05-08-2026 13:07", uploads[self.upload_mixed])
        self.assertIn("· 2 items", uploads[self.upload_mixed])

        frappe.set_user(STORE_B_USER)
        uploads = {u["value"]: u["label"] for u in get_uploads()}
        self.assertNotIn(self.upload_old, uploads)
        self.assertIn("· 1 item", uploads[self.upload_mixed])

    def test_upload_list_is_newest_first(self):
        values = [v for v in self._upload_values() if v.startswith(PREFIX)]
        self.assertEqual(values, [self.upload_b_only, self.upload_mixed, self.upload_old])

    def test_user_without_a_report_role_is_refused(self):
        frappe.set_user(SALES_ONLY_USER)
        self.assertRaises(frappe.PermissionError, get_uploads)
        self.assertRaises(frappe.PermissionError, self._run, self.upload_mixed)

    def test_permission_applicable_to_another_doctype_does_not_restrict(self):
        # Same as Frappe's own list queries: only permissions applying to all
        # doctypes, or to Stock Reconciliation, restrict what is read.
        frappe.set_user(OTHER_DOCTYPE_USER)
        self.assertEqual(self._codes(self.upload_mixed), [f"{PREFIX}-A1", f"{PREFIX}-A2", f"{PREFIX}-B1"])

    # -- Warehouse filter -----------------------------------------------------

    def test_store_user_gets_only_their_warehouse_as_filter_option(self):
        frappe.set_user(STORE_A_USER)
        self.assertEqual(get_warehouses(), {"warehouses": [self.wh_a], "restricted": True})

    def test_user_with_two_warehouses_gets_both_options(self):
        frappe.set_user(TWO_STORES_USER)
        self.assertEqual(get_warehouses(), {"warehouses": sorted([self.wh_a, self.wh_b]), "restricted": True})

    def test_unrestricted_user_gets_every_enabled_non_group_warehouse(self):
        options = get_warehouses()
        self.assertFalse(options["restricted"])
        self.assertIn(self.wh_a, options["warehouses"])
        self.assertIn(self.wh_b, options["warehouses"])
        self.assertNotIn(self.wh_group, options["warehouses"])
        self.assertNotIn(self.wh_disabled, options["warehouses"])
        self.assertEqual(
            options["warehouses"],
            frappe.get_all(
                "Warehouse", filters={"is_group": 0, "disabled": 0}, pluck="name", order_by="name asc"
            ),
        )

    def test_chosen_warehouse_narrows_rows_and_upload_list(self):
        self.assertEqual(self._codes(self.upload_mixed, self.wh_b), [f"{PREFIX}-B1"])
        uploads = {u["value"]: u["label"] for u in get_uploads(warehouse=self.wh_b)}
        self.assertIn("· 1 item", uploads[self.upload_mixed])
        self.assertNotIn(self.upload_old, uploads)

        frappe.set_user(TWO_STORES_USER)
        self.assertEqual(self._codes(self.upload_mixed, self.wh_a), [f"{PREFIX}-A1", f"{PREFIX}-A2"])
        self.assertEqual(self._codes(self.upload_mixed), [f"{PREFIX}-A1", f"{PREFIX}-A2", f"{PREFIX}-B1"])

    def test_choosing_a_warehouse_outside_permission_returns_nothing(self):
        frappe.set_user(STORE_A_USER)
        self.assertEqual(self._codes(self.upload_mixed, self.wh_b), [])
        self.assertEqual(get_uploads(warehouse=self.wh_b), [])
        rows = self._export(self.upload_mixed, self.wh_b)
        flat = [str(v) for row in rows for v in row if v is not None]
        self.assertFalse(any(v.startswith(PREFIX) for v in flat))

    def test_warehouse_options_refused_without_a_report_role(self):
        frappe.set_user(SALES_ONLY_USER)
        self.assertRaises(frappe.PermissionError, get_warehouses)
