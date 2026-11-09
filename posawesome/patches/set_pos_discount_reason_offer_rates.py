"""Fill in the usual bank offer rate (POS Discount Reason "Offer %") for the
seeded bank reasons.

A reminder for cashiers only: the till shows it next to the reason and warns
when a line's Disc % differs; nothing applies it to a line, and the receipt
and Z Report never read it.

Only fills a blank (0) rate on a reason with exactly this name: a rate a
manager already set is never changed, a renamed or missing reason is
skipped, and other reasons stay blank. Rates are edited in Desk afterwards.
"""

import frappe
from frappe.utils import flt

from posawesome.posawesome.api.discount_reasons import REASON_DOCTYPE

OFFER_RATES = (
    ("NBO Sadara", 20),
    ("NBO Infinite / Platinum", 20),
    ("OAB Elite / Infinite", 20),
    ("OAB Credit Card", 10),
    ("Bank Dhofar Al Riadah", 20),
    ("Bank Muscat Private Banking", 20),
    ("Bank Muscat Asalah", 15),
    ("Bank Muscat Al Jawhar", 10),
    ("Bank Muscat Oman Air Platinum", 10),
)


def execute():
    frappe.reload_doc("posawesome", "doctype", "pos_discount_reason")

    for reason, rate in OFFER_RATES:
        current = frappe.db.get_value(REASON_DOCTYPE, reason, "offer_percentage")
        if current is None or flt(current) > 0:
            continue
        # A one-time data fill, not a manager's edit: modified stays as is.
        frappe.db.set_value(REASON_DOCTYPE, reason, "offer_percentage", rate, update_modified=False)
