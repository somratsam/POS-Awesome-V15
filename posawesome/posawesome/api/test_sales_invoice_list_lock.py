"""Sales Invoice Desk List / Report view / export show staff submitted invoices
only (sales_invoice_list_lock.py); System Manager and Administrator see all;
POS queries are untouched. Counts are compared with plain SQL on the site's own
invoices."""

import json
import pathlib

import frappe
from frappe.desk import listview, reportview
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api import sales_invoice_list_lock as lock

STAFF = "posa-si-lock-staff@test.invalid"
MANAGER = "posa-si-lock-sysmgr@test.invalid"
FRAPPE_JS = pathlib.Path(frappe.get_app_path("frappe")) / "public" / "js" / "frappe"


def _sql_count(where=""):
    return frappe.db.sql(f"SELECT COUNT(*) FROM `tabSales Invoice` {where}")[0][0]


class TestSalesInvoiceListLock(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for email, roles in ((STAFF, ["Accounts User", "Accounts Manager"]), (MANAGER, ["System Manager", "Accounts User"])):
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
            user = frappe.get_doc(
                {"doctype": "User", "email": email, "first_name": "SI Lock Test", "send_welcome_email": 0, "user_type": "System User"}
            )
            user.insert(ignore_permissions=True)
            user.add_roles(*roles)

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        for email in (STAFF, MANAGER):
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.local.form_dict = frappe._dict()
        frappe.local.job = None

    def _call(self, user, cmd, fn, **form):
        frappe.set_user(user)
        frappe.local.form_dict = frappe._dict(cmd=cmd, **form)
        try:
            return fn()
        finally:
            frappe.set_user("Administrator")
            frappe.local.form_dict = frappe._dict()

    def _list(self, user, filters=None):
        return self._call(
            user,
            "frappe.desk.reportview.get",
            lambda: len(reportview.get().get("values", [])),
            doctype="Sales Invoice",
            fields=json.dumps(["`tabSales Invoice`.`name`"]),
            filters=json.dumps(filters or []),
            start=0,
            page_length=100000,
        )

    def _count(self, user, filters=None):
        return self._call(
            user,
            "frappe.desk.reportview.get_count",
            reportview.get_count,
            doctype="Sales Invoice",
            filters=json.dumps(filters or []),
        )

    def test_hook_registered(self):
        self.assertEqual(
            frappe.get_hooks("permission_query_conditions", app_name="posawesome").get("Sales Invoice"),
            ["posawesome.posawesome.api.sales_invoice_list_lock.get_permission_query_conditions"],
        )

    def test_staff_list_and_count_are_submitted_only(self):
        submitted = _sql_count("WHERE docstatus = 1")
        self.assertEqual(self._list(STAFF), submitted)
        self.assertEqual(self._count(STAFF), submitted)
        # a link or saved filter asking for drafts / cancelled gets nothing
        self.assertEqual(self._count(STAFF, [["Sales Invoice", "docstatus", "=", 0]]), 0)
        self.assertEqual(self._count(STAFF, [["Sales Invoice", "docstatus", "=", 2]]), 0)
        self.assertEqual(self._count(STAFF, [["Sales Invoice", "status", "in", ["Draft", "Cancelled"]]]), 0)

    def test_returns_and_credit_notes_still_shown(self):
        self.assertEqual(
            self._count(STAFF, [["Sales Invoice", "is_return", "=", 1]]),
            _sql_count("WHERE docstatus = 1 AND is_return = 1"),
        )

    def test_exempt_users_see_everything(self):
        everything = _sql_count()
        for user in (MANAGER, "Administrator"):
            self.assertEqual(self._list(user), everything, user)
            self.assertEqual(self._count(user), everything, user)
            self.assertEqual(self._count(user, [["Sales Invoice", "docstatus", "!=", 1]]), _sql_count("WHERE docstatus != 1"))

    def test_sidebar_group_by_counts_are_submitted_only(self):
        rows = self._call(
            STAFF,
            "frappe.desk.listview.get_group_by_count",
            lambda: listview.get_group_by_count("Sales Invoice", "[]", "status"),
        )
        self.assertEqual(sum(r["count"] for r in rows), _sql_count("WHERE docstatus = 1"))
        self.assertFalse({r["name"] for r in rows} & {"Draft", "Cancelled"})

    def test_client_get_list_and_v2_path_are_locked(self):
        # frappe.db.get_list / count in Desk scripts call reportview.get_list / get_count
        rows = self._call(
            STAFF,
            "frappe.desk.reportview.get_list",
            reportview.get_list,
            doctype="Sales Invoice",
            fields=json.dumps(["name"]),
            limit_page_length=0,
        )
        self.assertEqual(len(rows), _sql_count("WHERE docstatus = 1"))

        frappe.set_user(STAFF)
        frappe.local.form_dict = frappe._dict()
        request = frappe._dict(path="/api/v2/method/frappe.desk.reportview.get")
        previous = getattr(frappe.local, "request", None)
        frappe.local.request = request
        try:
            self.assertEqual(lock.get_permission_query_conditions(STAFF), lock.CONDITION)
        finally:
            frappe.local.request = previous

    def test_exports_are_submitted_only(self):
        # foreground export runs inside the export_query request
        frappe.local.form_dict = frappe._dict(cmd="frappe.desk.reportview.export_query")
        self.assertEqual(lock.get_permission_query_conditions(STAFF), lock.CONDITION)
        self.assertEqual(lock.get_permission_query_conditions(MANAGER), "")

        # background export (emailed file) runs in a worker with no request
        frappe.local.form_dict = frappe._dict()
        frappe.local.job = frappe._dict(method=lock.BACKGROUND_EXPORT_JOB)
        frappe.set_user(STAFF)
        self.assertEqual(
            len(frappe.get_list("Sales Invoice", fields=["name"], limit_page_length=0)),
            _sql_count("WHERE docstatus = 1"),
        )

    def test_pos_and_other_queries_untouched(self):
        drafts = _sql_count("WHERE docstatus = 0")
        for cmd in ("posawesome.posawesome.api.invoices.get_draft_invoices", "frappe.desk.search.search_link", ""):
            got = self._call(
                STAFF,
                cmd,
                lambda: len(frappe.get_list("Sales Invoice", filters={"docstatus": 0}, limit_page_length=0)),
            )
            self.assertEqual(got, drafts, cmd)
        frappe.local.job = frappe._dict(method="posawesome.posawesome.api.rewards_sync.sync")
        self.assertEqual(lock.get_permission_query_conditions(STAFF), "")

    def test_frappe_still_uses_the_endpoints_the_lock_relies_on(self):
        # If an update renames these, the lock would stop applying (fails open).
        base_list = (FRAPPE_JS / "list" / "base_list.js").read_text()
        self.assertIn('this.method = "frappe.desk.reportview.get"', base_list)
        self.assertIn('"frappe.desk.reportview.get_sidebar_stats"', base_list)
        report_view = (FRAPPE_JS / "views" / "reports" / "report_view.js").read_text()
        self.assertIn('"frappe.desk.reportview.export_query"', report_view)
        db_js = (FRAPPE_JS / "db.js").read_text()
        self.assertIn('"frappe.desk.reportview.get_list"', db_js)
        self.assertIn('"frappe.desk.reportview.get_count"', db_js)
        self.assertTrue(callable(frappe.get_attr(lock.BACKGROUND_EXPORT_JOB)))
        self.assertIn("frappe.desk.reportview.run_report_view_export_job", (pathlib.Path(reportview.__file__)).read_text())
