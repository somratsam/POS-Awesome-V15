# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""API for embedding local print assets (e.g. the receipt logo) as data URIs.

Called from within Print Format Jinja templates via frappe.call(), the same
sandboxed-call pattern used by the Z Report print format
(closing_processing/z_report.py's get_z_report_data). Returning a data URI
here means the QZ Tray HTML renderer never has to fetch the image over the
network at print time -- it's already inline in the HTML string.
"""

import base64
import mimetypes

import frappe
from frappe.utils.file_manager import get_file

from posawesome.posawesome.api.pos_access import get_authorized_pos_profile


@frappe.whitelist()
def get_receipt_logo_data_uri(pos_profile: str) -> str:
    """Return the given POS Profile's receipt logo as a data: URI, or "" if unset
    or the caller isn't authorized for that profile.

    Directly-callable whitelisted endpoint, so get_authorized_pos_profile()
    re-validates the requesting user actually has access to pos_profile before
    reading its logo -- otherwise any authenticated user could read another
    store's logo by passing a different profile name. Failure returns "" (not
    a thrown error) to match this function's existing fail-open design: a
    missing/unauthorized logo should never break receipt printing.
    """
    if not pos_profile:
        return ""

    try:
        profile_doc = get_authorized_pos_profile(pos_profile)
    except Exception:
        return ""

    file_url = profile_doc.get("posa_receipt_logo")
    if not file_url:
        return ""

    try:
        filename, content = get_file(file_url)
    except Exception:
        frappe.log_error(title="Receipt logo load failed", message=frappe.get_traceback())
        return ""

    mime_type = mimetypes.guess_type(filename)[0] or "image/png"
    return f"data:{mime_type};base64,{base64.b64encode(content).decode('utf-8')}"
