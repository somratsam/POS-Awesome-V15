"""Backfill Style Name and MRP No VAT on Sales Invoice Item for invoices saved
before these reporting fields existed.

New invoices get them from invoice_reporting_fields.set_invoice_reporting_fields
(Sales Invoice validate hook), as a snapshot when the invoice is saved.

- Style Name comes from the line's own Item (custom_style_name), its *current*
  value -- there is no history of earlier values. That Item field is made by
  hand on the sites that use it and is never created by this app; on a site
  without it this part is skipped. A blank on the Item stays blank.
- MRP No VAT is computed from each line's stored Price List Rate (the MRP when
  sold) and its invoice's stored tax rows, with the same function the save
  hook uses, so old and new invoices agree.

Reported (migrate output + Error Log): lines with no Price List Rate (MRP No
VAT is 0) and lines whose inclusive tax isn't "On Net Total" (left blank).
Idempotent: a second run changes nothing.
"""

import json
import pathlib

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field
from frappe.utils import flt

from posawesome.posawesome.api.invoice_reporting_fields import mrp_excl_vat

FIELD_NAMES = (
    "Sales Invoice Item-posa_item_style_name",
    "Sales Invoice Item-posa_item_mrp_excl_vat",
)
FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "custom_field.json"
SKIP_KEYS = {"doctype", "dt", "name"}
STYLE_NAME_ITEM_FIELD = "custom_style_name"
INVOICE_BATCH = 500
UPDATE_BATCH = 1000
EPSILON = 0.0000001


def execute():
    # Patches run before fixture sync, so create the columns here from the
    # fixture's own definitions (fixture sync re-applies them right after).
    _ensure_custom_fields()
    notes = []

    # Same test as the save hook (the field is defined on Item), plus the
    # column itself: a deleted Custom Field leaves its column behind.
    if frappe.get_meta("Item").has_field(STYLE_NAME_ITEM_FIELD) and frappe.db.has_column(
        "Item", STYLE_NAME_ITEM_FIELD
    ):
        frappe.db.sql(
            """
            UPDATE `tabSales Invoice Item` sii
            JOIN `tabItem` item ON item.name = sii.item_code
            SET sii.posa_item_style_name = TRIM(item.custom_style_name)
            WHERE IFNULL(sii.posa_item_style_name, '') = '' AND TRIM(IFNULL(item.custom_style_name, '')) != ''
            """
        )
    else:
        notes.append(
            f"Item has no {STYLE_NAME_ITEM_FIELD} field on this site: Style Name was not copied (nothing to copy)."
        )

    no_price, unsupported = backfill_mrp_excl_vat()

    problems = _report_problems(no_price, unsupported)
    for note in notes:
        print("Style Name / MRP No VAT backfill: " + note)
    if problems:
        message = "\n".join(problems)
        print("Style Name / MRP No VAT backfill -- please review:\n" + message)
        frappe.log_error(title="Style Name / MRP No VAT backfill: lines to review", message=message)
    else:
        print("Style Name / MRP No VAT backfill: done, nothing to review.")


def backfill_mrp_excl_vat():
    """Returns (invoices with lines that have no Price List Rate, invoices with
    an unsupported inclusive tax)."""
    no_price, unsupported = set(), set()
    parents = frappe.db.sql("SELECT DISTINCT parent FROM `tabSales Invoice Item` ORDER BY parent", pluck=True)
    for start in range(0, len(parents), INVOICE_BATCH):
        batch = tuple(parents[start : start + INVOICE_BATCH])
        taxes = {}
        for tax in frappe.db.sql(
            """
            SELECT parent, account_head, rate, charge_type, included_in_print_rate
            FROM `tabSales Taxes and Charges`
            WHERE parenttype = 'Sales Invoice' AND parent IN %(parents)s
            ORDER BY parent, idx
            """,
            {"parents": batch},
            as_dict=True,
        ):
            taxes.setdefault(tax.parent, []).append(tax)

        # Group line names by their new value: one UPDATE per distinct value.
        updates = {}
        for line in frappe.db.sql(
            """
            SELECT name, parent, price_list_rate, item_tax_rate, posa_item_mrp_excl_vat AS current
            FROM `tabSales Invoice Item`
            WHERE parent IN %(parents)s
            """,
            {"parents": batch},
            as_dict=True,
        ):
            value = mrp_excl_vat(line.price_list_rate, line.item_tax_rate, taxes.get(line.parent, []))
            if value is None:
                unsupported.add(line.parent)
            elif not flt(line.price_list_rate):
                no_price.add(line.parent)
            if value is None and line.current is None:
                continue
            if value is not None and line.current is not None and abs(flt(line.current) - value) < EPSILON:
                continue
            updates.setdefault(value, []).append(line.name)

        for value, names in updates.items():
            for i in range(0, len(names), UPDATE_BATCH):
                frappe.db.sql(
                    "UPDATE `tabSales Invoice Item` SET posa_item_mrp_excl_vat = %(value)s WHERE name IN %(names)s",
                    {"value": value, "names": tuple(names[i : i + UPDATE_BATCH])},
                )
    return sorted(no_price), sorted(unsupported)


def _report_problems(no_price, unsupported):
    lines = []
    if no_price:
        lines.append(
            f"{len(no_price)} invoice(s) have line(s) with no Price List Rate; their MRP No VAT is 0:"
        )
        lines.extend(f"  {name}" for name in no_price[:50])
        if len(no_price) > 50:
            lines.append(f"  ... and {len(no_price) - 50} more")
    if unsupported:
        lines.append(
            f"{len(unsupported)} invoice(s) have a tax-inclusive charge type other than On Net Total; "
            "their MRP No VAT was left blank:"
        )
        lines.extend(f"  {name}" for name in unsupported[:50])
        if len(unsupported) > 50:
            lines.append(f"  ... and {len(unsupported) - 50} more")
    return lines


def _ensure_custom_fields():
    fixture = {row["name"]: row for row in json.loads(FIXTURE_PATH.read_text())}
    for name in FIELD_NAMES:
        definition = fixture[name]
        if not frappe.db.exists("Custom Field", name):
            create_custom_field(
                definition["dt"],
                {key: value for key, value in definition.items() if key not in SKIP_KEYS},
            )
        frappe.clear_cache(doctype=definition["dt"])
