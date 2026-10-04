"""Backfill Size/Color/Brand on Sales Invoice Item and the cashier's name on
Sales Invoice for invoices saved before these reporting fields existed.

New invoices get them from invoice_reporting_fields.set_invoice_reporting_fields
(Sales Invoice validate hook). Size/Color lines that can't be matched are
reported, not treated as an error.
"""

import json
import pathlib

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from posawesome.posawesome.api.invoice_reporting_fields import (
    COLOR_ATTRIBUTE,
    ITEM_ATTRIBUTE_FIELDS,
    SIZE_ATTRIBUTE,
)

FIELD_NAMES = (
    "Sales Invoice Item-posa_item_size",
    "Sales Invoice Item-posa_item_color",
    "Sales Invoice-posa_cashier_name",
)
FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "custom_field.json"
SKIP_KEYS = {"doctype", "dt", "name"}


def execute():
    # Patches run before fixture sync, so create the columns here from the
    # fixture's own definitions (fixture sync re-applies them right after).
    _ensure_custom_fields()

    for attribute, fieldname in ITEM_ATTRIBUTE_FIELDS.items():
        frappe.db.sql(
            f"""
            UPDATE `tabSales Invoice Item` sii
            JOIN `tabItem Variant Attribute` iva
                ON iva.parent = sii.item_code AND iva.parenttype = 'Item' AND iva.attribute = %s
            SET sii.`{fieldname}` = iva.attribute_value
            WHERE IFNULL(sii.`{fieldname}`, '') = ''
            """,
            attribute,
        )

    frappe.db.sql(
        """
        UPDATE `tabSales Invoice Item` sii
        JOIN `tabItem` item ON item.name = sii.item_code
        SET sii.brand = item.brand
        WHERE IFNULL(sii.brand, '') = '' AND IFNULL(item.brand, '') != ''
        """
    )

    frappe.db.sql(
        """
        UPDATE `tabSales Invoice` si
        JOIN `tabUser` u ON u.name = si.posa_cashier
        SET si.posa_cashier_name = COALESCE(NULLIF(u.full_name, ''), u.name)
        WHERE IFNULL(si.posa_cashier_name, '') = ''
        """
    )

    report_unmatched_size_color()


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


def report_unmatched_size_color():
    """Variant items sold whose Size or Color couldn't be filled, plus any
    attribute names on them other than Size/Color (e.g. a misspelt "Colour")."""
    lines = []
    for attribute, fieldname in ITEM_ATTRIBUTE_FIELDS.items():
        rows = frappe.db.sql(
            f"""
            SELECT sii.item_code, COUNT(*) AS line_count,
                (SELECT GROUP_CONCAT(DISTINCT iva.attribute ORDER BY iva.attribute SEPARATOR ', ')
                 FROM `tabItem Variant Attribute` iva
                 WHERE iva.parent = sii.item_code AND iva.parenttype = 'Item') AS attributes
            FROM `tabSales Invoice Item` sii
            JOIN `tabItem` item ON item.name = sii.item_code
            WHERE IFNULL(item.variant_of, '') != '' AND IFNULL(sii.`{fieldname}`, '') = ''
            GROUP BY sii.item_code
            ORDER BY line_count DESC
            """,
            as_dict=True,
        )
        if rows:
            lines.append(
                f"{attribute}: {sum(r.line_count for r in rows)} invoice line(s) on "
                f"{len(rows)} variant item(s) have no '{attribute}' attribute:"
            )
            lines.extend(
                f"  {r.item_code} ({r.line_count} line(s)) - attributes: {r.attributes or 'none'}"
                for r in rows[:50]
            )
            if len(rows) > 50:
                lines.append(f"  ... and {len(rows) - 50} more item(s)")

    other_attributes = frappe.db.sql(
        """
        SELECT iva.attribute, COUNT(DISTINCT iva.parent) AS item_count
        FROM `tabItem Variant Attribute` iva
        WHERE iva.parenttype = 'Item' AND iva.attribute NOT IN %s
        GROUP BY iva.attribute
        ORDER BY item_count DESC
        """,
        ((SIZE_ATTRIBUTE, COLOR_ATTRIBUTE),),
        as_dict=True,
    )
    if other_attributes:
        lines.append("Attribute names in use other than Size/Color (not reported as columns):")
        lines.extend(f"  {r.attribute}: {r.item_count} item(s)" for r in other_attributes)

    if not lines:
        print("Invoice reporting backfill: every variant invoice line matched Size and Color.")
        return

    message = "\n".join(lines)
    print("Invoice reporting backfill -- please review:\n" + message)
    frappe.log_error(title="Invoice reporting backfill: unmatched Size/Color", message=message)
