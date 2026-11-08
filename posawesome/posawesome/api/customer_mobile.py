"""One mobile number per customer, in one format.

clean_mobile() is the single rule for how a customer's mobile number is
stored, compared and searched:
- spaces, dashes, brackets, dots and "+" are removed;
- an Omani number (8 digits, or 968 / 00968 / +968 followed by 8 digits)
  becomes the plain 8-digit local number, so "9123 4567", "91234567" and
  "+968 91234567" are the same number;
- any other number is foreign and is kept as "+" and its digits
  ("+44 7700 900123", "0044 7700 900123" and "447700900123" ->
  "+447700900123");
- a number shorter than 8 digits keeps its digits as typed.

The same rule is in the till (frontend utils/customerMobile.ts), so the
till's own offline check and the server agree.

A mobile number may belong to one active customer only. The Customer and
Contact save hooks clean the number and refuse a second customer with it;
names may still repeat (POS Profile "Allow Duplicate Customer Names").
"""

import re

import frappe
from frappe import _

OMAN_CODE = "968"
LOCAL_LENGTH = 8


def clean_mobile(value):
    text = str(value or "").strip()
    digits = re.sub(r"\D", "", text)
    if not digits:
        return ""
    international = text.startswith("+") or digits.startswith("00")
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == LOCAL_LENGTH and not international:
        return digits
    if digits.startswith(OMAN_CODE) and len(digits) == len(OMAN_CODE) + LOCAL_LENGTH:
        return digits[len(OMAN_CODE):]
    if international or len(digits) > LOCAL_LENGTH:
        return "+" + digits
    return digits


def find_customer_with_mobile(mobile_no, exclude_customers=None):
    """The active customer (other than exclude_customers) whose mobile number
    is the same number as mobile_no, in any stored format; None if none."""
    key = clean_mobile(mobile_no)
    if not key:
        return None
    exclude = [name for name in (exclude_customers or []) if name]
    tail = re.sub(r"\D", "", key)[-LOCAL_LENGTH:]
    # Older rows may still be stored with spaces or a country code, so the
    # candidates are found on the digits alone and checked with clean_mobile.
    rows = frappe.db.sql(
        """
        SELECT name, customer_name, mobile_no
        FROM `tabCustomer`
        WHERE disabled = 0
          AND IFNULL(mobile_no, '') != ''
          AND REGEXP_REPLACE(mobile_no, '[^0-9]', '') LIKE %(tail)s
        ORDER BY creation
        LIMIT 50
        """,
        {"tail": f"%{tail}"},
        as_dict=True,
    )
    for row in rows:
        if row.name in exclude:
            continue
        if clean_mobile(row.mobile_no) == key:
            return row
    return None


def duplicate_mobile_message(existing):
    return _("Customer already exists: {0}, {1}").format(
        existing.get("customer_name") or existing.get("name"),
        clean_mobile(existing.get("mobile_no")) or existing.get("mobile_no"),
    )


def assert_mobile_free(mobile_no, exclude_customers=None):
    existing = find_customer_with_mobile(mobile_no, exclude_customers)
    if existing:
        frappe.throw(duplicate_mobile_message(existing), title=_("Duplicate mobile number"))


def _mobile_changed(doc, fieldname):
    if doc.is_new():
        return True
    before = doc.get_doc_before_save()
    if not before:
        return True
    return clean_mobile(before.get(fieldname)) != clean_mobile(doc.get(fieldname))


def validate_customer_mobile(doc):
    """Customer validate hook: store the clean number and refuse a number
    another customer already has. Only checked when the number changes, so
    an old pair that already shares a number can still be saved."""
    doc.mobile_no = clean_mobile(doc.mobile_no) or None
    if doc.disabled or not doc.mobile_no:
        return
    if _mobile_changed(doc, "mobile_no"):
        assert_mobile_free(doc.mobile_no, [doc.name])


def _linked_customers(contact):
    return [
        link.link_name
        for link in (contact.get("links") or [])
        if link.link_doctype == "Customer" and link.link_name
    ]


def validate_contact_mobile(doc, method=None):
    """Contact validate hook: a customer's contact keeps its numbers in the
    same clean format (the Customer's mobile number is read from it), and
    may not take a number another customer already has."""
    customers = _linked_customers(doc)
    if not customers:
        return
    for row in doc.get("phone_nos") or []:
        row.phone = clean_mobile(row.phone) or row.phone
    # Contact.validate set these from the rows before they were cleaned.
    doc.mobile_no = clean_mobile(doc.mobile_no) or None
    doc.phone = clean_mobile(doc.phone) or None
    if doc.mobile_no and _mobile_changed(doc, "mobile_no"):
        assert_mobile_free(doc.mobile_no, customers)
