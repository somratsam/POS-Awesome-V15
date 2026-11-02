import json

import frappe
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.shifts import (
    check_opening_shift,
    create_opening_voucher,
    get_opening_dialog_data,
)

PREFIX = "SHIFT-TEST"
STORE_A = "shift-store-a@test.invalid"  # assigned to profile A, permissions for A
STORE_B = "shift-store-b@test.invalid"  # assigned to profile B, permissions for B
CASHIER = "shift-cashier@test.invalid"  # Sales User only, assigned to nothing
MANAGER = "shift-manager@test.invalid"  # POS Manager + Accounts Manager, no store restriction, assigned to nothing
POS_MANAGER_ONLY = "shift-pos-manager-only@test.invalid"  # POS Manager alone can't read a POS Profile in ERPNext
# Real store users have these; Sales Manager and Accounts Manager make them
# "POS Profile managers" in pos_access, so their User Permissions are what stops them.
STORE_ROLES = ("Sales User", "Sales Manager", "Accounts Manager", "Stock User")


class TestShifts(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.company = frappe.db.get_value("Company", {}, "name")
        cls.wh_a = cls._warehouse("Store A")
        cls.wh_b = cls._warehouse("Store B")
        for user, roles in (
            (STORE_A, STORE_ROLES),
            (STORE_B, STORE_ROLES),
            (CASHIER, ("Sales User",)),
            (MANAGER, ("POS Manager", "Accounts Manager")),
            (POS_MANAGER_ONLY, ("POS Manager",)),
        ):
            cls._user(user, roles, {})
        cls.profile_a = cls._profile("A", cls.wh_a, [STORE_A])
        cls.profile_b = cls._profile("B", cls.wh_b, [STORE_B])
        cls._permit(STORE_A, {"POS Profile": cls.profile_a, "Warehouse": cls.wh_a})
        cls._permit(STORE_B, {"POS Profile": cls.profile_b, "Warehouse": cls.wh_b})

    def setUp(self):
        frappe.db.savepoint("shift_test")  # each test starts with no shifts of its own

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback(save_point="shift_test")

    def test_open_then_resume_the_users_own_shift(self):
        opened = self._open(STORE_A, self.profile_a)["pos_opening_shift"]
        self.assertEqual((opened.user, opened.pos_profile, opened.status), (STORE_A, self.profile_a, "Open"))
        self.assertEqual(opened.company, self.company)

        frappe.set_user(STORE_A)
        resumed = check_opening_shift(STORE_A)
        self.assertEqual(resumed["pos_opening_shift"].name, opened.name)
        self.assertEqual(resumed["pos_profile"].name, self.profile_a)
        self.assertEqual(check_opening_shift()["pos_opening_shift"].name, opened.name)

    def test_another_users_name_is_ignored(self):
        self._open(STORE_A, self.profile_a)
        frappe.set_user(STORE_B)
        self.assertEqual(check_opening_shift(STORE_A), "")
        own = self._open(STORE_B, self.profile_b)["pos_opening_shift"]
        frappe.set_user(STORE_B)
        self.assertEqual(check_opening_shift(STORE_A)["pos_opening_shift"].name, own.name)

    def test_unassigned_user_is_refused(self):
        # Refused by POS Profile read permission before the assignment check is reached.
        with self.assertRaisesRegex(frappe.PermissionError, "can't open a shift on POS Profile"):
            self._open(CASHIER, self.profile_a)
        self.assertFalse(frappe.db.exists("POS Opening Shift", {"user": CASHIER}))

    def test_other_stores_user_is_refused_with_a_clear_message(self):
        with self.assertRaisesRegex(frappe.PermissionError, "can't open a shift on POS Profile"):
            self._open(STORE_B, self.profile_a)
        self.assertFalse(frappe.flags.error_message)
        self.assertFalse(frappe.db.exists("POS Opening Shift", {"user": STORE_B, "pos_profile": self.profile_a}))

    def test_company_must_match_the_profile(self):
        other = frappe.db.get_value("Company", {"name": ["!=", self.company]}, "name")
        if not other:
            self.skipTest("A second company is required")
        with self.assertRaisesRegex(frappe.PermissionError, "not available for company"):
            self._open(STORE_A, self.profile_a, company=other)

    def test_pos_manager_is_still_allowed(self):
        for profile in (self.profile_a, self.profile_b):
            with self.subTest(profile=profile):
                opened = self._open(MANAGER, profile)["pos_opening_shift"]
                self.assertEqual((opened.user, opened.pos_profile), (MANAGER, profile))

    def test_pos_manager_role_alone_is_refused_like_at_sale_time(self):
        with self.assertRaisesRegex(frappe.PermissionError, "can't open a shift on POS Profile"):
            self._open(POS_MANAGER_ONLY, self.profile_a)

    def test_opening_dialog_data_carries_the_cash_rule_inputs_for_own_profiles_only(self):
        # The opening screen shows only the cash modes: it needs each profile's
        # cash mode and precision, and each payment mode's type.
        frappe.set_user(STORE_A)
        data = get_opening_dialog_data()

        self.assertEqual([p.name for p in data["pos_profiles_data"]], [self.profile_a])
        profile = data["pos_profiles_data"][0]
        self.assertIn("posa_cash_mode_of_payment", profile)
        self.assertIn("posa_decimal_precision", profile)

        modes = [m for m in data["payments_method"] if m["parent"] == self.profile_a]
        self.assertEqual([m["mode_of_payment"] for m in modes], [self.mode])
        self.assertEqual(modes[0]["type"], frappe.db.get_value("Mode of Payment", self.mode, "type"))
        self.assertFalse([m for m in data["payments_method"] if m["parent"] == self.profile_b])

    # --- helpers

    def _open(self, user, profile, company=None):
        frappe.set_user(user)
        return create_opening_voucher(
            profile, company or self.company, json.dumps([{"mode_of_payment": self.mode, "amount": 0}])
        )

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
        frappe.get_doc("User", email).add_roles(*roles)
        cls._permit(email, permissions)

    @staticmethod
    def _permit(email, permissions):
        for allow, value in permissions.items():
            frappe.get_doc(
                {"doctype": "User Permission", "user": email, "allow": allow, "for_value": value, "apply_to_all_doctypes": 1}
            ).insert()
