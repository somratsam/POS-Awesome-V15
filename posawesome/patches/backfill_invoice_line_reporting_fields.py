"""Backfill Parent Style, Season, Collection and Item VAT on Sales Invoice Item
for invoices saved before these reporting fields existed.

New invoices get them from invoice_reporting_fields.set_invoice_reporting_fields
(Sales Invoice validate hook), as a snapshot when the invoice is saved. This
backfill can only copy each Item's *current* Parent Style / Season /
Collection -- there is no history of earlier values.

- Season / Collection come from the line's own Item (custom_season /
  custom_collection). Those Item fields are made by hand on the sites that
  use them and are never created by this app; on a site without them this
  part is skipped. A blank on the Item is intentional and stays blank.
- Item VAT is copied exactly from the stored Item Wise Tax Detail rows
  (fixed "Actual" charges excluded); untaxed invoices keep 0. Only a taxed
  invoice with no stored breakdown falls back to amount - net_amount (prices
  include VAT), which can be off by the rounding cent -- those are reported.

Reported (migrate output + Error Log): lines whose Item no longer exists and
taxed invoices that needed the approximate VAT. Blanks are not reported.
Idempotent: a second run writes the same values again.
"""

import json
import pathlib

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD_NAMES = (
    "Sales Invoice Item-posa_item_variant_of",
    "Sales Invoice Item-posa_item_season",
    "Sales Invoice Item-posa_item_collection",
    "Sales Invoice Item-posa_item_vat",
)
FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "custom_field.json"
SKIP_KEYS = {"doctype", "dt", "name"}
# Item field -> invoice line field (the Item fields only exist where made by hand).
OPTIONAL_ITEM_COPIES = {
    "custom_season": "posa_item_season",
    "custom_collection": "posa_item_collection",
}
VAT_EPSILON = 0.0000001


def execute():
    # Patches run before fixture sync, so create the columns here from the
    # fixture's own definitions (fixture sync re-applies them right after).
    _ensure_custom_fields()
    notes = []

    frappe.db.sql(
        """
        UPDATE `tabSales Invoice Item` sii
        JOIN `tabItem` item ON item.name = sii.item_code
        SET sii.posa_item_variant_of = item.variant_of
        WHERE IFNULL(sii.posa_item_variant_of, '') = '' AND IFNULL(item.variant_of, '') != ''
        """
    )

    missing_item_fields = []
    item_meta = frappe.get_meta("Item")
    for item_field, line_field in OPTIONAL_ITEM_COPIES.items():
        # Same test as the save hook (the field is defined on Item), plus the
        # column itself: a deleted Custom Field leaves its column behind.
        if not (item_meta.has_field(item_field) and frappe.db.has_column("Item", item_field)):
            missing_item_fields.append(item_field)
            continue
        frappe.db.sql(
            f"""
            UPDATE `tabSales Invoice Item` sii
            JOIN `tabItem` item ON item.name = sii.item_code
            SET sii.`{line_field}` = TRIM(item.`{item_field}`)
            WHERE IFNULL(sii.`{line_field}`, '') = '' AND TRIM(IFNULL(item.`{item_field}`, '')) != ''
            """
        )
    if missing_item_fields:
        notes.append(
            "Item has no " + " / ".join(missing_item_fields) + " field on this site: "
            "Season/Collection were not copied (nothing to copy)."
        )

    approximate = backfill_line_vat()

    problems = _report_problems(approximate)
    for note in notes:
        print("Invoice line reporting backfill: " + note)
    if problems:
        message = "\n".join(problems)
        print("Invoice line reporting backfill -- please review:\n" + message)
        frappe.log_error(title="Invoice line reporting backfill: lines to review", message=message)
    else:
        print("Invoice line reporting backfill: done, nothing to review.")


def backfill_line_vat():
    """Exact VAT from stored breakdown rows; returns invoices that needed the
    approximate amount - net_amount."""
    # 1. Exact, from Item Wise Tax Detail (VAT rows only, not "Actual" charges).
    frappe.db.sql(
        """
        UPDATE `tabSales Invoice Item` sii
        JOIN (
            SELECT w.item_row, SUM(w.amount) AS vat
            FROM `tabItem Wise Tax Detail` w
            JOIN `tabSales Taxes and Charges` t ON t.name = w.tax_row
            WHERE w.parenttype = 'Sales Invoice' AND t.charge_type != 'Actual'
            GROUP BY w.item_row
        ) breakdown ON breakdown.item_row = sii.name
        SET sii.posa_item_vat = breakdown.vat
        """
    )

    # 2. Taxed invoices whose lines have no stored breakdown at all: approximate.
    approximate = frappe.db.sql(
        """
        SELECT DISTINCT sii.parent
        FROM `tabSales Invoice Item` sii
        WHERE ABS(IFNULL(sii.posa_item_vat, 0)) < %(eps)s
          AND ABS(sii.amount - sii.net_amount) >= %(eps)s
          AND EXISTS (
              SELECT 1 FROM `tabSales Taxes and Charges` t
              WHERE t.parent = sii.parent AND t.parenttype = 'Sales Invoice' AND t.charge_type != 'Actual'
          )
          AND NOT EXISTS (
              SELECT 1 FROM `tabItem Wise Tax Detail` w
              WHERE w.parent = sii.parent AND w.parenttype = 'Sales Invoice' AND w.item_row = sii.name
          )
        """,
        {"eps": VAT_EPSILON},
        pluck=True,
    )
    if approximate:
        frappe.db.sql(
            """
            UPDATE `tabSales Invoice Item` sii
            SET sii.posa_item_vat = ROUND(sii.amount - sii.net_amount, 3)
            WHERE sii.parent IN %(parents)s
              AND NOT EXISTS (
                  SELECT 1 FROM `tabItem Wise Tax Detail` w
                  WHERE w.parent = sii.parent AND w.parenttype = 'Sales Invoice' AND w.item_row = sii.name
              )
            """,
            {"parents": tuple(approximate)},
        )
    # Untaxed invoices: the column default (0) is already right.
    return approximate


def _report_problems(approximate):
    lines = []
    orphans = frappe.db.sql(
        """
        SELECT sii.item_code, COUNT(*) AS line_count
        FROM `tabSales Invoice Item` sii
        LEFT JOIN `tabItem` item ON item.name = sii.item_code
        WHERE item.name IS NULL
        GROUP BY sii.item_code
        ORDER BY line_count DESC
        """,
        as_dict=True,
    )
    if orphans:
        lines.append(
            f"{sum(r.line_count for r in orphans)} invoice line(s) on {len(orphans)} item code(s) "
            "that no longer exist (no Parent Style / Season / Collection to copy):"
        )
        lines.extend(f"  {r.item_code or '(no item code)'}: {r.line_count} line(s)" for r in orphans[:50])
        if len(orphans) > 50:
            lines.append(f"  ... and {len(orphans) - 50} more")
    if approximate:
        lines.append(
            f"{len(approximate)} taxed invoice(s) had no stored per-line tax breakdown; their Item VAT "
            "uses amount - net_amount (may be off by 0.01):"
        )
        lines.extend(f"  {name}" for name in approximate[:50])
        if len(approximate) > 50:
            lines.append(f"  ... and {len(approximate) - 50} more")
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
