import json
import pathlib
import unittest
from unittest.mock import patch

import frappe

from posawesome import hooks
from posawesome.posawesome.api import discount_reasons as reasons
from posawesome.posawesome.api import invoice

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "posawesome" / "fixtures"
CREATION_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing" / "creation.py"
NEW_FIELDS = (
    "Sales Invoice Item-posa_discount_reason",
    "POS Invoice Item-posa_discount_reason",
    "POS Profile-posa_require_discount_reason",
)
REMOVED_NOTE_FIELDS = (
    "Sales Invoice Item-posa_discount_reason_note",
    "POS Invoice Item-posa_discount_reason_note",
)


class FakeRow(frappe._dict):
    def set(self, key, value):
        self[key] = value


class FakeDoc(frappe._dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _doc(items, docstatus=0, is_return=0, doctype="Sales Invoice", pos_profile="Test Pos"):
    return FakeDoc(
        doctype=doctype,
        docstatus=docstatus,
        is_return=is_return,
        is_pos=1 if pos_profile else 0,
        pos_profile=pos_profile,
        items=[FakeRow(row) for row in items],
    )


def _lines():
    return [
        {"item_code": "A", "discount_percentage": 10, "discount_amount": 5},
        {"item_code": "B", "discount_percentage": 10, "discount_amount": 5, "posa_discount_reason": "Mastercard"},
        {"item_code": "C", "discount_percentage": 0, "discount_amount": 0, "posa_discount_reason": "Staff"},
        {"item_code": "D", "discount_percentage": 100, "discount_amount": 9, "is_free_item": 1},
        {"item_code": "E", "discount_percentage": 10, "discount_amount": 5, "posa_offer_applied": 1},
        {"item_code": "F", "discount_percentage": 5, "discount_amount": 1,
         "posa_discount_reason": "Other / General"},
    ]


class TestApplyDiscountReasons(unittest.TestCase):
    def setUp(self):
        # The store's "Ask for a discount reason" switch is on for these cases.
        switch = patch.object(reasons.frappe, "get_cached_value", return_value=1)
        self.get_cached_value = switch.start()
        self.addCleanup(switch.stop)

    def test_reads_the_switch_from_the_invoices_own_pos_profile(self):
        reasons.apply_discount_reasons(_doc(_lines(), docstatus=1, pos_profile="Store 7"))
        self.get_cached_value.assert_called_with("POS Profile", "Store 7", "posa_require_discount_reason")

    def test_draft_keeps_a_missing_reason_blank_so_the_till_still_asks(self):
        doc = _doc(_lines(), docstatus=0)
        reasons.apply_discount_reasons(doc)
        got = {row.item_code: row.get("posa_discount_reason") for row in doc["items"]}
        self.assertEqual(
            got, {"A": None, "B": "Mastercard", "C": None, "D": None, "E": None, "F": "Other / General"}
        )

    def test_submit_marks_a_missing_reason_not_recorded_and_never_rejects(self):
        doc = _doc(_lines(), docstatus=1)
        reasons.apply_discount_reasons(doc)
        got = {row.item_code: row.get("posa_discount_reason") for row in doc["items"]}
        self.assertEqual(got["A"], reasons.NOT_RECORDED)
        self.assertEqual(got["B"], "Mastercard")
        # Undiscounted, free and offer lines carry no reason at all.
        self.assertIsNone(got["C"])
        self.assertIsNone(got["D"])
        self.assertIsNone(got["E"])

    def test_nothing_reads_or_writes_a_note_any_more(self):
        doc = _doc(_lines(), docstatus=1)
        reasons.apply_discount_reasons(doc)
        for row in doc["items"]:
            self.assertNotIn("posa_discount_reason_note", row)
        self.assertFalse(hasattr(reasons, "NOTE_FIELD"))

    def test_non_pos_desk_invoices_are_left_alone(self):
        doc = _doc([{"item_code": "A", "discount_percentage": 10, "discount_amount": 5}], docstatus=1,
                   pos_profile=None)
        reasons.apply_discount_reasons(doc)
        self.assertNotIn("posa_discount_reason", doc["items"][0])

    def test_returns_copy_the_original_lines_reason_not_the_clients(self):
        doc = _doc(
            [
                {"item_code": "A", "discount_percentage": 10, "discount_amount": 5,
                 "sales_invoice_item": "ORIG-1", "posa_discount_reason": "Staff"},
                {"item_code": "B", "discount_percentage": 10, "discount_amount": 5},
            ],
            docstatus=1,
            is_return=1,
        )
        originals = [frappe._dict(name="ORIG-1", posa_discount_reason="Damaged item")]
        with patch.object(reasons.frappe, "get_all", return_value=originals) as get_all:
            reasons.apply_discount_reasons(doc)
        self.assertEqual(get_all.call_args.args[0], "Sales Invoice Item")
        self.assertEqual(doc["items"][0].posa_discount_reason, "Damaged item")
        self.assertEqual(get_all.call_args.kwargs["fields"], ["name", "posa_discount_reason"])
        # A return line without an original is never marked "Not recorded".
        self.assertIsNone(doc["items"][1].get("posa_discount_reason"))

    def test_pos_invoice_returns_use_pos_invoice_item(self):
        doc = _doc([{"item_code": "A", "pos_invoice_item": "ORIG-1"}], is_return=1, doctype="POS Invoice")
        with patch.object(reasons.frappe, "get_all", return_value=[]) as get_all:
            reasons.apply_discount_reasons(doc)
        self.assertEqual(get_all.call_args.args[0], "POS Invoice Item")


class TestSwitchOff(unittest.TestCase):
    """Switch off (the default): invoices are saved exactly as before."""

    def setUp(self):
        switch = patch.object(reasons.frappe, "get_cached_value", return_value=0)
        switch.start()
        self.addCleanup(switch.stop)

    def test_submit_leaves_every_line_untouched(self):
        lines = _lines()
        doc = _doc(lines, docstatus=1)
        reasons.apply_discount_reasons(doc)
        for row, original in zip(doc["items"], lines):
            self.assertEqual(dict(row), original)

    def test_returns_are_not_touched_either(self):
        doc = _doc([{"item_code": "A", "sales_invoice_item": "ORIG-1"}], docstatus=1, is_return=1)
        with patch.object(reasons.frappe, "get_all") as get_all:
            reasons.apply_discount_reasons(doc)
        get_all.assert_not_called()
        self.assertNotIn("posa_discount_reason", doc["items"][0])


class TestSanitizePayload(unittest.TestCase):
    def test_unknown_reasons_become_not_recorded_before_link_validation(self):
        payload = {
            "items": [
                {"posa_discount_reason": "Mastercard"},
                {"posa_discount_reason": "Deleted Reason"},
                {"posa_discount_reason": "  "},
                {"posa_discount_reason": "Other / General"},
                {},
            ]
        }
        with patch.object(
            reasons.frappe.db, "exists", side_effect=lambda dt, name: name in {"Mastercard", "Other / General"}
        ):
            reasons.sanitize_discount_reason_payload(payload)
        items = payload["items"]
        self.assertEqual(items[0]["posa_discount_reason"], "Mastercard")
        self.assertEqual(items[1]["posa_discount_reason"], reasons.NOT_RECORDED)
        self.assertIsNone(items[2]["posa_discount_reason"])
        self.assertEqual(items[3]["posa_discount_reason"], "Other / General")

    def test_ignores_payloads_without_items(self):
        for payload in (None, {}, {"items": "x"}):
            reasons.sanitize_discount_reason_payload(payload)


class TestReasonDoctypeAndSeeds(unittest.TestCase):
    def test_doctype_is_pick_only_and_renamable(self):
        meta_path = REPO_ROOT / "posawesome" / "posawesome" / "doctype" / "pos_discount_reason" / "pos_discount_reason.json"
        meta = json.loads(meta_path.read_text())
        self.assertEqual(meta["allow_rename"], 1)
        self.assertNotIn("requires_note", [f["fieldname"] for f in meta["fields"]])

    NEW_LIST = [
        "NBO Sadara",
        "NBO Infinite / Platinum",
        "OAB Elite / Infinite",
        "OAB Credit Card",
        "Bank Dhofar Al Riadah",
        "Bank Muscat Private Banking",
        "Bank Muscat Asalah",
        "Bank Muscat Al Jawhar",
        "Bank Muscat Oman Air Platinum",
        "WGO",
        "VIP",
        "H.H Family",
        "Sale",
        "Staff",
        "Damaged item",
        "Manager approval",
        "Other / General",
    ]

    def test_seeds_are_exactly_the_requested_pick_only_list(self):
        from posawesome.patches import seed_pos_discount_reasons as patch_module

        names = [row[0] for row in patch_module.STARTING_REASONS]
        self.assertEqual(names, self.NEW_LIST + [reasons.NOT_RECORDED])
        self.assertEqual([row[1] for row in patch_module.STARTING_REASONS][:17], list(range(1, 18)))
        self.assertTrue(all(len(row) == 2 for row in patch_module.STARTING_REASONS))
        self.assertFalse(any("discount" in name.lower() or "%" in name for name in names))
        # Every old "– xx%" name maps to one of the ten bank/WGO reasons.
        self.assertEqual(sorted(patch_module.PREVIOUS_NAMES), sorted(self.NEW_LIST[:10]))
        for new_name, old_name in patch_module.PREVIOUS_NAMES.items():
            self.assertTrue(old_name.startswith(new_name + " – ") and old_name.endswith("%"))

    def _run_seed(self, existing, used=()):
        from posawesome.patches import seed_pos_discount_reasons as patch_module

        inserted, deleted, renamed = [], [], []

        class FakeReason(frappe._dict):
            def insert(self, ignore_permissions=False):
                inserted.append(self.reason_name)
                existing.add(self.reason_name)
                return self

        def fake_rename(doctype, old, new, **kwargs):
            self.assertEqual(doctype, reasons.REASON_DOCTYPE)
            self.assertTrue(kwargs.get("ignore_permissions"))
            self.assertFalse(kwargs.get("merge"))
            renamed.append((old, new))
            existing.discard(old)
            existing.add(new)

        with patch.object(patch_module.frappe, "reload_doc"), patch.object(
            patch_module.frappe.db, "exists",
            side_effect=lambda dt, name: (name in existing) if dt == reasons.REASON_DOCTYPE
            else name.get("posa_discount_reason") in used,
        ), patch.object(patch_module.frappe.db, "has_column", return_value=True), patch.object(
            patch_module.frappe, "get_doc", side_effect=lambda d: FakeReason(d)
        ), patch.object(patch_module.rename_doc_module, "rename_doc", side_effect=fake_rename), patch.object(
            patch_module.frappe, "delete_doc", side_effect=lambda dt, name, **kw: (deleted.append(name), existing.discard(name))
        ):
            patch_module.execute()
        return inserted, deleted, renamed

    def test_rename_call_matches_the_real_frappe_function(self):
        import inspect

        from frappe.model.rename_doc import rename_doc
        from posawesome.patches import seed_pos_discount_reasons as patch_module

        # Binding fails if a keyword the patch passes doesn't exist (the
        # frappe.rename_doc wrapper, for one, has no ignore_permissions).
        inspect.signature(rename_doc).bind(**patch_module.rename_kwargs("WGO – 15%", "WGO"))

    def test_fresh_site_creates_the_new_names_directly(self):
        existing = set()
        inserted, deleted, renamed = self._run_seed(existing)
        self.assertEqual(inserted, self.NEW_LIST + [reasons.NOT_RECORDED])
        self.assertEqual((deleted, renamed), ([], []))
        self.assertEqual(self._run_seed(existing), ([], [], []))

    def test_site_with_old_percentage_names_renames_them_not_duplicates(self):
        from posawesome.patches import seed_pos_discount_reasons as patch_module

        old_names = set(patch_module.PREVIOUS_NAMES.values())
        existing = old_names | {"VIP", "H.H Family", "Sale", "Staff", "Damaged item", "Manager approval",
                                "Other / General", reasons.NOT_RECORDED}
        inserted, deleted, renamed = self._run_seed(existing)
        self.assertEqual(inserted, [])
        self.assertEqual(sorted(renamed), sorted((old, new) for new, old in patch_module.PREVIOUS_NAMES.items()))
        self.assertTrue(old_names.isdisjoint(existing))
        self.assertEqual(sorted(existing), sorted(self.NEW_LIST + [reasons.NOT_RECORDED]))
        # Second run: nothing created, renamed or re-created under an old name.
        self.assertEqual(self._run_seed(existing), ([], [], []))
        self.assertTrue(old_names.isdisjoint(existing))

    def test_already_renamed_by_hand_is_left_alone(self):
        existing = set(self.NEW_LIST) | {reasons.NOT_RECORDED}
        self.assertEqual(self._run_seed(existing), ([], [], []))

    def test_new_and_old_name_both_present_touches_neither(self):
        existing = set(self.NEW_LIST) | {reasons.NOT_RECORDED, "WGO – 15%"}
        self.assertEqual(self._run_seed(existing), ([], [], []))
        self.assertIn("WGO – 15%", existing)

    def test_seed_removes_unused_mastercard_only(self):
        existing = set(self.NEW_LIST) | {reasons.NOT_RECORDED, "Mastercard", "Hand Added"}
        self.assertEqual(self._run_seed(existing), ([], ["Mastercard"], []))
        self.assertIn("Hand Added", existing)

    def test_seed_keeps_mastercard_when_an_invoice_line_uses_it(self):
        existing = {"Mastercard"}
        inserted, deleted, _renamed = self._run_seed(existing, used=("Mastercard",))
        self.assertEqual(deleted, [])
        self.assertIn("Mastercard", existing)
        self.assertEqual(len(inserted), 18)

    def test_reason_names_with_the_word_discount_are_refused(self):
        from posawesome.posawesome.doctype.pos_discount_reason.pos_discount_reason import POSDiscountReason

        for bad in ("VIP Discount", "discount 10%", "Staff DISCOUNT"):
            doc = POSDiscountReason({"doctype": "POS Discount Reason", "reason_name": bad})
            with self.assertRaises(frappe.ValidationError):
                doc.validate()
        POSDiscountReason({"doctype": "POS Discount Reason", "reason_name": "Discounted-not-a-word VIP"}).validate()
        doc = POSDiscountReason({"doctype": "POS Discount Reason", "reason_name": "Staff"})
        with self.assertRaises(frappe.ValidationError):
            doc.before_rename("Staff", "Staff Discount")

    def test_not_recorded_cannot_be_renamed(self):
        from posawesome.posawesome.doctype.pos_discount_reason.pos_discount_reason import POSDiscountReason

        doc = POSDiscountReason({"doctype": "POS Discount Reason", "reason_name": "Staff"})
        for old, new in ((reasons.NOT_RECORDED, "X"), ("Staff", reasons.NOT_RECORDED)):
            with self.assertRaises(frappe.ValidationError):
                doc.before_rename(old, new)
        doc.before_rename("Other / General", "General")


class TestCashierReasonList(unittest.TestCase):
    def test_only_enabled_non_system_reasons_in_display_order(self):
        with patch.object(reasons.frappe, "get_all", return_value=[]) as get_all:
            reasons.get_cashier_discount_reasons()
        kwargs = get_all.call_args.kwargs
        self.assertEqual(get_all.call_args.args[0], "POS Discount Reason")
        self.assertEqual(kwargs["filters"], {"enabled": 1, "is_system": 0})
        self.assertEqual(kwargs["order_by"], "display_order asc, name asc")
        # Pick-only: no note flag is sent to the till.
        self.assertEqual(kwargs["fields"], ["name", "display_order"])


class TestWiring(unittest.TestCase):
    def test_invoice_validate_applies_discount_reasons(self):
        names = (
            "validate_shift",
            "validate_pos_invoice_item_sale_controls",
            "set_patient",
            "auto_set_delivery_charges",
            "calc_delivery_charges",
            "apply_tax_inclusive",
            "set_invoice_reporting_fields",
        )
        patches = [patch.object(invoice, name) for name in names]
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch.object(invoice, "apply_discount_reasons") as apply:
            doc = object()
            invoice.validate(doc, "validate")
        apply.assert_called_once_with(doc)

    def test_both_submit_endpoints_sanitize_the_payload(self):
        source = CREATION_PATH.read_text()
        update = source[source.index("def update_invoice(") : source.index("def ", source.index("def update_invoice(") + 10)]
        submit = source[source.index("def submit_invoice(") : source.index("def ", source.index("def submit_invoice(") + 10)]
        self.assertIn("sanitize_discount_reason_payload(data)", update)
        self.assertIn("sanitize_discount_reason_payload(invoice)", submit)

    def test_boot_data_carries_the_reason_list(self):
        from posawesome.posawesome.api import shifts

        source = pathlib.Path(shifts.__file__).read_text()
        body = source[source.index("def update_opening_shift_data(") :]
        self.assertIn('data["discount_reasons"] = get_cashier_discount_reasons()', body)

    def test_fixtures_define_and_export_the_new_fields(self):
        fields = {f["name"]: f for f in json.loads((FIXTURES / "custom_field.json").read_text())}
        exported = []
        for entry in hooks.fixtures:
            if entry["doctype"] == "Custom Field":
                exported.extend(n for f in entry["filters"] if f[0] == "name" and f[1] == "in" for n in f[2])
        for name in NEW_FIELDS:
            self.assertIn(name, fields)
            self.assertIn(name, exported)
        for name in REMOVED_NOTE_FIELDS:
            self.assertNotIn(name, fields)
            self.assertNotIn(name, exported)
        self.assertEqual(fields["Sales Invoice Item-posa_discount_reason"]["options"], "POS Discount Reason")
        self.assertEqual(fields["Sales Invoice Item-posa_discount_reason"]["insert_after"], "discount_amount")
        self.assertEqual(
            fields["POS Profile-posa_require_discount_reason"]["insert_after"],
            "posa_allow_user_to_edit_item_discount_amount",
        )


if __name__ == "__main__":
    unittest.main()
