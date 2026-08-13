import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
CUSTOMER_HOOKS_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "customer.py"


class AttrDict(dict):
    __getattr__ = dict.get

    def __setattr__(self, key, value):
        self[key] = value


def _install_stubs(existing_codes=None):
    existing_codes = existing_codes or set()

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.throw = lambda message, *a, **k: (_ for _ in ()).throw(Exception(message))
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.get_traceback = lambda: "traceback"
    frappe_module.db = types.SimpleNamespace(
        exists=lambda doctype, filters: (
            filters.get("posa_loyalty_portal_code") in existing_codes
            if isinstance(filters, dict)
            else False
        )
    )
    sys.modules["frappe"] = frappe_module

    referral_code_module = types.ModuleType(
        "posawesome.posawesome.doctype.referral_code.referral_code"
    )
    referral_code_module.create_referral_code = lambda *a, **k: None
    sys.modules["posawesome.posawesome.doctype.referral_code.referral_code"] = referral_code_module

    customers_module = types.ModuleType("posawesome.posawesome.api.customers")
    sys.modules["posawesome.posawesome.api.customers"] = customers_module

    return frappe_module


def _load_module():
    # customer.py does `from . import customers` (a relative import), which
    # only resolves if this module is loaded under its real dotted name with
    # __package__ set accordingly -- a synthetic name like
    # "test_customer_hooks_target" has no parent package for "." to resolve
    # against, so it must be loaded as posawesome.posawesome.api.customer.
    module_name = "posawesome.posawesome.api.customer"
    spec = importlib.util.spec_from_file_location(module_name, CUSTOMER_HOOKS_PATH)
    module = importlib.util.module_from_spec(spec)
    module.__package__ = "posawesome.posawesome.api"
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestGenerateUniqueLoyaltyPortalCode(unittest.TestCase):
    def test_generates_a_code_of_the_configured_length(self):
        _install_stubs()
        module = _load_module()

        code = module._generate_unique_loyalty_portal_code()

        self.assertEqual(len(code), module.LOYALTY_PORTAL_CODE_LENGTH)

    def test_generated_code_only_uses_the_safe_alphabet(self):
        _install_stubs()
        module = _load_module()

        code = module._generate_unique_loyalty_portal_code()

        self.assertTrue(all(ch in module.LOYALTY_PORTAL_CODE_ALPHABET for ch in code))

    def test_alphabet_excludes_visually_ambiguous_characters(self):
        _install_stubs()
        module = _load_module()

        for ambiguous in "0O1IL5S8B":
            self.assertNotIn(ambiguous, module.LOYALTY_PORTAL_CODE_ALPHABET)

    def test_retries_on_collision_and_returns_a_non_colliding_code(self):
        _install_stubs()
        module = _load_module()

        colliding_code = "AAAAAAAA"
        call_count = {"n": 0}

        def fake_choice(alphabet):
            call_count["n"] += 1
            # First 8 calls (one full code) collide; every call after that
            # returns a different, non-colliding character.
            return "A" if call_count["n"] <= module.LOYALTY_PORTAL_CODE_LENGTH else "C"

        with (
            patch.object(module, "secrets", types.SimpleNamespace(choice=fake_choice)),
            patch.object(
                module.frappe.db,
                "exists",
                side_effect=lambda doctype, filters: filters.get("posa_loyalty_portal_code")
                == colliding_code,
            ),
        ):
            code = module._generate_unique_loyalty_portal_code()

        self.assertNotEqual(code, colliding_code)


class TestEnsureLoyaltyPortalCode(unittest.TestCase):
    def test_assigns_a_code_when_missing(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_loyalty_portal_code": None})

        module.ensure_loyalty_portal_code(doc)

        self.assertTrue(doc.posa_loyalty_portal_code)
        self.assertEqual(len(doc.posa_loyalty_portal_code), module.LOYALTY_PORTAL_CODE_LENGTH)

    def test_does_not_overwrite_an_existing_code(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_loyalty_portal_code": "EXISTING1"})

        module.ensure_loyalty_portal_code(doc)

        self.assertEqual(doc.posa_loyalty_portal_code, "EXISTING1")

    def test_generic_customer_never_gets_a_new_code(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_is_generic_customer": 1, "posa_loyalty_portal_code": None})

        module.ensure_loyalty_portal_code(doc)

        self.assertIsNone(doc.posa_loyalty_portal_code)

    def test_generic_customer_has_existing_code_cleared(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_is_generic_customer": 1, "posa_loyalty_portal_code": "ZATPE3MN"})

        module.ensure_loyalty_portal_code(doc)

        self.assertIsNone(doc.posa_loyalty_portal_code)

    def test_generic_customer_has_loyalty_program_cleared(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict(
            {
                "posa_is_generic_customer": 1,
                "posa_loyalty_portal_code": "ZATPE3MN",
                "loyalty_program": "Swan Rewards",
            }
        )

        module.ensure_loyalty_portal_code(doc)

        self.assertIsNone(doc.loyalty_program)

    def test_non_generic_customer_loyalty_program_untouched(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict(
            {
                "posa_is_generic_customer": 0,
                "posa_loyalty_portal_code": "EXISTING1",
                "loyalty_program": "Swan Rewards",
            }
        )

        module.ensure_loyalty_portal_code(doc)

        self.assertEqual(doc.loyalty_program, "Swan Rewards")

    def test_never_raises_even_if_generation_fails(self):
        # This is the fail-safe requirement: ensure_loyalty_portal_code runs
        # inside Customer.validate() for every customer save system-wide, so
        # an exception here must never propagate and block a real save.
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_loyalty_portal_code": None})

        with patch.object(
            module, "_generate_unique_loyalty_portal_code", side_effect=RuntimeError("boom")
        ):
            try:
                module.ensure_loyalty_portal_code(doc)
            except Exception as exc:  # pragma: no cover - failure path
                self.fail(f"ensure_loyalty_portal_code raised {exc!r}, it must never raise")

        self.assertIsNone(doc.posa_loyalty_portal_code)


class TestValidateStillRunsReferralCodeCheck(unittest.TestCase):
    """Regression guard: adding the loyalty-code hook must not remove or
    bypass the existing referral-code validation that already lives in
    validate() -- this is exactly the kind of thing that would have broken
    silently if the new hook had been wired as a second doc_events entry
    instead of extending the existing validate() function."""

    def test_validate_calls_both_referral_code_and_loyalty_code_checks(self):
        _install_stubs()
        module = _load_module()
        doc = AttrDict({"posa_referral_code": None, "posa_loyalty_portal_code": None})

        calls = []
        with (
            patch.object(module, "validate_referral_code", side_effect=lambda d: calls.append("referral")),
            patch.object(
                module, "ensure_loyalty_portal_code", side_effect=lambda d: calls.append("loyalty")
            ),
        ):
            module.validate(doc, method=None)

        self.assertEqual(calls, ["referral", "loyalty"])


if __name__ == "__main__":
    unittest.main()
