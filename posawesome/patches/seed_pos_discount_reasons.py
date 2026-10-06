"""Seed the POS Discount Reasons cashiers pick from, plus the hidden system
reason "Not recorded" (discounted lines submitted without a reason).

Idempotent: a reason that already exists is skipped -- never edited,
re-enabled or re-ordered -- so reasons a manager added or changed by hand
are left alone, and a second run changes nothing. The one exception is a
bank/WGO reason still under its earlier "– xx%" name (PREVIOUS_NAMES):
that record is renamed with frappe.rename_doc rather than duplicated. Pick-only:
no reason asks for a note. Names never contain the word "Discount", which the
receipt already prints in front of the reason.

The one removal: "Mastercard", from an earlier seed, is deleted only if no
invoice line uses it; otherwise it is kept and reported.

Patches run before doctype sync here, hence the reload_doc.
"""

import frappe
from frappe.model import rename_doc as rename_doc_module

from posawesome.posawesome.api.discount_reasons import NOT_RECORDED, REASON_DOCTYPE

# (reason, display order). Bank offers first, then the others.
STARTING_REASONS = (
    ("NBO Sadara", 1),
    ("NBO Infinite / Platinum", 2),
    ("OAB Elite / Infinite", 3),
    ("OAB Credit Card", 4),
    ("Bank Dhofar Al Riadah", 5),
    ("Bank Muscat Private Banking", 6),
    ("Bank Muscat Asalah", 7),
    ("Bank Muscat Al Jawhar", 8),
    ("Bank Muscat Oman Air Platinum", 9),
    ("WGO", 10),
    ("VIP", 11),
    ("H.H Family", 12),
    ("Sale", 13),
    ("Staff", 14),
    ("Damaged item", 15),
    ("Manager approval", 16),
    ("Other / General", 17),
    (NOT_RECORDED, 99),
)

# Earlier seeded names (with the offer percentage). A site that still has one
# gets it renamed -- links on invoice lines follow -- instead of a duplicate.
PREVIOUS_NAMES = {
    "NBO Sadara": "NBO Sadara – 20%",
    "NBO Infinite / Platinum": "NBO Infinite / Platinum – 20%",
    "OAB Elite / Infinite": "OAB Elite / Infinite – 20%",
    "OAB Credit Card": "OAB Credit Card – 10%",
    "Bank Dhofar Al Riadah": "Bank Dhofar Al Riadah – 20%",
    "Bank Muscat Private Banking": "Bank Muscat Private Banking – 20%",
    "Bank Muscat Asalah": "Bank Muscat Asalah – 15%",
    "Bank Muscat Al Jawhar": "Bank Muscat Al Jawhar – 10%",
    "Bank Muscat Oman Air Platinum": "Bank Muscat Oman Air Platinum – 10%",
    "WGO": "WGO – 15%",
}

RETIRED_SEEDED_REASONS = ("Mastercard",)
INVOICE_ITEM_DOCTYPES = ("Sales Invoice Item", "POS Invoice Item")


def _reason_in_use(reason):
    return any(
        frappe.db.exists(doctype, {"posa_discount_reason": reason})
        for doctype in INVOICE_ITEM_DOCTYPES
        if frappe.db.has_column(doctype, "posa_discount_reason")
    )


def rename_kwargs(old, new):
    return {
        "doctype": REASON_DOCTYPE,
        "old": old,
        "new": new,
        "ignore_permissions": True,
        "show_alert": False,
    }


def execute():
    frappe.reload_doc("posawesome", "doctype", "pos_discount_reason")

    for reason, display_order in STARTING_REASONS:
        if frappe.db.exists(REASON_DOCTYPE, reason):
            # Already there (seeded, renamed or added by hand): leave it -- and
            # any old-named copy next to it -- exactly as it is.
            continue
        previous = PREVIOUS_NAMES.get(reason)
        if previous and frappe.db.exists(REASON_DOCTYPE, previous):
            # The model-level rename (the frappe.rename_doc wrapper takes no
            # ignore_permissions); links on invoice lines are updated too.
            rename_doc_module.rename_doc(**rename_kwargs(previous, reason))
            continue
        frappe.get_doc(
            {
                "doctype": REASON_DOCTYPE,
                "reason_name": reason,
                "enabled": 1,
                "display_order": display_order,
            }
        ).insert(ignore_permissions=True)

    for reason in RETIRED_SEEDED_REASONS:
        if not frappe.db.exists(REASON_DOCTYPE, reason):
            continue
        if _reason_in_use(reason):
            print(f'POS Discount Reason "{reason}" is used on invoice lines, so it was kept.')
            continue
        frappe.delete_doc(REASON_DOCTYPE, reason, ignore_permissions=True)
