# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""Upload Stock Check: everything one catalog upload put into stock, for staff
to compare against their own sheet.

An upload ends with one submitted Stock Reconciliation (the only step that
carries warehouse and quantity), so one upload = one Stock Reconciliation.
Rows are limited to the warehouses the user's Warehouse User Permissions
allow; the Excel export re-runs execute() as the same user, so it can never
contain more than the screen shows.
"""

import frappe
from frappe import _
from frappe.core.doctype.user_permission.user_permission import get_user_permissions
from frappe.query_builder.functions import Count
from frappe.utils import cstr, escape_html, flt, format_datetime, get_datetime, getdate, strip_html, today

REPORT_NAME = "Upload Stock Check"
UPLOAD_DOCTYPE = "Stock Reconciliation"
PRICE_LIST = "Standard Selling"
SIZE_ATTRIBUTES = ("Size",)
COLOUR_ATTRIBUTES = ("Color", "Colour")
# Season / Collection are made by hand on each site, not shipped as fixtures.
OPTIONAL_ITEM_FIELDS = ("custom_season", "custom_collection")
UPLOAD_LIST_LIMIT = 200


def execute(filters=None):
    filters = frappe._dict(filters or {})
    upload = cstr(filters.get("upload")).strip()
    warehouses = narrow_to_chosen(get_permitted_warehouses(), filters.get("warehouse"))
    if not upload or warehouses == set():
        return get_columns(), []
    return get_columns(), get_data(upload, warehouses)


def get_columns():
    return [
        {"label": _("Item Code (Barcode)"), "fieldname": "item_code", "fieldtype": "Data", "width": 160},
        {"label": _("Parent Style Code"), "fieldname": "variant_of", "fieldtype": "Data", "width": 140},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
        {"label": _("Description"), "fieldname": "description", "fieldtype": "Data", "width": 200},
        {"label": _("Brand"), "fieldname": "brand", "fieldtype": "Data", "width": 110},
        {"label": _("Size"), "fieldname": "size", "fieldtype": "Data", "width": 80},
        {"label": _("Colour"), "fieldname": "colour", "fieldtype": "Data", "width": 100},
        {"label": _("Season"), "fieldname": "season", "fieldtype": "Data", "width": 120},
        {"label": _("Collection"), "fieldname": "collection", "fieldtype": "Data", "width": 120},
        {"label": _("Price"), "fieldname": "price", "fieldtype": "Float", "precision": 3, "width": 100},
        {"label": _("Quantity"), "fieldname": "qty", "fieldtype": "Float", "width": 90},
        {"label": _("Upload Date and Time"), "fieldname": "upload_datetime", "fieldtype": "Datetime", "width": 160},
    ]


def get_permitted_warehouses(user=None):
    """Warehouses the user's Warehouse User Permissions allow, or None when unrestricted.

    Same rule as Frappe's own list queries (frappe/model/db_query.py): a permission
    counts when it has no "Applicable For" or names the doctype being read; a user
    with none that count is unrestricted.
    """
    permissions = get_user_permissions(user).get("Warehouse") or []
    allowed = {
        p.get("doc")
        for p in permissions
        if p.get("doc") and (not p.get("applicable_for") or p.get("applicable_for") == UPLOAD_DOCTYPE)
    }
    return allowed or None


def narrow_to_chosen(permitted, warehouse):
    """Narrow the permitted warehouses to the one chosen in the Warehouse filter.

    The filter is a convenience: a choice outside the permitted set gives an empty
    set (no rows), never more than the user is allowed.
    """
    warehouse = cstr(warehouse).strip()
    if not warehouse:
        return permitted
    if permitted is not None and warehouse not in permitted:
        return set()
    return {warehouse}


def _upload_rows_query(warehouses):
    sr = frappe.qb.DocType(UPLOAD_DOCTYPE)
    sri = frappe.qb.DocType("Stock Reconciliation Item")
    query = (
        frappe.qb.from_(sri)
        .join(sr)
        .on(sr.name == sri.parent)
        .where((sr.docstatus == 1) & (sri.parenttype == UPLOAD_DOCTYPE))
    )
    if warehouses is not None:
        query = query.where(sri.warehouse.isin(sorted(warehouses)))
    return query, sr, sri


def get_data(upload, warehouses):
    query, sr, sri = _upload_rows_query(warehouses)
    item = frappe.qb.DocType("Item")
    item_meta = frappe.get_meta("Item")
    optional = [item[f] for f in OPTIONAL_ITEM_FIELDS if item_meta.has_field(f)]

    rows = (
        query.join(item)
        .on(item.name == sri.item_code)
        .select(
            sri.item_code,
            item.variant_of,
            item.item_name,
            item.description,
            item.brand,
            item.stock_uom,
            sri.qty,
            sr.posting_date,
            sr.posting_time,
            *optional,
        )
        .where(sr.name == upload)
        .orderby(sri.idx)
    ).run(as_dict=True)
    if not rows:
        return []

    item_codes = sorted({r.item_code for r in rows})
    attributes = _get_attributes(item_codes)
    prices = _get_prices(item_codes, {r.item_code: r.stock_uom for r in rows})
    upload_datetime = get_datetime(f"{getdate(rows[0].posting_date)} {rows[0].posting_time}").replace(
        microsecond=0
    )

    data = []
    for r in rows:
        item_attributes = attributes.get(r.item_code, {})
        data.append(
            {
                "item_code": r.item_code,
                "variant_of": r.variant_of,
                "item_name": r.item_name,
                "description": strip_html(cstr(r.description)).strip(),
                "brand": r.brand,
                "size": _first(item_attributes, SIZE_ATTRIBUTES),
                "colour": _first(item_attributes, COLOUR_ATTRIBUTES),
                "season": r.get("custom_season"),
                "collection": r.get("custom_collection"),
                "price": prices.get(r.item_code),
                "qty": flt(r.qty),
                "upload_datetime": upload_datetime,
            }
        )
    return data


def _first(values, keys):
    for key in keys:
        if values.get(key):
            return values[key]
    return None


def _get_attributes(item_codes):
    rows = frappe.get_all(
        "Item Variant Attribute",
        filters={
            "parenttype": "Item",
            "parent": ["in", item_codes],
            "attribute": ["in", SIZE_ATTRIBUTES + COLOUR_ATTRIBUTES],
        },
        fields=["parent", "attribute", "attribute_value"],
    )
    attributes = {}
    for r in rows:
        attributes.setdefault(r.parent, {})[r.attribute] = r.attribute_value
    return attributes


def _get_prices(item_codes, stock_uoms):
    """Today's Standard Selling price, picked the way ERPNext's get_item_price does:
    the item's stock UOM (or no UOM), no customer/supplier/batch, valid today,
    newest Valid From first."""
    on = getdate(today())
    candidates = frappe.get_all(
        "Item Price",
        filters={
            "price_list": PRICE_LIST,
            "selling": 1,
            "item_code": ["in", item_codes],
            "customer": ["is", "not set"],
            "supplier": ["is", "not set"],
            "batch_no": ["is", "not set"],
        },
        fields=["item_code", "uom", "price_list_rate", "valid_from", "valid_upto"],
    )
    best = {}
    for p in candidates:
        if cstr(p.uom) not in ("", cstr(stock_uoms.get(p.item_code))):
            continue
        if (p.valid_from and getdate(p.valid_from) > on) or (p.valid_upto and getdate(p.valid_upto) < on):
            continue
        key = (getdate(p.valid_from) if p.valid_from else getdate("1900-01-01"), cstr(p.uom))
        if p.item_code not in best or key > best[p.item_code][0]:
            best[p.item_code] = (key, flt(p.price_list_rate))
    return {code: rate for code, (_key, rate) in best.items()}


def _check_report_access():
    from frappe.desk.query_report import get_report_doc

    # The same role / report-permission check Frappe runs before the report itself.
    get_report_doc(REPORT_NAME)


@frappe.whitelist()
def get_warehouses():
    """Options for the Warehouse filter.

    A user with Warehouse User Permissions gets only their permitted warehouses
    (group permissions expanded to the warehouses under them); an unrestricted
    user gets every enabled, non-group warehouse. execute() re-checks either way.
    """
    _check_report_access()

    permitted = get_permitted_warehouses()
    filters = {"is_group": 0, "disabled": 0}
    if permitted is not None:
        filters["name"] = ["in", sorted(permitted)]
    return {
        "warehouses": frappe.get_all("Warehouse", filters=filters, pluck="name", order_by="name asc"),
        "restricted": permitted is not None,
    }


@frappe.whitelist()
def get_uploads(warehouse=None):
    """Uploads for the report's picker: number, date and item count, newest first.

    Only uploads with rows in the user's permitted warehouses (narrowed to the
    chosen warehouse, if any) are listed, and the count is of those rows only.
    Reads Stock Reconciliation directly, so store users without access to that
    form can still pick an upload.
    """
    _check_report_access()

    warehouses = narrow_to_chosen(get_permitted_warehouses(), warehouse)
    if warehouses == set():
        return []
    query, sr, sri = _upload_rows_query(warehouses)
    uploads = (
        query.select(sr.name, sr.posting_date, sr.posting_time, Count(sri.name).as_("item_count"))
        .groupby(sr.name, sr.posting_date, sr.posting_time)
        .orderby(sr.posting_date, order=frappe.qb.desc)
        .orderby(sr.posting_time, order=frappe.qb.desc)
        .orderby(sr.name, order=frappe.qb.desc)
        .limit(UPLOAD_LIST_LIMIT)
    ).run(as_dict=True)

    return [
        {
            "value": u.name,
            # Frappe's Select renders option labels as HTML.
            "label": "{0} · {1} · {2}".format(
                escape_html(u.name),
                format_datetime(f"{getdate(u.posting_date)} {u.posting_time}", "dd-MM-yyyy HH:mm"),
                _("1 item")
                if u.item_count == 1
                else _("{0} items").format(frappe.format(u.item_count, {"fieldtype": "Int"})),
            ),
        }
        for u in uploads
    ]
