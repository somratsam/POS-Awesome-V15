# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from posawesome.posawesome.api.discount_reasons import NOT_RECORDED

# The receipt prints "Discount <reason> ...", so a reason named
# "... Discount ..." would read "Discount ... Discount ...".
_DISCOUNT_WORD = re.compile(r"\bdiscount\b", re.IGNORECASE)


def _check_reason_name(name):
    if _DISCOUNT_WORD.search(name or ""):
        frappe.throw(
            _("Leave the word \"Discount\" out of the reason name: the receipt already prints it before the reason.")
        )


class POSDiscountReason(Document):
    def validate(self):
        self.reason_name = (self.reason_name or "").strip()
        _check_reason_name(self.reason_name)
        # Only "Not recorded" is a system reason; nobody can mark another one.
        is_not_recorded = self.reason_name == NOT_RECORDED
        self.is_system = 1 if is_not_recorded else 0
        if is_not_recorded:
            self.enabled = 1

    def before_rename(self, old, new, merge=False):
        if NOT_RECORDED in (old, new):
            frappe.throw(
                _("\"{0}\" marks discounts submitted without a reason and cannot be renamed.").format(NOT_RECORDED)
            )
        _check_reason_name(new)

    def on_trash(self):
        if self.name == NOT_RECORDED:
            frappe.throw(_("\"{0}\" is used to mark discounts submitted without a reason and cannot be deleted.").format(NOT_RECORDED))
