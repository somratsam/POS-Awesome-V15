import json
import pathlib
import unittest

from posawesome import hooks


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES_PATH = REPO_ROOT / "posawesome" / "fixtures" / "custom_field.json"
FIELD_NAME = "Item-custom_description_arabic"


def _load_custom_field(name):
    fields = json.loads(FIXTURES_PATH.read_text())
    return next((field for field in fields if field.get("name") == name), None)


class TestItemDescriptionArabicField(unittest.TestCase):
    def test_fixture_matches_production_field(self):
        # Created by hand on production first; the "Swan Sales Invoice" print
        # format reads Item.custom_description_arabic, so the fieldname is load-bearing.
        field = _load_custom_field(FIELD_NAME)

        self.assertIsNotNone(field)
        self.assertEqual(field["dt"], "Item")
        self.assertEqual(field["fieldname"], "custom_description_arabic")
        self.assertEqual(field["fieldtype"], "Data")
        self.assertEqual(field["insert_after"], "description")

    def test_fixture_is_exported_by_hooks(self):
        # A fixture entry not listed in hooks.fixtures is never imported by migrate.
        custom_field_filters = next(
            entry["filters"] for entry in hooks.fixtures if entry["doctype"] == "Custom Field"
        )
        names = next(f[2] for f in custom_field_filters if f[0] == "name" and f[1] == "in")

        self.assertIn(FIELD_NAME, names)


if __name__ == "__main__":
    unittest.main()
