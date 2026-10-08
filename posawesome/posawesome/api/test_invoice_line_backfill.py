import unittest
from unittest.mock import patch

import frappe

from posawesome.patches import backfill_invoice_line_reporting_fields as backfill


class FakeMeta:
    def __init__(self, fields):
        self.fields = set(fields)

    def has_field(self, fieldname):
        return fieldname in self.fields


class TestInvoiceLineBackfill(unittest.TestCase):
    def _run(self, item_fields=("custom_season", "custom_collection"), approximate=(), orphans=()):
        statements = []

        def fake_sql(query, values=None, as_dict=False, pluck=False, **kwargs):
            statements.append(" ".join(query.split()))
            if "SELECT DISTINCT sii.parent" in query:
                return list(approximate)
            if "LEFT JOIN `tabItem` item" in query:
                return [frappe._dict(item_code=code, line_count=count) for code, count in orphans]
            return []

        with patch.object(backfill, "_ensure_custom_fields"), patch.object(
            backfill.frappe.db, "sql", side_effect=fake_sql
        ), patch.object(backfill.frappe.db, "has_column", side_effect=lambda dt, col: col in item_fields), patch.object(
            backfill.frappe, "get_meta", return_value=FakeMeta(item_fields)
        ), patch.object(backfill.frappe, "log_error") as log_error, patch("builtins.print") as printed:
            backfill.execute()
        output = "\n".join(str(c.args[0]) for c in printed.call_args_list)
        return statements, log_error, output

    def test_copies_season_and_collection_skipping_blanks(self):
        statements, log_error, output = self._run()
        season = [s for s in statements if "posa_item_season" in s]
        collection = [s for s in statements if "posa_item_collection" in s]
        self.assertEqual(len(season), 1)
        self.assertEqual(len(collection), 1)
        for stmt, item_field in ((season[0], "custom_season"), (collection[0], "custom_collection")):
            # From the line's own Item, blanks never written, no placeholder.
            self.assertIn("JOIN `tabItem` item ON item.name = sii.item_code", stmt)
            self.assertIn(f"TRIM(IFNULL(item.`{item_field}`, '')) != ''", stmt)
            self.assertNotIn("variant_of", stmt)
            self.assertNotIn("N/A", stmt)
        log_error.assert_not_called()
        self.assertIn("nothing to review", output)

    def test_site_without_the_item_fields_skips_them_quietly(self):
        statements, log_error, output = self._run(item_fields=())
        self.assertFalse(any("posa_item_season" in s or "posa_item_collection" in s for s in statements))
        self.assertIn("Item has no custom_season / custom_collection field", output)
        log_error.assert_not_called()

    def test_deleted_custom_field_with_leftover_column_is_also_skipped(self):
        with patch.object(backfill.frappe.db, "has_column", return_value=True):
            statements, _log_error, _output = self._run(item_fields=())
        self.assertFalse(any("posa_item_season" in s for s in statements))

    def test_parent_style_from_variant_of(self):
        statements, _log_error, _output = self._run()
        self.assertTrue(any("SET sii.posa_item_variant_of = item.variant_of" in s for s in statements))

    def test_vat_copied_from_breakdown_excluding_actual_charges(self):
        statements, _log_error, _output = self._run()
        exact = [s for s in statements if "SET sii.posa_item_vat = breakdown.vat" in s]
        self.assertEqual(len(exact), 1)
        self.assertIn("t.charge_type != 'Actual'", exact[0])
        self.assertIn("`tabItem Wise Tax Detail`", exact[0])

    def test_only_real_problems_are_reported(self):
        _statements, log_error, output = self._run(approximate=("SINV-1",), orphans=(("GONE-1", 3),))
        log_error.assert_called_once()
        message = log_error.call_args.kwargs["message"]
        self.assertIn("SINV-1", message)
        self.assertIn("GONE-1: 3 line(s)", message)
        self.assertNotIn("blank", message.lower())
        self.assertIn("please review", output)


if __name__ == "__main__":
    unittest.main()
