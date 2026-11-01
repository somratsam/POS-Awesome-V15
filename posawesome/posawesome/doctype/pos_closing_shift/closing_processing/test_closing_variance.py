import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.shifts import create_opening_voucher
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
    make_closing_shift_from_opening,
    submit_closing_shift,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report import get_z_report_data

PREFIX = "VARIANCE-TEST"
STORE_ROLES = ("Sales User", "Sales Manager", "Accounts Manager", "Stock User")
OWNER = "variance-owner@test.invalid"
SUPERVISOR = "variance-supervisor@test.invalid"
OPENING = 5  # opening cash; with no sales the expected cash is 5
ACTIVE_CASHIER = "posawesome.posawesome.api.terminal_state.get_active_terminal_cashier"


class TestClosingVariance(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.company = frappe.db.get_value("Company", {}, "name")
        for user, roles in ((OWNER, STORE_ROLES), (SUPERVISOR, STORE_ROLES + ("POS Awesome Supervisor",))):
            if not frappe.db.exists("User", user):
                frappe.get_doc(
                    {"doctype": "User", "email": user, "first_name": user.split("@")[0], "send_welcome_email": 0}
                ).insert()
            frappe.get_doc("User", user).add_roles(*roles)
        cls.mode = frappe.db.get_value("Mode of Payment", {"type": "Cash", "enabled": 1}, "name") or "Cash"
        abbr = frappe.get_cached_value("Company", cls.company, "abbr")
        cls.warehouse = f"{PREFIX} Store - {abbr}"
        if not frappe.db.exists("Warehouse", cls.warehouse):
            frappe.get_doc(
                {"doctype": "Warehouse", "warehouse_name": f"{PREFIX} Store", "company": cls.company}
            ).insert()
        company = frappe.get_cached_doc("Company", cls.company)
        cls.profile = frappe.get_doc(
            {
                "doctype": "POS Profile",
                "name": f"{PREFIX} Store",
                "company": cls.company,
                "warehouse": cls.warehouse,
                "currency": company.default_currency,
                "write_off_account": company.write_off_account or company.round_off_account,
                "write_off_cost_center": company.cost_center,
                "payments": [{"mode_of_payment": cls.mode, "default": 1}],
                "applicable_for_users": [{"user": OWNER}, {"user": SUPERVISOR}],
            }
        ).insert().name
        for user in (OWNER, SUPERVISOR):
            for allow, value in (("POS Profile", cls.profile), ("Warehouse", cls.warehouse)):
                frappe.get_doc(
                    {"doctype": "User Permission", "user": user, "allow": allow, "for_value": value, "apply_to_all_doctypes": 1}
                ).insert()

    def setUp(self):
        frappe.set_user("Administrator")
        frappe.db.savepoint("variance_test")
        self._profile_settings(tolerance=0.5, needs_supervisor=0)
        frappe.set_user(OWNER)
        opened = create_opening_voucher(
            self.profile, self.company, json.dumps([{"mode_of_payment": self.mode, "amount": OPENING}])
        )["pos_opening_shift"]
        frappe.set_user("Administrator")
        self.opening = frappe.get_doc("POS Opening Shift", opened.name)

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback(save_point="variance_test")
        frappe.clear_document_cache("POS Profile", self.profile)

    def test_the_new_profile_fields_default_to_0_500_and_off(self):
        meta = frappe.get_meta("POS Profile")
        self.assertEqual(float(meta.get_field("posa_closing_variance_tolerance").default), 0.5)
        self.assertEqual(int(meta.get_field("posa_closing_variance_needs_supervisor").default), 0)

    def test_within_tolerance_closes_without_a_reason(self):
        name = self._close(OWNER, counted=OPENING - 0.5)
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual(closing.docstatus, 1)
        self.assertFalse(closing.posa_variance_approved_by)
        self.assertAlmostEqual(closing.payment_reconciliation[0].difference, -0.5)

    def test_short_over_tolerance_needs_a_reason_then_closes_with_it_stored(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            self._close(OWNER, counted=OPENING - 0.501)
        name = self._close(OWNER, counted=OPENING - 0.501, reason="Gave 0.501 too much change")
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual((closing.docstatus, closing.posa_variance_reason), (1, "Gave 0.501 too much change"))
        self.assertFalse(closing.posa_variance_approved_by)

    def test_over_tolerance_in_the_other_direction_needs_a_reason_too(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            self._close(OWNER, counted=OPENING + 5)
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            self._close(OWNER, counted=OPENING + 5, reason="   ")
        self.assertTrue(self._close(OWNER, counted=OPENING + 5, reason="Card sale rung up as cash"))

    def test_tolerance_zero_means_any_baisa_needs_a_reason(self):
        self._profile_settings(tolerance=0, needs_supervisor=0)
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            self._close(OWNER, counted=OPENING - 0.001)
        self.assertTrue(self._close(OWNER, counted=OPENING))

    def test_supervisor_approval_when_the_profile_asks_for_it(self):
        self._profile_settings(tolerance=0.5, needs_supervisor=1)
        # The owner (no supervisor role, no supervisor switched in) is refused even with a reason.
        with patch(ACTIVE_CASHIER, return_value=OWNER):
            with self.assertRaisesRegex(frappe.PermissionError, "POS supervisor must approve"):
                self._close(OWNER, counted=OPENING - 2, reason="Short")
        # A locked terminal (no PIN cashier) is refused with the same clear message.
        with patch(ACTIVE_CASHIER, side_effect=frappe.PermissionError("locked")):
            with self.assertRaisesRegex(frappe.PermissionError, "POS supervisor must approve"):
                self._close(OWNER, counted=OPENING - 2, reason="Short")
        # A supervisor switched in on the terminal approves; the closing stays the owner's.
        with patch(ACTIVE_CASHIER, return_value=SUPERVISOR):
            name = self._close(OWNER, counted=OPENING - 2, reason="Short")
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual((closing.user, closing.posa_variance_approved_by), (OWNER, SUPERVISOR))

    def test_no_approval_is_recorded_within_tolerance_even_when_required(self):
        self._profile_settings(tolerance=0.5, needs_supervisor=1)
        name = self._close(OWNER, counted=OPENING)
        self.assertFalse(frappe.db.get_value("POS Closing Shift", name, "posa_variance_approved_by"))

    def test_a_tampered_expected_amount_is_replaced_by_the_servers_own(self):
        # Count 2 against a real expected 5, but send expected 2 so the
        # difference looks like 0: the server works out 5 itself and refuses.
        frappe.set_user(OWNER)
        payload = self._prepared(counted=OPENING - 3)
        for row in payload["payment_reconciliation"]:
            row["expected_amount"] = OPENING - 3
            row["difference"] = 0
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            submit_closing_shift(json.dumps(payload, default=str))
        # With a reason it closes, recording the server's expected amount.
        payload["posa_variance_reason"] = "Counted short"
        name = submit_closing_shift(json.dumps(payload, default=str))
        frappe.set_user("Administrator")
        row = frappe.get_doc("POS Closing Shift", name).payment_reconciliation[0]
        self.assertEqual((row.expected_amount, row.closing_amount, row.difference), (OPENING, OPENING - 3, -3))

    def test_a_dropped_payment_row_counts_as_zero(self):
        frappe.set_user(OWNER)
        payload = self._prepared(counted=OPENING)
        payload["payment_reconciliation"] = []
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            submit_closing_shift(json.dumps(payload, default=str))

    def test_supervisor_closing_in_desk_needs_a_reason_and_approves_it(self):
        self._profile_settings(tolerance=0.5, needs_supervisor=1)
        frappe.set_user(SUPERVISOR)
        doc = self._desk_closing(counted=OPENING - 2)
        with self.assertRaisesRegex(frappe.ValidationError, "Enter a reason"):
            doc.insert()
        doc = self._desk_closing(counted=OPENING - 2, reason="Supervisor count")
        doc.insert()
        doc.submit()
        self.assertEqual((doc.docstatus, doc.posa_variance_approved_by, doc.user), (1, SUPERVISOR, OWNER))

    def test_z_report_carries_the_reason_and_approver(self):
        self._profile_settings(tolerance=0.5, needs_supervisor=1)
        with patch(ACTIVE_CASHIER, return_value=SUPERVISOR):
            name = self._close(OWNER, counted=OPENING - 2, reason="Short 2 at close")
        frappe.set_user(OWNER)
        report = get_z_report_data(name)
        self.assertEqual((report["variance_reason"], report["variance_approved_by"]), ("Short 2 at close", SUPERVISOR))
        html = self._render_z_report(name)
        self.assertIn("Short 2 at close", html)
        self.assertIn(SUPERVISOR, html)

    def test_z_report_escapes_the_reason(self):
        # Frappe's XSS filter strips a script when the closing is saved, and
        # the Z Report escapes whatever markup is left, so a reason prints as
        # text, never as HTML.
        name = self._close(OWNER, counted=OPENING - 2, reason="Short <b>2</b> <script>alert(1)</script>")
        stored = frappe.db.get_value("POS Closing Shift", name, "posa_variance_reason")
        self.assertNotIn("<script", stored)
        frappe.set_user(OWNER)
        html = self._render_z_report(name)
        self.assertNotIn("<script", html)
        self.assertNotIn("Short <b>2</b>", html)
        self.assertIn("Short &lt;b&gt;2&lt;/b&gt;", html)

    # --- helpers

    def _render_z_report(self, name):
        """The real Z Report template, with its data lines (frappe.call, which
        needs a web request) given the same report data directly."""
        template = frappe.db.get_value("Print Format", "Z Report", "html")
        template = "\n".join(line for line in template.splitlines() if "frappe.call(" not in line)
        return frappe.render_template(
            template,
            {"doc": frappe.get_doc("POS Closing Shift", name), "report": get_z_report_data(name), "logo_data_uri": ""},
        )

    def _profile_settings(self, tolerance, needs_supervisor):
        frappe.db.set_value(
            "POS Profile",
            self.profile,
            {"posa_closing_variance_tolerance": tolerance, "posa_closing_variance_needs_supervisor": needs_supervisor},
        )
        frappe.clear_document_cache("POS Profile", self.profile)

    def _prepared(self, counted):
        doc = make_closing_shift_from_opening(json.dumps({"name": self.opening.name}))["closing_shift"]
        for row in doc.payment_reconciliation:
            row.closing_amount = counted
        return json.loads(frappe.as_json(doc.as_dict()))

    def _close(self, user, counted, reason=None):
        frappe.set_user(user)
        payload = self._prepared(counted)
        if reason is not None:
            payload["posa_variance_reason"] = reason
        try:
            return submit_closing_shift(json.dumps(payload, default=str))
        finally:
            frappe.set_user("Administrator")

    def _desk_closing(self, counted, reason=None):
        return frappe.get_doc(
            {
                "doctype": "POS Closing Shift",
                "pos_opening_shift": self.opening.name,
                "pos_profile": self.profile,
                "company": self.company,
                "user": OWNER,
                "period_start_date": self.opening.period_start_date,
                "period_end_date": frappe.utils.now_datetime(),
                "posa_variance_reason": reason,
                "payment_reconciliation": [
                    {"mode_of_payment": self.mode, "opening_amount": 0, "expected_amount": counted, "closing_amount": counted}
                ],
            }
        )
