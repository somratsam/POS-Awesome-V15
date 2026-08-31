import unittest
from contextlib import contextmanager
from unittest.mock import patch

import frappe

from posawesome.posawesome.api.utilities import get_database_usage, get_server_usage


@contextmanager
def _as_user(user):
    # frappe.session is a frappe._dict (attribute access over a plain dict),
    # not a regular object -- unittest.mock.patch.object needs a real
    # __dict__ and fails against it, so save/restore by hand instead.
    original = frappe.session.user
    frappe.session.user = user
    try:
        yield
    finally:
        frappe.session.user = original


class TestSystemStatusPermission(unittest.TestCase):
    """get_server_usage/get_database_usage expose raw server CPU/RAM and DB
    internals -- confirmed reachable by any authenticated user (including a
    plain cashier) with zero server-side check before this fix. Enforced via
    frappe.only_for("System Manager") so hiding the button client-side isn't
    the only thing standing between a cashier and this data."""

    def test_get_server_usage_blocks_non_system_manager(self):
        with _as_user("cashier@example.com"):
            with patch("frappe.get_roles", return_value=["POS Awesome User"]):
                with self.assertRaises(frappe.PermissionError):
                    get_server_usage()

    def test_get_database_usage_blocks_non_system_manager(self):
        with _as_user("cashier@example.com"):
            with patch("frappe.get_roles", return_value=["POS Awesome User"]):
                with self.assertRaises(frappe.PermissionError):
                    get_database_usage()

    def test_get_server_usage_allows_system_manager(self):
        with _as_user("manager@example.com"):
            with patch("frappe.get_roles", return_value=["System Manager"]):
                result = get_server_usage()
        self.assertIsInstance(result, dict)
        self.assertIn("cpu_percent", result)

    def test_get_database_usage_allows_system_manager(self):
        with _as_user("manager@example.com"):
            with patch("frappe.get_roles", return_value=["System Manager"]):
                result = get_database_usage()
        self.assertIsInstance(result, dict)
        self.assertIn("db_size", result)

    def test_administrator_is_always_allowed_regardless_of_roles(self):
        # frappe.only_for's own short-circuit -- Administrator bypasses the
        # role check entirely, matching every other only_for() call in Frappe.
        with _as_user("Administrator"):
            with patch("frappe.get_roles", return_value=[]):
                server_result = get_server_usage()
                db_result = get_database_usage()
        self.assertIsInstance(server_result, dict)
        self.assertIsInstance(db_result, dict)


if __name__ == "__main__":
    unittest.main()
