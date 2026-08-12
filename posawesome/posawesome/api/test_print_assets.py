import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
PRINT_ASSETS_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "print_assets.py"


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.log_error = lambda *args, **kwargs: None

    file_manager_module = types.ModuleType("frappe.utils.file_manager")
    file_manager_module.get_file = lambda file_url: ("logo.png", b"fake-image-bytes")

    pos_access_module = types.ModuleType("posawesome.posawesome.api.pos_access")
    pos_access_module.get_authorized_pos_profile = lambda pos_profile=None, company=None: AttrDict(
        {"name": pos_profile, "posa_receipt_logo": "/files/logo.png"}
    )

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils.file_manager"] = file_manager_module
    sys.modules["posawesome.posawesome.api.pos_access"] = pos_access_module


def _load_module():
    module_name = "posawesome.posawesome.api.print_assets"
    spec = importlib.util.spec_from_file_location(module_name, PRINT_ASSETS_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestGetReceiptLogoDataUriAuthorization(unittest.TestCase):
    """get_receipt_logo_data_uri() must re-resolve and re-authorize the POS
    Profile server-side via get_authorized_pos_profile() before reading its
    logo -- otherwise any authenticated user could read another store's logo
    by passing a different profile name. Unlike the Z Report/overview
    endpoints, failure here returns "" rather than raising, matching this
    function's existing fail-open design (a missing/unauthorized logo must
    never break receipt printing)."""

    def setUp(self):
        _install_stubs()
        self.module = _load_module()

    def test_returns_the_logo_for_an_authorized_profile(self):
        recorded_calls = []

        def fake_get_authorized_pos_profile(pos_profile=None, company=None):
            recorded_calls.append(pos_profile)
            return AttrDict({"name": pos_profile, "posa_receipt_logo": "/files/logo.png"})

        self.module.get_authorized_pos_profile = fake_get_authorized_pos_profile

        result = self.module.get_receipt_logo_data_uri("Test Pos")

        self.assertEqual(recorded_calls, ["Test Pos"])
        self.assertTrue(result.startswith("data:image/png;base64,"))

    def test_returns_empty_string_instead_of_raising_for_an_unauthorized_profile(self):
        def deny(pos_profile=None, company=None):
            raise Exception("not authorized")

        self.module.get_authorized_pos_profile = deny

        result = self.module.get_receipt_logo_data_uri("Someone Elses Profile")

        self.assertEqual(result, "")

    def test_returns_empty_string_for_no_pos_profile(self):
        result = self.module.get_receipt_logo_data_uri("")
        self.assertEqual(result, "")

    def test_returns_empty_string_when_authorized_profile_has_no_logo_set(self):
        self.module.get_authorized_pos_profile = lambda pos_profile=None, company=None: AttrDict(
            {"name": pos_profile, "posa_receipt_logo": None}
        )

        result = self.module.get_receipt_logo_data_uri("Test Pos")

        self.assertEqual(result, "")


if __name__ == "__main__":
    unittest.main()
