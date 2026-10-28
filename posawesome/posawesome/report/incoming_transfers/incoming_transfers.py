# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""Incoming Transfers: goods sent to a store with Add to Transit that it has not
fully received yet (Per Transferred below 100).

Rows are limited on the server to Destination Stores the user's Warehouse User
Permissions allow; a user with none is unrestricted. The sent entries themselves
are opened through the read-only share made on submit (api/stock_transit.py).
"""

import frappe
from frappe import _
from frappe.query_builder.functions import Count, Sum
from frappe.utils import cstr

from posawesome.posawesome.api.stock_transit import (
    DESTINATION_FIELD,
    get_permitted_warehouses,
    is_transit_warehouse,
)


def execute(filters=None):
    filters = frappe._dict(filters or {})
    stores = narrow_to_chosen(get_permitted_warehouses(), filters.get("destination_store"))
    if stores == set():
        return get_columns(), []
    return get_columns(), get_data(stores)


def get_columns():
    return [
        {"label": _("Transfer"), "fieldname": "name", "fieldtype": "Link", "options": "Stock Entry", "width": 170},
        {"label": _("Sent On"), "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
        {"label": _("From Store"), "fieldname": "from_store", "fieldtype": "Data", "width": 170},
        {"label": _("Destination Store"), "fieldname": "destination_store", "fieldtype": "Data", "width": 170},
        {"label": _("Items"), "fieldname": "items", "fieldtype": "Int", "width": 70},
        {"label": _("Qty Sent"), "fieldname": "qty_sent", "fieldtype": "Float", "width": 90},
        {"label": _("Qty Received"), "fieldname": "qty_received", "fieldtype": "Float", "width": 110},
        {"label": _("% Received"), "fieldname": "per_transferred", "fieldtype": "Percent", "width": 100},
        {"label": _("Sent By"), "fieldname": "sent_by", "fieldtype": "Data", "width": 150},
    ]


def narrow_to_chosen(permitted, store):
    """A store chosen outside the permitted set gives no rows, never more."""
    store = cstr(store).strip()
    if not store:
        return permitted
    if permitted is not None and store not in permitted:
        return set()
    return {store}


def get_data(stores):
    se = frappe.qb.DocType("Stock Entry")
    sed = frappe.qb.DocType("Stock Entry Detail")
    user = frappe.qb.DocType("User")
    query = (
        frappe.qb.from_(se)
        .join(sed)
        .on((sed.parent == se.name) & (sed.parenttype == "Stock Entry"))
        .left_join(user)
        .on(user.name == se.owner)
        .select(
            se.name,
            se.posting_date,
            se.from_warehouse,
            se[DESTINATION_FIELD].as_("destination_store"),
            se.per_transferred,
            user.full_name.as_("sent_by"),
            Count(sed.item_code).distinct().as_("items"),
            Sum(sed.transfer_qty).as_("qty_sent"),
            Sum(sed.transferred_qty).as_("qty_received"),
        )
        .where(
            (se.docstatus == 1)
            & (se.purpose == "Material Transfer")
            & (se.add_to_transit == 1)
            & (se.per_transferred < 100)
            & (se[DESTINATION_FIELD].isnotnull())
            & (se[DESTINATION_FIELD] != "")
        )
        .groupby(se.name)
        .orderby(se.posting_date)
        .orderby(se.name)
    )
    if stores is not None:
        query = query.where(se[DESTINATION_FIELD].isin(sorted(stores)))
    rows = query.run(as_dict=True)

    sources = _get_sources([r.name for r in rows if not r.from_warehouse])
    for row in rows:
        row.from_store = row.pop("from_warehouse") or sources.get(row.name, "")
    return rows


def _get_sources(names):
    """The rows' Source Warehouses for entries saved without a Default Source Warehouse."""
    if not names:
        return {}
    rows = frappe.get_all(
        "Stock Entry Detail",
        filters={"parent": ("in", names), "parenttype": "Stock Entry"},
        fields=["parent", "s_warehouse"],
        order_by="idx asc",
    )
    sources = {}
    for row in rows:
        if row.s_warehouse:
            sources.setdefault(row.parent, set()).add(row.s_warehouse)
    return {name: ", ".join(sorted(stores)) for name, stores in sources.items()}


@frappe.whitelist()
def get_destination_stores():
    """Choices for the Destination Store filter: the user's permitted stores, or every
    store that has an open transfer when the user is unrestricted."""
    frappe.has_permission("Stock Entry", "report", throw=True)
    permitted = get_permitted_warehouses()
    if permitted is not None:
        return sorted(w for w in permitted if not is_transit_warehouse(w))
    return frappe.get_all(
        "Stock Entry",
        filters={
            "docstatus": 1,
            "add_to_transit": 1,
            "per_transferred": ("<", 100),
            DESTINATION_FIELD: ("is", "set"),
        },
        pluck=DESTINATION_FIELD,
        distinct=True,
        order_by=f"{DESTINATION_FIELD} asc",
    )
