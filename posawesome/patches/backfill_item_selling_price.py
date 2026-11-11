"""Fill Item.posa_selling_price for every existing Item from its current
Standard Selling price (same rule and code as the Item Price hooks and the
daily refresh, see posawesome.posawesome.api.item_selling_price).

Prints a summary to migrate output and lists stock items that hold stock but
have no valid Standard Selling price (their Selling Price is 0). Idempotent: a
second run updates nothing.
"""

import json
import pathlib

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from posawesome.posawesome.api.item_selling_price import FIELDNAME, refresh_items

FIELD_NAME = "Item-posa_selling_price"
FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "custom_field.json"
SKIP_KEYS = {"doctype", "dt", "name"}


def execute():
    # Patches run before fixture sync, so create the column here from the
    # fixture's own definition (fixture sync re-applies it right after).
    _ensure_custom_field()

    result = refresh_items()
    print(
        "Item Selling Price backfill: {checked} items checked, {priced} with a Standard Selling "
        "price, {updated} updated.".format(**result)
    )

    unpriced = frappe.db.sql(
        f"""
        SELECT DISTINCT bin.item_code
        FROM `tabBin` bin
        JOIN `tabItem` item ON item.name = bin.item_code
        WHERE bin.actual_qty != 0 AND IFNULL(item.`{FIELDNAME}`, 0) = 0
        ORDER BY bin.item_code
        """,
        pluck=True,
    )
    if unpriced:
        print(f"Item Selling Price backfill: {len(unpriced)} item(s) hold stock but have no price:")
        for code in unpriced[:50]:
            print(f"  {code}")
        if len(unpriced) > 50:
            print(f"  ... and {len(unpriced) - 50} more")


def _ensure_custom_field():
    fixture = {row["name"]: row for row in json.loads(FIXTURE_PATH.read_text())}
    definition = fixture[FIELD_NAME]
    if not frappe.db.exists("Custom Field", FIELD_NAME):
        create_custom_field(
            definition["dt"],
            {key: value for key, value in definition.items() if key not in SKIP_KEYS},
        )
    frappe.clear_cache(doctype=definition["dt"])
