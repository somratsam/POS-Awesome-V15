import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_ORIGINAL_MODULES = dict(sys.modules)


def tearDownModule():
    managed_prefixes = ("frappe", "erpnext.setup.utils", "posawesome")
    for name in list(sys.modules):
        if name.startswith(managed_prefixes) and name not in _ORIGINAL_MODULES:
            sys.modules.pop(name, None)
    for name, module in _ORIGINAL_MODULES.items():
        if name.startswith(managed_prefixes):
            sys.modules[name] = module


def _install_stubs(get_value_mock):
    frappe_module = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    erpnext_setup_utils = types.ModuleType("erpnext.setup.utils")

    frappe_utils.add_days = lambda value, days: value
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.flt = lambda value, precision=None: round(float(value or 0), precision or 2)
    frappe_utils.formatdate = lambda value=None, fmt=None: str(value or "")
    frappe_utils.getdate = lambda value=None: value
    frappe_utils.nowdate = lambda: "2026-03-21"
    frappe_utils.strip_html_tags = lambda value: value

    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.db = types.SimpleNamespace(get_value=get_value_mock)

    erpnext_setup_utils.get_exchange_rate = lambda *args, **kwargs: 1.0

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils
    sys.modules["erpnext"] = types.ModuleType("erpnext")
    sys.modules["erpnext.setup"] = types.ModuleType("erpnext.setup")
    sys.modules["erpnext.setup.utils"] = erpnext_setup_utils

    for name, path in {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
        "posawesome.posawesome.api.invoice_processing": (
            REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing"
        ),
    }.items():
        module = types.ModuleType(name)
        module.__path__ = [str(path)]
        sys.modules[name] = module


def _load_utils_module():
    module_name = "posawesome.posawesome.api.invoice_processing.utils"
    file_path = (
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing" / "utils.py"
    )
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestZeroValuationRateDefaults(unittest.TestCase):
    # Real bug: Swan's business model deliberately uses zero valuation rate
    # on every item (opening-stock model, no formal PO/Supplier cost
    # tracking -- see PROGRESS_NOTES.md section 37). POS Awesome never set
    # allow_zero_valuation_rate anywhere, so ERPNext core's own zero-rate
    # checks fired on every single sale. A pre-existing POS Profile field
    # (posa_allow_zero_rated_items, "Allow Zero Rated Items") was built for
    # exactly this but was never wired to anything.
    def setUp(self):
        self.get_value_calls = []

        def get_value(doctype, name, fieldname):
            self.get_value_calls.append((doctype, name, fieldname))
            if doctype == "POS Profile" and fieldname == "posa_allow_zero_rated_items":
                return self.pos_profile_flag
            return None

        self.pos_profile_flag = 0
        _install_stubs(get_value)
        self.utils = _load_utils_module()

    def test_returns_false_when_pos_profile_missing(self):
        self.assertFalse(self.utils.pos_profile_allows_zero_rated_items(None))
        self.assertFalse(self.utils.pos_profile_allows_zero_rated_items(""))

    def test_reads_the_correct_pos_profile_field(self):
        self.pos_profile_flag = 1
        self.assertTrue(self.utils.pos_profile_allows_zero_rated_items("Test Pos"))
        self.assertIn(
            ("POS Profile", "Test Pos", "posa_allow_zero_rated_items"),
            self.get_value_calls,
        )

    def test_does_not_set_allow_zero_valuation_rate_when_profile_flag_disabled(self):
        self.pos_profile_flag = 0
        items = [{"item_code": "ITEM-1", "rate": 0}]

        self.utils.apply_zero_valuation_rate_defaults(items, "Test Pos")

        self.assertNotIn("allow_zero_valuation_rate", items[0])

    def test_sets_allow_zero_valuation_rate_on_every_item_when_profile_flag_enabled(self):
        self.pos_profile_flag = 1
        items = [
            {"item_code": "ITEM-1", "rate": 0},
            {"item_code": "ITEM-2", "rate": 50},
        ]

        self.utils.apply_zero_valuation_rate_defaults(items, "Test Pos")

        self.assertEqual(items[0]["allow_zero_valuation_rate"], 1)
        self.assertEqual(items[1]["allow_zero_valuation_rate"], 1)

    def test_tolerates_a_missing_or_non_list_items_payload(self):
        self.pos_profile_flag = 1
        # Must not raise for either shape -- real callers pass
        # invoice.get("items"), which can be None or a non-list if the
        # payload is malformed.
        self.utils.apply_zero_valuation_rate_defaults(None, "Test Pos")
        self.utils.apply_zero_valuation_rate_defaults("not-a-list", "Test Pos")

    def test_skips_non_dict_rows_without_raising(self):
        self.pos_profile_flag = 1
        items = [{"item_code": "ITEM-1"}, "not-a-dict", None]

        self.utils.apply_zero_valuation_rate_defaults(items, "Test Pos")

        self.assertEqual(items[0]["allow_zero_valuation_rate"], 1)


if __name__ == "__main__":
    unittest.main()


class TestReturnWindow(unittest.TestCase):
    """The 15-day return window is decided on the server from the original
    sale's posting date -- older invoices have no stored
    posa_return_valid_upto and used to skip the check silently."""

    def setUp(self):
        import datetime

        self.get_value_mock = Mock(return_value=None)
        _install_stubs(self.get_value_mock)
        self.utils = _load_utils_module()
        self.today = datetime.date(2026, 11, 3)
        self.utils.getdate = lambda value=None: (
            value if isinstance(value, datetime.date) else datetime.date.fromisoformat(str(value))
        )
        self.utils.add_days = lambda value, days: value + datetime.timedelta(days=days)
        self.utils.nowdate = lambda: self.today.isoformat()
        self.utils.frappe.throw = Mock(side_effect=Exception("blocked"))

    def _return_doc(self, return_against="SINV-OLD"):
        return types.SimpleNamespace(
            is_return=1,
            return_against=return_against,
            get=lambda key, default=None: {"return_against": return_against}.get(key, default),
        )

    def test_day_15_is_still_allowed_and_day_16_is_not(self):
        self.assertFalse(self.utils.is_return_window_expired("2026-10-19", True, 15))
        self.assertTrue(self.utils.is_return_window_expired("2026-10-18", True, 15))

    def test_switched_off_never_expires(self):
        self.assertFalse(self.utils.is_return_window_expired("2025-01-01", False, 15))

    def test_old_invoice_without_stored_date_is_blocked_with_plain_message(self):
        self.get_value_mock.return_value = "2026-08-05"

        with self.assertRaises(Exception):
            self.utils._validate_return_window(self._return_doc(), "Sales Invoice", True, 15)

        self.utils.frappe.throw.assert_called_once_with(
            "This invoice is older than 15 days and cannot be returned."
        )
        self.get_value_mock.assert_called_with("Sales Invoice", "SINV-OLD", "posting_date")

    def test_recent_invoice_passes(self):
        self.get_value_mock.return_value = "2026-10-28"
        self.utils._validate_return_window(self._return_doc(), "Sales Invoice", True, 15)
        self.utils.frappe.throw.assert_not_called()

    def test_sale_deadline_is_set_by_the_server_not_the_browser(self):
        import datetime

        sale = types.SimpleNamespace(is_return=0, posa_return_valid_upto="2099-12-31")
        sale.get = lambda key, default=None: {"posting_date": "2026-11-03"}.get(key, default)

        self.utils._set_return_valid_upto(sale, True, 15)
        self.assertEqual(sale.posa_return_valid_upto, datetime.date(2026, 11, 18))

        self.utils._set_return_valid_upto(sale, False, 15)
        self.assertIsNone(sale.posa_return_valid_upto)

    def test_return_without_invoice_refused_when_profile_turns_it_off(self):
        unlinked = types.SimpleNamespace(get=lambda key, default=None: {"is_return": 1}.get(key, default))

        self.get_value_mock.return_value = 0
        with self.assertRaises(Exception):
            self.utils._guard_return_without_invoice(unlinked, "Main POS")

        self.get_value_mock.return_value = 1
        self.utils.frappe.throw.reset_mock(side_effect=True)
        self.utils._guard_return_without_invoice(unlinked, "Main POS")
        self.utils.frappe.throw.assert_not_called()
