# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""Bulk Add Values on the Item Attribute form.

Paste one value per line; Check previews what would happen, Add appends only
the missing values with a normal doc.save(). Existing rows are never changed or
removed, and both calls re-check everything server-side from the pasted text.
"""

import re

import frappe
from frappe import _

MAX_LINES = 2000
MAX_VALUE_LENGTH = 140  # Data field length of attribute_value / abbr
MAX_TEXT_LENGTH = 400_000  # 2,000 lines of 200 characters
SHOWN_REJECTED_LENGTH = 160  # rejected lines are echoed back cut to this
SAVEPOINT = "posa_bulk_attribute_values"


def normalize_value(line):
    """Trim and collapse inner runs of spaces; case and all other characters kept."""
    return re.sub(r" {2,}", " ", line.replace("\xa0", " ").strip())


def split_lines(text):
    lines = re.split(r"\r\n|\r|\n", text)
    # Excel ends a copied column with a newline; that last empty line isn't a value.
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def classify_lines(text, existing_rows):
    """Sort pasted lines into to_add / existing / duplicates / abbr_clashes / rejected.

    existing_rows: the attribute's current rows (attribute_value, abbr).
    The new value's abbr is the value itself.
    """
    if len(text) > MAX_TEXT_LENGTH:
        frappe.throw(
            _("The pasted text is too long. Paste at most {0} lines at a time.").format(MAX_LINES),
            title=_("Too Many Lines"),
        )
    lines = split_lines(text)
    if len(lines) > MAX_LINES:
        frappe.throw(
            _("Too many lines: {0}. Paste at most {1} lines at a time.").format(len(lines), MAX_LINES),
            title=_("Too Many Lines"),
        )

    existing_values = {(row.attribute_value or "").lower() for row in existing_rows}
    abbr_owner = {(row.abbr or "").lower(): row for row in existing_rows}

    result = {
        "total_lines": len(lines),
        "to_add": [],
        "existing": [],
        "duplicates": [],
        "abbr_clashes": [],
        "rejected": [],
    }

    def reject(line_no, value, reason):
        result["rejected"].append({"line": line_no, "value": value[:SHOWN_REJECTED_LENGTH], "reason": reason})

    seen = set()
    for line_no, raw in enumerate(lines, start=1):
        if "\t" in raw:
            reject(line_no, raw, _("contains a tab (more than one column copied)"))
            continue
        value = normalize_value(raw)
        if not value:
            reject(line_no, raw, _("empty"))
            continue
        if len(value) > MAX_VALUE_LENGTH:
            reject(line_no, value, _("longer than {0} characters").format(MAX_VALUE_LENGTH))
            continue

        key = value.lower()
        if key in seen:
            result["duplicates"].append({"line": line_no, "value": value})
            continue
        seen.add(key)

        if key in existing_values:
            result["existing"].append(value)
        elif key in abbr_owner:
            owner = abbr_owner[key]
            result["abbr_clashes"].append(
                {"value": value, "abbr": owner.abbr, "existing_value": owner.attribute_value}
            )
        else:
            result["to_add"].append(value)

    return result


def _get_attribute_for_write(attribute, for_update=False):
    if not isinstance(attribute, str) or not attribute:
        frappe.throw(_("Item Attribute is required."))
    frappe.has_permission("Item Attribute", "write", throw=True)
    doc = frappe.get_doc("Item Attribute", attribute, for_update=for_update)
    doc.check_permission("write")
    if doc.numeric_values:
        frappe.throw(
            _("{0} uses numeric values; values can't be added in bulk.").format(frappe.bold(doc.name)),
            title=_("Numeric Attribute"),
        )
    return doc


def _check_text(text):
    if text is None:
        return ""
    if not isinstance(text, str):
        frappe.throw(_("Paste the values as text, one per line."))
    return text


@frappe.whitelist(methods=["POST"])
def preview_bulk_attribute_values(attribute, text=None):
    """Step 1 (Check): what Add would do. Makes no changes."""
    doc = _get_attribute_for_write(attribute)
    result = classify_lines(_check_text(text), doc.item_attribute_values)
    result["attribute"] = doc.name
    return result


@frappe.whitelist(methods=["POST"])
def add_bulk_attribute_values(attribute, text=None):
    """Step 2 (Add): append only the missing values, all or nothing.

    Recomputed from the pasted text against the attribute as it is now (locked
    for this save), so a value added since the preview is reported as existing.
    """
    text = _check_text(text)
    doc = _get_attribute_for_write(attribute, for_update=True)
    result = classify_lines(text, doc.item_attribute_values)
    result["attribute"] = doc.name

    if result["to_add"]:
        for value in result["to_add"]:
            doc.append("item_attribute_values", {"attribute_value": value, "abbr": value})
        frappe.db.savepoint(SAVEPOINT)
        try:
            # Normal save: permissions, ERPNext validation and a Version row.
            doc.save()
        except Exception:
            frappe.db.rollback(save_point=SAVEPOINT)
            raise

    result["added"] = len(result["to_add"])
    result["already_existed"] = len(result["existing"])
    return result
