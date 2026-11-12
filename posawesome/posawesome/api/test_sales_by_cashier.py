"""Sales by Cashier: access rules, what is counted, buckets and totals.

Data tests insert bare invoice rows inside the test transaction and roll
them back, so every rule (cancelled, draft, no shift, other store, date
edges, hidden and former cashiers) is checked exactly, and nothing is left
on the site.
"""

import json
import unittest
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import sales_by_cashier as sbc

STORE = "_SBC Test Store"
OTHER_STORE = "_SBC Other Store"
SHIFT = "_SBC-SHIFT-1"


def _profile(name=STORE, enabled=1, hidden_mode="Group into Others", company=None):
    return frappe._dict(
        name=name,
        company=company or _company(),
        posa_enable_sales_by_cashier=enabled,
        posa_sales_by_cashier_hidden=hidden_mode,
    )


def _company():
    return "Swan" if frappe.db.exists("Company", "Swan") else frappe.get_all("Company", limit=1, pluck="name")[0]


class _Base(unittest.TestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.company = _company()
        self.seq = 0

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")

    def invoice(self, net, cashier="a@sbc.test", name=None, *, profile=STORE, shift=SHIFT,
                date="2026-10-05", docstatus=1, cashier_name=None, credited=None, credited_name=None):
        self.seq += 1
        names = {"a@sbc.test": "Alice A", "b@sbc.test": "Bilal B"}
        frappe.db.sql(
            """INSERT INTO `tabSales Invoice`
               (name, docstatus, company, pos_profile, posting_date, is_return,
                grand_total, base_grand_total, posa_cashier, posa_cashier_name, posa_pos_opening_shift,
                posa_credited_user, posa_credited_user_name)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                name or f"_SBC-INV-{self.seq}", docstatus, self.company, profile, date,
                1 if net < 0 else 0, net, net, cashier or None,
                cashier_name if cashier_name is not None else (names.get(cashier) or cashier),
                shift or None,
                credited,
                credited_name if credited_name is not None else (names.get(credited) or credited),
            ),
        )

    def assign(self, user, hidden=0, profile=STORE):
        self.seq += 1
        frappe.db.sql(
            """INSERT INTO `tabPOS Profile User`
               (name, parent, parenttype, parentfield, user, posa_hide_in_sales_by_cashier)
               VALUES (%s, %s, 'POS Profile', 'applicable_for_users', %s, %s)""",
            (f"_SBC-PPU-{self.seq}", profile, user, hidden),
        )

    def call(self, profile=None, cashier="a@sbc.test", log=False, **kwargs):
        profile = profile or _profile()
        args = {"pos_profile": profile.name, "from_date": "2026-10-01", "to_date": "2026-10-31"}
        args.update(kwargs)
        with (
            patch.object(sbc, "get_authorized_pos_profile", return_value=profile) as authorize,
            patch.object(sbc, "get_active_terminal_cashier", return_value=cashier) as terminal,
            # The log links a real User and POS Profile; TestOpeningLog checks it.
            patch.object(sbc, "_log_opening", wraps=sbc._log_opening if log else None) as self.log_opening,
        ):
            result = sbc.get_sales_by_cashier(**args)
        self.authorize, self.terminal = authorize, terminal
        return result


class TestAccess(_Base):
    def test_not_this_stores_profile_is_refused_without_figures(self):
        frappe.local.message_log = []

        def refuse(_profile):
            frappe.throw("You are not assigned to POS Profile X", frappe.PermissionError)

        with patch.object(sbc, "get_authorized_pos_profile", side_effect=refuse):
            result = sbc.get_sales_by_cashier("Other Store", "2026-10-01", "2026-10-31")
        self.assertEqual(result, {"allowed": False, "reason": "not_assigned", "message": "You are not assigned to this store."})
        self.assertEqual(frappe.local.message_log, [])  # no Frappe popup on the till

    def test_switch_off_refuses_before_reading_the_terminal(self):
        with (
            patch.object(sbc, "get_authorized_pos_profile", return_value=_profile(enabled=0)),
            patch.object(sbc, "get_active_terminal_cashier") as terminal,
        ):
            result = sbc.get_sales_by_cashier(STORE, "2026-10-01", "2026-10-31")
        self.assertEqual(result["reason"], "disabled")
        self.assertNotIn("rows", result)
        terminal.assert_not_called()

    def test_locked_till_or_unassigned_pin_cashier_is_refused(self):
        def locked(_profile):
            frappe.throw("This POS terminal is locked.", frappe.PermissionError)

        with (
            patch.object(sbc, "get_authorized_pos_profile", return_value=_profile()),
            patch.object(sbc, "get_active_terminal_cashier", side_effect=locked),
        ):
            result = sbc.get_sales_by_cashier(STORE, "2026-10-01", "2026-10-31")
        self.assertEqual(result["reason"], "locked")
        self.assertEqual(result["message"], "Unlock the till with your PIN to see this report.")
        self.assertNotIn("rows", result)

    def test_ordinary_cashier_sees_the_full_report(self):
        # No role check: the PIN cashier is only used for the log.
        self.assign("a@sbc.test")
        self.assign("b@sbc.test")
        self.invoice(100, "a@sbc.test")
        self.invoice(80, "b@sbc.test")
        result = self.call(cashier="b@sbc.test")
        self.assertTrue(result["allowed"])
        self.assertEqual([row["label"] for row in result["rows"]], ["Alice A", "Bilal B"])

    def test_store_comes_from_the_authorized_profile_not_the_request(self):
        self.assign("a@sbc.test")
        self.invoice(100, "a@sbc.test")
        self.invoice(999, "a@sbc.test", profile=OTHER_STORE)
        result = self.call(profile=_profile(), pos_profile=OTHER_STORE)
        self.authorize.assert_called_once_with(OTHER_STORE)
        self.terminal.assert_called_once_with(STORE)
        self.assertEqual(result["store"], STORE)
        self.assertEqual(result["totals"]["store"][0]["net"], 100)

    def test_guest_is_refused(self):
        frappe.set_user("Guest")
        result = sbc.get_sales_by_cashier(STORE, "2026-10-01", "2026-10-31")
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "not_assigned")

    def test_periods_are_validated(self):
        cases = [
            ({"from_date": "2026-10-31", "to_date": "2026-10-01"}, "The From date must be on or before the To date."),
            ({"from_date": "2025-01-01", "to_date": "2026-01-02"}, "Choose a period of one year or less."),
            ({"from_date": "", "to_date": "2026-10-01"}, "Choose a From and a To date."),
            ({"from_date": "not a date", "to_date": "2026-10-01"}, "Choose a From and a To date."),
            ({"compare_from": "2026-09-30", "compare_to": "2026-09-01"}, "The From date must be on or before the To date."),
        ]
        for args, message in cases:
            result = self.call(**args)
            self.assertEqual((result["reason"], result["message"]), ("invalid_period", message), args)
        self.assertTrue(self.call(from_date="2025-11-01", to_date="2026-11-01")["allowed"])  # 366 days

    def test_method_is_post_only(self):
        self.assertIn("POST", frappe.allowed_http_methods_for_whitelisted_func[sbc.get_sales_by_cashier])
        self.assertNotIn("GET", frappe.allowed_http_methods_for_whitelisted_func[sbc.get_sales_by_cashier])


class TestFigures(_Base):
    def seed(self):
        self.assign("a@sbc.test")
        self.assign("b@sbc.test")
        self.assign("hid@sbc.test", hidden=1)
        self.assign("a@sbc.test", profile=OTHER_STORE)
        self.invoice(100, "a@sbc.test")
        self.invoice(50, "a@sbc.test")
        self.invoice(-30, "a@sbc.test")
        self.invoice(80, "b@sbc.test")
        self.invoice(20, "hid@sbc.test")
        self.invoice(10, "old@sbc.test")  # former staff: not on the list
        self.invoice(5, None)  # cashier not recorded
        self.invoice(1000, "a@sbc.test", docstatus=2)  # cancelled
        self.invoice(500, "a@sbc.test", docstatus=0)  # draft
        self.invoice(700, "a@sbc.test", shift=None)  # not a till sale
        self.invoice(900, "a@sbc.test", profile=OTHER_STORE)  # another store
        self.invoice(7, "a@sbc.test", date="2026-10-01")  # first day
        self.invoice(3, "a@sbc.test", date="2026-10-31")  # last day
        self.invoice(400, "a@sbc.test", date="2026-11-01")  # after the period

    def test_rows_buckets_and_totals(self):
        self.seed()
        result = self.call()
        self.assertTrue(result["allowed"])
        self.assertEqual(result["currency"], frappe.get_cached_value("Company", self.company, "default_currency"))
        rows = {row["label"]: (row["kind"], row["values"][0]) for row in result["rows"]}
        self.assertEqual([row["label"] for row in result["rows"]], ["Alice A", "Bilal B", "Others", "Cashier not recorded"])
        self.assertEqual(rows["Alice A"], ("cashier", {"gross": 160, "returns": -30, "net": 130, "sales": 4, "by_others": 0, "avg_basket": 40}))
        self.assertEqual(rows["Bilal B"], ("cashier", {"gross": 80, "returns": 0, "net": 80, "sales": 1, "by_others": 0, "avg_basket": 80}))
        self.assertEqual(rows["Others"], ("others", {"gross": 30, "returns": 0, "net": 30, "sales": 2, "by_others": 0, "avg_basket": 15}))
        self.assertEqual(rows["Cashier not recorded"][0], "not_recorded")
        self.assertEqual(rows["Cashier not recorded"][1]["net"], 5)
        totals = result["totals"]
        self.assertEqual(totals["store"][0], {"gross": 275, "returns": -30, "net": 245, "sales": 8, "by_others": 0, "avg_basket": 34.375})
        self.assertEqual((totals["shown_net"][0], totals["others_net"][0], totals["not_recorded_net"][0]), (210, 30, 5))

    def test_store_total_matches_an_independent_sum(self):
        self.seed()
        result = self.call()
        expected = frappe.db.sql(
            """SELECT SUM(base_grand_total) FROM `tabSales Invoice`
               WHERE docstatus = 1 AND pos_profile = %s AND IFNULL(posa_pos_opening_shift, '') <> ''
                 AND posting_date BETWEEN '2026-10-01' AND '2026-10-31'""",
            STORE,
        )[0][0]
        self.assertAlmostEqual(result["totals"]["store"][0]["net"], float(expected), places=3)

    def test_hide_mode_drops_the_others_row_but_not_the_total(self):
        self.seed()
        result = self.call(profile=_profile(hidden_mode="Hide"))
        self.assertEqual(result["hidden_mode"], "hide")
        self.assertEqual([row["label"] for row in result["rows"]], ["Alice A", "Bilal B", "Cashier not recorded"])
        self.assertEqual(result["totals"]["store"][0]["net"], 245)
        self.assertEqual(result["totals"]["others_net"][0], 30)

    def test_two_periods_are_paired_by_cashier(self):
        self.seed()
        result = self.call(compare_from="2026-11-01", compare_to="2026-11-30")
        self.assertEqual(result["periods"], [{"from": "2026-10-01", "to": "2026-10-31"}, {"from": "2026-11-01", "to": "2026-11-30"}])
        rows = {row["label"]: row["values"] for row in result["rows"]}
        self.assertEqual(rows["Alice A"][1], {"gross": 400, "returns": 0, "net": 400, "sales": 1, "by_others": 0, "avg_basket": 400})
        self.assertEqual(rows["Bilal B"][1], {"gross": 0, "returns": 0, "net": 0, "sales": 0, "by_others": 0, "avg_basket": None})
        self.assertEqual(result["totals"]["store"][1]["net"], 400)

    def test_no_user_ids_leave_the_server(self):
        self.seed()
        self.invoice(1, "c@sbc.test", cashier_name="")
        self.assign("c@sbc.test")
        payload = json.dumps(self.call(compare_from="2026-11-01", compare_to="2026-11-30"))
        self.assertNotIn("@sbc.test", payload)
        self.assertIn('"label": "Cashier"', payload)  # no name anywhere: generic label, not the email

    def test_empty_period(self):
        result = self.call()
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["totals"]["store"][0], {"gross": 0, "returns": 0, "net": 0, "sales": 0, "by_others": 0, "avg_basket": None})


class TestCreditedPerson(_Base):
    """Sales by Cashier counts "Sales credited to", falling back to the PIN cashier."""

    def test_sale_counts_for_the_credited_person_not_the_pin_cashier(self):
        self.assign("a@sbc.test")
        self.assign("b@sbc.test")
        self.invoice(100, "a@sbc.test", credited="b@sbc.test")  # b chosen as Sales Person
        self.invoice(40, "a@sbc.test", credited="a@sbc.test")
        self.invoice(10, "a@sbc.test")  # not filled yet: the PIN cashier
        rows = {row["label"]: row["values"][0] for row in self.call()["rows"]}
        self.assertEqual(rows["Bilal B"], {"gross": 100, "returns": 0, "net": 100, "sales": 1, "by_others": 1, "avg_basket": 100})
        self.assertEqual(rows["Alice A"], {"gross": 50, "returns": 0, "net": 50, "sales": 2, "by_others": 0, "avg_basket": 25})

    def test_return_counts_for_the_credited_person_and_is_not_rung_up_by_others(self):
        self.assign("a@sbc.test")
        self.assign("b@sbc.test")
        self.invoice(100, "a@sbc.test", credited="b@sbc.test")
        self.invoice(-30, "a@sbc.test", credited="b@sbc.test")  # return of b's sale, rung up by a
        rows = {row["label"]: row["values"][0] for row in self.call()["rows"]}
        self.assertEqual(rows["Bilal B"], {"gross": 100, "returns": -30, "net": 70, "sales": 1, "by_others": 1, "avg_basket": 100})
        self.assertNotIn("Alice A", rows)

    def test_credited_person_not_on_the_store_list_goes_to_others(self):
        self.assign("a@sbc.test")
        self.invoice(100, "a@sbc.test", credited="elsewhere@sbc.test")
        result = self.call()
        self.assertEqual([row["label"] for row in result["rows"]], ["Others"])
        self.assertEqual(result["totals"]["store"][0]["net"], 100)

    def test_no_cashier_but_a_credited_person_is_not_cashier_not_recorded(self):
        self.assign("b@sbc.test")
        self.invoice(25, None, credited="b@sbc.test")
        rows = {row["label"]: row["values"][0] for row in self.call()["rows"]}
        self.assertEqual(rows["Bilal B"]["net"], 25)
        self.assertNotIn("Cashier not recorded", rows)


class TestBuildReport(unittest.TestCase):
    def test_sums_raw_and_rounds_once(self):
        rows = [[{"cashier": "a", "gross": 0.3333, "returns": 0, "net": 0.3333, "sales": 1},
                 {"cashier": "b", "gross": 0.3333, "returns": 0, "net": 0.3333, "sales": 1},
                 {"cashier": "c", "gross": 0.3333, "returns": 0, "net": 0.3333, "sales": 1}]]
        report = sbc.build_report(rows, {"a", "b", "c"}, {}, "Group into Others", 3)
        self.assertEqual(report["totals"]["store"][0]["net"], 1.0)  # not 0.999
        self.assertEqual(report["totals"]["shown_net"][0], 1.0)

    def test_user_full_name_wins_over_the_invoice_name(self):
        rows = [[{"cashier": "a", "cashier_name": "Old Name", "gross": 1, "returns": 0, "net": 1, "sales": 1}]]
        report = sbc.build_report(rows, {"a"}, {"a": "Current Name"}, "Group into Others", 3)
        self.assertEqual(report["rows"][0]["label"], "Current Name")

    def test_negative_net_sorts_last_among_cashiers(self):
        rows = [[{"cashier": "a", "gross": 0, "returns": -50, "net": -50, "sales": 0},
                 {"cashier": "b", "gross": 10, "returns": 0, "net": 10, "sales": 1}]]
        report = sbc.build_report(rows, {"a", "b"}, {"a": "A", "b": "B"}, "Group into Others", 3)
        self.assertEqual([row["label"] for row in report["rows"]], ["B", "A"])
        self.assertIsNone(report["rows"][1]["values"][0]["avg_basket"])


class TestOpeningLog(_Base):
    def setUp(self):
        super().setUp()
        self.store = frappe.get_all("POS Profile", limit=1, pluck="name")[0]
        self.profile = _profile(name=self.store)

    def open(self, opened, **kwargs):
        return self.call(profile=kwargs.pop("profile", self.profile), cashier="Administrator", log=True, opened=opened, **kwargs)

    def logs(self):
        return frappe.get_all(
            "Activity Log",
            filters={
                "reference_doctype": "POS Profile",
                "reference_name": self.store,
                "user": "Administrator",
                "subject": ["like", "Sales by Cashier opened%"],
            },
            fields=["subject", "content"],
        )

    def test_each_opening_is_logged_and_period_changes_are_not(self):
        before = len(self.logs())
        self.open(1)
        self.open(0)
        self.open(0)
        logs = self.logs()
        self.assertEqual(len(logs), before + 1)
        self.assertTrue(any(log.subject.startswith(f"Sales by Cashier opened at {self.store} by ") for log in logs))
        self.assertTrue(any("Till login: Administrator" in (log.content or "") for log in logs))
        self.open(1)
        self.assertEqual(len(self.logs()), before + 2)

    def test_a_client_that_never_says_opened_is_still_logged(self):
        before = len(self.logs())
        # No log inside the backstop window -> logged even without "opened".
        with patch.object(sbc, "LOG_BACKSTOP_MINUTES", 0):
            self.open(0)
        self.assertEqual(len(self.logs()), before + 1)

    def test_refusals_are_not_logged(self):
        before = len(self.logs())
        self.open(1, profile=_profile(name=self.store, enabled=0))
        self.assertEqual(len(self.logs()), before)
