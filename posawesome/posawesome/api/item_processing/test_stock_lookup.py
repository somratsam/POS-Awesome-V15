import importlib.util
import json
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get


class FakeProfile(AttrDict):
    pass


STUBBED_MODULES = [
    "frappe",
    "frappe.utils",
    "posawesome.posawesome.api.item_processing.barcode",
    "posawesome.posawesome.api.item_processing.details",
    "posawesome.posawesome.api.pos_access",
]


def _install_stubs(state):
    original_modules = {name: sys.modules.get(name) for name in STUBBED_MODULES}

    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module._ = lambda text, *args, **kwargs: text

    class ValidationError(Exception):
        pass

    frappe_module.ValidationError = ValidationError

    def throw(message, *args, **kwargs):
        raise ValidationError(message)

    frappe_module.throw = throw
    frappe_module.as_json = lambda value: json.dumps(value)

    class Db:
        def get_value(self, doctype, filters, fields=None, as_dict=False):
            state["queries"].append((doctype, filters, fields))
            if doctype == "Item Barcode":
                return state["barcodes"].get(filters["barcode"])
            if doctype == "Item":
                item = state["items"].get(filters)
                if not item:
                    return None
                if fields == "item_name":
                    return item["item_name"]
                return AttrDict(item) if as_dict else item
            if doctype == "Batch":
                return state["batches"].get(filters)
            if doctype == "Serial No":
                return state["serials"].get(filters)
            return None

        def exists(self, doctype, name):
            return doctype == "Item" and name in state["items"]

    frappe_module.db = Db()
    frappe_module.get_all = lambda doctype, filters=None, fields=None: [
        {"item_code": filters["name"], "item_name": state["items"][filters["name"]]["item_name"]}
    ]
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.cstr = lambda value: "" if value is None else str(value)
    sys.modules["frappe.utils"] = frappe_utils

    barcode_module = types.ModuleType("posawesome.posawesome.api.item_processing.barcode")
    barcode_module._parse_scale_barcode_data = lambda code: state["scale"].get(code)
    sys.modules[barcode_module.__name__] = barcode_module

    details_module = types.ModuleType("posawesome.posawesome.api.item_processing.details")

    def get_item_variants(pos_profile, parent_item_code, price_list=None, customer=None):
        state["variant_calls"].append((pos_profile, parent_item_code, price_list, customer))
        return {
            "variants": [{"item_code": f"{parent_item_code}-S"}, {"item_code": f"{parent_item_code}-M"}],
            "attributes_meta": {"Size": ["M", "S"]},
        }

    def get_items_details(pos_profile, items_data, price_list=None, customer=None):
        state["detail_calls"].append((pos_profile, json.loads(items_data), price_list))
        return [{"item_code": row["item_code"], "actual_qty": 7} for row in json.loads(items_data)]

    details_module.get_item_variants = get_item_variants
    details_module.get_items_details = get_items_details
    sys.modules[details_module.__name__] = details_module

    access_module = types.ModuleType("posawesome.posawesome.api.pos_access")

    def get_authorized_pos_profile(pos_profile):
        state["auth_calls"].append(pos_profile)
        if state.get("deny"):
            raise PermissionError("not assigned")
        return state["profile"]

    access_module.get_authorized_pos_profile = get_authorized_pos_profile
    sys.modules[access_module.__name__] = access_module
    return original_modules


def _restore_modules(original_modules):
    for module_name, original in original_modules.items():
        if original is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original


def _load_module():
    module_name = "test_stock_lookup_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "stock_lookup.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestStockLookup(unittest.TestCase):
    def setUp(self):
        self.state = {
            "profile": FakeProfile(
                name="Test Pos",
                warehouse="Stores - S",
                selling_price_list="Standard Selling",
                posa_search_batch_no=0,
                posa_search_serial_no=0,
            ),
            "barcodes": {"4524019703002": "STYLE-NAVY-S"},
            "items": {
                "STYLE": {"name": "STYLE", "item_name": "Style", "variant_of": None, "has_variants": 1, "disabled": 0},
                "STYLE-NAVY-S": {
                    "name": "STYLE-NAVY-S",
                    "item_name": "Style Navy S",
                    "variant_of": "STYLE",
                    "has_variants": 0,
                    "disabled": 0,
                },
                "MUG": {"name": "MUG", "item_name": "Mug", "variant_of": None, "has_variants": 0, "disabled": 0},
                "OLD": {"name": "OLD", "item_name": "Old", "variant_of": None, "has_variants": 0, "disabled": 1},
            },
            "batches": {"BATCH-1": "MUG"},
            "serials": {},
            "scale": {},
            "queries": [],
            "variant_calls": [],
            "detail_calls": [],
            "auth_calls": [],
        }
        self.original_modules = _install_stubs(self.state)
        self.module = _load_module()

    def tearDown(self):
        _restore_modules(self.original_modules)
        sys.modules.pop("test_stock_lookup_target", None)

    def test_a_variant_barcode_returns_its_whole_family(self):
        result = self.module.lookup_item_stock("Test Pos", " 4524019703002 ", price_list="Retail")

        self.assertTrue(result["found"])
        self.assertEqual(result["scanned_item_code"], "STYLE-NAVY-S")
        self.assertEqual(result["template_item_code"], "STYLE")
        self.assertEqual(result["template_item_name"], "Style")
        self.assertEqual([i["item_code"] for i in result["items"]], ["STYLE-S", "STYLE-M"])
        self.assertEqual(result["attributes_meta"], {"Size": ["M", "S"]})
        self.assertEqual(result["warehouse"], "Stores - S")
        # The re-authorized profile's name is passed on, never the client's raw value.
        self.assertEqual(self.state["variant_calls"], [("Test Pos", "STYLE", "Retail", None)])

    def test_a_template_code_returns_its_family(self):
        result = self.module.lookup_item_stock("Test Pos", "STYLE")
        self.assertEqual(result["template_item_code"], "STYLE")
        self.assertEqual(result["scanned_item_code"], "STYLE")
        # Falls back to the profile's selling price list.
        self.assertEqual(self.state["variant_calls"][0][2], "Standard Selling")

    def test_an_item_without_variants_returns_a_single_card(self):
        result = self.module.lookup_item_stock("Test Pos", "MUG")
        self.assertTrue(result["found"])
        self.assertIsNone(result["template_item_code"])
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["item_code"], "MUG")
        self.assertEqual(result["items"][0]["actual_qty"], 7)
        self.assertEqual(result["items"][0]["item_attributes"], [])
        self.assertEqual(result["attributes_meta"], {})
        self.assertEqual(self.state["variant_calls"], [])

    def test_unknown_and_disabled_codes_are_not_found(self):
        self.assertEqual(self.module.lookup_item_stock("Test Pos", "NOPE"), {"found": False, "code": "NOPE"})
        self.assertFalse(self.module.lookup_item_stock("Test Pos", "OLD")["found"])

    def test_batch_lookup_only_when_the_profile_enables_it(self):
        self.assertFalse(self.module.lookup_item_stock("Test Pos", "BATCH-1")["found"])
        self.state["profile"]["posa_search_batch_no"] = 1
        result = self.module.lookup_item_stock("Test Pos", "BATCH-1")
        self.assertTrue(result["found"])
        self.assertEqual(result["scanned_item_code"], "MUG")

    def test_scale_parse_only_counts_when_the_item_exists(self):
        self.state["scale"] = {"2000001": {"item_code": "MUG"}, "2999999": {"item_code": "GHOST"}}
        self.assertEqual(self.module.lookup_item_stock("Test Pos", "2000001")["scanned_item_code"], "MUG")
        self.assertFalse(self.module.lookup_item_stock("Test Pos", "2999999")["found"])

    def test_empty_code_is_rejected(self):
        with self.assertRaises(sys.modules["frappe"].ValidationError):
            self.module.lookup_item_stock("Test Pos", "   ")

    def test_overlong_code_returns_not_found_without_querying(self):
        result = self.module.lookup_item_stock("Test Pos", "x" * 500)
        self.assertFalse(result["found"])
        self.assertEqual(len(result["code"]), 140)
        self.assertEqual(self.state["queries"], [])

    def test_unauthorized_profile_is_refused_before_any_lookup(self):
        self.state["deny"] = True
        with self.assertRaises(PermissionError):
            self.module.lookup_item_stock("Someone Elses Pos", "4524019703002")
        self.assertEqual(self.state["queries"], [])
        self.assertEqual(self.state["auth_calls"], ["Someone Elses Pos"])


if __name__ == "__main__":
    unittest.main()
