"""Credit note voucher: the code printed on it, and the reprint log.

A return that refunds no money leaves its whole value as store credit on the
customer's account. "Credit note issue" in the POS prints that credit as a
voucher (posawesome/templates/print/credit_note_voucher.html, included by the
store's receipt format for such a return).

Voucher code = "C" + 2-digit year + invoice number + 4-character check:
ACC-SINV-2026-00247 -> "C2600247K7Q4", printed "C26-00247-K7Q4". The check is
an HMAC of the full invoice name with this site's encryption key, so it can't
be worked out from the invoice number alone; it needs no field and is the
same on every print and reprint.

Anyone who can print the return can still print its code (a reprint is
allowed for any cashier), so every POS reprint of a voucher is recorded as a
Comment on the invoice naming the PIN-verified cashier
(record_credit_note_reprint).
"""

import hashlib
import hmac

import frappe
from frappe import _
from frappe.utils import cstr, escape_html, flt

CHECK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O, 1/I/L
CHECK_LENGTH = 4
VOUCHER_PREFIX = "C"
REPRINT_DOCTYPES = ("Sales Invoice", "POS Invoice")


def _secret():
    from frappe.utils.password import get_encryption_key

    return cstr(get_encryption_key()).encode()


def _name_parts(name):
    """(yy, number) from "ACC-SINV-2026-00247" -> ("26", "00247"): the first
    4-digit group is the year, the next all-digit group the number. None
    when the name has no such groups."""
    groups = cstr(name).strip().split("-")
    for index, group in enumerate(groups[:-1]):
        nxt = groups[index + 1]
        if len(group) == 4 and group.isdigit() and nxt.isdigit():
            return group[2:], nxt
    return None


def _check(name):
    digest = hmac.new(_secret(), f"posa-credit-voucher|{cstr(name).strip()}".encode(), hashlib.sha256).digest()
    return "".join(CHECK_ALPHABET[byte % len(CHECK_ALPHABET)] for byte in digest[:CHECK_LENGTH])


def credit_voucher_code(name):
    """Voucher code for an invoice name ("" when the name has no year and
    number groups). Jinja method."""
    parts = _name_parts(name)
    if not parts:
        return ""
    yy, number = parts
    return f"{VOUCHER_PREFIX}{yy}{number}{_check(name)}"


def credit_voucher_label(code):
    """Printed form, "C2600247K7Q4" -> "C26-00247-K7Q4". Jinja method."""
    code = cstr(code)
    if len(code) <= 3 + CHECK_LENGTH:
        return code
    return f"{code[:3]}-{code[3:-CHECK_LENGTH]}-{code[-CHECK_LENGTH:]}"


def normalize_voucher_code(text):
    """Code as typed or scanned: spaces and dashes dropped, upper case."""
    return "".join(ch for ch in cstr(text).upper() if ch.isalnum())


def verify_credit_voucher_code(name, code):
    """True only when code is this invoice's voucher code."""
    expected = credit_voucher_code(name)
    given = normalize_voucher_code(code)
    return bool(expected) and hmac.compare_digest(expected, given)


def is_credit_note_voucher(doc):
    """A submitted return that refunds no money: every payment row is 0 and
    its value stays as credit. Jinja method; the receipt format prints the
    voucher instead of the receipt for these."""
    if not doc or not int(doc.get("is_return") or 0) or int(doc.get("docstatus") or 0) != 1:
        return False
    if flt(doc.get("grand_total")) >= 0:
        return False
    return not any(abs(flt(row.get("amount"))) > 0 for row in (doc.get("payments") or []))


def credit_voucher_valid_until(doc):
    """Last day the voucher's credit can be used: the same rule the POS and
    the server apply when credit is spent. Jinja method."""
    from posawesome.posawesome.api.payments import get_customer_credit_expiry

    return get_customer_credit_expiry(doc.get("posting_date"))


@frappe.whitelist()
def record_credit_note_reprint(doctype=None, name=None, pos_profile=None):
    """Called by the POS before it reprints an invoice. For a credit note
    voucher, records a Comment naming the till's PIN-verified cashier (taken
    from the server's terminal state, not from the request) and returns
    {"credit_note": True}; the POS then prints it as a DUPLICATE. Other
    invoices: nothing is recorded, {"credit_note": False}.

    An invoice the server doesn't have (yet) is not a credit note here.
    Raises when the caller can't read the invoice, or (credit notes only)
    when the till has no verified, unlocked cashier: the reprint is then not
    printed, so no voucher copy leaves the till unrecorded."""
    from posawesome.posawesome.api.terminal_state import get_active_terminal_cashier

    if doctype not in REPRINT_DOCTYPES:
        frappe.throw(_("Reprints are recorded for Sales Invoice and POS Invoice only."))
    if not name or not frappe.db.exists(doctype, name):
        # e.g. a sale still waiting to sync: the POS prints its own copy.
        return {"credit_note": False}

    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    if not is_credit_note_voucher(doc):
        return {"credit_note": False}

    cashier = get_active_terminal_cashier(pos_profile)
    full_name = frappe.db.get_value("User", cashier, "full_name") or cashier
    till = cstr(pos_profile or doc.get("pos_profile"))
    doc.add_comment(
        "Info",
        _("Credit note voucher reprinted (DUPLICATE) by {0} ({1}) at {2}.").format(
            escape_html(full_name), escape_html(cashier), escape_html(till)
        ),
    )
    return {"credit_note": True, "cashier": cashier}
