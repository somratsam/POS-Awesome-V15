import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    original_modules = {
        "frappe": sys.modules.get("frappe"),
        "frappe.utils": sys.modules.get("frappe.utils"),
    }
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.DoesNotExistError = Exception
    frappe_module.PermissionError = PermissionError
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.get_cached_doc = lambda *args, **kwargs: None
    frappe_module.get_all = lambda *args, **kwargs: []
    # get_items_from_barcode() now imports get_authorized_pos_profile from
    # pos_access.py at module level (see barcode.py); pos_access.py's own
    # top-level `from frappe import _` needs this to exist just to import
    # cleanly. Individual tests still stub get_authorized_pos_profile itself
    # rather than exercising its real DB-backed logic against this fake.
    frappe_module._ = lambda text, *args, **kwargs: text
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = int
    frappe_utils.cstr = str
    frappe_utils.flt = float
    sys.modules["frappe.utils"] = frappe_utils
    return original_modules


def _restore_modules(original_modules):
    for module_name, original in original_modules.items():
        if original is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original


def _load_module():
    module_name = "test_barcode_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "barcode.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestBarcodeProcessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_modules = _install_stubs()
        cls.module = _load_module()

    @classmethod
    def tearDownClass(cls):
        _restore_modules(cls.original_modules)

    def test_get_items_from_barcode_uses_standard_uom_even_when_posa_uom_exists(self):
        calls = []

        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                calls.append((doctype, filters, fields, as_dict))
                if doctype == "Item Barcode":
                    return AttrDict(
                        {
                            "item_code": "ITEM-001",
                            "uom": "Box",
                            "posa_uom": "Nos",
                        }
                    )
                if doctype == "Item Price":
                    return 120
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Item 001", "stock_uom": "Nos"}
        )
        self.module._parse_scale_barcode_data = lambda barcode: None
        # This test is about UOM/rate logic, not authorization -- stub the
        # authorization call itself rather than reproducing its real
        # session/DB-backed logic against this file's lightweight fake frappe.
        self.module.get_authorized_pos_profile = lambda pos_profile=None: AttrDict(
            {"name": "Test Pos", "company": "Test Co"}
        )

        result = self.module.get_items_from_barcode(
            "Standard Selling",
            "USD",
            "BOX-001",
        )

        self.assertEqual(result["uom"], "Box")
        self.assertIn("uom", calls[0][2])

    def test_returns_full_item_shape_for_a_variant_with_no_visibility_filtering(self):
        # Regression guard: barcode scanning (useScanProcessor.ts) was switched
        # to this endpoint specifically because get_items()'s search path
        # applies catalog-visibility filters (Hide Variants Items, Hide
        # Unavailable Items, item groups) that are appropriate for the browse
        # grid but not for resolving a physically-scanned tag -- every real
        # barcode belongs to a specific variant, so Hide Variants Items would
        # otherwise make scanning fail almost entirely. get_items_from_barcode()
        # does take a pos_profile argument (added for authorization -- see
        # test_requires_an_authorized_pos_profile below), but it must only ever
        # use it to authorize the caller, never to filter the result: this test
        # asserts a Hide-Variants-Items-shaped item (variant_of set, has_variants
        # 0) still comes back with that data intact, proving no such filter is
        # applied.
        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                if doctype == "Item Barcode":
                    return AttrDict(
                        {"item_code": "35740232030014", "uom": None}
                    )
                if doctype == "Item Price":
                    return 48.6
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {
                "name": name,
                "item_name": "HAT-CAP-BLACK-58",
                "stock_uom": "Nos",
                "is_stock_item": 1,
                "has_variants": 0,
                "variant_of": "3574023203",
                "item_group": "ACCESSORIES",
                "has_batch_no": 0,
                "has_serial_no": 0,
                "max_discount": 0,
                "brand": None,
                "allow_negative_stock": 0,
                "idx": 3,
            }
        )
        self.module._parse_scale_barcode_data = lambda barcode: None
        recorded_profile_calls = []
        self.module.get_authorized_pos_profile = lambda pos_profile=None: (
            recorded_profile_calls.append(pos_profile)
            or AttrDict({"name": "Test Pos", "company": "Test Co"})
        )

        result = self.module.get_items_from_barcode(
            "Standard Selling",
            "OMR",
            "35740232030014",
            pos_profile="Test Pos",
        )

        self.assertEqual(result["item_code"], "35740232030014")
        # variant_of being set is exactly what Hide Variants Items would have
        # excluded via get_items() -- this endpoint must return it anyway.
        self.assertEqual(result["variant_of"], "3574023203")
        self.assertEqual(result["has_variants"], 0)
        self.assertEqual(result["item_group"], "ACCESSORIES")
        self.assertEqual(result["is_stock_item"], 1)
        self.assertEqual(result["rate"], 48.6)
        # get_authorized_pos_profile() was consulted (authorization happened)
        # but its return value never touched any filtering above.
        self.assertEqual(recorded_profile_calls, ["Test Pos"])

    def test_requires_an_authorized_pos_profile(self):
        # If the caller's session isn't authorized for any POS Profile,
        # get_authorized_pos_profile() raises -- get_items_from_barcode()
        # must propagate that, not swallow it and return item data anyway.
        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                return AttrDict({"item_code": "ITEM-001", "uom": None})

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Item 001", "stock_uom": "Nos"}
        )
        self.module._parse_scale_barcode_data = lambda barcode: None

        def deny(pos_profile=None):
            raise self.module.frappe.PermissionError("not authorized")

        self.module.get_authorized_pos_profile = deny

        with self.assertRaises(self.module.frappe.PermissionError):
            self.module.get_items_from_barcode(
                "Standard Selling",
                "USD",
                "BARCODE-001",
                pos_profile="Someone Elses Profile",
            )


if __name__ == "__main__":
    unittest.main()
