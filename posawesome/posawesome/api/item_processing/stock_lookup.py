"""Read-only "Check Stock" lookup for the POS item panel.

Resolves a scanned or typed code to an item and returns its whole
size/colour family (or just the item itself, when it has no variants) with
price and available qty for the POS Profile's own warehouse. Nothing here
touches an invoice -- the cart only changes if staff press Add on a card,
which goes through the normal client-side add path.
"""

import frappe
from frappe import _
from frappe.utils import cint, cstr

from posawesome.posawesome.api.item_processing.barcode import _parse_scale_barcode_data
from posawesome.posawesome.api.item_processing.details import get_item_variants, get_items_details
from posawesome.posawesome.api.pos_access import get_authorized_pos_profile

# Item names are capped at 140 characters by Frappe; anything longer can't
# match a barcode or item code, so don't spend queries on it.
MAX_LOOKUP_CODE_LENGTH = 140

# Same base Item fields get_item_variants() returns per variant, so a
# single (non-variant) item renders with the identical card shape.
SINGLE_ITEM_FIELDS = [
    "name as item_code",
    "item_name",
    "description",
    "stock_uom",
    "image",
    "is_stock_item",
    "has_variants",
    "variant_of",
    "item_group",
    "idx",
    "has_batch_no",
    "has_serial_no",
    "max_discount",
    "brand",
    "allow_negative_stock",
]


def _resolve_item_code(code, profile):
    """Map a scanned/typed value to an item code, or None if nothing matches.

    Same sources the selling scan resolves against, but with an exact
    registered barcode taking precedence over a scale-barcode parse.
    """
    barcode_parent = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
    if barcode_parent:
        return barcode_parent

    scale_data = _parse_scale_barcode_data(code)
    scale_item_code = cstr((scale_data or {}).get("item_code")).strip()
    if scale_item_code and frappe.db.exists("Item", scale_item_code):
        return scale_item_code

    if frappe.db.exists("Item", code):
        return code

    if cint(profile.get("posa_search_batch_no")):
        batch_item = frappe.db.get_value("Batch", code, "item")
        if batch_item:
            return batch_item

    if cint(profile.get("posa_search_serial_no")):
        serial_item = frappe.db.get_value("Serial No", code, "item_code")
        if serial_item:
            return serial_item

    return None


def _single_item_rows(item_code, profile_name, price_list, customer):
    rows = frappe.get_all("Item", filters={"name": item_code}, fields=SINGLE_ITEM_FIELDS)
    if not rows:
        return []

    details = get_items_details(
        profile_name,
        frappe.as_json(rows),
        price_list=price_list,
        customer=customer,
    )
    detail_map = {d.get("item_code"): d for d in details or []}
    for row in rows:
        detail = detail_map.get(row.get("item_code"))
        if detail:
            row.update(detail)
        else:
            row.setdefault("item_barcode", [])
        row["item_attributes"] = []
    return rows


SUGGEST_MIN_PREFIX_LENGTH = 4
SUGGEST_MAX_RESULTS = 8
SIZE_ATTRIBUTES = ("Size",)
COLOR_ATTRIBUTES = ("Color", "Colour")


def _like_prefix_pattern(prefix):
    """A LIKE pattern matching values that start with `prefix` literally:
    % and _ typed by staff are not wildcards."""
    escaped = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"


@frappe.whitelist()
def suggest_item_barcodes(pos_profile, prefix, limit=SUGGEST_MAX_RESULTS):
    """Registered barcodes starting with what has been typed, for Check
    Stock's suggestion list: barcode, item name, size and colour only -- the
    stock comes from lookup_item_stock once one is picked.

    Same authorization as lookup_item_stock (the user must be allowed this
    POS Profile); only the typed text comes from the browser."""

    get_authorized_pos_profile(pos_profile)

    prefix = cstr(prefix).strip()
    if len(prefix) < SUGGEST_MIN_PREFIX_LENGTH or len(prefix) > MAX_LOOKUP_CODE_LENGTH:
        return []
    limit = max(1, min(cint(limit) or SUGGEST_MAX_RESULTS, SUGGEST_MAX_RESULTS))

    rows = frappe.db.sql(
        """
        select ib.barcode, ib.parent as item_code, i.item_name
        from `tabItem Barcode` ib
        inner join `tabItem` i on i.name = ib.parent
        where ib.parenttype = 'Item'
            and ib.barcode like %(pattern)s
            and i.disabled = 0
        order by ib.barcode
        limit %(limit)s
        """,
        {"pattern": _like_prefix_pattern(prefix), "limit": limit},
        as_dict=True,
    )
    if not rows:
        return []

    attributes = frappe.get_all(
        "Item Variant Attribute",
        filters={
            "parenttype": "Item",
            "parent": ["in", list({row.item_code for row in rows})],
            "attribute": ["in", [*SIZE_ATTRIBUTES, *COLOR_ATTRIBUTES]],
        },
        fields=["parent", "attribute", "attribute_value"],
    )
    by_item = {}
    for attr in attributes:
        by_item.setdefault(attr.parent, {})[attr.attribute] = attr.attribute_value

    suggestions = []
    for row in rows:
        values = by_item.get(row.item_code, {})
        suggestions.append(
            {
                "barcode": row.barcode,
                "item_code": row.item_code,
                "item_name": row.item_name,
                "size": next((values[a] for a in SIZE_ATTRIBUTES if values.get(a)), None),
                "color": next((values[a] for a in COLOR_ATTRIBUTES if values.get(a)), None),
            }
        )
    return suggestions


@frappe.whitelist()
def lookup_item_stock(pos_profile, code, price_list=None, customer=None):
    """Return the item family (or single item) for a scanned/typed code."""

    # Authorization only (same as get_items_from_barcode): a physically
    # scanned tag must resolve regardless of catalog visibility filters
    # such as Hide Variants Items.
    profile = get_authorized_pos_profile(pos_profile)

    code = cstr(code).strip()
    if not code:
        frappe.throw(_("Scan or enter a barcode or item code."))
    if len(code) > MAX_LOOKUP_CODE_LENGTH:
        return {"found": False, "code": code[:MAX_LOOKUP_CODE_LENGTH]}

    item_code = _resolve_item_code(code, profile)
    item = (
        frappe.db.get_value(
            "Item",
            item_code,
            ["name", "item_name", "variant_of", "has_variants", "disabled"],
            as_dict=True,
        )
        if item_code
        else None
    )
    if not item or cint(item.disabled):
        return {"found": False, "code": code}

    price_list = price_list or profile.get("selling_price_list")
    template_code = item.variant_of or (item.name if cint(item.has_variants) else None)

    if template_code:
        family = get_item_variants(profile.name, template_code, price_list=price_list, customer=customer)
        items = (family or {}).get("variants") or []
        attributes_meta = (family or {}).get("attributes_meta") or {}
        template_name = frappe.db.get_value("Item", template_code, "item_name") or template_code
    else:
        items = _single_item_rows(item.name, profile.name, price_list, customer)
        attributes_meta = {}
        template_name = None

    return {
        "found": True,
        "code": code,
        "scanned_item_code": item.name,
        "template_item_code": template_code,
        "template_item_name": template_name,
        "items": items,
        "attributes_meta": attributes_meta,
        "warehouse": profile.get("warehouse"),
    }
