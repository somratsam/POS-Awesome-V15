"""Staff Sales Performance (Desk report): access per store and the same
credited-person rules as Sales by Cashier."""

from __future__ import annotations

import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import sales_by_cashier
from posawesome.posawesome.report.staff_sales_performance import staff_sales_performance as report

CO = "_SSP Co"
OTHER_CO = "_SSP Other Co"
STORE_A = "_SSP Store A"
STORE_B = "_SSP Store B"
STORE_C = "_SSP Store C"  # same company, nobody's store
STORE_X = "_SSP Store X"  # other company
SELLER = "test1@example.com"
CASHIER = "test2@example.com"
HIDDEN = "test3@example.com"
ADMIN = "Administrator"
STAFF_USER = "_ssp_staff@example.com"


@contextmanager
def as_user(user, roles):
    with patch.dict(frappe.session, {"user": user}), patch.object(frappe, "get_roles", return_value=roles):
        yield


class _Base(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.seq = 0
        for name, company in ((STORE_A, CO), (STORE_B, CO), (STORE_C, CO), (STORE_X, OTHER_CO)):
            frappe.db.sql(
                "INSERT INTO `tabPOS Profile` (name, company, creation, modified) VALUES (%s, %s, NOW(), NOW())",
                (name, company),
            )
        self.profile_user(STORE_A, SELLER)
        self.profile_user(STORE_A, CASHIER)
        self.profile_user(STORE_A, HIDDEN, hide=1)
        self.profile_user(STORE_B, SELLER)

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")

    def profile_user(self, store, user, hide=0):
        self.seq += 1
        frappe.db.sql(
            """INSERT INTO `tabPOS Profile User`
               (name, parent, parenttype, parentfield, idx, user, posa_hide_in_sales_by_cashier)
               VALUES (%s, %s, 'POS Profile', 'applicable_for_users', %s, %s, %s)""",
            (f"_SSP-PU-{self.seq}", store, self.seq, user, hide),
        )

    def user_permission(self, user, store):
        self.seq += 1
        frappe.db.sql(
            """INSERT INTO `tabUser Permission` (name, user, allow, for_value, apply_to_all_doctypes)
               VALUES (%s, %s, 'POS Profile', %s, 1)""",
            (f"_SSP-UP-{self.seq}", user, store),
        )

    def invoice(self, store, total, *, cashier=CASHIER, credited=None, is_return=0, shift=1,
                date="2026-10-05", company=CO, docstatus=1):
        self.seq += 1
        frappe.db.sql(
            """INSERT INTO `tabSales Invoice`
               (name, docstatus, company, posting_date, is_return, grand_total, base_grand_total,
                pos_profile, posa_pos_opening_shift, posa_cashier, posa_credited_user)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (f"_SSP-INV-{self.seq}", docstatus, company, date, is_return, total, total, store,
             "_SSP-SHIFT" if shift else None, cashier, credited),
        )

    def run_report(self, **filters):
        base = {"company": CO, "from_date": "2026-10-01", "to_date": "2026-10-31"}
        base.update(filters)
        with patch.object(report, "_check_report_access"):
            return report.execute(base)

    def rows(self, **filters):
        return self.run_report(**filters)[1]

    def by_label(self, **filters):
        return {(row["staff"], row["store"]): row for row in self.rows(**filters)}


class TestAccess(_Base):
    def test_system_manager_sees_every_store_of_the_company(self):
        with as_user(STAFF_USER, ["System Manager"]):
            self.assertEqual(report.allowed_stores(CO), [STORE_A, STORE_B, STORE_C])
        with as_user(ADMIN, []):
            self.assertEqual(report.allowed_stores(CO), [STORE_A, STORE_B, STORE_C])

    def test_others_see_only_their_stores(self):
        with as_user(STAFF_USER, ["Accounts User"]):
            self.assertEqual(report.allowed_stores(CO), [])
        self.profile_user(STORE_A, STAFF_USER)
        self.user_permission(STAFF_USER, STORE_B)
        self.user_permission(STAFF_USER, STORE_X)  # another company's store
        with as_user(STAFF_USER, ["Accounts User"]):
            self.assertEqual(report.allowed_stores(CO), [STORE_A, STORE_B])
            options = report.get_store_options
            with patch.object(report, "_check_report_access"):
                self.assertEqual([o["value"] for o in options(CO)], [STORE_A, STORE_B])
                self.assertEqual([o["value"] for o in options(CO, "store b")], [STORE_B])

    def test_asking_for_another_store_is_refused_and_none_means_own_stores(self):
        self.profile_user(STORE_A, STAFF_USER)
        self.invoice(STORE_A, 10)
        self.invoice(STORE_C, 99)
        with as_user(STAFF_USER, ["Accounts User"]):
            with self.assertRaises(frappe.PermissionError):
                self.run_report(stores=[STORE_A, STORE_C])
            with self.assertRaises(frappe.PermissionError):
                self.run_report(stores=json.dumps([STORE_C]))
            total = self.rows()[-1]
            self.assertEqual(total["net"], 10)
            self.assertEqual(self.rows(stores=[STORE_A])[-1]["net"], 10)

    def test_no_store_gives_an_empty_report_not_everything(self):
        self.invoice(STORE_A, 10)
        with as_user(STAFF_USER, ["Accounts User"]):
            columns, data, message = self.run_report()
        self.assertEqual(data, [])
        self.assertIn("not assigned", message)

    def test_the_report_itself_is_system_manager_only_until_a_role_is_added(self):
        with as_user(STAFF_USER, ["Accounts User"]):
            with self.assertRaises(frappe.PermissionError):
                report.execute({"company": CO, "from_date": "2026-10-01", "to_date": "2026-10-31"})
            with self.assertRaises(frappe.PermissionError):
                report.get_store_options(CO)
        frappe.get_doc(
            {"doctype": "Custom Role", "report": report.REPORT_NAME, "roles": [{"role": "Accounts User"}]}
        ).insert(ignore_permissions=True)
        self.profile_user(STORE_A, STAFF_USER)
        self.invoice(STORE_A, 10)
        self.invoice(STORE_B, 50)
        with as_user(STAFF_USER, ["Accounts User"]):
            data = report.execute({"company": CO, "from_date": "2026-10-01", "to_date": "2026-10-31"})[1]
        self.assertEqual(data[-1]["net"], 10)

    def test_report_definition(self):
        doc = frappe.get_doc("Report", report.REPORT_NAME)
        self.assertEqual([row.role for row in doc.roles], ["System Manager"])
        self.assertEqual(doc.ref_doctype, "Sales Invoice")
        self.assertEqual(doc.report_type, "Script Report")
        self.assertFalse(doc.add_total_row)
        self.assertFalse(doc.prepared_report)


class TestFigures(_Base):
    def test_same_rules_as_sales_by_cashier(self):
        self.invoice(STORE_A, 100, cashier=CASHIER, credited=SELLER)  # sold by SELLER, rung by CASHIER
        self.invoice(STORE_A, 40, cashier=CASHIER)  # not filled yet -> PIN cashier
        self.invoice(STORE_A, -30, cashier=HIDDEN, credited=SELLER, is_return=1)  # return follows SELLER
        self.invoice(STORE_A, 20, cashier=HIDDEN, credited=HIDDEN)  # hidden -> Others
        self.invoice(STORE_A, 7, cashier=ADMIN, credited=ADMIN)  # not on the list -> Others
        self.invoice(STORE_A, 5, cashier=None, credited=None)  # nobody -> Cashier not recorded
        self.invoice(STORE_A, 1000, docstatus=2)
        self.invoice(STORE_A, 1000, date="2026-11-01")
        rows = self.by_label()
        seller = rows[(frappe.db.get_value("User", SELLER, "full_name"), STORE_A)]
        self.assertEqual((seller["gross"], seller["returns"], seller["net"], seller["sales"]), (100, -30, 70, 1))
        self.assertEqual(seller["by_others"], 1)
        self.assertEqual(seller["avg_basket"], 100)
        cashier = rows[(frappe.db.get_value("User", CASHIER, "full_name"), STORE_A)]
        self.assertEqual((cashier["net"], cashier["by_others"]), (40, 0))
        self.assertEqual(rows[("Others", STORE_A)]["net"], 27)
        self.assertEqual(rows[("Cashier not recorded", STORE_A)]["net"], 5)
        total = rows[("Total", STORE_A)]
        self.assertEqual((total["net"], total["sales"], total["bold"]), (142, 5, 1))
        self.assertEqual(self.rows()[-1]["staff"], "Total")
        self.assertEqual([row["staff"] for row in self.rows()][-3:], ["Others", "Cashier not recorded", "Total"])

    def test_store_totals_match_the_tills_sales_by_cashier(self):
        self.invoice(STORE_A, 100, credited=SELLER)
        self.invoice(STORE_A, -12.5, is_return=1)
        self.invoice(STORE_A, 33, shift=0)
        till = sum(row.net for row in sales_by_cashier._fetch_period(STORE_A, CO, "2026-10-01", "2026-10-31"))
        self.assertEqual(self.rows()[-1]["net"], till)

    def test_till_sales_by_default_all_pos_sales_on_request(self):
        self.invoice(STORE_A, 100)
        self.invoice(STORE_A, 33, shift=0)
        self.invoice(None, 500, shift=0)  # not a POS sale
        self.assertEqual(self.rows()[-1]["net"], 100)
        self.assertEqual(self.rows(sales_counted="All POS sales")[-1]["net"], 133)

    def test_hidden_in_one_store_is_still_shown_in_another(self):
        self.invoice(STORE_A, 10, credited=HIDDEN)
        self.profile_user(STORE_B, HIDDEN)
        self.invoice(STORE_B, 4, credited=HIDDEN)
        rows = self.by_label(group_by="Staff and store")
        self.assertEqual(rows[("Others", STORE_A)]["net"], 10)
        self.assertEqual(rows[(frappe.db.get_value("User", HIDDEN, "full_name"), STORE_B)]["net"], 4)

    def test_staff_view_folds_stores_under_each_person(self):
        self.invoice(STORE_A, 60, credited=SELLER)
        self.invoice(STORE_B, 40, credited=SELLER)
        self.invoice(STORE_A, 25, credited=CASHIER)
        data = self.rows()
        name = frappe.db.get_value("User", SELLER, "full_name")
        parent, child_a, child_b = data[0], data[1], data[2]
        self.assertEqual((parent["staff"], parent["store"], parent["net"], parent["indent"]), (name, "2 stores", 100, 0))
        self.assertEqual((child_a["store"], child_a["net"], child_a["parent_row"]), (STORE_A, 60, parent["row_id"]))
        self.assertEqual((child_b["store"], child_b["indent"]), (STORE_B, 1))
        one_store = data[3]
        self.assertEqual((one_store["store"], one_store["indent"]), (STORE_A, 0))
        self.assertNotEqual(data[4].get("parent_row"), one_store["row_id"])  # no copy of itself underneath
        top = [row for row in data if not row.get("indent") and not row.get("bold")]
        self.assertEqual(sum(row["net"] for row in top), data[-1]["net"])
        self.assertEqual(sum(row["share"] for row in top), 100)
        self.assertEqual(data[-1]["store"], "2 stores")

    def test_staff_and_store_is_one_row_each(self):
        self.invoice(STORE_A, 60, credited=SELLER)
        self.invoice(STORE_B, 40, credited=SELLER)
        data = self.rows(group_by="Staff and store")
        self.assertEqual([(row["store"], row["net"]) for row in data[:-1]], [(STORE_A, 60), (STORE_B, 40)])
        self.assertTrue(all("indent" not in row for row in data))

    def test_chart_and_summary(self):
        self.invoice(STORE_A, 60, credited=SELLER)
        self.invoice(STORE_A, -10, credited=SELLER, is_return=1)
        result = self.run_report()
        chart, summary = result[3], result[4]
        self.assertEqual(chart["data"]["datasets"][0]["values"], [50])
        self.assertEqual({s["label"]: s["value"] for s in summary}["Net sales"], 50)
        self.assertEqual({s["label"]: s["value"] for s in summary}["Returns"], -10)

    def test_names_are_shown_as_text(self):
        self.profile_user(STORE_A, "_ssp_html_user")
        self.invoice(STORE_A, 5, credited="_ssp_html_user")
        frappe.db.sql(
            "UPDATE `tabSales Invoice` SET posa_credited_user_name = %s WHERE posa_credited_user = '_ssp_html_user'",
            ("<img src=x onerror=alert(1)>",),
        )
        chart = self.run_report()[3]
        self.assertEqual(chart["data"]["labels"], ["‹img src=x onerror=alert(1)›"])
        self.assertEqual(report._chart([{"staff": "Aziz", "store": "MAX&Co", "net": 1}], "OMR")["data"]["labels"], ["Aziz · MAX&Co"])
        js = open(
            frappe.get_app_path(
                "posawesome", "posawesome", "report", "staff_sales_performance", "staff_sales_performance.js"
            )
        ).read()
        self.assertIn('if (column.fieldname === "staff" || column.fieldname === "store")', js)
        self.assertIn("frappe.utils.escape_html(", js)

    def test_period_limits(self):
        with self.assertRaises(frappe.ValidationError):
            self.run_report(from_date="2026-10-31", to_date="2026-10-01")
        with self.assertRaises(frappe.ValidationError):
            self.run_report(from_date="2025-01-01", to_date="2026-10-31")
        with self.assertRaises(frappe.ValidationError):
            self.run_report(from_date="")


class TestPage(unittest.TestCase):
    def test_filters(self):
        js = open(
            frappe.get_app_path(
                "posawesome", "posawesome", "report", "staff_sales_performance", "staff_sales_performance.js"
            )
        ).read()
        self.assertIn("staff_sales_performance.get_store_options", js)
        self.assertIn('default: "Till sales"', js)
        self.assertIn('fieldtype: "MultiSelectList"', js)
