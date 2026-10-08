"""Plain, reportable copies of per-line Size/Color/Brand, Parent Style,
Season, Collection and VAT, and the POS cashier's name on Sales Invoice, so
they work as ordinary Report View columns (Pick Columns, filters, Group By,
export).

Size and Color only exist in Item's "Item Variant Attribute" child table,
which Report View can't reach from Sales Invoice; posa_cashier is a Link to
User and displays the email. Item VAT comes from ERPNext's per-line tax
breakdown (Item Wise Tax Detail), which Report View can only join as an
unrelated child table (every item x every tax row). Values are a snapshot
taken when the invoice is saved, so later edits to an Item or User don't
rewrite past sales.
"""

import frappe
from frappe.utils import flt

SIZE_ATTRIBUTE = "Size"
COLOR_ATTRIBUTE = "Color"
ITEM_ATTRIBUTE_FIELDS = {
    SIZE_ATTRIBUTE: "posa_item_size",
    COLOR_ATTRIBUTE: "posa_item_color",
}

# Item field -> invoice line field, copied from the line's own Item.
ITEM_SNAPSHOT_FIELDS = {
    "variant_of": "posa_item_variant_of",
    "custom_season": "posa_item_season",
    "custom_collection": "posa_item_collection",
}
# Item custom fields this app never creates or ships: they exist on sites
# where they were made by hand (production). Read only if present, so a site
# without them still saves invoices.
OPTIONAL_ITEM_FIELDS = ("custom_season", "custom_collection")
LINE_VAT_FIELD = "posa_item_vat"
# "Actual" tax rows are fixed charges (e.g. POS delivery charges), not VAT;
# ERPNext still spreads them over the items' breakdown, so leave them out.
NON_VAT_CHARGE_TYPES = ("Actual",)


def set_invoice_reporting_fields(doc):
    if doc.doctype != "Sales Invoice":
        return

    rows = [row for row in (doc.get("items") or []) if row.get("item_code")]
    item_codes = list({row.item_code for row in rows})
    attributes = get_item_size_color(item_codes)
    optional_fields = get_available_optional_item_fields()
    item_values = _get_item_values(item_codes, optional_fields)

    for row in rows:
        values = attributes.get(row.item_code, {})
        for attribute, fieldname in ITEM_ATTRIBUTE_FIELDS.items():
            row.set(fieldname, values.get(attribute))
        item = item_values.get(row.item_code, {})
        # Always from Item, never the client payload, so brand reports can't be skewed.
        row.brand = item.get("brand") or None
        row.set("posa_item_variant_of", item.get("variant_of") or None)
        # From the line's own (variant) Item. A blank stays blank -- no parent
        # fallback, no placeholder. Fields absent on this site: left untouched.
        for item_field in optional_fields:
            row.set(ITEM_SNAPSHOT_FIELDS[item_field], _clean(item.get(item_field)))

    set_line_vat(doc)
    doc.posa_cashier_name = get_cashier_name(doc.get("posa_cashier"))


def get_available_optional_item_fields():
    meta = frappe.get_meta("Item")
    return [fieldname for fieldname in OPTIONAL_ITEM_FIELDS if meta.has_field(fieldname)]


def _clean(value):
    if isinstance(value, str):
        value = value.strip()
    return value or None


def set_line_vat(doc):
    """Each line's VAT from ERPNext's per-line tax breakdown.

    During validate ERPNext keeps the breakdown in memory
    (doc._item_wise_tax_details, rounding cent already placed) and writes the
    Item Wise Tax Detail rows on update; a doc that wasn't recalculated has
    only those stored rows. Lines on invoices without VAT get 0. A line with
    no breakdown at all falls back to amount - net_amount (prices include
    VAT), which can be off by the rounding cent.
    """
    items = doc.get("items") or []
    vat_taxes = [tax for tax in (doc.get("taxes") or []) if tax.get("charge_type") not in NON_VAT_CHARGE_TYPES]
    if not vat_taxes:
        for row in items:
            row.set(LINE_VAT_FIELD, 0)
        return

    per_row = _vat_from_breakdown(doc, vat_taxes)
    fallback_rows = []
    for row in items:
        key = id(row)
        if key not in per_row and row.get("name") in per_row:
            key = row.get("name")
        if key in per_row:
            row.set(LINE_VAT_FIELD, flt(per_row[key], 6))
        else:
            row.set(LINE_VAT_FIELD, flt(flt(row.get("amount")) - flt(row.get("net_amount")), 6))
            fallback_rows.append(row.get("idx"))
    if fallback_rows:
        frappe.logger("posawesome").warning(
            f"Item VAT on {doc.get('name') or 'new invoice'} rows {fallback_rows}: no per-line tax "
            "breakdown, used amount - net_amount"
        )


def _vat_from_breakdown(doc, vat_taxes):
    """{id(item row) or item row name: VAT} for the given (non-Actual) tax rows."""
    per_row = {}
    breakdown = getattr(doc, "_item_wise_tax_details", None)
    if breakdown:
        tax_ids = {id(tax) for tax in vat_taxes}
        for detail in breakdown:
            item, tax = detail.get("item"), detail.get("tax")
            if item is None or tax is None or id(tax) not in tax_ids:
                continue
            per_row[id(item)] = per_row.get(id(item), 0.0) + flt(detail.get("amount"))
        return per_row

    tax_names = {tax.get("name") for tax in vat_taxes if tax.get("name")}
    for detail in doc.get("item_wise_tax_details") or []:
        if detail.get("tax_row") in tax_names and detail.get("item_row"):
            per_row[detail.item_row] = per_row.get(detail.item_row, 0.0) + flt(detail.get("amount"))
    return per_row


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


def _get_item_values(item_codes, optional_fields):
    """{item_code: {brand, variant_of, <optional fields present on this site>}}."""
    if not item_codes:
        return {}
    return {
        row.name: row
        for row in frappe.get_all(
            "Item",
            filters={"name": ["in", item_codes]},
            fields=["name", "brand", "variant_of", *optional_fields],
        )
    }
