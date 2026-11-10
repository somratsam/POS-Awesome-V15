"""Sales by Cashier: each cashier's till sales for a period, for one store.

Who may see it: anyone who unlocked this store's till with their PIN, when
the store's POS Profile has "Enable Sales by Cashier" on. There is no role
check -- every cashier of the store sees the same report -- and never another
store: the profile is re-authorized for the session and the PIN cashier must
be assigned to it (get_active_terminal_cashier).

What it counts: submitted Sales Invoices of this POS Profile that belong to a
till shift (posa_pos_opening_shift set), by posting date. That is the same
set of invoices as the Z Reports, so a shift's Net here is its Z Report
total. Gross, Returns and Net use base_grand_total like the Z Report.

Who gets a bar: only cashiers on the store's POS Profile User list who are
not ticked "Hide in Sales by Cashier". Hidden accounts, former staff, deleted
users and test accounts go to "Others" (with the profile's "Hide" setting
they get no row at all). Invoices without a cashier go to "Cashier not
recorded". The store total always includes everyone.

User ids never leave the server: rows carry a display name and figures.
Expected refusals (store switched off, till locked, not this store's) come
back as {"allowed": False, ...} so the till shows them in the dialog instead
of Frappe's error popup; no figures are sent with a refusal.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import frappe
from frappe import _
from frappe.model.meta import get_field_precision
from frappe.utils import cint, cstr, flt, getdate, now_datetime

from .pos_access import get_authorized_pos_profile
from .terminal_state import get_active_terminal_cashier

ENABLE_FIELD = "posa_enable_sales_by_cashier"
HIDDEN_MODE_FIELD = "posa_sales_by_cashier_hidden"
HIDE_FIELD = "posa_hide_in_sales_by_cashier"

MODE_OTHERS = "Group into Others"
MODE_HIDE = "Hide"

KIND_CASHIER = "cashier"
KIND_OTHERS = "others"
KIND_NOT_RECORDED = "not_recorded"

MAX_PERIOD_DAYS = 366
# A new opening is logged when the till says so, and in any case at least
# once per this many minutes of use, so the log can't be skipped by a client.
LOG_BACKSTOP_MINUTES = 30
LOG_SUBJECT_PREFIX = "Sales by Cashier opened"


class _Refused(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def _drop_server_messages():
    # frappe.throw() queued a popup message before raising; the refusal is
    # shown in the dialog instead.
    frappe.local.message_log = []


def _authorize(pos_profile) -> tuple[Any, str]:
    try:
        profile_doc = get_authorized_pos_profile(pos_profile)
    except (frappe.PermissionError, frappe.ValidationError):
        _drop_server_messages()
        raise _Refused("not_assigned", _("You are not assigned to this store."))

    if not cint(profile_doc.get(ENABLE_FIELD)):
        raise _Refused("disabled", _("Sales by Cashier is turned off for this store."))

    try:
        cashier = get_active_terminal_cashier(profile_doc.name)
    except (frappe.PermissionError, frappe.ValidationError):
        _drop_server_messages()
        raise _Refused("locked", _("Unlock the till with your PIN to see this report."))

    return profile_doc, cashier


def _parse_period(from_date, to_date) -> tuple[Any, Any]:
    if not cstr(from_date).strip() or not cstr(to_date).strip():
        raise _Refused("invalid_period", _("Choose a From and a To date."))
    try:
        start, end = getdate(from_date), getdate(to_date)
    except Exception:
        raise _Refused("invalid_period", _("Choose a From and a To date."))
    if start > end:
        raise _Refused("invalid_period", _("The From date must be on or before the To date."))
    if (end - start).days + 1 > MAX_PERIOD_DAYS:
        raise _Refused("invalid_period", _("Choose a period of one year or less."))
    return start, end


def _fetch_period(profile_name: str, company: str, start, end) -> list[dict[str, Any]]:
    return frappe.db.sql(
        """
        SELECT si.posa_cashier AS cashier,
               MAX(si.posa_cashier_name) AS cashier_name,
               SUM(CASE WHEN si.is_return = 0 THEN si.base_grand_total ELSE 0 END) AS gross,
               SUM(CASE WHEN si.is_return = 1 THEN si.base_grand_total ELSE 0 END) AS returns,
               SUM(si.base_grand_total) AS net,
               SUM(CASE WHEN si.is_return = 0 THEN 1 ELSE 0 END) AS sales
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1
          AND si.company = %(company)s
          AND si.pos_profile = %(profile)s
          AND IFNULL(si.posa_pos_opening_shift, '') <> ''
          AND si.posting_date BETWEEN %(start)s AND %(end)s
        GROUP BY si.posa_cashier
        """,
        {"company": company, "profile": profile_name, "start": start, "end": end},
        as_dict=True,
    )


def _shown_cashiers(profile_name: str) -> set[str]:
    """Cashiers with their own bar: on the store's list and not ticked hidden."""
    fields = ["user"]
    has_hide = frappe.db.has_column("POS Profile User", HIDE_FIELD)
    if has_hide:
        fields.append(HIDE_FIELD)
    rows = frappe.get_all(
        "POS Profile User",
        filters={"parent": profile_name, "parenttype": "POS Profile"},
        fields=fields,
    )
    return {
        cstr(row.user).strip()
        for row in rows
        if cstr(row.user).strip() and not (has_hide and cint(row.get(HIDE_FIELD)))
    }


def _empty_values() -> dict[str, float]:
    return {"gross": 0.0, "returns": 0.0, "net": 0.0, "sales": 0}


def _add(target: dict[str, float], row: dict[str, Any]):
    target["gross"] += flt(row.get("gross"))
    target["returns"] += flt(row.get("returns"))
    target["net"] += flt(row.get("net"))
    target["sales"] += cint(row.get("sales"))


def _finish(values: dict[str, float], precision: int) -> dict[str, Any]:
    # Sum raw, round once (here).
    sales = cint(values["sales"])
    return {
        "gross": flt(values["gross"], precision),
        "returns": flt(values["returns"], precision),
        "net": flt(values["net"], precision),
        "sales": sales,
        "avg_basket": flt(values["gross"] / sales, precision) if sales else None,
    }


def _is_empty(values: dict[str, float]) -> bool:
    return (
        not cint(values["sales"])
        and abs(flt(values["gross"])) < 0.0005
        and abs(flt(values["returns"])) < 0.0005
        and abs(flt(values["net"])) < 0.0005
    )


def build_report(
    period_rows: list[list[dict[str, Any]]],
    shown: set[str],
    names: dict[str, str],
    hidden_mode: str,
    precision: int,
) -> dict[str, Any]:
    """Bucket the grouped rows of each period into the report (pure)."""
    count = len(period_rows)
    cashiers: dict[str, list[dict[str, float]]] = {}
    labels: dict[str, str] = {}
    others = [_empty_values() for _ in range(count)]
    not_recorded = [_empty_values() for _ in range(count)]
    store = [_empty_values() for _ in range(count)]

    for index, rows in enumerate(period_rows):
        for row in rows:
            user = cstr(row.get("cashier")).strip()
            _add(store[index], row)
            if not user:
                _add(not_recorded[index], row)
            elif user in shown:
                if user not in cashiers:
                    cashiers[user] = [_empty_values() for _ in range(count)]
                    labels[user] = (
                        cstr(names.get(user)).strip()
                        or cstr(row.get("cashier_name")).strip()
                        or _("Cashier")
                    )
                _add(cashiers[user][index], row)
            else:
                _add(others[index], row)

    ordered = sorted(cashiers, key=lambda user: (-flt(cashiers[user][0]["net"]), labels[user].lower()))
    rows_out = [
        {
            "label": labels[user],
            "kind": KIND_CASHIER,
            "values": [_finish(values, precision) for values in cashiers[user]],
        }
        for user in ordered
    ]
    if hidden_mode != MODE_HIDE and not all(_is_empty(values) for values in others):
        rows_out.append(
            {
                "label": _("Others"),
                "kind": KIND_OTHERS,
                "values": [_finish(values, precision) for values in others],
            }
        )
    if not all(_is_empty(values) for values in not_recorded):
        rows_out.append(
            {
                "label": _("Cashier not recorded"),
                "kind": KIND_NOT_RECORDED,
                "values": [_finish(values, precision) for values in not_recorded],
            }
        )

    shown_net = [0.0] * count
    for values in cashiers.values():
        for index in range(count):
            shown_net[index] += flt(values[index]["net"])

    return {
        "rows": rows_out,
        "totals": {
            "store": [_finish(values, precision) for values in store],
            "shown_net": [flt(value, precision) for value in shown_net],
            "others_net": [flt(values["net"], precision) for values in others],
            "not_recorded_net": [flt(values["net"], precision) for values in not_recorded],
        },
    }


def _log_opening(profile_name: str, cashier: str, opened: bool):
    since = now_datetime() - timedelta(minutes=LOG_BACKSTOP_MINUTES)
    if not opened and frappe.db.exists(
        "Activity Log",
        {
            "reference_doctype": "POS Profile",
            "reference_name": profile_name,
            "user": cashier,
            "subject": ["like", f"{LOG_SUBJECT_PREFIX}%"],
            "creation": [">=", since],
        },
    ):
        return
    full_name = cstr(frappe.db.get_value("User", cashier, "full_name")).strip() or cashier
    frappe.get_doc(
        {
            "doctype": "Activity Log",
            "subject": f"{LOG_SUBJECT_PREFIX} at {profile_name} by {full_name}",
            "content": f"Till login: {frappe.session.user}",
            "communication_date": now_datetime(),
            "status": "Success",
            "reference_doctype": "POS Profile",
            "reference_name": profile_name,
            "user": cashier,
            "full_name": full_name,
            "ip_address": getattr(frappe.local, "request_ip", None),
        }
    ).insert(ignore_permissions=True)


@frappe.whitelist(methods=["POST"])
def get_sales_by_cashier(
    pos_profile=None,
    from_date=None,
    to_date=None,
    compare_from=None,
    compare_to=None,
    opened=0,
):
    """Each cashier's till sales for one or two periods, for the till's store."""
    try:
        profile_doc, cashier = _authorize(pos_profile)
        periods = [_parse_period(from_date, to_date)]
        if cstr(compare_from).strip() or cstr(compare_to).strip():
            periods.append(_parse_period(compare_from, compare_to))
    except _Refused as refused:
        return {"allowed": False, "reason": refused.reason, "message": refused.message}

    profile_name = profile_doc.name
    company = cstr(profile_doc.get("company")).strip()
    currency = cstr(frappe.get_cached_value("Company", company, "default_currency")).strip()
    precision = cint(
        get_field_precision(frappe.get_meta("Sales Invoice").get_field("base_grand_total"), currency=currency)
    ) or 3

    period_rows = [_fetch_period(profile_name, company, start, end) for start, end in periods]
    shown = _shown_cashiers(profile_name)
    users = sorted({cstr(row.cashier).strip() for rows in period_rows for row in rows} & shown)
    names = (
        {u.name: u.full_name for u in frappe.get_all("User", filters={"name": ["in", users]}, fields=["name", "full_name"])}
        if users
        else {}
    )
    hidden_mode = cstr(profile_doc.get(HIDDEN_MODE_FIELD)).strip() or MODE_OTHERS
    report = build_report(period_rows, shown, names, hidden_mode, precision)

    _log_opening(profile_name, cashier, bool(cint(opened)))

    return {
        "allowed": True,
        "store": profile_name,
        "currency": currency,
        "precision": precision,
        "hidden_mode": "hide" if hidden_mode == MODE_HIDE else "others",
        "periods": [{"from": str(start), "to": str(end)} for start, end in periods],
        **report,
    }
