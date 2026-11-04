import contextlib
import unittest
from unittest.mock import MagicMock, patch

import frappe
from frappe.utils import add_to_date, now_datetime

from posawesome.posawesome.api import submitted_invoice_edits as edits

MODULE = "posawesome.posawesome.api.submitted_invoice_edits"
SUPERVISOR_MESSAGE = "Only a POS supervisor can edit a submitted invoice"


class FakeInvoice(frappe._dict):
    """Just enough of a submitted Sales Invoice for the edit rules."""

    def __init__(self, **values):
        defaults = dict(
            doctype="Sales Invoice",
            name="ZZ-SUPERVISOR-TEST-0001",
            docstatus=1,
            is_return=0,
            return_against=None,
            amended_from=None,
            pos_profile="ZZ Supervisor Test Profile",
            company="ZZ Test Co",
            creation=now_datetime(),
            posa_redeemed_customer_credit=0,
            gift_card_redemptions=[],
        )
        defaults.update(values)
        super().__init__(defaults)
        self.flags = frappe._dict()
        self.cancel = MagicMock()
        self.check_permission = MagicMock()
        self.db_update = MagicMock()


class TestEditApprover(unittest.TestCase):
    """Who counts as the authorizing supervisor (same rule as closing variance)."""

    def setUp(self):
        self.roles = {}
        self.cashier = None
        self.cashier_error = None
        patches = [
            patch.object(frappe, "session", frappe._dict(user="cashier@test.invalid")),
            patch(
                "posawesome.posawesome.api.employees._get_user_doc",
                side_effect=lambda user: frappe._dict(name=user),
            ),
            patch(
                "posawesome.posawesome.api.employees._is_pos_supervisor",
                side_effect=lambda doc: self.roles.get(doc.name, False),
            ),
            patch(
                "posawesome.posawesome.api.terminal_state.get_active_terminal_cashier",
                side_effect=self._active_cashier,
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _active_cashier(self, pos_profile):
        if self.cashier_error:
            raise self.cashier_error
        return self.cashier

    def test_signed_in_supervisor_authorizes(self):
        self.roles["cashier@test.invalid"] = True
        self.assertEqual(edits.get_submitted_invoice_edit_approver("P"), "cashier@test.invalid")

    def test_supervisor_switched_in_at_the_till_by_pin_authorizes(self):
        self.cashier = "boss@test.invalid"
        self.roles["boss@test.invalid"] = True
        self.assertEqual(edits.get_submitted_invoice_edit_approver("P"), "boss@test.invalid")

    def test_ordinary_cashier_does_not_authorize(self):
        self.cashier = "cashier@test.invalid"
        self.assertIsNone(edits.get_submitted_invoice_edit_approver("P"))

    def test_locked_till_does_not_authorize(self):
        self.cashier_error = frappe.PermissionError("This POS terminal is locked.")
        self.assertIsNone(edits.get_submitted_invoice_edit_approver("P"))


class TestEditEligibilityWithSupervisor(unittest.TestCase):
    def setUp(self):
        self.approver = "boss@test.invalid"
        p = patch(f"{MODULE}.get_submitted_invoice_edit_approver", side_effect=lambda profile: self.approver)
        self.approver_mock = p.start()
        self.addCleanup(p.stop)

    def test_supervisor_allowed_and_recorded_in_metadata(self):
        meta = edits.get_submitted_invoice_edit_metadata(FakeInvoice())
        self.assertTrue(meta["can_edit_submitted_invoice"])
        self.assertFalse(meta["edit_requires_supervisor"])
        self.assertEqual(meta["edit_authorized_by"], "boss@test.invalid")

    def test_cashier_refused_with_clear_message(self):
        self.approver = None
        meta = edits.get_submitted_invoice_edit_metadata(FakeInvoice())
        self.assertFalse(meta["can_edit_submitted_invoice"])
        self.assertTrue(meta["edit_requires_supervisor"])
        self.assertIn(SUPERVISOR_MESSAGE, meta["edit_block_reason"])

    def test_cashier_refused_by_assert_as_permission_error(self):
        self.approver = None
        with patch(f"{MODULE}.assert_pos_profile_write_allowed"):
            with self.assertRaisesRegex(frappe.PermissionError, SUPERVISOR_MESSAGE):
                edits.assert_submitted_invoice_edit_allowed(FakeInvoice())

    def test_existing_rules_still_apply_to_a_supervisor(self):
        cases = {
            "edit window": FakeInvoice(creation=add_to_date(now_datetime(), hours=-25)),
            "Return invoices": FakeInvoice(is_return=1),
            "Credit notes": FakeInvoice(return_against="ZZ-OTHER"),
            "customer credit": FakeInvoice(posa_redeemed_customer_credit=10),
            "gift cards": FakeInvoice(gift_card_redemptions=[{"gift_card": "GC-1"}]),
        }
        for expected, doc in cases.items():
            with self.subTest(expected):
                meta = edits.get_submitted_invoice_edit_metadata(doc)
                self.assertFalse(meta["can_edit_submitted_invoice"])
                self.assertFalse(meta["edit_requires_supervisor"])
                self.assertIn(expected, meta["edit_block_reason"])

    def test_closed_shift_and_existing_return_still_block_a_supervisor(self):
        def exists(doctype, filters=None, *args, **kwargs):
            if doctype == "Sales Invoice Reference":
                return "row-1"
            return None

        with patch.object(frappe.db, "exists", side_effect=exists):
            meta = edits.get_submitted_invoice_edit_metadata(FakeInvoice())
        self.assertFalse(meta["can_edit_submitted_invoice"])
        self.assertIn("closing shift", meta["edit_block_reason"])

        with patch.object(frappe.db, "exists", side_effect=lambda doctype, *a, **k: doctype == "Sales Invoice"):
            meta = edits.get_submitted_invoice_edit_metadata(FakeInvoice())
        self.assertFalse(meta["can_edit_submitted_invoice"])
        self.assertIn("return or credit note", meta["edit_block_reason"])

    def test_ineligible_invoice_does_not_look_up_a_supervisor(self):
        edits.get_submitted_invoice_edit_metadata(FakeInvoice(is_return=1))
        self.approver_mock.assert_not_called()

    def test_list_looks_up_the_supervisor_once_per_profile(self):
        cache = {}
        for _ in range(3):
            edits.get_submitted_invoice_edit_metadata(FakeInvoice(), approver_cache=cache)
        self.assertEqual(self.approver_mock.call_count, 1)


class TestSubmitEditRequiresSupervisor(unittest.TestCase):
    """The whitelisted cancel-and-amend call itself, as a direct API call would reach it."""

    def setUp(self):
        self.original = FakeInvoice()
        self.amended = FakeInvoice(name="ZZ-SUPERVISOR-TEST-0001-1", amended_from=self.original.name)
        self.approver = None
        profile = frappe._dict(name=self.original.pos_profile, company=self.original.company)

        def get_doc(doctype, name=None, *args, **kwargs):
            return self.amended if name == self.amended.name else self.original

        self.submit_invoice = MagicMock(return_value={"name": self.amended.name, "doctype": "Sales Invoice"})
        patches = [
            patch.object(frappe, "get_doc", side_effect=get_doc),
            patch("posawesome.posawesome.api.pos_access.get_authorized_pos_profile", return_value=profile),
            patch(f"{MODULE}.find_invoice_by_client_request_id", return_value=None),
            patch(f"{MODULE}.assert_pos_profile_write_allowed"),
            patch(f"{MODULE}.get_submitted_invoice_edit_approver", side_effect=lambda p: self.approver),
            patch(f"{MODULE}.build_submitted_invoice_amendment_payload", return_value={}),
            patch(f"{MODULE}.trusted_invoice_shift_reassignment", return_value=contextlib.nullcontext()),
            patch(f"{MODULE}.submit_invoice", self.submit_invoice),
            patch(f"{MODULE}.set_invoice_client_request_id"),
            patch(f"{MODULE}._has_column", return_value=True),
            patch.object(frappe.db, "savepoint"),
            patch.object(frappe.db, "sql", return_value=()),
            patch.object(frappe.db, "rollback"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        previous_flag = frappe.flags.ignore_account_permission
        self.addCleanup(setattr, frappe.flags, "ignore_account_permission", previous_flag)

    def _submit(self):
        return edits.submit_submitted_invoice_edit(
            "Sales Invoice",
            self.original.name,
            correction_data='{"customer": "CUST-NEW"}',
            client_request_id="submitted-edit-test",
        )

    def test_direct_api_call_by_a_cashier_is_refused_before_anything_is_cancelled(self):
        with self.assertRaisesRegex(frappe.PermissionError, SUPERVISOR_MESSAGE):
            self._submit()
        self.original.cancel.assert_not_called()
        self.submit_invoice.assert_not_called()

    def test_supervisor_edit_goes_through_and_records_who_authorized_it(self):
        self.approver = "boss@test.invalid"
        result = self._submit()
        self.original.cancel.assert_called_once()
        self.submit_invoice.assert_called_once()
        self.assertEqual(self.amended.posa_edit_authorized_by, "boss@test.invalid")
        self.amended.db_update.assert_called_once()
        self.assertEqual(result["original_invoice"], self.original.name)
