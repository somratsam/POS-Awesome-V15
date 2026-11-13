"""Sales credited to: rules, POS Sales Person checks, Sales Person POS User,
the re-runnable refresh, the dashboard, and the wiring.

Everything runs inside the test transaction and is rolled back.
"""

import inspect
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import dashboard, sales_credit
from posawesome.posawesome.api.invoice_processing import creation

SP_A = "_SC Person A"
SP_B = "_SC Person B"
SP_UNLINKED = "_SC Person Unlinked"
SP_OFF = "_SC Person Off"
SP_GROUP = "_SC Group"
USER_A = "test@example.com"
USER_B = "testpassword@example.com"
CASHIER = "testdelete@example.com"


def _company():
    return "Swan" if frappe.db.exists("Company", "Swan") else frappe.get_all("Company", limit=1, pluck="name")[0]


def _sales_person(name, user=None, enabled=1, is_group=0):
    doc = frappe.get_doc(
        {
            "doctype": "Sales Person",
            "sales_person_name": name,
            "parent_sales_person": "Sales Team" if frappe.db.exists("Sales Person", "Sales Team") else None,
            "is_group": is_group,
            "enabled": enabled,
            "posa_user": user,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc


class _Base(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        frappe.flags.pop("posa_trusted_shift_audit", None)
        self.company = _company()
        self.seq = 0

    def tearDown(self):
        frappe.flags.pop("posa_trusted_shift_audit", None)
        frappe.db.rollback()
        frappe.set_user("Administrator")

    def people(self):
        _sales_person(SP_A, USER_A)
        _sales_person(SP_B, USER_B)
        _sales_person(SP_UNLINKED)
        _sales_person(SP_OFF, enabled=0)
        _sales_person(SP_GROUP, is_group=1)

    def bare_invoice(self, *, cashier=CASHIER, sales_person=None, is_return=0, return_against=None,
                     credited=None, docstatus=1, name=None):
        self.seq += 1
        name = name or f"_SC-INV-{self.seq}"
        frappe.db.sql(
            """INSERT INTO `tabSales Invoice`
               (name, docstatus, company, posting_date, is_return, return_against,
                grand_total, base_grand_total, posa_cashier, posa_credited_user)
               VALUES (%s, %s, %s, '2026-10-05', %s, %s, 10, 10, %s, %s)""",
            (name, docstatus, self.company, is_return, return_against, cashier, credited),
        )
        if sales_person:
            frappe.db.sql(
                """INSERT INTO `tabSales Team`
                   (name, parent, parenttype, parentfield, idx, sales_person, allocated_percentage)
                   VALUES (%s, %s, 'Sales Invoice', 'sales_team', 1, %s, 100)""",
                (f"_SC-ST-{self.seq}", name, sales_person),
            )
        return name

    def doc(self, *, sales_team=None, cashier=CASHIER, is_return=0, return_against=None):
        doc = frappe.new_doc("Sales Invoice")
        doc.posa_cashier = cashier
        doc.is_return = is_return
        doc.return_against = return_against
        for row in sales_team or []:
            doc.append("sales_team", row)
        return doc


class TestRules(_Base):
    def test_no_sales_person_is_the_pin_cashier(self):
        doc = self.doc()
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, CASHIER)
        self.assertEqual(doc.posa_credited_user_name, frappe.db.get_value("User", CASHIER, "full_name"))

    def test_linked_sales_person_is_their_user(self):
        self.people()
        doc = self.doc(sales_team=[{"sales_person": SP_A, "allocated_percentage": 100}])
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_A)
        self.assertEqual(doc.posa_cashier, CASHIER)  # the PIN cashier stays on the invoice

    def test_unlinked_sales_person_is_the_pin_cashier(self):
        self.people()
        doc = self.doc(sales_team=[{"sales_person": SP_UNLINKED, "allocated_percentage": 100}])
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, CASHIER)

    def test_highest_share_wins(self):
        self.people()
        doc = self.doc(
            sales_team=[
                {"sales_person": SP_A, "allocated_percentage": 40},
                {"sales_person": SP_B, "allocated_percentage": 60},
            ]
        )
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_B)

    def test_return_follows_the_original_not_its_own_sales_person_or_cashier(self):
        self.people()
        original = self.bare_invoice(cashier="Administrator", credited=USER_B)
        doc = self.doc(
            sales_team=[{"sales_person": SP_A, "allocated_percentage": 100}],
            is_return=1,
            return_against=original,
        )
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_B)

    def test_return_of_an_unfilled_original_computes_it(self):
        self.people()
        original = self.bare_invoice(cashier="Administrator", sales_person=SP_B)
        doc = self.doc(is_return=1, return_against=original)
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_B)

    def test_return_without_invoice_uses_its_own_rules(self):
        self.people()
        doc = self.doc(sales_team=[{"sales_person": SP_A, "allocated_percentage": 100}], is_return=1)
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_A)

    def test_pos_invoice_is_left_alone(self):
        doc = frappe.new_doc("POS Invoice")
        doc.posa_cashier = CASHIER
        sales_credit.set_credited_user(doc)
        self.assertIsNone(doc.get("posa_credited_user"))

    def test_corrected_sales_team_after_submit_moves_its_returns(self):
        original = self.bare_invoice(credited=CASHIER)
        ret = self.bare_invoice(is_return=1, return_against=original, credited=CASHIER)
        other = self.bare_invoice(is_return=1, return_against=original, credited=CASHIER, docstatus=2)
        doc = frappe.get_doc("Sales Invoice", original)
        before = frappe._dict(posa_credited_user=CASHIER)
        doc.posa_credited_user, doc.posa_credited_user_name = USER_A, "A"
        with patch.object(doc, "get_doc_before_save", return_value=before):
            sales_credit.on_update_after_submit(doc)
        self.assertEqual(frappe.db.get_value("Sales Invoice", ret, "posa_credited_user"), USER_A)
        self.assertEqual(frappe.db.get_value("Sales Invoice", other, "posa_credited_user"), CASHIER)


class TestSalesTeamAfterSubmit(_Base):
    def setUp(self):
        super().setUp()
        self.people()

    def submitted(self, sales_person):
        doc = self.doc(sales_team=[{"sales_person": sales_person, "allocated_percentage": 100}])
        saved = frappe.copy_doc(doc)
        return doc, saved

    def run_as(self, roles, doc, saved, user="sc-staff@example.com"):
        with patch.object(frappe, "get_roles", return_value=roles), patch.dict(
            frappe.session, {"user": user}
        ), patch.object(doc, "get_doc_before_save", return_value=saved):
            sales_credit.before_update_after_submit(doc)

    def test_only_system_manager_can_change_the_sales_person(self):
        doc, saved = self.submitted(SP_A)
        doc.sales_team[0].sales_person = SP_B
        with self.assertRaises(frappe.PermissionError):
            self.run_as(["Accounts User", "Accounts Manager"], doc, saved)
        self.run_as(["System Manager"], doc, saved)
        self.assertEqual(doc.posa_credited_user, USER_B)
        self.run_as([], doc, saved, user="Administrator")

    def test_adding_removing_or_resharing_is_a_change_too(self):
        doc, saved = self.submitted(SP_A)
        doc.append("sales_team", {"sales_person": SP_B, "allocated_percentage": 0})
        with self.assertRaises(frappe.PermissionError):
            self.run_as(["Accounts User"], doc, saved)
        doc, saved = self.submitted(SP_A)
        doc.sales_team[0].allocated_percentage = 40
        with self.assertRaises(frappe.PermissionError):
            self.run_as(["Accounts User"], doc, saved)
        doc, saved = self.submitted(SP_A)
        doc.set("sales_team", [])
        with self.assertRaises(frappe.PermissionError):
            self.run_as(["Accounts User"], doc, saved)

    def test_other_after_submit_edits_still_work(self):
        doc, saved = self.submitted(SP_A)
        doc.sales_team[0].incentives = 5
        doc.sales_team[0].contact_no = "999"
        self.run_as(["Accounts User"], doc, saved)
        self.assertEqual(doc.posa_credited_user, USER_A)

    def test_the_desk_form_locks_the_table_for_others(self):
        js = open(frappe.get_app_path("posawesome", "posawesome", "api", "invoice.js")).read()
        self.assertIn('frm.doc.docstatus === 1 && !frappe.user.has_role("System Manager")', js)
        self.assertIn('set_df_property("sales_team", "read_only"', js)


class TestPosCheck(_Base):
    def profile(self, allowed=()):
        return frappe._dict(posa_sales_persons=[frappe._dict(sales_person=name) for name in allowed])

    def check(self, sales_person, allowed=()):
        doc = self.doc(sales_team=[{"sales_person": sales_person, "allocated_percentage": 100}])
        sales_credit.check_pos_sales_team(doc, self.profile(allowed))
        return doc

    def test_valid_sales_person_passes(self):
        self.people()
        self.assertEqual(len(self.check(SP_A).sales_team), 1)
        self.assertEqual(len(self.check(SP_A, allowed=[SP_A, SP_B]).sales_team), 1)

    def test_group_heading_is_refused(self):
        self.people()
        with self.assertRaisesRegex(frappe.ValidationError, "group heading"):
            self.check(SP_GROUP)

    def test_disabled_is_refused(self):
        self.people()
        with self.assertRaisesRegex(frappe.ValidationError, "disabled"):
            self.check(SP_OFF)

    def test_not_on_the_allowed_list_is_refused(self):
        self.people()
        with self.assertRaisesRegex(frappe.ValidationError, "not allowed for this store"):
            self.check(SP_B, allowed=[SP_A])

    def test_unknown_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "does not exist"):
            self.check("_SC Nobody")

    def test_offline_sync_drops_the_row_and_logs_instead_of_refusing(self):
        self.people()
        frappe.flags.posa_trusted_shift_audit = {"source": "offline_sync"}
        before = frappe.db.count("Error Log", {"method": "POS Sales Person dropped on offline sync"})
        doc = self.check(SP_GROUP)
        self.assertEqual(doc.sales_team, [])
        after = frappe.db.count("Error Log", {"method": "POS Sales Person dropped on offline sync"})
        self.assertEqual(after, before + 1)

    def test_edit_invoice_amendment_keeps_the_original_sales_team(self):
        self.people()
        frappe.flags.posa_trusted_shift_audit = {"source": "submitted_amendment"}
        self.assertEqual(self.check(SP_GROUP).sales_team[0].sales_person, SP_GROUP)

    def test_dropdown_never_lists_a_group_heading(self):
        self.people()
        with patch("posawesome.posawesome.api.utils.get_active_pos_profile", return_value=None):
            from posawesome.posawesome.api.utils import fetch_sales_person_names

            names = {row["name"] for row in fetch_sales_person_names()}
        self.assertIn(SP_A, names)
        self.assertNotIn(SP_GROUP, names)
        self.assertNotIn(SP_OFF, names)


class TestDropdownStore(_Base):
    """The till sends its store; the list is that store's, and only for an assigned user."""

    def test_the_tills_store_list_is_used(self):
        self.people()
        profile = frappe._dict(name="X", posa_sales_persons=[frappe._dict(sales_person=SP_B)])
        profile.as_dict = lambda: profile
        from posawesome.posawesome.api.utils import fetch_sales_person_names

        with patch("posawesome.posawesome.api.pos_access.get_authorized_pos_profile", return_value=profile) as auth, patch(
            "posawesome.posawesome.api.utils.get_active_pos_profile"
        ) as active:
            names = [row["name"] for row in fetch_sales_person_names("X")]
        self.assertEqual(names, [SP_B])
        auth.assert_called_once_with("X")
        active.assert_not_called()

    def test_a_store_the_user_is_not_on_gives_nothing(self):
        self.people()
        from posawesome.posawesome.api.utils import fetch_sales_person_names

        with patch(
            "posawesome.posawesome.api.pos_access.get_authorized_pos_profile",
            side_effect=frappe.PermissionError("not assigned"),
        ):
            self.assertEqual(fetch_sales_person_names("Other Store"), [])


class TestSalesPersonUser(_Base):
    def test_only_system_manager_can_set_or_change_it(self):
        self.people()
        doc = frappe.get_doc("Sales Person", SP_UNLINKED)
        doc.posa_user = USER_A
        with patch.object(frappe, "get_roles", return_value=["Sales Master Manager"]), patch.dict(
            frappe.session, {"user": "someone@example.com"}
        ):
            sales_credit.validate_sales_person(doc)
        self.assertIsNone(doc.posa_user)  # reverted, not saved

        doc = frappe.get_doc("Sales Person", SP_A)
        doc.posa_user = None
        saved = frappe.get_doc("Sales Person", SP_A)  # what save() loads as "before"
        with patch.object(doc, "get_doc_before_save", return_value=saved), patch.object(
            frappe, "get_roles", return_value=["Sales Master Manager"]
        ), patch.dict(
            frappe.session, {"user": "someone@example.com"}
        ):
            sales_credit.validate_sales_person(doc)
        self.assertEqual(doc.posa_user, USER_A)

    def test_system_manager_can_link(self):
        self.people()
        doc = frappe.get_doc("Sales Person", SP_UNLINKED)
        doc.posa_user = CASHIER
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Sales Person", SP_UNLINKED, "posa_user"), CASHIER)

    def test_one_user_per_sales_person(self):
        self.people()
        doc = frappe.get_doc("Sales Person", SP_UNLINKED)
        doc.posa_user = USER_A
        with self.assertRaisesRegex(frappe.ValidationError, "already the POS User"):
            doc.save(ignore_permissions=True)

    def test_group_heading_cannot_have_a_user(self):
        self.people()
        doc = frappe.get_doc("Sales Person", SP_GROUP)
        doc.posa_user = CASHIER
        with self.assertRaisesRegex(frappe.ValidationError, "group heading"):
            doc.save(ignore_permissions=True)

    def test_hook_is_wired(self):
        from posawesome import hooks

        self.assertEqual(
            hooks.doc_events["Sales Person"]["validate"],
            "posawesome.posawesome.api.sales_credit.validate_sales_person",
        )


class TestRefresh(_Base):
    def run_refresh(self, dry_run=False):
        with patch.object(frappe.db, "commit"):
            return sales_credit.refresh_sales_credit(dry_run=dry_run, verbose=False)

    def test_changes_only_what_differs_and_is_rerunnable(self):
        self.people()
        sale = self.bare_invoice(sales_person=SP_B)  # blank, should become USER_B
        ret = self.bare_invoice(is_return=1, return_against=sale)  # follows the sale
        plain = self.bare_invoice()  # blank, becomes the cashier
        stale = self.bare_invoice(sales_person=SP_UNLINKED, credited=USER_A)  # wrong, back to cashier
        modified = frappe.db.get_value("Sales Invoice", sale, "modified")

        preview = self.run_refresh(dry_run=True)
        self.assertIsNone(frappe.db.get_value("Sales Invoice", sale, "posa_credited_user"))
        self.assertTrue(preview["dry_run"])

        first = self.run_refresh()
        values = {name: frappe.db.get_value("Sales Invoice", name, "posa_credited_user") for name in (sale, ret, plain, stale)}
        self.assertEqual(values, {sale: USER_B, ret: USER_B, plain: CASHIER, stale: CASHIER})
        self.assertEqual(preview["changed"], first["changed"])
        self.assertGreaterEqual(first["changed"], 4)
        self.assertEqual(frappe.db.get_value("Sales Invoice", sale, "modified"), modified)
        self.assertEqual(first["unlinked_sales_persons"].get(SP_UNLINKED), 1)

        second = self.run_refresh()
        self.assertEqual(second["changed"], 0)

    def test_linking_later_moves_past_sales_on_the_next_run(self):
        self.people()
        sale = self.bare_invoice(sales_person=SP_UNLINKED)
        self.run_refresh()
        self.assertEqual(frappe.db.get_value("Sales Invoice", sale, "posa_credited_user"), CASHIER)
        frappe.db.set_value("Sales Person", SP_UNLINKED, "posa_user", "test1@example.com")
        result = self.run_refresh()
        self.assertEqual(frappe.db.get_value("Sales Invoice", sale, "posa_credited_user"), "test1@example.com")
        self.assertEqual(result["changed"], 1)


class TestDashboard(_Base):
    def test_staff_performance_uses_the_credited_person(self):
        self.bare_invoice(cashier=CASHIER, credited=USER_A)
        self.bare_invoice(cashier=CASHIER)  # not filled: the PIN cashier
        frappe.db.sql("UPDATE `tabSales Invoice` SET pos_profile='_SC Store' WHERE name LIKE '_SC-INV-%%'")
        report = dashboard._collect_staff_cashier_performance_report(
            ["_SC Store"], self.company, "2026-10-01", "2026-10-31"
        )
        counts = {row["cashier"]: row["invoice_count"] for row in report["cashier_wise"]}
        self.assertEqual(counts, {USER_A: 1, CASHIER: 1})

    def test_pos_invoice_keeps_the_pin_cashier(self):
        self.assertNotIn("posa_credited_user", dashboard._staff_credit_expression("POS Invoice"))
        self.assertIn("posa_credited_user", dashboard._staff_credit_expression("Sales Invoice"))


def _team(doc):
    return [(row.sales_person, row.allocated_percentage) for row in doc.get("sales_team") or []]


class TestAutoFill(_Base):
    """apply_pos_sales_team: what the POS saves at submit."""

    def setUp(self):
        super().setUp()
        self.people()
        self.allowed_b_only = frappe._dict(posa_sales_persons=[frappe._dict(sales_person=SP_B)])

    def test_a_chosen_sales_person_is_kept(self):
        doc = self.doc(cashier=USER_A, sales_team=[{"sales_person": SP_B, "allocated_percentage": 100}])
        sales_credit.apply_pos_sales_team(doc, self.allowed_b_only)
        self.assertEqual(_team(doc), [(SP_B, 100)])

    def test_a_chosen_sales_person_is_still_checked(self):
        doc = self.doc(cashier=USER_A, sales_team=[{"sales_person": SP_GROUP, "allocated_percentage": 100}])
        with self.assertRaises(frappe.ValidationError):
            sales_credit.apply_pos_sales_team(doc, self.allowed_b_only)

    def test_none_chosen_is_the_cashiers_own_even_at_another_store(self):
        doc = self.doc(cashier=USER_A)
        sales_credit.apply_pos_sales_team(doc, self.allowed_b_only)  # SP_A not on this store's list
        self.assertEqual(_team(doc), [(SP_A, 100)])

    def test_a_cashier_without_a_sales_person_stays_empty(self):
        doc = self.doc(cashier=CASHIER)
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [])
        frappe.db.set_value("Sales Person", SP_A, "enabled", 0)
        doc = self.doc(cashier=USER_A)
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [])

    def test_offline_sync_drops_a_bad_choice_then_uses_the_cashiers_own(self):
        frappe.flags.posa_trusted_shift_audit = {"source": "offline_sync"}
        doc = self.doc(cashier=USER_A, sales_team=[{"sales_person": SP_OFF, "allocated_percentage": 100}])
        with patch.object(frappe, "log_error"):
            sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [(SP_A, 100)])

    def test_a_return_always_takes_the_originals_team(self):
        original = self.bare_invoice(cashier=USER_A, sales_person=SP_B)
        for picked in (None, SP_A, SP_GROUP, SP_OFF):
            team = [{"sales_person": picked, "allocated_percentage": 100}] if picked else []
            doc = self.doc(cashier=CASHIER, is_return=1, return_against=original, sales_team=team)
            sales_credit.apply_pos_sales_team(doc, self.allowed_b_only)
            self.assertEqual(_team(doc), [(SP_B, 100)], picked)

    def test_a_return_of_a_sale_without_one_stays_empty(self):
        original = self.bare_invoice(cashier=CASHIER)
        doc = self.doc(cashier=USER_A, is_return=1, return_against=original,
                       sales_team=[{"sales_person": SP_A, "allocated_percentage": 100}])
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [])

    def test_a_return_of_a_now_disabled_sales_person_stays_empty(self):
        original = self.bare_invoice(cashier=USER_A, sales_person=SP_OFF)
        doc = self.doc(cashier=USER_A, is_return=1, return_against=original)
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [])

    def test_a_return_without_an_original_is_like_a_sale(self):
        doc = self.doc(cashier=USER_A, is_return=1)
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [(SP_A, 100)])

    def test_edit_invoice_is_never_filled(self):
        doc = self.doc(cashier=USER_A)
        doc.amended_from = "X"
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [])
        frappe.flags.posa_trusted_shift_audit = {"source": "submitted_amendment"}
        doc = self.doc(cashier=USER_A, sales_team=[{"sales_person": SP_GROUP, "allocated_percentage": 100}])
        sales_credit.apply_pos_sales_team(doc, None)
        self.assertEqual(_team(doc), [(SP_GROUP, 100)])


class TestEditInvoiceCredit(_Base):
    def amend(self, original, cashier, sales_team=None):
        doc = self.doc(cashier=cashier, sales_team=sales_team)
        doc.amended_from = original
        return doc

    def test_credit_stays_with_the_original_cashier_not_the_editor(self):
        self.people()
        first = self.bare_invoice(cashier=CASHIER, docstatus=2)
        second = self.bare_invoice(cashier=USER_B, docstatus=2)
        frappe.db.set_value("Sales Invoice", second, "amended_from", first)
        doc = self.amend(second, cashier="Administrator")
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, CASHIER)
        self.assertEqual(doc.posa_cashier, "Administrator")  # the editor stays recorded

    def test_a_linked_sales_person_still_wins(self):
        self.people()
        first = self.bare_invoice(cashier=CASHIER, docstatus=2)
        doc = self.amend(first, cashier="Administrator", sales_team=[{"sales_person": SP_A, "allocated_percentage": 100}])
        sales_credit.set_credited_user(doc)
        self.assertEqual(doc.posa_credited_user, USER_A)

    def test_refresh_uses_the_same_rule(self):
        first = self.bare_invoice(cashier=CASHIER, docstatus=2)
        amended = self.bare_invoice(cashier=USER_B, credited=USER_B)
        frappe.db.set_value("Sales Invoice", amended, "amended_from", first)
        with patch.object(frappe.db, "commit"):
            sales_credit.refresh_sales_credit(verbose=False)
        self.assertEqual(frappe.db.get_value("Sales Invoice", amended, "posa_credited_user"), CASHIER)


class TestFillPastInvoices(_Base):
    def pos_invoice(self, *, cashier, sales_person=None, is_return=0, return_against=None, amended_from=None,
                    docstatus=1, eligible=50):
        name = self.bare_invoice(cashier=cashier, sales_person=sales_person, is_return=is_return,
                                 return_against=return_against, docstatus=docstatus)
        frappe.db.sql(
            """UPDATE `tabSales Invoice` SET pos_profile = '_SC Store', amended_from = %s,
               amount_eligible_for_commission = %s, base_net_total = %s, modified = '2026-10-05 10:00:00'
               WHERE name = %s""",
            (amended_from, eligible, eligible, name),
        )
        return name

    def team_of(self, name):
        return [(r.sales_person, r.allocated_percentage, r.allocated_amount)
                for r in frappe.get_all("Sales Team", filters={"parent": name}, fields=["sales_person", "allocated_percentage", "allocated_amount"], order_by="idx")]

    def fill(self, **kwargs):
        with patch.object(frappe.db, "commit"):
            return sales_credit.fill_pos_sales_team(verbose=False, **kwargs)

    def test_fills_overwrites_returns_and_is_rerunnable(self):
        self.people()
        frappe.db.set_value("Sales Person", SP_B, "commission_rate", 10)
        sale = self.pos_invoice(cashier=USER_A)                                   # -> SP_A
        chosen = self.pos_invoice(cashier=USER_A, sales_person=SP_B)              # kept
        unlinked = self.pos_invoice(cashier=CASHIER)                              # stays empty
        ret = self.pos_invoice(cashier=CASHIER, is_return=1, return_against=sale, eligible=-20)          # -> SP_A
        wrong = self.pos_invoice(cashier=USER_A, sales_person=SP_A, is_return=1, return_against=chosen,
                                 eligible=-10)                                     # SP_A -> SP_B
        first = self.pos_invoice(cashier=USER_B, docstatus=2)
        amended = self.pos_invoice(cashier=CASHIER, amended_from=first)           # -> SP_B (first cashier)

        dry = self.fill(dry_run=True)
        self.assertEqual(self.team_of(sale), [])
        summary = self.fill()
        self.assertEqual(dry["changed"], summary["changed"])
        self.assertEqual(self.team_of(sale), [(SP_A, 100, 50)])
        self.assertEqual(self.team_of(chosen), [(SP_B, 100, 0)])  # untouched (bare row)
        self.assertEqual(self.team_of(unlinked), [])
        self.assertEqual(self.team_of(ret), [(SP_A, 100, -20)])
        self.assertEqual(self.team_of(wrong), [(SP_B, 100, -10)])
        self.assertEqual(self.team_of(amended), [(SP_B, 100, 50)])
        self.assertEqual(frappe.db.get_value("Sales Team", {"parent": wrong}, "incentives"), -1)
        self.assertIn(
            {"return": wrong, "original": chosen, "was": [SP_A], "now": [SP_B]}, summary["returns_overwritten"]
        )
        self.assertIn(CASHIER, summary["left_empty_cashier_not_linked"])
        self.assertEqual(str(frappe.db.get_value("Sales Invoice", sale, "modified")), "2026-10-05 10:00:00")
        mine = {sale, chosen, unlinked, ret, wrong, amended}
        again = self.fill(dry_run=True)
        self.assertFalse(mine & {item["return"] for item in again["returns_overwritten"]})
        self.assertEqual([self.team_of(n) for n in sorted(mine)], [self.team_of(n) for n in sorted(mine)])
        self.fill()
        self.assertEqual(self.team_of(sale), [(SP_A, 100, 50)])
        self.assertEqual(len(self.team_of(ret)), 1)


class TestWiring(unittest.TestCase):
    def test_invoice_validate_sets_the_credited_person(self):
        from posawesome.posawesome.api import invoice

        self.assertIn("set_credited_user(doc)", inspect.getsource(invoice.validate))

    def test_update_after_submit_hooks(self):
        from posawesome import hooks

        events = hooks.doc_events["Sales Invoice"]
        self.assertEqual(events["before_update_after_submit"], "posawesome.posawesome.api.sales_credit.before_update_after_submit")
        self.assertEqual(events["on_update_after_submit"], "posawesome.posawesome.api.sales_credit.on_update_after_submit")

    def test_both_pos_submit_paths_check_the_sales_person(self):
        self.assertIn("check_pos_sales_team(invoice_doc, profile_doc)", inspect.getsource(creation.update_invoice))
        # submit checks the choice, then fills or copies (apply_pos_sales_team calls the check)
        self.assertIn("apply_pos_sales_team(invoice_doc, profile_doc)", inspect.getsource(creation.submit_invoice))
        self.assertNotIn("apply_pos_sales_team", inspect.getsource(creation.update_invoice))
        self.assertIn("check_pos_sales_team(invoice_doc, profile_doc)", inspect.getsource(sales_credit.apply_pos_sales_team))

    def test_credit_fields_can_change_after_submit(self):
        meta = frappe.get_meta("Sales Invoice")
        self.assertTrue(meta.get_field("posa_credited_user").allow_on_submit)
        self.assertTrue(meta.get_field("posa_credited_user_name").allow_on_submit)

    def test_bench_command_is_registered(self):
        from posawesome import commands

        self.assertIn("posa-refresh-sales-credit", [command.name for command in commands.commands])
        self.assertIn("posa-fill-sales-person", [command.name for command in commands.commands])
