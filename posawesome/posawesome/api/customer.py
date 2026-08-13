# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt

"""Customer hooks and compatibility wrappers.

Hook handlers live here; customer CRUD/list APIs are implemented in
`posawesome.posawesome.api.customers` and exposed via wrappers as needed.
"""


import secrets
import string

import frappe
from frappe import _

from posawesome.posawesome.doctype.referral_code.referral_code import (
    create_referral_code,
)

from . import customers

LOYALTY_PORTAL_CODE_LENGTH = 8
# Uppercase letters and digits, excluding visually-ambiguous characters
# (0/O, 1/I/L, 5/S, 8/B) so a code printed on a thermal receipt can be
# reliably read and retyped by a customer.
LOYALTY_PORTAL_CODE_ALPHABET = "".join(
    ch for ch in (string.ascii_uppercase + string.digits) if ch not in "0O1IL5S8B"
)


def after_insert(doc, method):
    create_customer_referral_code(doc)
    create_gift_coupon(doc)


def validate(doc, method):
    validate_referral_code(doc)
    ensure_loyalty_portal_code(doc)


def create_customer_referral_code(doc):
    if doc.posa_referral_company:
        company = frappe.get_cached_doc("Company", doc.posa_referral_company)
        if not company.posa_auto_referral:
            return
        create_referral_code(
            doc.posa_referral_company,
            doc.name,
            company.posa_customer_offer,
            company.posa_primary_offer,
            company.posa_referral_campaign,
        )


def create_gift_coupon(doc):
    if doc.posa_referral_code:
        coupon = frappe.new_doc("POS Coupon")
        coupon.customer = doc.name
        coupon.referral_code = doc.posa_referral_code
        coupon.create_coupon_from_referral()


def validate_referral_code(doc):
    referral_code = doc.posa_referral_code
    exist = None
    if referral_code:
        exist = frappe.db.exists("Referral Code", referral_code)
        if not exist:
            exist = frappe.db.exists("Referral Code", {"referral_code": referral_code})
        if not exist:
            frappe.throw(_("This Referral Code {0} not exists").format(referral_code))


def ensure_loyalty_portal_code(doc):
    """Auto-assign a loyalty portal access code the first time a customer is
    saved without one, mirroring how ERPNext's own set_loyalty_program()
    auto-assigns a Loyalty Program on Customer.validate(). Must never raise:
    this runs inside Customer.validate() for every customer save
    system-wide -- POS Awesome's own create_customer(), ERPNext's native
    customer forms, data imports, everything -- so an exception here would
    block customer creation/editing entirely, not just fail to generate a
    code.

    Records flagged posa_is_generic_customer are shared/anonymous buckets
    (e.g. a walk-in customer reused across many unrelated sales), not
    individually tracked people -- an individual portal code or a pooled
    loyalty balance would be actively misleading on those records, so both
    are cleared here rather than left to accumulate.
    """
    try:
        if doc.get("posa_is_generic_customer"):
            if doc.get("posa_loyalty_portal_code"):
                doc.posa_loyalty_portal_code = None
            if doc.get("loyalty_program"):
                doc.loyalty_program = None
            return
        if doc.get("posa_loyalty_portal_code"):
            return
        doc.posa_loyalty_portal_code = _generate_unique_loyalty_portal_code()
    except Exception:
        frappe.log_error(
            title="Failed to generate loyalty portal code",
            message=frappe.get_traceback(),
        )


def _generate_unique_loyalty_portal_code():
    for _ in range(5):
        candidate = "".join(
            secrets.choice(LOYALTY_PORTAL_CODE_ALPHABET) for _ in range(LOYALTY_PORTAL_CODE_LENGTH)
        )
        if not frappe.db.exists("Customer", {"posa_loyalty_portal_code": candidate}):
            return candidate
    # Vanishingly unlikely to ever be reached given the alphabet size, but
    # fall back to a longer code rather than ever returning a colliding one.
    return "".join(
        secrets.choice(LOYALTY_PORTAL_CODE_ALPHABET) for _ in range(LOYALTY_PORTAL_CODE_LENGTH + 4)
    )


@frappe.whitelist()
def get_customer_balance(customer, company=None):
    return customers.get_customer_balance(customer, company)


@frappe.whitelist()
def create_customer(*args, **kwargs):
    """Backward compatible wrapper for ``api.customers.create_customer``."""
    return customers.create_customer(*args, **kwargs)
