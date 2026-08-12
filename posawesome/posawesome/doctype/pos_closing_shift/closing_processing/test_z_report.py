import importlib.util
import pathlib
import sys
import types
import unittest
from types import SimpleNamespace

REPO_ROOT = pathlib.Path(__file__).resolve().parents[5]
Z_REPORT_PATH = (
    REPO_ROOT
    / "posawesome"
    / "posawesome"
    / "doctype"
    / "pos_closing_shift"
    / "closing_processing"
    / "z_report.py"
)


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils_module = types.ModuleType("frappe.utils")
    closing_data_module = types.ModuleType(
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data"
    )
    closing_utils_module = types.ModuleType(
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils"
    )

    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.get_cached_value = lambda doctype, name, field: "USD"
    frappe_module.get_doc = lambda doctype, name: AttrDict(
        {
            "name": name,
            "doctype": doctype,
            "docstatus": 1,
            "pos_profile": "POS-PROFILE-1",
            "company": "My Co",
            "posting_date": "2026-08-12",
            "net_total": 0,
            "grand_total": 0,
            "customer_credit_issued": 0,
            "customer_credit_redeemed": 0,
            "same_shift_exchange_total": 0,
            "payment_reconciliation": [],
        }
    )
    frappe_module.db = SimpleNamespace(get_value=lambda *args, **kwargs: None)
    frappe_utils_module.flt = lambda value=0, precision=None: float(value or 0)

    closing_data_module.get_shift_invoice_rows = lambda doc: []
    closing_data_module.get_payment_mode_counts = lambda sale_names, return_names: {}
    closing_utils_module.get_base_value = lambda row, amount_field, base_field, conversion_rate=None: 0.0

    pos_access_module = types.ModuleType("posawesome.posawesome.api.pos_access")
    pos_access_module.get_authorized_pos_profile = lambda pos_profile=None, company=None: AttrDict(
        {"name": pos_profile or "POS-PROFILE-1", "company": company or "My Co"}
    )

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils_module
    sys.modules[
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data"
    ] = closing_data_module
    sys.modules[
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils"
    ] = closing_utils_module
    sys.modules["posawesome.posawesome.api.pos_access"] = pos_access_module


def _load_module():
    module_name = "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report"
    spec = importlib.util.spec_from_file_location(module_name, Z_REPORT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestGetZReportDataAuthorization(unittest.TestCase):
    """get_z_report_data() must re-resolve and re-authorize the POS Profile
    server-side via get_authorized_pos_profile(), not trust the closing
    shift's stored pos_profile/company without checking the caller actually
    has access to it -- otherwise any authenticated user could read another
    store's full Z Report by passing a different closing shift name."""

    def setUp(self):
        _install_stubs()
        self.module = _load_module()

    def test_authorizes_using_the_resolved_shifts_profile_and_company(self):
        recorded_calls = []

        def fake_get_authorized_pos_profile(pos_profile=None, company=None):
            recorded_calls.append((pos_profile, company))
            return AttrDict({"name": pos_profile, "company": company})

        self.module.get_authorized_pos_profile = fake_get_authorized_pos_profile

        self.module.get_z_report_data("POSA-CS-0001")

        self.assertEqual(recorded_calls, [("POS-PROFILE-1", "My Co")])

    def test_propagates_a_permission_error_from_an_unauthorized_profile(self):
        class Denied(Exception):
            pass

        def deny(pos_profile=None, company=None):
            raise Denied("not authorized")

        self.module.get_authorized_pos_profile = deny

        with self.assertRaises(Denied):
            self.module.get_z_report_data("POSA-CS-0001")

    def test_authorization_happens_before_the_docstatus_check(self):
        # Even for a not-yet-submitted shift, an unauthorized caller must be
        # rejected for lack of access, not shown a "not submitted" message
        # that would confirm the shift's existence/state to them.
        self.module.frappe.get_doc = lambda doctype, name: AttrDict(
            {
                "name": name,
                "doctype": doctype,
                "docstatus": 0,
                "pos_profile": "POS-PROFILE-1",
                "company": "My Co",
            }
        )

        class Denied(Exception):
            pass

        def deny(pos_profile=None, company=None):
            raise Denied("not authorized")

        self.module.get_authorized_pos_profile = deny

        with self.assertRaises(Denied):
            self.module.get_z_report_data("POSA-CS-0001")


if __name__ == "__main__":
    unittest.main()
