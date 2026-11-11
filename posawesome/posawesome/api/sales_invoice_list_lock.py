"""Sales Invoice Desk List / Report view / export: submitted invoices only for
everyone except System Manager and Administrator.

Registered as Sales Invoice's permission_query_conditions hook, which Frappe
applies to every permission-checked Sales Invoice query. It only returns a
condition when the query comes from Desk's list endpoints
(frappe.desk.reportview.* / frappe.desk.listview.*: list, report, counts,
sidebar, group-by, export, and frappe.db.get_list/count in Desk scripts) or
from the background export job. Everything else is left alone on purpose:
the POS loads held (draft) invoices with frappe.get_list as the terminal user,
who can hold Accounts User, and link-field searches and ERPNext reports have
their own rules.

It locks what the list, report and export show, not the documents: a draft or
cancelled invoice still opens by its name or from a link.
"""

import frappe

EXEMPT_ROLE = "System Manager"
DESK_LIST_PREFIXES = ("frappe.desk.reportview.", "frappe.desk.listview.")
BACKGROUND_EXPORT_JOB = "frappe.desk.reportview.run_report_view_export_job"
CONDITION = "`tabSales Invoice`.`docstatus` = 1"


def is_exempt(user=None):
    user = user or frappe.session.user
    return user == "Administrator" or EXEMPT_ROLE in frappe.get_roles(user)


def _called_method():
    form_dict = getattr(frappe.local, "form_dict", None) or {}
    if cmd := form_dict.get("cmd"):
        return str(cmd)
    # /api/v2/method/<method> doesn't set form_dict.cmd
    request = getattr(frappe.local, "request", None)
    path = getattr(request, "path", "") or ""
    if "/method/" in path:
        return path.rsplit("/method/", 1)[1]
    return ""


def from_desk_list():
    if _called_method().startswith(DESK_LIST_PREFIXES):
        return True
    job = getattr(frappe.local, "job", None)
    return bool(job and job.get("method") == BACKGROUND_EXPORT_JOB)


def get_permission_query_conditions(user=None, doctype=None):
    if is_exempt(user) or not from_desk_list():
        return ""
    return CONDITION
