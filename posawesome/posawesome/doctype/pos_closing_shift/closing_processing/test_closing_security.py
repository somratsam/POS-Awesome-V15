import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.shifts import create_opening_voucher
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import creation, data
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
    make_closing_shift_from_opening,
    submit_closing_shift,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_payments_entries,
    get_pos_invoices,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report import get_z_report_data

PREFIX = "CLOSE-TEST"
# Real store cashiers: Sales Manager is what lets them close their own shift
# (closing writes POS Opening Shift), so it can't be what lets them close others'.
STORE_ROLES = ("Sales User", "Sales Manager", "Accounts Manager", "Stock User")
OWNER = "close-owner-a@test.invalid"  # opens the shift on store A
COLLEAGUE = "close-colleague-a@test.invalid"  # another cashier on store A
SUPERVISOR_A = "close-supervisor-a@test.invalid"  # POS Awesome Supervisor on store A
SUPERVISOR_B = "close-supervisor-b@test.invalid"  # POS Awesome Supervisor on store B only
OPENING_AMOUNT = 5


class TestClosingSecurity(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.company = frappe.db.get_value("Company", {}, "name")
        cls.wh_a = cls._warehouse("Store A")
        cls.wh_b = cls._warehouse("Store B")
        users = (
            (OWNER, STORE_ROLES, "A"),
            (COLLEAGUE, STORE_ROLES, "A"),
            (SUPERVISOR_A, STORE_ROLES + ("POS Awesome Supervisor",), "A"),
            (SUPERVISOR_B, STORE_ROLES + ("POS Awesome Supervisor",), "B"),
        )
        for user, roles, _store in users:
            cls._user(user, roles, {})
        cls.profile_a = cls._profile("A", cls.wh_a, [OWNER, COLLEAGUE, SUPERVISOR_A])
        cls.profile_b = cls._profile("B", cls.wh_b, [SUPERVISOR_B])
        for user, _roles, store in users:
            profile, wh = (cls.profile_a, cls.wh_a) if store == "A" else (cls.profile_b, cls.wh_b)
            cls._user(user, (), {"POS Profile": profile, "Warehouse": wh})

    def setUp(self):
        frappe.set_user("Administrator")
        frappe.db.savepoint("close_test")
        self.opening = self._open(OWNER, self.profile_a)

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback(save_point="close_test")

    # 1
    def test_owner_prepares_and_submits_their_own_shift(self):
        name = self._close_as(OWNER)
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual((closing.docstatus, closing.user, closing.pos_profile), (1, OWNER, self.profile_a))
        self.assertEqual(frappe.db.get_value("POS Opening Shift", self.opening.name, "status"), "Closed")

    # 2
    def test_another_cashier_on_the_same_store_is_refused_everywhere(self):
        owners_payload = self._payload_as(OWNER)  # what the owner's POS would send
        with patch.object(creation, "submit_printed_invoices") as prep_submit, patch.object(
            data, "submit_printed_invoices"
        ) as invoices_submit:
            frappe.set_user(COLLEAGUE)
            with self.assertRaisesRegex(frappe.PermissionError, f"belongs to {OWNER}"):
                make_closing_shift_from_opening(json.dumps(self.opening.as_dict(), default=str))
            with self.assertRaisesRegex(frappe.PermissionError, f"belongs to {OWNER}"):
                get_pos_invoices(self.opening.name)
            with self.assertRaisesRegex(frappe.PermissionError, f"belongs to {OWNER}"):
                get_payments_entries(self.opening.name)
            with self.assertRaisesRegex(frappe.PermissionError, f"belongs to {OWNER}"):
                submit_closing_shift(owners_payload)
            prep_submit.assert_not_called()
            invoices_submit.assert_not_called()
        frappe.set_user("Administrator")
        self.assertFalse(frappe.db.exists("POS Closing Shift", {"pos_opening_shift": self.opening.name}))
        self.assertEqual(frappe.db.get_value("POS Opening Shift", self.opening.name, "status"), "Open")

    # 3
    def test_supervisor_on_the_store_closes_a_colleagues_shift(self):
        name = self._close_as(SUPERVISOR_A)
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual((closing.docstatus, closing.user), (1, OWNER))

    # 4
    def test_supervisor_of_another_store_is_refused(self):
        frappe.set_user(SUPERVISOR_B)
        with self.assertRaises(frappe.PermissionError):
            make_closing_shift_from_opening(json.dumps(self.opening.as_dict(), default=str))
        with self.assertRaises(frappe.PermissionError):
            get_pos_invoices(self.opening.name)
        with self.assertRaises(frappe.PermissionError):
            submit_closing_shift(self._payload_as(OWNER, user_for_submit=SUPERVISOR_B))
        frappe.set_user("Administrator")
        self.assertFalse(frappe.db.exists("POS Closing Shift", {"pos_opening_shift": self.opening.name}))

    # 5
    def test_administrator_allowed_guest_refused(self):
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_pos_invoices(self.opening.name)
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            submit_closing_shift(self._payload_as(OWNER, user_for_submit="Guest"))
        name = self._close_as("Administrator")
        self.assertEqual(frappe.db.get_value("POS Closing Shift", name, "docstatus"), 1)

    # 6
    def test_owner_cannot_change_who_or_which_store_the_closing_is_for(self):
        # user and pos_profile are fetch_from the opening shift, so Frappe
        # already resets them on save; company isn't, so it is the real gap.
        other_company = frappe.db.get_value("Company", {"name": ["!=", self.company]}, "name")
        if not other_company:
            self.skipTest("A second company is required")
        payload = json.loads(self._payload_as(OWNER))
        payload.update({"user": COLLEAGUE, "pos_profile": self.profile_b, "company": other_company})
        for row in payload["payment_reconciliation"]:
            row["closing_amount"] = row["expected_amount"]  # counted right; this test is about who/where
        frappe.set_user(OWNER)
        name = submit_closing_shift(json.dumps(payload, default=str))
        frappe.set_user("Administrator")
        closing = frappe.get_doc("POS Closing Shift", name)
        self.assertEqual((closing.user, closing.pos_profile, closing.company), (OWNER, self.profile_a, self.company))

    # 7
    def test_closing_uses_the_stored_opening_amounts_not_the_browsers(self):
        sent = self.opening.as_dict()
        sent["user"] = COLLEAGUE
        for row in sent["balance_details"]:
            row["amount"] = 999
        frappe.set_user(OWNER)
        closing = make_closing_shift_from_opening(json.dumps(sent, default=str))["closing_shift"]
        self.assertEqual(closing.user, OWNER)
        self.assertEqual([row.opening_amount for row in closing.payment_reconciliation], [OPENING_AMOUNT])

    # 8
    def test_a_closed_shift_cannot_be_prepared_or_closed_again(self):
        self._close_as(OWNER)
        frappe.set_user(OWNER)
        with self.assertRaisesRegex(frappe.ValidationError, "should be open"):
            make_closing_shift_from_opening(json.dumps({"name": self.opening.name}))
        with self.assertRaisesRegex(frappe.ValidationError, "should be open"):
            submit_closing_shift(self._payload_as(OWNER, prepared=False))

    # 9
    def test_get_pos_invoices_only_reads_invoice_doctypes(self):
        frappe.set_user(SUPERVISOR_A)
        for doctype in ("User", "Sales Invoice` WHERE 1=0 -- "):
            with self.subTest(doctype=doctype):
                with self.assertRaisesRegex(frappe.ValidationError, "Sales Invoice or POS Invoice"):
                    get_pos_invoices(self.opening.name, doctype=doctype, submit_printed=0)
        # The Desk closing form's own call (no doctype) still works for a supervisor.
        self.assertEqual(get_pos_invoices(self.opening.name, submit_printed=0), [])

    # 10
    def test_z_report_after_closing_by_owner_and_by_supervisor(self):
        for closer in (OWNER, SUPERVISOR_A):
            with self.subTest(closer=closer):
                frappe.set_user("Administrator")
                opening = self.opening if closer == OWNER else self._open(OWNER, self.profile_a)
                name = self._close_as(closer, opening=opening)
                frappe.set_user(closer)
                report = get_z_report_data(name)
                self.assertTrue(report)
                frappe.set_user(SUPERVISOR_B)
                with self.assertRaises(frappe.PermissionError):
                    get_z_report_data(name)

    # 11
    def test_desk_closing_form_follows_the_same_rule(self):
        frappe.set_user(COLLEAGUE)
        with self.assertRaisesRegex(frappe.PermissionError, f"belongs to {OWNER}"):
            self._desk_closing().insert()
        frappe.set_user(SUPERVISOR_A)
        doc = self._desk_closing().insert()
        self.assertEqual(doc.user, OWNER)

    # --- helpers

    def _close_as(self, user, opening=None):
        opening = opening or self.opening
        frappe.set_user(user)
        prepared = make_closing_shift_from_opening(json.dumps(opening.as_dict(), default=str))["closing_shift"]
        for row in prepared.payment_reconciliation:
            row.closing_amount = row.expected_amount
        return submit_closing_shift(frappe.as_json(prepared.as_dict()))

    def _payload_as(self, preparer, user_for_submit=None, prepared=True):
        """A closing payload as the POS would send it (prepared by `preparer`),
        then switch to `user_for_submit` to send it."""
        if prepared:
            frappe.set_user(preparer)
            doc = make_closing_shift_from_opening(json.dumps(self.opening.as_dict(), default=str))["closing_shift"]
            payload = frappe.as_json(doc.as_dict())
        else:
            payload = json.dumps(
                {
                    "doctype": "POS Closing Shift",
                    "pos_opening_shift": self.opening.name,
                    "pos_profile": self.profile_a,
                    "company": self.company,
                    "user": OWNER,
                    "period_start_date": str(self.opening.period_start_date),
                    "period_end_date": str(frappe.utils.now_datetime()),
                    "payment_reconciliation": [{"mode_of_payment": self.mode, "closing_amount": 0}],
                }
            )
        if user_for_submit:
            frappe.set_user(user_for_submit)
        return payload

    def _desk_closing(self):
        return frappe.get_doc(
            {
                "doctype": "POS Closing Shift",
                "pos_opening_shift": self.opening.name,
                "pos_profile": self.profile_a,
                "company": self.company,
                "user": OWNER,
                "period_start_date": self.opening.period_start_date,
                "period_end_date": frappe.utils.now_datetime(),
                # Counted right (opening cash, no sales); this test is about who may close.
                "payment_reconciliation": [
                    {
                        "mode_of_payment": self.mode,
                        "opening_amount": OPENING_AMOUNT,
                        "expected_amount": OPENING_AMOUNT,
                        "closing_amount": OPENING_AMOUNT,
                    }
                ],
            }
        )

    def _open(self, user, profile):
        frappe.set_user(user)
        opened = create_opening_voucher(
            profile,
            self.company,
            json.dumps([{"mode_of_payment": self.mode, "amount": OPENING_AMOUNT}]),
        )["pos_opening_shift"]
        frappe.set_user("Administrator")
        return frappe.get_doc("POS Opening Shift", opened.name)

    @classmethod
    def _warehouse(cls, name):
        abbr = frappe.get_cached_value("Company", cls.company, "abbr")
        full = f"{PREFIX} {name} - {abbr}"
        if not frappe.db.exists("Warehouse", full):
            frappe.get_doc({"doctype": "Warehouse", "warehouse_name": f"{PREFIX} {name}", "company": cls.company}).insert()
        return full

    @classmethod
    def _profile(cls, name, warehouse, users):
        cls.mode = frappe.db.get_value("Mode of Payment", {"type": "Cash", "enabled": 1}, "name") or "Cash"
        company = frappe.get_cached_doc("Company", cls.company)
        doc = frappe.get_doc(
            {
                "doctype": "POS Profile",
                "name": f"{PREFIX} {name}",
                "company": cls.company,
                "warehouse": warehouse,
                "currency": company.default_currency,
                "write_off_account": company.write_off_account or company.round_off_account,
                "write_off_cost_center": company.cost_center,
                "payments": [{"mode_of_payment": cls.mode, "default": 1}],
                "applicable_for_users": [{"user": u} for u in users],
            }
        )
        doc.insert()
        return doc.name

    @classmethod
    def _user(cls, email, roles, permissions):
        if not frappe.db.exists("User", email):
            frappe.get_doc(
                {"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0}
            ).insert()
        if roles:
            frappe.get_doc("User", email).add_roles(*roles)
        for allow, value in permissions.items():
            frappe.get_doc(
                {"doctype": "User Permission", "user": email, "allow": allow, "for_value": value, "apply_to_all_doctypes": 1}
            ).insert()
