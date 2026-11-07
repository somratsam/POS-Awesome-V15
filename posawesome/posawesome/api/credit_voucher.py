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

Spending credit (Payments, "Use Customer Balance"): every credit note used
on a sale must be authorized one of three ways, checked at submit
(authorize_customer_credit) and recorded in posa_credit_authorized_by:
  - same-shift exchange: the return was made in this sale's shift;
  - the customer's voucher, scanned or typed (lookup_credit_voucher);
  - a POS supervisor (lost voucher): signed in, or switched onto the till
    with their PIN -- the same rule as Edit Invoice and a below-cost sale.
Credit held by a shared (generic) customer can't be spent at all.
"""

import hashlib
import hmac

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, flt, formatdate

CHECK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O, 1/I/L
CHECK_LENGTH = 4
VOUCHER_PREFIX = "C"
REPRINT_DOCTYPES = ("Sales Invoice", "POS Invoice")
# Wrong voucher numbers allowed per user before lookups pause, so guessing
# the 4-character check (31^4 = 923,521 values) is impractical.
LOOKUP_FAILURE_LIMIT = 10
LOOKUP_FAILURE_WINDOW_SECONDS = 15 * 60


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


def parse_voucher_code(text):
    """(yy, number, code) from a typed or scanned voucher number, or None
    when it isn't shaped like one."""
    code = normalize_voucher_code(text)
    body = code[len(VOUCHER_PREFIX) : -CHECK_LENGTH] if code.startswith(VOUCHER_PREFIX) else ""
    check = code[-CHECK_LENGTH:]
    if len(body) < 3 or not body.isdigit() or any(ch not in CHECK_ALPHABET for ch in check):
        return None
    return body[:2], body[2:], code


def find_voucher_invoice(text):
    """Name of the submitted return whose voucher code this is, or None."""
    parsed = parse_voucher_code(text)
    if not parsed:
        return None
    yy, number, code = parsed
    candidates = frappe.get_all(
        "Sales Invoice",
        filters={"name": ["like", f"%-20{yy}-{number}"], "docstatus": 1, "is_return": 1},
        pluck="name",
    )
    for name in candidates:
        if verify_credit_voucher_code(name, code):
            return name
    return None


def find_return_by_number(text):
    """A submitted return named by its number as staff read it off a receipt
    or Invoice Management: the full name, or its number part ("2026-00257").
    For a supervisor replacing a lost voucher."""
    text = cstr(text).strip().upper()
    if not text:
        return None
    if frappe.db.exists("Sales Invoice", {"name": text, "docstatus": 1, "is_return": 1}):
        return text
    if not all(group.isdigit() for group in text.split("-")) or "-" not in text:
        return None
    matches = frappe.get_all(
        "Sales Invoice",
        filters={"name": ["like", f"%-{text}"], "docstatus": 1, "is_return": 1},
        pluck="name",
        limit=2,
    )
    return matches[0] if len(matches) == 1 else None


def _failure_key():
    return f"posa_credit_voucher_failures:{frappe.session.user}"


def _guard_lookup_attempts():
    if cint(frappe.cache.get_value(_failure_key())) >= LOOKUP_FAILURE_LIMIT:
        frappe.throw(
            _("Too many wrong voucher numbers. Wait 15 minutes, or ask a POS supervisor."),
            frappe.PermissionError,
        )


def _record_lookup_failure():
    key = _failure_key()
    count = cint(frappe.cache.get_value(key)) + 1
    frappe.cache.set_value(key, count, expires_in_sec=LOOKUP_FAILURE_WINDOW_SECONDS)


def is_generic_customer(customer):
    return bool(customer) and bool(
        cint(frappe.db.get_value("Customer", customer, "posa_is_generic_customer"))
    )


def generic_customer_credit_message(customer):
    return _(
        '"{0}" is a shared customer account: store credit on it can\'t be used. '
        "Select the customer the credit belongs to, or scan their credit note voucher."
    ).format(customer)


@frappe.whitelist()
def lookup_credit_voucher(code=None, pos_profile=None):
    """Check a scanned or typed credit note voucher before it is used in
    Payments. Returns the credit note, its customer and the credit left on it.
    Refuses a wrong number (limited per user), another company's voucher, and
    a used or expired one. Spending is checked again at submit."""
    from posawesome.posawesome.api.payments import get_available_credit
    from posawesome.posawesome.api.pos_access import get_authorized_pos_profile

    profile = get_authorized_pos_profile(pos_profile)
    _guard_lookup_attempts()

    name = find_voucher_invoice(code)
    approved_by = None
    if not name:
        # Lost voucher: a POS supervisor on the till may give the return's
        # number instead; spending it is recorded under their name at submit.
        approved_by = _credit_supervisor(profile.get("name"))
        name = find_return_by_number(code) if approved_by else None
    if not name:
        _record_lookup_failure()
        frappe.throw(_("This is not a valid credit note voucher number. Check it and try again."))

    voucher = frappe.db.get_value(
        "Sales Invoice", name, ["name", "customer", "customer_name", "company"], as_dict=True
    )
    label = credit_voucher_label(credit_voucher_code(name))
    if voucher.company != profile.get("company"):
        frappe.throw(_("Voucher {0} belongs to another company.").format(label))
    if is_generic_customer(voucher.customer):
        frappe.throw(generic_customer_credit_message(voucher.customer))

    rows = get_available_credit(voucher.customer, voucher.company, include_expired=1)
    credit = next((r for r in rows["credit"] if r["type"] == "Invoice" and r["credit_origin"] == name), None)
    if not credit:
        expired = next((r for r in rows["expired"] if r["credit_origin"] == name), None)
        if expired:
            frappe.throw(
                _("Voucher {0} expired on {1} and can't be used.").format(
                    label, formatdate(expired["expires_on"])
                )
            )
        frappe.throw(_("Voucher {0} has already been used.").format(label))

    return {
        # The code itself is not shown for a supervisor approval.
        "voucher": name if approved_by else label,
        # No code when a supervisor approved it by return number: the server
        # then authorizes it as the supervisor's at submit.
        "code": "" if approved_by else credit_voucher_code(name),
        "approved_by": approved_by,
        "credit_origin": name,
        "customer": voucher.customer,
        "customer_name": voucher.customer_name,
        "mobile_no": frappe.db.get_value("Customer", voucher.customer, "mobile_no") or "",
        "amount": flt(credit["total_credit"]),
        "expires_on": str(credit["expires_on"]),
    }


def _credit_supervisor(pos_profile):
    from posawesome.posawesome.api.submitted_invoice_edits import get_submitted_invoice_edit_approver

    return get_submitted_invoice_edit_approver(pos_profile)


def authorize_customer_credit(invoice_doc, requested_rows):
    """Every credit row a sale spends through "Use Customer Balance" must be
    authorized (see the module docstring). Sets posa_credit_authorized_by to
    one line per credit row, or throws naming what is missing."""
    if not requested_rows:
        return
    customer = invoice_doc.get("customer")
    if is_generic_customer(customer):
        frappe.throw(generic_customer_credit_message(customer))

    shift = cstr(invoice_doc.get("posa_pos_opening_shift")).strip()
    invoice_origins = [r.get("credit_origin") for r in requested_rows if r.get("type") == "Invoice"]
    origin_shift = {}
    if invoice_origins:
        origin_shift = {
            row.name: cstr(row.posa_pos_opening_shift).strip()
            for row in frappe.get_all(
                "Sales Invoice",
                filters={"name": ["in", invoice_origins]},
                fields=["name", "posa_pos_opening_shift"],
            )
        }

    lines, unauthorized = [], []
    for row in requested_rows:
        origin = cstr(row.get("credit_origin"))
        if row.get("type") == "Invoice" and shift and origin_shift.get(origin) == shift:
            lines.append(_("{0}: same-shift exchange").format(origin))
        elif row.get("type") == "Invoice" and verify_credit_voucher_code(origin, row.get("voucher_code")):
            lines.append(_("{0}: voucher {1}").format(origin, credit_voucher_label(credit_voucher_code(origin))))
        else:
            unauthorized.append(origin)

    if unauthorized:
        approver = _credit_supervisor(invoice_doc.get("pos_profile"))
        if not approver:
            frappe.throw(
                _(
                    "Store credit from {0} needs the customer's credit note voucher: scan it in Payments. "
                    "If the voucher is lost, a POS supervisor must approve: switch the till to a POS "
                    "supervisor with their PIN, then submit again."
                ).format(", ".join(unauthorized)),
                # A business rule, not an access error: a ValidationError
                # (HTTP 417) reaches the POS with its reason; a 403 doesn't.
                frappe.ValidationError,
            )
        full_name = frappe.db.get_value("User", approver, "full_name") or approver
        for origin in unauthorized:
            lines.append(_("{0}: supervisor {1} ({2})").format(origin, full_name, approver))

    meta = frappe.get_meta(invoice_doc.doctype)
    if meta.has_field("posa_credit_authorized_by"):
        invoice_doc.set("posa_credit_authorized_by", "\n".join(lines))
