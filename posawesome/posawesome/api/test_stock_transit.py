from unittest.mock import patch

import frappe
from erpnext.stock.doctype.stock_entry.stock_entry import make_stock_in_entry
from frappe.desk.query_report import run
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.stock_transit import (
    DESTINATION_FIELD,
    EMAIL_CONFIG_KEY,
    get_receivers,
    validate_no_stock_out_of_transit,
)
from posawesome.posawesome.report.incoming_transfers.incoming_transfers import get_destination_stores

PREFIX = "STT-TEST"
REPORT = "Incoming Transfers"
SENDER = "stt-sender@test.invalid"  # store A
RECEIVER = "stt-receiver@test.invalid"  # store B
# Set up like the real store users: POS and sales/accounts roles, no Company permission.
REAL_STORE_USER = "stt-real-store@test.invalid"  # store B
TWO_STORES = "stt-two-stores@test.invalid"  # stores B and C, Sales Manager + Accounts Manager
OTHER_DOCTYPE = "stt-other-doctype@test.invalid"  # store B, but only for Sales Invoice
NO_STOCK_ROLE = "stt-no-stock-role@test.invalid"  # store B, Sales User only
DISABLED = "stt-disabled@test.invalid"  # store B, disabled
STORE_C = "stt-store-c@test.invalid"  # store C
STOCK_MANAGER = "stt-stock-manager@test.invalid"  # unrestricted
STOCK_AND_ACCOUNTS_MANAGER = "stt-stock-accounts-manager@test.invalid"  # unrestricted
REAL_STORE_ROLES = ("POS User", "POS Manager", "Sales User", "Sales Manager", "Accounts Manager", "Customer", "Stock User")


class TestStockTransit(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.company = frappe.db.get_value("Company", {}, "name")
        cls.store_a = cls._warehouse("Store A")
        cls.store_b = cls._warehouse("Store B")
        cls.store_c = cls._warehouse("Store C")
        cls.store_empty = cls._warehouse("Store Nobody")
        cls.group = cls._warehouse("Group", is_group=1)
        cls.transit = cls._warehouse("Transit", warehouse_type="Transit")
        cls.item_1 = cls._item(f"{PREFIX}-ITEM-1")
        cls.item_2 = cls._item(f"{PREFIX}-ITEM-2")
        cls._receive_stock(cls.store_a, 50)
        cls._receive_stock(cls.store_b, 50)
        cls.customer = cls._customer(f"{PREFIX} Customer")
        cls.supplier = cls._supplier(f"{PREFIX} Supplier")
        pos_profile = frappe.db.get_value("POS Profile", {}, "name")
        for role in REAL_STORE_ROLES:
            # "POS User" is a site-made role on production; staging does not have it.
            if not frappe.db.exists("Role", role):
                frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert()

        cls._user(SENDER, ("Stock User",), [cls.store_a, cls.transit])
        cls._user(RECEIVER, ("Stock User",), [cls.store_b, cls.transit])
        cls._user(REAL_STORE_USER, REAL_STORE_ROLES, [cls.store_b, cls.transit], pos_profile=pos_profile)
        cls._user(TWO_STORES, ("Stock User", "Sales Manager", "Accounts Manager"), [cls.store_b, cls.store_c, cls.transit])
        cls._user(OTHER_DOCTYPE, ("Stock User",), [cls.store_b], applicable_for="Sales Invoice")
        cls._user(NO_STOCK_ROLE, ("Sales User",), [cls.store_b])
        cls._user(DISABLED, ("Stock User",), [cls.store_b])
        frappe.db.set_value("User", DISABLED, "enabled", 0)
        cls._user(STORE_C, ("Stock User",), [cls.store_c, cls.transit])
        cls._user(STOCK_MANAGER, ("Stock User", "Stock Manager"), [])
        cls._user(STOCK_AND_ACCOUNTS_MANAGER, ("Stock Manager", "Accounts Manager", "Sales Manager"), [])

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.local.conf.pop(EMAIL_CONFIG_KEY, None)

    # --- sending

    def test_destination_store_is_required(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Destination Store"):
            self._send({self.item_1: 1}, destination=None)

    def test_destination_store_must_be_a_real_other_store(self):
        for bad in (self.transit, self.group, self.store_a):
            with self.subTest(bad=bad), self.assertRaises(frappe.ValidationError):
                self._send({self.item_1: 1}, destination=bad)

    def test_sender_may_pick_a_store_outside_their_permissions(self):
        sent = self._send({self.item_1: 1})
        self.assertEqual(sent.get(DESTINATION_FIELD), self.store_b)

    def test_destination_is_dropped_from_entries_that_are_not_sent_to_transit(self):
        doc = self._entry(self.store_a, self.store_c, {self.item_1: 1}, destination=self.store_b, add_to_transit=0)
        doc.insert()
        self.assertFalse(doc.get(DESTINATION_FIELD))

    # --- share and notify

    def test_receivers_are_store_users_who_can_read_stock_entries(self):
        self.assertEqual(get_receivers(self.store_b, exclude={SENDER}), sorted([RECEIVER, REAL_STORE_USER, TWO_STORES]))

    def test_submit_shares_read_only_and_notifies_without_email(self):
        emails_before = frappe.db.count("Email Queue")
        sent = self._send({self.item_1: 2})
        frappe.set_user("Administrator")

        shares = frappe.get_all(
            "DocShare",
            filters={"share_doctype": "Stock Entry", "share_name": sent.name},
            fields=["user", "read", "write", "submit", "share"],
        )
        self.assertEqual(sorted(s.user for s in shares), sorted([RECEIVER, REAL_STORE_USER, TWO_STORES]))
        for share in shares:
            self.assertEqual((share.read, share.write, share.submit, share.share), (1, 0, 0, 0))

        bells = frappe.get_all(
            "Notification Log",
            filters={"document_type": "Stock Entry", "document_name": sent.name},
            fields=["for_user", "type", "subject"],
        )
        self.assertEqual(sorted(b.for_user for b in bells), sorted([RECEIVER, REAL_STORE_USER, TWO_STORES]))
        for bell in bells:
            self.assertEqual(bell.type, "Alert")
            self.assertIn(sent.name, bell.subject)
            self.assertIn(self.store_a, bell.subject)
        self.assertEqual(frappe.db.count("Email Queue"), emails_before)

    def test_email_only_when_site_config_switch_is_on(self):
        with patch("frappe.sendmail") as sendmail:
            self._send({self.item_1: 1})
            sendmail.assert_not_called()
            frappe.local.conf[EMAIL_CONFIG_KEY] = 1
            sent = self._send({self.item_1: 1})
        sendmail.assert_called_once()
        self.assertEqual(sendmail.call_args.kwargs["reference_name"], sent.name)
        self.assertEqual(sorted(sendmail.call_args.kwargs["recipients"]), sorted([RECEIVER, REAL_STORE_USER, TWO_STORES]))

    def test_email_failure_does_not_block_the_transfer(self):
        frappe.local.conf[EMAIL_CONFIG_KEY] = 1
        # log_error writes outside the test transaction, so it is patched out.
        with patch("frappe.sendmail", side_effect=frappe.OutgoingEmailError("no account")), patch("frappe.log_error") as log_error:
            sent = self._send({self.item_1: 1})
        self.assertEqual(sent.docstatus, 1)
        log_error.assert_called_once()

    def test_receiver_can_open_the_sent_entry_only_once_shared(self):
        sent = self._send({self.item_1: 1})
        doc = frappe.get_doc("Stock Entry", sent.name)
        self.assertTrue(frappe.has_permission("Stock Entry", "read", doc=doc, user=REAL_STORE_USER))
        self.assertFalse(frappe.has_permission("Stock Entry", "write", doc=doc, user=REAL_STORE_USER))
        self.assertFalse(frappe.has_permission("Stock Entry", "read", doc=doc, user=STORE_C))

    def test_warns_when_nobody_can_receive(self):
        frappe.local.message_log = []
        sent = self._send({self.item_1: 1}, destination=self.store_empty)
        messages = [m if isinstance(m, dict) else frappe.parse_json(m) for m in frappe.local.message_log]
        self.assertTrue(any("Nobody" in m.get("title", "") for m in messages))
        self.assertFalse(frappe.db.exists("DocShare", {"share_name": sent.name}))

    # --- receiving

    def test_real_store_user_without_company_permission_receives(self):
        sent = self._send({self.item_1: 3, self.item_2: 2})
        receipt = self._receive(sent, REAL_STORE_USER, self.store_b)
        self.assertEqual(receipt.docstatus, 1)
        self.assertEqual(frappe.db.get_value("Stock Entry", sent.name, "per_transferred"), 100)

    def test_receiving_into_another_store_names_the_expected_store(self):
        sent = self._send({self.item_1: 1})
        with self.assertRaisesRegex(frappe.ValidationError, f"must be received into.*{self.store_b}"):
            self._receive(sent, TWO_STORES, self.store_c)

    def test_partial_receipt_leaves_the_shortage_in_transit(self):
        sent = self._send({self.item_1: 3})
        transit_before = self._bin(self.item_1, self.transit)
        self._receive(sent, RECEIVER, self.store_b, qty=2)
        self.assertAlmostEqual(frappe.db.get_value("Stock Entry", sent.name, "per_transferred"), 66.667, places=2)
        self.assertEqual(self._bin(self.item_1, self.transit), transit_before - 2)

    def test_only_stock_manager_may_return_a_shortage_to_the_sender(self):
        sent = self._send({self.item_1: 2})
        self._receive(sent, RECEIVER, self.store_b, qty=1)
        with self.assertRaisesRegex(frappe.ValidationError, "must be received into"):
            self._receive(sent, SENDER, self.store_a)
        returned = self._receive(sent, STOCK_MANAGER, self.store_a)
        self.assertEqual(returned.docstatus, 1)
        with self.assertRaisesRegex(frappe.ValidationError, "must be received into"):
            self._receive(self._send({self.item_1: 1}), STOCK_MANAGER, self.store_c)

    def test_receiving_row_must_take_the_goods_from_transit_for_every_role(self):
        # Without this a row linked to the sent entry but taken from a store would mark
        # the transfer received while the goods never left transit.
        sent = self._send({self.item_1: 2})
        for user, source, target in (
            (SENDER, self.store_a, self.transit),
            (RECEIVER, self.store_b, self.transit),
            (STOCK_MANAGER, self.store_c, self.store_b),
        ):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "must take the goods from"):
                frappe.set_user(user)
                doc = make_stock_in_entry(sent.name)
                for row in doc.items:
                    row.s_warehouse, row.t_warehouse = source, target
                doc.insert()
        self.assertEqual(frappe.db.get_value("Stock Entry", sent.name, "per_transferred"), 0)

    def test_get_items_from_transit_entry_path_is_checked_the_same_way(self):
        sent = self._send({self.item_1: 2})
        frappe.set_user(RECEIVER)
        changed = make_stock_in_entry(sent.name, target_doc=frappe.new_doc("Stock Entry"))
        for row in changed.items:
            row.s_warehouse, row.t_warehouse = self.store_b, self.transit
        with self.assertRaisesRegex(frappe.ValidationError, "must take the goods from"):
            changed.insert()
        received = make_stock_in_entry(sent.name, target_doc=frappe.new_doc("Stock Entry"))
        for row in received.items:
            row.t_warehouse = self.store_b
        received.insert()
        received.submit()
        self.assertEqual(frappe.db.get_value("Stock Entry", sent.name, "per_transferred"), 100)

    def test_normal_end_transit_into_the_destination(self):
        sent = self._send({self.item_1: 2, self.item_2: 1})
        transit_before = self._bin(self.item_1, self.transit)
        receipt = self._receive(sent, RECEIVER, self.store_b)
        self.assertEqual(receipt.docstatus, 1)
        self.assertEqual(frappe.db.get_value("Stock Entry", sent.name, "per_transferred"), 100)
        self.assertEqual(self._bin(self.item_1, self.transit), transit_before - 2)

    def test_forged_link_to_another_sent_row_is_rejected(self):
        sent = self._send({self.item_1: 1, self.item_2: 1})
        frappe.set_user(TWO_STORES)
        doc = make_stock_in_entry(sent.name)
        doc.items[0].ste_detail = sent.items[1].name  # item 1 row claiming item 2's sent row
        for row in doc.items:
            row.t_warehouse = self.store_b
        with self.assertRaisesRegex(frappe.ValidationError, "End Transit"):
            doc.insert()

    def test_entries_sent_before_destination_store_keep_erpnext_behaviour(self):
        sent = self._send({self.item_1: 1})
        frappe.db.set_value("Stock Entry", sent.name, DESTINATION_FIELD, None)
        receipt = self._receive(sent, TWO_STORES, self.store_c)
        self.assertEqual(receipt.docstatus, 1)

    # --- stock leaving transit any other way

    def test_plain_transfer_out_of_transit_is_blocked_for_every_role_but_a_manager_write_off(self):
        self._send({self.item_1: 4})
        for user in (RECEIVER, REAL_STORE_USER, TWO_STORES, STOCK_MANAGER):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "End Transit"):
                frappe.set_user(user)
                self._entry(self.transit, self.store_b, {self.item_1: 1}, destination=None, add_to_transit=0).insert()
        for user in (RECEIVER, REAL_STORE_USER, TWO_STORES):
            with self.subTest(user=user, purpose="Material Issue"), self.assertRaisesRegex(frappe.ValidationError, "End Transit"):
                frappe.set_user(user)
                self._issue(self.transit, {self.item_1: 1}).insert()
        frappe.set_user(STOCK_MANAGER)
        written_off = self._issue(self.transit, {self.item_1: 1})
        written_off.insert()
        written_off.submit()
        self.assertEqual(written_off.docstatus, 1)

    # --- Incoming Transfers report

    def test_report_lists_open_transfers_for_the_users_own_store_only(self):
        open_b = self._send({self.item_1: 2})
        done_b = self._send({self.item_1: 1})
        self._receive(done_b, RECEIVER, self.store_b)
        open_c = self._send({self.item_1: 1}, destination=self.store_c)

        self.assertEqual(self._report_names(REAL_STORE_USER) & {open_b.name, done_b.name, open_c.name}, {open_b.name})
        self.assertEqual(self._report_names(STORE_C) & {open_b.name, open_c.name}, {open_c.name})
        self.assertEqual(self._report_names(STORE_C, destination_store=self.store_b), set())
        self.assertEqual(self._report_names(STOCK_MANAGER) & {open_b.name, open_c.name}, {open_b.name, open_c.name})

    def test_report_store_choices_leave_out_the_transit_warehouse(self):
        frappe.set_user(REAL_STORE_USER)
        self.assertEqual(get_destination_stores(), [self.store_b])

    # --- selling or delivering from transit

    def test_delivery_note_from_transit_is_refused_for_everyone(self):
        self._send({self.item_1: 2})
        for user in (REAL_STORE_USER, STOCK_MANAGER, "Administrator"):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
                frappe.set_user(user)
                self._sale("Delivery Note", self.transit).insert()

    def test_sales_invoice_with_update_stock_from_transit_is_refused_for_everyone(self):
        self._send({self.item_1: 2})
        for user in (REAL_STORE_USER, STOCK_AND_ACCOUNTS_MANAGER, "Administrator"):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
                frappe.set_user(user)
                self._sale("Sales Invoice", self.transit, update_stock=1).insert()

    def test_pos_invoice_and_packed_items_from_transit_are_refused(self):
        pos = frappe.get_doc({"doctype": "POS Invoice", "items": [{"idx": 1, "item_code": self.item_1, "warehouse": self.transit}]})
        with self.assertRaisesRegex(frappe.ValidationError, "Row 1"):
            validate_no_stock_out_of_transit(pos)
        bundle = frappe.get_doc(
            {
                "doctype": "Delivery Note",
                "items": [{"idx": 1, "item_code": self.item_1, "warehouse": self.store_a}],
                "packed_items": [{"idx": 1, "item_code": self.item_2, "warehouse": self.transit}],
            }
        )
        with self.assertRaisesRegex(frappe.ValidationError, "Packed Items row 1"):
            validate_no_stock_out_of_transit(bundle)

    def test_returns_and_invoices_that_move_no_stock_are_not_checked(self):
        for doc in (
            frappe.get_doc({"doctype": "POS Invoice", "is_return": 1, "items": [{"item_code": self.item_1, "warehouse": self.transit}]}),
            frappe.get_doc({"doctype": "Delivery Note", "is_return": 1, "items": [{"item_code": self.item_1, "warehouse": self.transit}]}),
            frappe.get_doc({"doctype": "Sales Invoice", "update_stock": 0, "items": [{"item_code": self.item_1, "warehouse": self.transit}]}),
        ):
            with self.subTest(doctype=doc.doctype):
                validate_no_stock_out_of_transit(doc)

    def test_normal_sales_from_a_store_still_work(self):
        frappe.set_user(REAL_STORE_USER)
        invoice = self._sale("Sales Invoice", self.store_b, update_stock=1, rows=40)
        invoice.insert()
        frappe.set_user(SENDER)
        note = self._sale("Delivery Note", self.store_a)
        note.insert()
        self.assertTrue(invoice.name and note.name)

    def test_purchase_receipt_into_transit_is_allowed_but_its_return_is_refused(self):
        frappe.set_user(REAL_STORE_USER)
        receipt = self._purchase("Purchase Receipt", self.transit)
        receipt.insert()
        receipt.submit()
        for user in (REAL_STORE_USER, "Administrator"):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
                frappe.set_user(user)
                self._purchase("Purchase Receipt", self.transit, return_against=receipt.name).insert()

    def test_purchase_invoice_return_with_update_stock_from_transit_is_refused(self):
        frappe.set_user("Administrator")
        invoice = self._purchase("Purchase Invoice", self.transit, update_stock=1)
        invoice.insert()
        invoice.submit()
        for user in (REAL_STORE_USER, "Administrator"):
            with self.subTest(user=user), self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
                frappe.set_user(user)
                self._purchase("Purchase Invoice", self.transit, update_stock=1, return_against=invoice.name).insert()

    def test_every_field_that_takes_stock_out_of_transit_is_checked(self):
        t, store = self.transit, self.store_a
        cases = {
            "internal transfer return, Target Warehouse": {"doctype": "Delivery Note", "is_return": 1, "items": [{"idx": 1, "warehouse": store, "target_warehouse": t}]},
            "Purchase Receipt return, Rejected Warehouse": {"doctype": "Purchase Receipt", "is_return": 1, "items": [{"idx": 1, "warehouse": store, "rejected_warehouse": t}]},
            "internal transfer receipt, From Warehouse": {"doctype": "Purchase Receipt", "items": [{"idx": 1, "warehouse": store, "from_warehouse": t}]},
            "Subcontracting Receipt, Supplier Warehouse": {"doctype": "Subcontracting Receipt", "supplier_warehouse": t, "items": [{"idx": 1, "warehouse": store}], "supplied_items": [{"idx": 1, "rm_item_code": self.item_2}]},
            "Subcontracting Receipt return": {"doctype": "Subcontracting Receipt", "is_return": 1, "items": [{"idx": 1, "warehouse": t}]},
            "Stock Reservation Entry": {"doctype": "Stock Reservation Entry", "warehouse": t},
            "Stock Reconciliation": {"doctype": "Stock Reconciliation", "items": [{"idx": 1, "warehouse": store}, {"idx": 2, "warehouse": t}]},
            "Asset Capitalization": {"doctype": "Asset Capitalization", "stock_items": [{"idx": 1, "warehouse": t}]},
        }
        for case, values in cases.items():
            with self.subTest(case=case), self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
                validate_no_stock_out_of_transit(frappe.get_doc(values))

    def test_stock_reconciliation_on_transit_is_refused_even_for_a_stock_manager(self):
        frappe.set_user(STOCK_MANAGER)
        doc = frappe.new_doc("Stock Reconciliation")
        doc.update({"company": self.company, "purpose": "Stock Reconciliation"})
        doc.append("items", {"item_code": self.item_1, "warehouse": self.transit, "qty": 0, "valuation_rate": 10})
        with self.assertRaisesRegex(frappe.ValidationError, "transit warehouse"):
            doc.insert()

    def test_stock_coming_into_transit_is_not_refused(self):
        t, store = self.transit, self.store_a
        for values in (
            {"doctype": "Purchase Receipt", "items": [{"idx": 1, "warehouse": t, "rejected_warehouse": t}]},
            {"doctype": "Purchase Receipt", "is_return": 1, "items": [{"idx": 1, "warehouse": store, "from_warehouse": t}]},
            {"doctype": "Purchase Invoice", "update_stock": 0, "is_return": 1, "items": [{"idx": 1, "warehouse": t}]},
            {"doctype": "Delivery Note", "items": [{"idx": 1, "warehouse": store, "target_warehouse": t}]},
            {"doctype": "Subcontracting Receipt", "supplier_warehouse": t, "items": [{"idx": 1, "warehouse": store}]},
        ):
            with self.subTest(values=values):
                validate_no_stock_out_of_transit(frappe.get_doc(values))

    def test_block_runs_after_the_existing_invoice_hooks(self):
        events = frappe.get_hooks("doc_events")
        for doctype in ("Sales Invoice", "POS Invoice"):
            validate = events[doctype]["validate"]
            self.assertIn("posawesome.posawesome.api.invoice.validate", validate)
            self.assertLess(
                validate.index("posawesome.posawesome.api.invoice.validate"),
                validate.index("posawesome.posawesome.api.stock_transit.validate_no_stock_out_of_transit"),
            )
        for doctype in (
            "Delivery Note",
            "Purchase Receipt",
            "Purchase Invoice",
            "Subcontracting Receipt",
            "Stock Reservation Entry",
            "Stock Reconciliation",
            "Asset Capitalization",
        ):
            self.assertIn("posawesome.posawesome.api.stock_transit.validate_no_stock_out_of_transit", events[doctype]["validate"])

    # --- helpers

    def _purchase(self, doctype, warehouse, update_stock=None, return_against=None):
        currency = frappe.get_cached_value("Company", self.company, "default_currency")
        doc = frappe.new_doc(doctype)
        doc.update(
            {
                "company": self.company,
                "supplier": self.supplier,
                "set_warehouse": warehouse,
                "currency": currency,
                "conversion_rate": 1,
                "price_list_currency": currency,
                "plc_conversion_rate": 1,
                "ignore_pricing_rule": 1,
            }
        )
        if update_stock is not None:
            doc.update_stock = update_stock
        if return_against:
            doc.update({"is_return": 1, "return_against": return_against})
        doc.append(
            "items", {"item_code": self.item_2, "qty": -1 if return_against else 1, "rate": 10, "warehouse": warehouse}
        )
        return doc

    def _sale(self, doctype, warehouse, update_stock=None, rows=1):
        doc = frappe.new_doc(doctype)
        currency = frappe.get_cached_value("Company", self.company, "default_currency")
        doc.update(
            {
                "company": self.company,
                "customer": self.customer,
                "set_warehouse": warehouse,
                # Rates set so the sale doesn't depend on staging's exchange-rate records.
                "currency": currency,
                "conversion_rate": 1,
                "price_list_currency": currency,
                "plc_conversion_rate": 1,
                "ignore_pricing_rule": 1,
            }
        )
        if update_stock is not None:
            doc.update_stock = update_stock
        for _row in range(rows):
            doc.append("items", {"item_code": self.item_1, "qty": 1, "rate": 20, "warehouse": warehouse})
        return doc

    def _send(self, items, destination="__default__"):
        frappe.set_user(SENDER)
        destination = self.store_b if destination == "__default__" else destination
        doc = self._entry(self.store_a, self.transit, items, destination=destination)
        doc.insert()
        doc.submit()
        return doc

    def _receive(self, sent, user, store, qty=None):
        frappe.set_user(user)
        doc = make_stock_in_entry(sent.name)
        for row in doc.items:
            row.t_warehouse = store
            if qty is not None:
                row.qty = qty
        doc.insert()
        doc.submit()
        return doc

    def _entry(self, source, target, items, destination, add_to_transit=1):
        doc = frappe.new_doc("Stock Entry")
        doc.update(
            {
                "stock_entry_type": "Material Transfer",
                "company": self.company,
                "add_to_transit": add_to_transit,
                "from_warehouse": source,
                "to_warehouse": target,
                DESTINATION_FIELD: destination,
            }
        )
        for item_code, qty in items.items():
            doc.append("items", {"item_code": item_code, "qty": qty, "s_warehouse": source, "t_warehouse": target})
        return doc

    def _issue(self, source, items):
        doc = frappe.new_doc("Stock Entry")
        doc.update({"stock_entry_type": "Material Issue", "company": self.company, "from_warehouse": source})
        for item_code, qty in items.items():
            doc.append("items", {"item_code": item_code, "qty": qty, "s_warehouse": source})
        return doc

    def _report_names(self, user, **filters):
        frappe.set_user(user)
        result = run(REPORT, filters=filters)
        return {row["name"] for row in result["result"]}

    def _bin(self, item_code, warehouse):
        return frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0

    @classmethod
    def _warehouse(cls, name, is_group=0, warehouse_type=None):
        abbr = frappe.get_cached_value("Company", cls.company, "abbr")
        full = f"{PREFIX} {name} - {abbr}"
        if not frappe.db.exists("Warehouse", full):
            frappe.get_doc(
                {
                    "doctype": "Warehouse",
                    "warehouse_name": f"{PREFIX} {name}",
                    "company": cls.company,
                    "is_group": is_group,
                    "warehouse_type": warehouse_type,
                }
            ).insert()
        return full

    @classmethod
    def _item(cls, code):
        if not frappe.db.exists("Item", code):
            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": code,
                    "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
                    "stock_uom": "Nos",
                    "is_stock_item": 1,
                    "valuation_rate": 10,
                }
            ).insert()
        return code

    @classmethod
    def _customer(cls, name):
        if not frappe.db.exists("Customer", name):
            frappe.get_doc(
                {
                    "doctype": "Customer",
                    "customer_name": name,
                    "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                    "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
                    "default_currency": frappe.get_cached_value("Company", cls.company, "default_currency"),
                }
            ).insert()
        return name

    @classmethod
    def _supplier(cls, name):
        if not frappe.db.exists("Supplier", name):
            frappe.get_doc(
                {
                    "doctype": "Supplier",
                    "supplier_name": name,
                    "supplier_group": frappe.db.get_value("Supplier Group", {"is_group": 0}, "name"),
                    "default_currency": frappe.get_cached_value("Company", cls.company, "default_currency"),
                }
            ).insert()
        return name

    @classmethod
    def _receive_stock(cls, warehouse, qty):
        doc = frappe.new_doc("Stock Entry")
        doc.update({"stock_entry_type": "Material Receipt", "company": cls.company, "to_warehouse": warehouse})
        for item_code in (cls.item_1, cls.item_2):
            doc.append("items", {"item_code": item_code, "qty": qty, "t_warehouse": warehouse, "basic_rate": 10})
        doc.insert()
        doc.submit()

    @classmethod
    def _user(cls, email, roles, warehouses, applicable_for=None, pos_profile=None):
        if not frappe.db.exists("User", email):
            frappe.get_doc(
                {"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0}
            ).insert()
        frappe.get_doc("User", email).add_roles(*roles)
        for warehouse in warehouses:
            cls._user_permission(email, "Warehouse", warehouse, applicable_for)
        if pos_profile:
            cls._user_permission(email, "POS Profile", pos_profile)

    @staticmethod
    def _user_permission(user, allow, value, applicable_for=None):
        frappe.get_doc(
            {
                "doctype": "User Permission",
                "user": user,
                "allow": allow,
                "for_value": value,
                "apply_to_all_doctypes": 0 if applicable_for else 1,
                "applicable_for": applicable_for,
            }
        ).insert()
