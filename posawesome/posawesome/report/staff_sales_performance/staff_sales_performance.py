"""Staff Sales Performance: each staff member's POS sales across stores (Desk).

Same rules as the till's Sales by Cashier (sales_by_cashier.py):
- A sale counts for "Sales credited to" (sales_credit.py): the chosen Sales
  Person's POS User, else the PIN cashier; a return counts for whoever was
  credited on the original sale.
- In each store, only staff on that store's POS Profile User list and not
  ticked "Hide in Sales by Cashier" get their own row. Everyone else there
  (Administrator, shared store logins, former staff) is counted in
  "Others"; invoices with nobody recorded in "Cashier not recorded". The
  totals always include everyone.
- "Till sales" (default) are invoices of a till shift, the same set as the
  Z Reports; "All POS sales" are all invoices with a POS Profile.
- Gross, Returns and Net use base_grand_total.

Who sees what (enforced here, on every run, including Export and Print,
and for reports saved from this one with "Save as"):
- The report itself: its roles (System Manager), or what "Role Permission
  for Page and Report" sets for it.
- System Manager (and Administrator): every store of the company.
- Anyone else given the report: only their own stores -- POS Profiles whose
  User list has them, or that a POS Profile User Permission gives them. The
  Stores filter offers only those, and asking for any other store is refused.
"""

from __future__ import annotations

import json
from typing import Any

import frappe
from frappe import _
from frappe.model.meta import get_field_precision
from frappe.utils import cint, cstr, flt, getdate

from posawesome.posawesome.api.sales_by_cashier import (
    CREDITED_NAME_SQL,
    CREDITED_SQL,
    _add,
    _empty_values,
    _finish,
    _is_empty,
    _shown_cashiers,
)

REPORT_NAME = "Staff Sales Performance"
FULL_ACCESS_ROLE = "System Manager"
MAX_PERIOD_DAYS = 366
CHART_BARS = 15

TILL_SALES = "Till sales"
ALL_POS_SALES = "All POS sales"
BY_STAFF = "Staff"
BY_STAFF_AND_STORE = "Staff and store"

OTHERS = "__others__"
NOT_RECORDED = "__not_recorded__"


# --- Access --------------------------------------------------------------------


def _check_report_access():
    # Checked here too because a report saved with "Save as" gets the roles of
    # Sales Invoice, not this report's.
    if not frappe.get_doc("Report", REPORT_NAME).is_permitted():
        frappe.throw(_("You don't have access to Report: {0}").format(_(REPORT_NAME)), frappe.PermissionError)


def sees_all_stores(user=None) -> bool:
    user = user or frappe.session.user
    return user == "Administrator" or FULL_ACCESS_ROLE in frappe.get_roles(user)


def allowed_stores(company, user=None) -> list[str]:
    """The POS Profiles of this company the user may see in the report."""
    user = user or frappe.session.user
    company = cstr(company).strip()
    if not company:
        return []
    filters: dict[str, Any] = {"company": company}
    if not sees_all_stores(user):
        own = set(
            frappe.get_all(
                "POS Profile User",
                filters={"user": user, "parenttype": "POS Profile"},
                pluck="parent",
                ignore_permissions=True,
            )
        )
        own |= set(
            frappe.get_all(
                "User Permission",
                filters={"user": user, "allow": "POS Profile"},
                pluck="for_value",
                ignore_permissions=True,
            )
        )
        if not own:
            return []
        filters["name"] = ["in", sorted(own)]
    return sorted(frappe.get_all("POS Profile", filters=filters, pluck="name", ignore_permissions=True))


@frappe.whitelist()
def get_store_options(company=None, txt=None):
    """The Stores filter's choices: only the user's own stores."""
    _check_report_access()
    txt = cstr(txt).strip().lower()
    return [
        {"value": name, "description": ""}
        for name in allowed_stores(company)
        if not txt or txt in name.lower()
    ]


# --- Filters ---------------------------------------------------------------------


def _requested_stores(value) -> list[str]:
    if isinstance(value, str):
        value = value.strip()
        if value.startswith("["):
            try:
                value = json.loads(value)
            except ValueError:
                value = [value]
        else:
            value = [part for part in value.split(",")]
    names = []
    for name in value or []:
        name = cstr(name).strip()
        if name and name not in names:
            names.append(name)
    return names


def _period(filters):
    if not cstr(filters.get("from_date")).strip() or not cstr(filters.get("to_date")).strip():
        frappe.throw(_("Choose a From and a To date."))
    start, end = getdate(filters.get("from_date")), getdate(filters.get("to_date"))
    if start > end:
        frappe.throw(_("The From date must be on or before the To date."))
    if (end - start).days + 1 > MAX_PERIOD_DAYS:
        frappe.throw(_("Choose a period of one year or less."))
    return start, end


def _stores(filters, company) -> list[str]:
    allowed = allowed_stores(company)
    requested = _requested_stores(filters.get("stores"))
    refused = [name for name in requested if name not in allowed]
    if refused:
        frappe.throw(
            _("Store {0} is not one of your stores for company {1}.").format(refused[0], company),
            frappe.PermissionError,
        )
    return requested or allowed


# --- Data ----------------------------------------------------------------------


def _fetch(company, stores, start, end, till_only) -> list[dict[str, Any]]:
    till = "AND IFNULL(si.posa_pos_opening_shift, '') <> ''" if till_only else ""
    return frappe.db.sql(
        f"""
        SELECT si.pos_profile AS store,
               {CREDITED_SQL} AS staff,
               MAX({CREDITED_NAME_SQL}) AS staff_name,
               SUM(CASE WHEN si.is_return = 0 THEN si.base_grand_total ELSE 0 END) AS gross,
               SUM(CASE WHEN si.is_return = 1 THEN si.base_grand_total ELSE 0 END) AS returns,
               SUM(si.base_grand_total) AS net,
               SUM(CASE WHEN si.is_return = 0 THEN 1 ELSE 0 END) AS sales,
               SUM(CASE WHEN si.is_return = 0 AND {CREDITED_SQL} <> IFNULL(si.posa_cashier, '')
                        THEN 1 ELSE 0 END) AS by_others
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1
          AND si.company = %(company)s
          AND si.pos_profile IN %(stores)s
          AND si.posting_date BETWEEN %(start)s AND %(end)s
          {till}
        GROUP BY si.pos_profile, {CREDITED_SQL}
        """,
        {"company": company, "stores": tuple(stores), "start": start, "end": end},
        as_dict=True,
    )


def bucket_rows(rows, shown_by_store):
    """Group the per-store rows into staff / Others / Cashier not recorded (pure).

    Returns ({bucket: {store: values}}, {bucket: fallback name}).
    """
    buckets: dict[str, dict[str, dict[str, float]]] = {}
    names: dict[str, str] = {}
    for row in rows:
        store = cstr(row.get("store")).strip()
        user = cstr(row.get("staff")).strip()
        if not user:
            key = NOT_RECORDED
        elif user in shown_by_store.get(store, set()):
            key = user
            names.setdefault(user, cstr(row.get("staff_name")).strip())
        else:
            key = OTHERS
        per_store = buckets.setdefault(key, {})
        _add(per_store.setdefault(store, _empty_values()), row)
    return buckets, names


def _label(key, names, full_names):
    if key == OTHERS:
        return _("Others")
    if key == NOT_RECORDED:
        return _("Cashier not recorded")
    return cstr(full_names.get(key)).strip() or names.get(key) or _("Staff")


def _sum(values_list):
    total = _empty_values()
    for values in values_list:
        _add(total, values)
    return total


def _out(values, precision, total_net, currency, **extra):
    finished = _finish(values, precision)
    share = flt(values["net"]) / total_net * 100 if abs(total_net) >= 0.0005 else None
    return {
        **extra,
        "gross": finished["gross"],
        "returns": finished["returns"],
        "net": finished["net"],
        "sales": finished["sales"],
        "avg_basket": finished["avg_basket"],
        "by_others": finished["by_others"],
        "share": flt(share, 1) if share is not None else None,
        "currency": currency,
    }


def build_rows(buckets, names, full_names, group_by, precision, currency):
    """The report rows, ending with the Total row (pure)."""
    total = _sum(values for per_store in buckets.values() for values in per_store.values())
    total_net = flt(total["net"])
    stores_seen = sorted({store for per_store in buckets.values() for store in per_store})

    def rank(key):
        # Staff by net (highest first), then Others, then Cashier not recorded.
        tail = {OTHERS: 1, NOT_RECORDED: 2}.get(key, 0)
        return (tail, -flt(_sum(buckets[key].values())["net"]), _label(key, names, full_names).lower())

    data = []
    for index, key in enumerate(sorted(buckets, key=rank)):
        per_store = {store: values for store, values in buckets[key].items() if not _is_empty(values)}
        if not per_store:
            continue
        label = _label(key, names, full_names)
        ordered = sorted(per_store, key=lambda store: (-flt(per_store[store]["net"]), store.lower()))
        if group_by == BY_STAFF_AND_STORE:
            for store in ordered:
                data.append(_out(per_store[store], precision, total_net, currency, staff=label, store=store))
            continue
        row_id = f"row-{index}"  # not the user id
        store_text = ordered[0] if len(ordered) == 1 else _("{0} stores").format(len(ordered))
        data.append(
            _out(_sum(per_store.values()), precision, total_net, currency,
                 row_id=row_id, parent_row="", indent=0, staff=label, store=store_text)
        )
        if len(ordered) == 1:
            continue  # the row above already is that one store
        for store in ordered:
            data.append(
                _out(per_store[store], precision, total_net, currency,
                     row_id=f"{row_id}-{store}", parent_row=row_id, indent=1, staff=label, store=store)
            )

    if data:
        store_text = stores_seen[0] if len(stores_seen) == 1 else _("{0} stores").format(len(stores_seen))
        extra = {"staff": _("Total"), "store": store_text, "bold": 1}
        if group_by != BY_STAFF_AND_STORE:
            extra.update(row_id="total", parent_row="", indent=0)
        data.append(_out(total, precision, total_net, currency, **extra))
    return data, total


def _columns(currency):
    money = {"fieldtype": "Currency", "options": "currency", "width": 130}
    return [
        {"fieldname": "staff", "label": _("Staff"), "fieldtype": "Data", "width": 220},
        {"fieldname": "store", "label": _("Store"), "fieldtype": "Data", "width": 170},
        {"fieldname": "gross", "label": _("Gross sales"), **money},
        {"fieldname": "returns", "label": _("Returns"), **money},
        {"fieldname": "net", "label": _("Net sales"), **money},
        {"fieldname": "sales", "label": _("Sales"), "fieldtype": "Int", "width": 80},
        {"fieldname": "avg_basket", "label": _("Avg basket"), **money},
        {"fieldname": "by_others", "label": _("Rung up by others"), "fieldtype": "Int", "width": 160},
        {"fieldname": "share", "label": _("Share of net"), "fieldtype": "Percent", "width": 110},
        {"fieldname": "currency", "label": _("Currency"), "fieldtype": "Link", "options": "Currency", "hidden": 1},
    ]


def _chart(data, currency):
    bars = [row for row in data if not row.get("bold") and not row.get("indent")][:CHART_BARS]
    if not bars:
        return None
    labels = []
    for row in bars:
        label = row["staff"]
        if row.get("row_id") is None:
            label = f"{row['staff']} · {row['store']}"
        # The chart draws labels both as text (axis) and as HTML (tooltip):
        # without < and > no tag can form, and "MAX&Co" still reads right.
        labels.append(label.replace("<", "‹").replace(">", "›"))
    return {
        "data": {"labels": labels, "datasets": [{"name": _("Net sales"), "values": [row["net"] for row in bars]}]},
        "type": "bar",
        "fieldtype": "Currency",
        "options": currency,
        "colors": ["#2490ef"],
    }


def _summary(total, precision, currency):
    finished = _finish(total, precision)
    return [
        {"value": finished["net"], "label": _("Net sales"), "datatype": "Currency", "currency": currency, "indicator": "Blue"},
        {"value": finished["sales"], "label": _("Sales"), "datatype": "Int", "indicator": "Green"},
        {"value": finished["by_others"], "label": _("Rung up by another cashier"), "datatype": "Int", "indicator": "Grey"},
        {"value": finished["avg_basket"] or 0, "label": _("Avg basket"), "datatype": "Currency", "currency": currency, "indicator": "Grey"},
        {"value": finished["returns"], "label": _("Returns"), "datatype": "Currency", "currency": currency, "indicator": "Red"},
    ]


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _check_report_access()

    company = cstr(filters.get("company")).strip()
    if not company:
        frappe.throw(_("Choose a Company."))
    start, end = _period(filters)
    group_by = BY_STAFF_AND_STORE if filters.get("group_by") == BY_STAFF_AND_STORE else BY_STAFF
    till_only = filters.get("sales_counted") != ALL_POS_SALES

    currency = cstr(frappe.get_cached_value("Company", company, "default_currency")).strip()
    precision = cint(
        get_field_precision(frappe.get_meta("Sales Invoice").get_field("base_grand_total"), currency=currency)
    ) or 3
    columns = _columns(currency)

    stores = _stores(filters, company)
    if not stores:
        return columns, [], _("You are not assigned to any store of {0}.").format(company)

    rows = _fetch(company, stores, start, end, till_only)
    shown = {store: _shown_cashiers(store) for store in {cstr(row.store).strip() for row in rows}}
    buckets, names = bucket_rows(rows, shown)
    users = [key for key in buckets if key not in (OTHERS, NOT_RECORDED)]
    full_names = (
        dict(frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"], as_list=True))
        if users
        else {}
    )
    data, total = build_rows(buckets, names, full_names, group_by, precision, currency)
    if not data:
        return columns, [], None, None, None
    return columns, data, None, _chart(data, currency), _summary(total, precision, currency)
