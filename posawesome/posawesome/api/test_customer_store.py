"""Customer "Store" (posa_store): filled from the POS Profile at creation,
fallback to the creating user's single store, walk-ins blank, read-only after
creation except for System Manager, and a filter only -- POS Profile User
Permissions (Apply To All Document Types) never hide customers."""

import json
import pathlib

import frappe
from frappe.desk.search import search_widget
from frappe.tests import IntegrationTestCase

from posawesome.patches import backfill_customer_store
from posawesome.posawesome.api import customer_store, customers

APP_ROOT = pathlib.Path(__file__).resolve().parents[2]
STORE_A = "posa-store-a@test.invalid"  # on profile A only, User Permission A (all doctypes)
TWO = "posa-store-two@test.invalid"  # on A and B
NONE = "posa-store-none@test.invalid"  # on no profile
USERS = (STORE_A, TWO, NONE)


class TestCustomerStore(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, fields=["name", "company"], order_by="name", limit=2)
        if len(profiles) < 2:
            raise cls.skipTest(cls, "needs two POS Profiles")
        cls.A, cls.B = profiles[0].name, profiles[1].name
        cls.company = profiles[0].company
        cls.created_customers = []
        cls.profile_rows = []
        for email in USERS:
            cls._drop_user(email)
            user = frappe.get_doc({"doctype": "User", "email": email, "first_name": "Store Test", "send_welcome_email": 0, "user_type": "System User"})
            user.insert(ignore_permissions=True)
            user.add_roles("Accounts User", "Sales User")
        for email, profile in ((STORE_A, cls.A), (TWO, cls.A), (TWO, cls.B)):
            row = frappe.get_doc(
                {"doctype": "POS Profile User", "parent": profile, "parenttype": "POS Profile", "parentfield": "applicable_for_users", "user": email}
            )
            row.db_insert()
            cls.profile_rows.append(row.name)
        frappe.get_doc(
            {"doctype": "User Permission", "user": STORE_A, "allow": "POS Profile", "for_value": cls.A, "apply_to_all_doctypes": 1}
        ).insert(ignore_permissions=True)
        # one customer per store, made by Administrator, for the visibility checks
        cls.cust_a = cls._make_customer("Store Test Cust A", store=cls.A)
        cls.cust_b = cls._make_customer("Store Test Cust B", store=cls.B)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        for name in cls.created_customers:
            for code in frappe.get_all("Referral Code", filters={"customer": name}, pluck="name"):
                frappe.delete_doc("Referral Code", code, force=True, ignore_permissions=True)
            if frappe.db.exists("Customer", name):
                frappe.delete_doc("Customer", name, force=True, ignore_permissions=True)
        for row in cls.profile_rows:
            frappe.db.delete("POS Profile User", {"name": row})
        for email in USERS:
            cls._drop_user(email)
        frappe.db.commit()
        super().tearDownClass()

    @classmethod
    def _drop_user(cls, email):
        frappe.db.delete("User Permission", {"user": email})
        frappe.db.delete("POS Profile User", {"user": email})
        if frappe.db.exists("User", email):
            frappe.delete_doc("User", email, force=True, ignore_permissions=True)

    @classmethod
    def _make_customer(cls, name, store=None, user="Administrator", generic=0):
        frappe.set_user(user)
        try:
            doc = frappe.get_doc(
                {
                    "doctype": "Customer",
                    "customer_name": f"{name} {frappe.generate_hash(length=6)}",
                    "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}),
                    "territory": frappe.db.get_value("Territory", {"is_group": 0}),
                    "posa_store": store,
                    "posa_is_generic_customer": generic,
                }
            ).insert()
        finally:
            frappe.set_user("Administrator")
        cls.created_customers.append(doc.name)
        return doc.name

    def _pos_create(self, user, profile):
        frappe.set_user(user)
        try:
            doc = customers.create_customer(
                customer_name=f"Store Test POS {frappe.generate_hash(length=6)}",
                company=self.company,
                pos_profile_doc=profile,
                customer_group=frappe.db.get_value("Customer Group", {"is_group": 0}),
                territory=frappe.db.get_value("Territory", {"is_group": 0}),
            )
        finally:
            frappe.set_user("Administrator")
        self.created_customers.append(doc.name)
        return frappe.db.get_value("Customer", doc.name, "posa_store")

    def tearDown(self):
        frappe.set_user("Administrator")

    # --- field and hooks ---------------------------------------------------
    def test_field_definition_and_hooks(self):
        fixture = {r["name"]: r for r in json.loads((APP_ROOT / "fixtures" / "custom_field.json").read_text())}
        entry = fixture["Customer-posa_store"]
        self.assertEqual(
            (entry["fieldtype"], entry["options"], entry["read_only"], entry["no_copy"], entry["ignore_user_permissions"], entry["in_standard_filter"], entry["insert_after"]),
            ("Link", "POS Profile", 1, 1, 1, 1, "territory"),
        )
        field = frappe.get_meta("Customer").get_field("posa_store")
        self.assertEqual((field.read_only, field.ignore_user_permissions, field.in_standard_filter), (1, 1, 1))
        events = frappe.get_hooks("doc_events", app_name="posawesome")["Customer"]
        self.assertEqual(events["before_insert"], ["posawesome.posawesome.api.customer_store.before_insert"])
        source = (APP_ROOT / "posawesome" / "api" / "invoice_processing" / "creation.py").read_text()
        self.assertIn('"posa_store": pos_profile,', source)  # customer created during a sale

    # --- new customers -------------------------------------------------------
    def test_pos_creation_uses_the_profile_when_the_user_is_on_it(self):
        self.assertEqual(self._pos_create(STORE_A, self.A), self.A)
        self.assertEqual(self._pos_create(TWO, self.B), self.B)

    def test_profile_the_user_is_not_on_falls_back(self):
        # STORE_A claims B: not on it -> their own single store
        self.assertEqual(self._pos_create(STORE_A, self.B), self.A)
        # NONE is on no profile -> blank
        self.assertIsNone(self._pos_create(NONE, self.A))

    def test_desk_creation_by_a_store_login_gets_its_store(self):
        name = self._make_customer("Store Test Desk", user=STORE_A)
        self.assertEqual(frappe.db.get_value("Customer", name, "posa_store"), self.A)
        # a user on two stores creating in Desk: no single store -> blank
        name = self._make_customer("Store Test Desk Two", user=TWO)
        self.assertIsNone(frappe.db.get_value("Customer", name, "posa_store"))

    def test_walk_in_stays_blank(self):
        name = self._make_customer("Store Test Walkin", store=self.A, user=STORE_A, generic=1)
        self.assertIsNone(frappe.db.get_value("Customer", name, "posa_store"))

    # --- read-only after creation -------------------------------------------
    def test_only_system_manager_can_change_it(self):
        name = self._make_customer("Store Test RO", user=STORE_A)
        frappe.set_user(STORE_A)
        doc = frappe.get_doc("Customer", name)
        doc.posa_store = self.B
        doc.save()
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value("Customer", name, "posa_store"), self.A)

        doc = frappe.get_doc("Customer", name)
        doc.posa_store = self.B
        doc.save()
        self.assertEqual(frappe.db.get_value("Customer", name, "posa_store"), self.B)

    # --- filter only: User Permissions never hide customers ------------------
    def test_user_permission_does_not_hide_other_stores_customers(self):
        frappe.set_user(STORE_A)
        try:
            listed = set(frappe.get_list("Customer", filters={"name": ["in", [self.cust_a, self.cust_b]]}, pluck="name"))
            self.assertEqual(listed, {self.cust_a, self.cust_b})
            self.assertEqual(frappe.db.count("Customer"), len(frappe.get_list("Customer", pluck="name", limit_page_length=0)))
            self.assertTrue(frappe.has_permission("Customer", "read", self.cust_b))
            # the Store filter itself works
            self.assertEqual(frappe.get_list("Customer", filters={"posa_store": self.B, "name": self.cust_b}, pluck="name"), [self.cust_b])
            # customer picker on another form (link search) still finds store B's customer
            found = search_widget("Customer", txt=frappe.db.get_value("Customer", self.cust_b, "customer_name"), reference_doctype="Sales Invoice", as_dict=True)
            self.assertIn(self.cust_b, [r.get("name") for r in found])
            # the Store dropdown lists every store, not just the user's own
            stores = search_widget(
                "POS Profile", txt="", reference_doctype="Customer", link_fieldname="posa_store", ignore_user_permissions=True, page_length=100, as_dict=True
            )
            self.assertTrue({self.A, self.B} <= {r.get("name") for r in stores})
        finally:
            frappe.set_user("Administrator")

    def test_pos_customer_queries_untouched(self):
        # The POS customer list and search are the same for a store login with a
        # POS Profile User Permission as for Administrator.
        profile = json.dumps(frappe.get_doc("POS Profile", self.A).as_dict(), default=str)
        txt = frappe.db.get_value("Customer", self.cust_b, "customer_name")

        def pos_view():
            return (
                {c.get("name") for c in customers.get_customer_names(profile, limit=100000) or []},
                {c.get("name") for c in customers.search_customers(profile, txt) or []},
            )

        as_admin = pos_view()
        frappe.set_user(STORE_A)
        try:
            as_store = pos_view()
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(as_store, as_admin)
        self.assertTrue(as_admin[0])

    # --- backfill --------------------------------------------------------------
    def test_backfill_rules_idempotent_and_keeps_modified(self):
        by_owner = self._make_customer("Store Test Backfill Owner", user=STORE_A)
        walk_in = self._make_customer("Store Test Backfill Walkin", generic=1)
        nothing = self._make_customer("Store Test Backfill None")
        invoiced = frappe.db.get_value(
            "Sales Invoice", {"docstatus": 1, "pos_profile": ["is", "set"], "customer": ["is", "set"]}, ["customer", "pos_profile"], order_by="posting_date, posting_time, creation"
        )
        targets = [by_owner, walk_in, nothing] + ([invoiced[0]] if invoiced else [])
        saved = {n: frappe.db.get_value("Customer", n, ["posa_store", "modified"]) for n in targets}
        for n in targets:
            frappe.db.set_value("Customer", n, "posa_store", None, update_modified=False)
        try:
            backfill_customer_store.execute()
            self.assertEqual(frappe.db.get_value("Customer", by_owner, "posa_store"), self.A)
            self.assertIsNone(frappe.db.get_value("Customer", walk_in, "posa_store"))
            self.assertIsNone(frappe.db.get_value("Customer", nothing, "posa_store"))
            if invoiced:
                owner = frappe.db.get_value("Customer", invoiced[0], "owner")
                expected = customer_store.single_store(owner) or backfill_customer_store._first_invoice_stores()[invoiced[0]]
                self.assertEqual(frappe.db.get_value("Customer", invoiced[0], "posa_store"), expected)
            for n in targets:
                self.assertEqual(frappe.db.get_value("Customer", n, "modified"), saved[n][1])
            after_first = {n: frappe.db.get_value("Customer", n, "posa_store") for n in targets}
            backfill_customer_store.execute()
            self.assertEqual({n: frappe.db.get_value("Customer", n, "posa_store") for n in targets}, after_first)
        finally:
            for n, (store, _modified) in saved.items():
                frappe.db.set_value("Customer", n, "posa_store", store, update_modified=False)
            frappe.db.commit()
