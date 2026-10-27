from unittest.mock import patch

import frappe
from erpnext.stock.doctype.item_attribute.item_attribute import ItemAttribute
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.item_attribute_bulk import (
    MAX_LINES,
    MAX_TEXT_LENGTH,
    SHOWN_REJECTED_LENGTH,
    add_bulk_attribute_values,
    classify_lines,
    normalize_value,
    preview_bulk_attribute_values,
)

ATTRIBUTE = "_Test Bulk Attr"
NUMERIC_ATTRIBUTE = "_Test Bulk Attr Numeric"
STOCK_USER = "iab-stock-user@test.invalid"
SYSTEM_MANAGER = "iab-system-manager@test.invalid"
ITEM_MANAGER = "iab-item-manager@test.invalid"

SEED = [("S", "S"), ("M", "M"), ("34 MM", "34 MM"), ("Extra Large", "XL")]


class TestItemAttributeBulkAdd(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        for email, role in (
            (STOCK_USER, "Stock User"),
            (SYSTEM_MANAGER, "System Manager"),
            (ITEM_MANAGER, "Item Manager"),
        ):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": email,
                    "first_name": email.split("@")[0],
                    "send_welcome_email": 0,
                    "roles": [{"role": role}],
                }
            ).insert(ignore_permissions=True)
        frappe.get_doc(
            {
                "doctype": "Item Attribute",
                "attribute_name": NUMERIC_ATTRIBUTE,
                "numeric_values": 1,
                "from_range": 1,
                "to_range": 10,
                "increment": 1,
            }
        ).insert()

    def setUp(self):
        frappe.set_user("Administrator")
        if frappe.db.exists("Item Attribute", ATTRIBUTE):
            frappe.delete_doc("Item Attribute", ATTRIBUTE, force=1)
        frappe.get_doc(
            {
                "doctype": "Item Attribute",
                "attribute_name": ATTRIBUTE,
                "item_attribute_values": [{"attribute_value": v, "abbr": a} for v, a in SEED],
            }
        ).insert()

    def tearDown(self):
        frappe.set_user("Administrator")

    # -- helpers --------------------------------------------------------------

    def _rows(self):
        return frappe.get_all(
            "Item Attribute Value",
            filters={"parent": ATTRIBUTE, "parenttype": "Item Attribute"},
            # Not "modified": doc.save() rewrites every child row, as the form's Save does.
            fields=["name", "idx", "attribute_value", "abbr"],
            order_by="idx asc",
        )

    def _values(self):
        return [r.attribute_value for r in self._rows()]

    def _version_count(self):
        return frappe.db.count("Version", {"ref_doctype": "Item Attribute", "docname": ATTRIBUTE})

    # -- normalization --------------------------------------------------------

    def test_normalize_keeps_case_and_punctuation(self):
        self.assertEqual(normalize_value("  2B "), "2B")
        self.assertEqual(normalize_value(" V-XL"), "V-XL")
        self.assertEqual(normalize_value("ONE   SIZE-OVER"), "ONE SIZE-OVER")
        self.assertEqual(normalize_value("S/M"), "S/M")
        self.assertEqual(normalize_value("\xa034\xa0\xa0MM\xa0"), "34 MM")
        self.assertEqual(normalize_value("navy Blue"), "navy Blue")

    def test_leading_and_trailing_spaces_are_trimmed_on_add(self):
        result = add_bulk_attribute_values(ATTRIBUTE, "  2B \n V-XL\n")
        self.assertEqual(result["to_add"], ["2B", "V-XL"])
        rows = {r.attribute_value: r.abbr for r in self._rows()}
        self.assertEqual(rows["2B"], "2B")
        self.assertEqual(rows["V-XL"], "V-XL")

    # -- preview --------------------------------------------------------------

    def test_preview_changes_nothing(self):
        before, versions = self._rows(), self._version_count()
        result = preview_bulk_attribute_values(ATTRIBUTE, "NEW1\nNEW2\ns\n\nNEW1\nX\tY")
        self.assertEqual(result["to_add"], ["NEW1", "NEW2"])
        self.assertEqual(result["existing"], ["s"])
        self.assertEqual(result["duplicates"], [{"line": 5, "value": "NEW1"}])
        self.assertEqual([r["line"] for r in result["rejected"]], [4, 6])
        self.assertEqual(self._rows(), before)
        self.assertEqual(self._version_count(), versions)

    def test_rejected_lines(self):
        result = classify_lines(" \n" + "A" * 141 + "\n" + "B" * 140 + "\nRED\tBLUE\n\xa0", [])
        self.assertEqual(result["to_add"], ["B" * 140])
        self.assertEqual([r["line"] for r in result["rejected"]], [1, 2, 4, 5])
        self.assertIn("tab", result["rejected"][2]["reason"])

    def test_oversized_text_refused_and_long_lines_shown_cut(self):
        with self.assertRaises(frappe.ValidationError):
            preview_bulk_attribute_values(ATTRIBUTE, "A" * (MAX_TEXT_LENGTH + 1))
        result = classify_lines("Z" * 5000, [])
        self.assertEqual(len(result["rejected"][0]["value"]), SHOWN_REJECTED_LENGTH)

    def test_single_trailing_newline_is_not_a_rejected_line(self):
        result = classify_lines("A\r\nB\r\n", [])
        self.assertEqual(result["total_lines"], 2)
        self.assertEqual(result["rejected"], [])

    # -- skip rules -----------------------------------------------------------

    def test_existing_values_skipped_case_insensitively(self):
        result = add_bulk_attribute_values(ATTRIBUTE, "s\nm\n34 mm\n  EXTRA   large \nL")
        self.assertEqual(result["to_add"], ["L"])
        self.assertEqual(result["existing"], ["s", "m", "34 mm", "EXTRA large"])
        self.assertEqual(self._values(), ["S", "M", "34 MM", "Extra Large", "L"])

    def test_duplicates_inside_paste_collapsed(self):
        result = add_bulk_attribute_values(ATTRIBUTE, "Navy\nNAVY\n navy \nRed\nNavy")
        self.assertEqual(result["to_add"], ["Navy", "Red"])
        self.assertEqual([d["line"] for d in result["duplicates"]], [2, 3, 5])
        self.assertEqual(self._values()[-2:], ["Navy", "Red"])

    def test_abbr_clash_skipped_and_reported(self):
        result = add_bulk_attribute_values(ATTRIBUTE, "xl\nXXL")
        self.assertEqual(result["to_add"], ["XXL"])
        self.assertEqual(
            result["abbr_clashes"], [{"value": "xl", "abbr": "XL", "existing_value": "Extra Large"}]
        )
        self.assertNotIn("xl", self._values())

    # -- safety ---------------------------------------------------------------

    def test_existing_rows_untouched(self):
        before = self._rows()
        add_bulk_attribute_values(ATTRIBUTE, "S\nNEW-A\nm\nNEW-B")
        after = self._rows()
        self.assertEqual(len(after), len(before) + 2)
        self.assertEqual(after[: len(before)], before)
        self.assertEqual(
            [(r.attribute_value, r.abbr) for r in after[len(before) :]],
            [("NEW-A", "NEW-A"), ("NEW-B", "NEW-B")],
        )

    def test_second_run_adds_nothing(self):
        text = "Alpha\nBeta\nGamma"
        first = add_bulk_attribute_values(ATTRIBUTE, text)
        rows, versions = self._rows(), self._version_count()
        second = add_bulk_attribute_values(ATTRIBUTE, text)
        self.assertEqual(first["added"], 3)
        self.assertEqual(second["added"], 0)
        self.assertEqual(second["already_existed"], 3)
        self.assertEqual(self._rows(), rows)
        self.assertEqual(self._version_count(), versions)

    def test_add_records_one_version(self):
        versions = self._version_count()
        # Frappe skips Version rows while tests run; switch that off to see the real save.
        with patch.object(frappe, "in_test", False):
            add_bulk_attribute_values(ATTRIBUTE, "V1\nV2")
        self.assertEqual(self._version_count(), versions + 1)
        version = frappe.get_last_doc(
            "Version", filters={"ref_doctype": "Item Attribute", "docname": ATTRIBUTE}
        )
        added = [row[1]["attribute_value"] for row in frappe.parse_json(version.data)["added"]]
        self.assertEqual(added, ["V1", "V2"])

    def test_failed_save_adds_nothing(self):
        before, versions = self._rows(), self._version_count()
        with patch.object(ItemAttribute, "on_update", side_effect=frappe.ValidationError("boom")):
            with self.assertRaises(frappe.ValidationError):
                add_bulk_attribute_values(ATTRIBUTE, "FAIL-1\nFAIL-2")
        self.assertEqual(self._rows(), before)
        self.assertEqual(self._version_count(), versions)

    def test_numeric_attribute_refused(self):
        for method in (preview_bulk_attribute_values, add_bulk_attribute_values):
            with self.assertRaises(frappe.ValidationError):
                method(NUMERIC_ATTRIBUTE, "1\n2")
        self.assertEqual(frappe.db.count("Item Attribute Value", {"parent": NUMERIC_ATTRIBUTE}), 0)

    def test_line_cap(self):
        too_many = "\n".join(f"CAP-{i}" for i in range(MAX_LINES + 1))
        before = self._rows()
        for method in (preview_bulk_attribute_values, add_bulk_attribute_values):
            with self.assertRaises(frappe.ValidationError):
                method(ATTRIBUTE, too_many)
        self.assertEqual(self._rows(), before)

        at_cap = "\n".join(f"CAP-{i}" for i in range(MAX_LINES))
        result = add_bulk_attribute_values(ATTRIBUTE, at_cap)
        self.assertEqual(result["added"], MAX_LINES)
        self.assertEqual(len(self._rows()), len(before) + MAX_LINES)

    # -- permissions ----------------------------------------------------------

    def test_users_without_write_are_refused(self):
        before = self._rows()
        # System Manager has no permission on Item Attribute on this site; only Item Manager does.
        for user in (STOCK_USER, SYSTEM_MANAGER):
            frappe.set_user(user)
            for method in (preview_bulk_attribute_values, add_bulk_attribute_values):
                with self.assertRaises(frappe.PermissionError):
                    method(ATTRIBUTE, "PERM-1")
        frappe.set_user("Administrator")
        self.assertEqual(self._rows(), before)

    def test_item_manager_can_add(self):
        frappe.set_user(ITEM_MANAGER)
        result = add_bulk_attribute_values(ATTRIBUTE, "IM-1")
        frappe.set_user("Administrator")
        self.assertEqual(result["added"], 1)
        self.assertIn("IM-1", self._values())

    def test_non_text_input_refused(self):
        with self.assertRaises(frappe.ValidationError):
            add_bulk_attribute_values(ATTRIBUTE, ["A", "B"])
