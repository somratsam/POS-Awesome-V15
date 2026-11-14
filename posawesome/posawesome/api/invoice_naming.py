"""Invoice numbering per store.

Each POS Profile can name its own Sales Invoice series in "Invoice Naming
Series" (posa_invoice_naming_series), e.g. "MCO-.YYYY.-" for MAX&Co: its
sales are then MCO-2026-00001, MCO-2026-00002, ... and its returns (credit
notes) MCO-CN-2026-00001, ... -- the same prefix plus "-CN", with its own
counter. The year in the name restarts the counter every January.

The series is set here, on the server, from the invoice's POS Profile; what
the till sends is ignored. A POS Profile with no series keeps the default
ACC-SINV-.YYYY.- for its sales and returns. Both series must first be added
to Sales Invoice's series list in Document Naming Settings (that is also
where their counters are seen and set).

An amended invoice (Edit Invoice) is named by Frappe from the original
(<original>-1) and keeps the original's series, so old invoices stay in the
old series. Existing invoices are never renamed.

The prefix is capital letters only (one or more groups joined by "-", at
most 4 characters in all): the credit note voucher code carries it
(C26-MCO-00001-K7Q4, credit_voucher.py) and the receipt barcode carries the
whole invoice name (print_barcode.py); both stay within 16 characters, the
longest Code 128 that decoded at 171-203 dpi on a 64 mm receipt barcode.
"""

import re

import frappe
from frappe import _
from frappe.utils import cstr

DEFAULT_SERIES = "ACC-SINV-.YYYY.-"
RETURN_SEGMENT = "CN"
SERIES_SUFFIX = "-.YYYY.-"
MAX_PREFIX_LENGTH = 4
SERIES_FIELD = "posa_invoice_naming_series"
_SERIES_PATTERN = re.compile(r"^([A-Z]+(?:-[A-Z]+)*)-\.YYYY\.-$")


def sales_invoice_series_options():
    """The series listed for Sales Invoice in Document Naming Settings."""
    field = frappe.get_meta("Sales Invoice").get_field("naming_series")
    return [line.strip() for line in cstr(field.options if field else "").split("\n") if line.strip()]


def return_series_for(series):
    """"MCO-.YYYY.-" -> "MCO-CN-.YYYY.-"."""
    return f"{cstr(series)[: -len(SERIES_SUFFIX)]}-{RETURN_SEGMENT}{SERIES_SUFFIX}"


def store_series_choices():
    """Series a POS Profile can pick: listed sales series of the right shape
    whose credit note series is listed too."""
    options = sales_invoice_series_options()
    return [series for series in options if not series_problem(series, options)]


def series_problem(series, options=None):
    """Why series can't be a store's invoice series, or None when it can."""
    series = cstr(series).strip()
    match = _SERIES_PATTERN.match(series)
    if series == DEFAULT_SERIES:
        return _("{0} is the default series. Leave Invoice Naming Series blank to use it.").format(series)
    if not match:
        return _(
            "{0} is not a store series. Use capital letters followed by -.YYYY.-, for example MCO-.YYYY.-"
        ).format(series)
    prefix = match.group(1)
    if RETURN_SEGMENT in prefix.split("-"):
        return _("{0} is a credit note series. Pick the store's sales series.").format(series)
    if len(prefix) > MAX_PREFIX_LENGTH:
        return _(
            "The prefix of {0} is longer than {1} characters, which makes the receipt barcode too long to scan."
        ).format(series, MAX_PREFIX_LENGTH)
    options = sales_invoice_series_options() if options is None else options
    missing = [s for s in (series, return_series_for(series)) if s not in options]
    if missing:
        return _("Add {0} to Sales Invoice in Document Naming Settings first.").format(
            _(" and ").join(missing)
        )
    return None


def validate_pos_profile(doc, method=None):
    """POS Profile validate: the picked series must be usable."""
    series = cstr(doc.get(SERIES_FIELD)).strip()
    if not series:
        return
    problem = series_problem(series)
    if problem:
        frappe.throw(problem, title=_("Invoice Naming Series"))
    doc.set(SERIES_FIELD, series)


def series_for_invoice(pos_profile, is_return):
    """The series a new invoice of this POS Profile is named from."""
    series = ""
    if pos_profile:
        series = cstr(frappe.db.get_value("POS Profile", pos_profile, SERIES_FIELD)).strip()
    if not series or not _SERIES_PATTERN.match(series) or series == DEFAULT_SERIES:
        return DEFAULT_SERIES
    return return_series_for(series) if is_return else series


def set_invoice_naming_series(doc, method=None):
    """Sales Invoice before_naming: series from the POS Profile, never from
    the till. Invoices without a POS Profile (made in Desk) are left alone."""
    amended_from = cstr(doc.get("amended_from")).strip()
    if amended_from:
        # Frappe names it <original>-N; keep the original's series with it.
        original = frappe.db.get_value(doc.doctype, amended_from, "naming_series")
        if original:
            doc.naming_series = original
        return
    if not cstr(doc.get("pos_profile")).strip():
        return
    doc.naming_series = series_for_invoice(doc.get("pos_profile"), bool(int(doc.get("is_return") or 0)))


@frappe.whitelist()
def get_store_series_choices():
    """For the POS Profile form's Invoice Naming Series list."""
    if not frappe.has_permission("POS Profile", "read"):
        return []
    return store_series_choices()
