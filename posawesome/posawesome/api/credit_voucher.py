"""Credit note voucher: the code printed on it, and the reprint log.

A return that refunds no money leaves its whole value as store credit on the
customer's account. "Credit note issue" in the POS prints that credit as a
voucher (posawesome/templates/print/credit_note_voucher.html, included by the
store's receipt format for such a return).

Voucher code = "C" + 2-digit year + invoice number + 4-character check:
ACC-SINV-2026-00247 -> "C2600247K7Q4", printed "C26-00247-K7Q4". A credit
note in a store's own series (invoice_naming.py) carries the store prefix
too: MCO-CN-2026-00001 -> "C26MCO00001K7Q4", printed "C26-MCO-00001-K7Q4";
credit notes in the default series keep the old form, so old vouchers keep
their codes. The check is an HMAC of the full invoice name with this site's
encryption key, so it can't be worked out from the invoice number alone; it
needs no field and is the same on every print and reprint.

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
Bearer voucher: a return linked to its original sale to a shared (generic)
customer such as Anonymous leaves its credit on that shared account, and its
voucher works like cash. That credit can be spent only with its own voucher,
on a sale to the same shared customer -- never by the same-shift rule, never
by a supervisor (a lost bearer voucher can't be replaced), never just by
choosing the shared customer. Other credit on a shared customer (a return
without an invoice, from before this rule) can't be spent at all.

A credit note can be used in part: credit worth more than the sale covers
the sale and the rest stays on the same credit note -- same code, same
expiry. A balance voucher (the voucher with a BALANCE banner, "Used X on
sale Y. Remaining Z.") prints after that sale; record_credit_note_reprint
logs it with balance_for.
"""

import hashlib
import hmac
import re

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, flt, formatdate

CHECK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O, 1/I/L
CHECK_LENGTH = 4
VOUCHER_PREFIX = "C"
# A store's credit note series is <PREFIX>-CN-.YYYY.- (invoice_naming.py).
STORE_RETURN_SEGMENT = "CN"
_STORE_BODY = re.compile(r"^([A-Z]*)(\d+)$")
REPRINT_DOCTYPES = ("Sales Invoice", "POS Invoice")
# Wrong voucher numbers allowed per user before lookups pause, so guessing
# the 4-character check (31^4 = 923,521 values) is impractical.
LOOKUP_FAILURE_LIMIT = 10
LOOKUP_FAILURE_WINDOW_SECONDS = 15 * 60


def _secret():
    from frappe.utils.password import get_encryption_key

    return cstr(get_encryption_key()).encode()


def _name_parts(name):
    """(yy, store, number): "ACC-SINV-2026-00247" -> ("26", "", "00247"),
    "MCO-CN-2026-00001" -> ("26", "MCO", "00001"). The first 4-digit group
    is the year, the next all-digit group the number; store is the letters
    before "-CN" when the year follows "CN" (a store's credit note series),
    else "". None when the name has no year and number groups."""
    groups = cstr(name).strip().split("-")
    for index, group in enumerate(groups[:-1]):
        nxt = groups[index + 1]
        if len(group) == 4 and group.isdigit() and nxt.isdigit():
            store = ""
            if index >= 2 and groups[index - 1].upper() == STORE_RETURN_SEGMENT:
                store = "".join(groups[: index - 1]).upper()
                if not store.isalpha():
                    store = ""
            return group[2:], store, nxt
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
    yy, store, number = parts
    return f"{VOUCHER_PREFIX}{yy}{store}{number}{_check(name)}"


def credit_voucher_label(code):
    """Printed form, "C2600247K7Q4" -> "C26-00247-K7Q4",
    "C26MCO00001K7Q4" -> "C26-MCO-00001-K7Q4". Jinja method."""
    code = cstr(code)
    if len(code) <= 3 + CHECK_LENGTH:
        return code
    body = code[3:-CHECK_LENGTH]
    match = _STORE_BODY.match(body)
    if match and match.group(1):
        body = f"{match.group(1)}-{match.group(2)}"
    return f"{code[:3]}-{body}-{code[-CHECK_LENGTH:]}"


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


def credit_voucher_balance_use(credit_note, sale):
    """Store credit of credit_note spent on sale (0 when none): the credit
    redemption Journal Entries that move credit from the credit note to that
    sale. The balance voucher prints "Used X on sale Y". Jinja method."""
    if not credit_note or not sale:
        return 0
    used = frappe.db.sql(
        """
        select sum(debit_row.debit_in_account_currency)
        from `tabJournal Entry Account` debit_row
        inner join `tabJournal Entry Account` credit_row on credit_row.parent = debit_row.parent
        inner join `tabJournal Entry` je on je.name = debit_row.parent
        where je.docstatus = 1
            and debit_row.reference_type = 'Sales Invoice' and debit_row.reference_name = %s
            and credit_row.reference_type = 'Sales Invoice' and credit_row.reference_name = %s
            and credit_row.credit_in_account_currency > 0
        """,
        (cstr(credit_note), cstr(sale)),
    )
    return flt(used[0][0]) if used and used[0][0] else 0


@frappe.whitelist()
def record_credit_note_reprint(doctype=None, name=None, pos_profile=None, balance_for=None):
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
    # Balance voucher: printed after a sale that used this credit note in
    # part. Not a DUPLICATE: it shows the new balance and the sale.
    used = credit_voucher_balance_use(name, balance_for) if balance_for else 0
    if used > 0:
        remaining = max(-flt(doc.get("outstanding_amount")), 0)
        doc.add_comment(
            "Info",
            _(
                "Balance voucher printed by {0} ({1}) at {2}: {3} used on sale {4}, {5} remaining."
            ).format(
                escape_html(full_name),
                escape_html(cashier),
                escape_html(till),
                frappe.utils.fmt_money(used, doc.precision("grand_total"), currency=doc.get("currency")),
                escape_html(cstr(balance_for)),
                frappe.utils.fmt_money(remaining, doc.precision("grand_total"), currency=doc.get("currency")),
            ),
        )
        return {"credit_note": True, "balance": True, "cashier": cashier}
    doc.add_comment(
        "Info",
        _("Credit note voucher reprinted (DUPLICATE) by {0} ({1}) at {2}.").format(
            escape_html(full_name), escape_html(cashier), escape_html(till)
        ),
    )
    return {"credit_note": True, "balance": False, "cashier": cashier}


def parse_voucher_code(text):
    """(yy, store, number, code) from a typed or scanned voucher number --
    store is "" on a voucher in the default series -- or None when it isn't
    shaped like one."""
    code = normalize_voucher_code(text)
    body = code[len(VOUCHER_PREFIX) : -CHECK_LENGTH] if code.startswith(VOUCHER_PREFIX) else ""
    check = code[-CHECK_LENGTH:]
    if len(body) < 3 or not body[:2].isdigit() or any(ch not in CHECK_ALPHABET for ch in check):
        return None
    match = _STORE_BODY.match(body[2:])
    if not match:
        return None
    return body[:2], match.group(1), match.group(2), code


def find_voucher_invoice(text):
    """Name of the submitted return whose voucher code this is, or None."""
    parsed = parse_voucher_code(text)
    if not parsed:
        return None
    yy, store, number, code = parsed
    # Narrowed by year and number (and "-CN-" for a store's voucher); the
    # code, which includes the store prefix, picks the one return.
    tail = f"%-{STORE_RETURN_SEGMENT}-20{yy}-{number}" if store else f"%-20{yy}-{number}"
    candidates = frappe.get_all(
        "Sales Invoice",
        filters={"name": ["like", tail], "docstatus": 1, "is_return": 1},
        pluck="name",
    )
    for name in candidates:
        if verify_credit_voucher_code(name, code):
            return name
    return None


def find_return_by_number(text, pos_profile=None):
    """A submitted return named by its number as staff read it off a receipt
    or Invoice Management: the full name, or its number part ("2026-00257").
    For a supervisor replacing a lost voucher. With pos_profile, only that
    store's returns: the same number exists in every store's series."""
    text = cstr(text).strip().upper()
    if not text:
        return None
    base = {"docstatus": 1, "is_return": 1}
    if pos_profile:
        base["pos_profile"] = pos_profile
    if frappe.db.exists("Sales Invoice", {**base, "name": text}):
        return text
    if not all(group.isdigit() for group in text.split("-")) or "-" not in text:
        return None
    matches = frappe.get_all(
        "Sales Invoice",
        filters={**base, "name": ["like", f"%-{text}"]},
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


def is_bearer_credit_note(doc):
    """A submitted return linked to its original sale, to a shared (generic)
    customer: its credit is a bearer voucher. doc = a return or its name.
    Jinja method (the voucher prints "works like cash")."""
    if isinstance(doc, str):
        doc = frappe.db.get_value(
            "Sales Invoice", doc, ["is_return", "return_against", "customer", "docstatus"], as_dict=True
        )
    if not doc or not cint(doc.get("is_return")) or cint(doc.get("docstatus")) != 1:
        return False
    return bool(cstr(doc.get("return_against")).strip()) and is_generic_customer(doc.get("customer"))


def bearer_voucher_for(doc):
    """The bearer voucher of a return just made by this till, for the exchange
    that follows it (the till uses it on the new sale). None unless doc is a
    return linked to its original sale, to a shared customer, refunding no
    money -- the voucher the receipt printer prints for it. Only for a doc the
    current request has just created or submitted."""
    if not doc or not cint(doc.get("is_return")) or not cstr(doc.get("return_against")).strip():
        return None
    name = cstr(doc.get("name")).strip()
    if not name or not is_generic_customer(doc.get("customer")):
        return None
    if flt(doc.get("grand_total")) >= 0 or any(
        abs(flt(row.get("amount"))) > 0 for row in (doc.get("payments") or [])
    ):
        return None
    code = credit_voucher_code(name)
    if not code:
        return None
    return {
        "credit_origin": name,
        "code": code,
        "voucher": credit_voucher_label(code),
        "customer": doc.get("customer"),
        "customer_name": doc.get("customer_name") or doc.get("customer"),
        "amount": abs(flt(doc.get("rounded_total") or doc.get("grand_total"))),
        "bearer": 1,
    }


def generic_customer_credit_message(customer):
    """A voucher on a shared customer that isn't a bearer voucher: credit from a
    return without an invoice (or from before bearer vouchers) -- never usable."""
    return _(
        'This voucher is on "{0}", a shared customer account, and its credit wasn\'t '
        "given from the receipt of a sale, so it can't be used."
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
        name = find_return_by_number(code, profile.get("name")) if approved_by else None
    if not name:
        _record_lookup_failure()
        frappe.throw(_("This is not a valid credit note voucher number. Check it and try again."))

    voucher = frappe.db.get_value(
        "Sales Invoice", name, ["name", "customer", "customer_name", "company"], as_dict=True
    )
    label = credit_voucher_label(credit_voucher_code(name))
    if voucher.company != profile.get("company"):
        frappe.throw(_("Voucher {0} belongs to another company.").format(label))
    bearer = is_generic_customer(voucher.customer)
    if bearer:
        # Works like cash: only the voucher itself, never a supervisor's
        # approval by return number; and only a return linked to its sale.
        if approved_by:
            frappe.throw(lost_bearer_voucher_message(voucher.customer_name or voucher.customer))
        if not is_bearer_credit_note(name):
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
        "bearer": 1 if bearer else 0,
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
        _authorize_bearer_credit(invoice_doc, requested_rows)
        return

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


def lost_bearer_voucher_message(customer):
    return _(
        "This credit is from a sale to {0}: its voucher works like cash, so a lost "
        "voucher can't be replaced, not even by a supervisor."
    ).format(customer)


def _authorize_bearer_credit(invoice_doc, requested_rows):
    """A sale to a shared customer spends only bearer credit notes whose own
    voucher was scanned or typed (see the module docstring)."""
    lines, refused = [], []
    for row in requested_rows:
        origin = cstr(row.get("credit_origin"))
        if (
            row.get("type") == "Invoice"
            and is_bearer_credit_note(origin)
            and verify_credit_voucher_code(origin, row.get("voucher_code"))
        ):
            lines.append(_("{0}: voucher {1}").format(origin, credit_voucher_label(credit_voucher_code(origin))))
        else:
            refused.append(origin or cstr(row.get("type")))
    if refused:
        frappe.throw(
            _(
                'Credit on "{0}", a shared customer account, can only be used with its own '
                "voucher: scan the voucher in Payments. Not usable here: {1}."
            ).format(invoice_doc.get("customer"), ", ".join(refused)),
            frappe.ValidationError,
        )
    meta = frappe.get_meta(invoice_doc.doctype)
    if meta.has_field("posa_credit_authorized_by"):
        invoice_doc.set("posa_credit_authorized_by", "\n".join(lines))
