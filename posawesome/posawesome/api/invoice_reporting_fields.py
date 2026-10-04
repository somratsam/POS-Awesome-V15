"""Plain, reportable copies of per-line Size/Color/Brand and the POS cashier's
name on Sales Invoice, so they work as ordinary Report View columns
(Pick Columns, filters, Group By, export).

Size and Color only exist in Item's "Item Variant Attribute" child table,
which Report View can't reach from Sales Invoice; posa_cashier is a Link to
User and displays the email. Values are a snapshot taken when the invoice is
saved, so later edits to an Item or User don't rewrite past sales.
"""

import frappe

SIZE_ATTRIBUTE = "Size"
COLOR_ATTRIBUTE = "Color"
ITEM_ATTRIBUTE_FIELDS = {
    SIZE_ATTRIBUTE: "posa_item_size",
    COLOR_ATTRIBUTE: "posa_item_color",
}


def set_invoice_reporting_fields(doc):
    if doc.doctype != "Sales Invoice":
        return

    rows = [row for row in (doc.get("items") or []) if row.get("item_code")]
    item_codes = list({row.item_code for row in rows})
    attributes = get_item_size_color(item_codes)
    brands = _get_item_brands(item_codes)

    for row in rows:
        values = attributes.get(row.item_code, {})
        for attribute, fieldname in ITEM_ATTRIBUTE_FIELDS.items():
            row.set(fieldname, values.get(attribute))
        # Always from Item, never the client payload, so brand reports can't be skewed.
        row.brand = brands.get(row.item_code)

    doc.posa_cashier_name = get_cashier_name(doc.get("posa_cashier"))


def get_item_size_color(item_codes):
    """{item_code: {"Size": ..., "Color": ...}} from Item Variant Attribute."""
    if not item_codes:
        return {}

    result = {}
    for row in frappe.get_all(
        "Item Variant Attribute",
        filters={
            "parenttype": "Item",
            "parent": ["in", item_codes],
            "attribute": ["in", list(ITEM_ATTRIBUTE_FIELDS)],
        },
        fields=["parent", "attribute", "attribute_value"],
        order_by="idx asc",
    ):
        result.setdefault(row.parent, {}).setdefault(row.attribute, row.attribute_value)
    return result


def get_cashier_name(cashier):
    if not cashier:
        return None
    return frappe.db.get_value("User", cashier, "full_name") or cashier


def _get_item_brands(item_codes):
    if not item_codes:
        return {}
    return {
        row.name: row.brand
        for row in frappe.get_all(
            "Item",
            filters={"name": ["in", item_codes]},
            fields=["name", "brand"],
        )
        if row.brand
    }
