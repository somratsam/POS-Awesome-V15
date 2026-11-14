"""One-time switch of the "Swan Sales Invoice" Print Format record to the
receipt kept in git (posawesome/templates/print/swan_receipt.html).

The record stays a non-standard Print Format with the same name, so every
POS Profile keeps pointing at it and `bench migrate` never touches it. Its
HTML becomes only the switch below; the receipt and the voucher live in git.

Run from the bench, never from the browser (not whitelisted):

    bench --site <site> execute posawesome.posawesome.api.receipt_record.switch_swan_receipt \
        --kwargs "{'expected_md5': '<md5 of the record's current HTML>'}"

It refuses when the record's HTML is not the one expected (edited by hand
since it was checked), writes a JSON backup of the whole record to
sites/<site>/private/backups/ first, and prints the backup path. To go back:

    bench --site <site> execute posawesome.posawesome.api.receipt_record.restore_swan_receipt \
        --kwargs "{'backup_path': '<path printed by the switch>'}"

The record's HTML before this change is also kept in git:
posawesome/templates/print/archive/swan_sales_invoice_record_2026-11-05.html.
"""

import hashlib
import json
import os

import frappe
from frappe.utils import now_datetime

PRINT_FORMAT = "Swan Sales Invoice"

SWITCH_HTML = (
    "{#- Swan receipt and credit note voucher, both kept in git (posawesome app):\n"
    "    posawesome/templates/print/swan_receipt.html and credit_note_voucher.html.\n"
    "    A return that refunds no money prints the voucher. -#}\n"
    "{%- if is_credit_note_voucher(doc) -%}\n"
    '{% include "posawesome/templates/print/credit_note_voucher.html" %}\n'
    "{%- else -%}\n"
    '{% include "posawesome/templates/print/swan_receipt.html" %}\n'
    "{%- endif -%}\n"
)


def html_md5(html):
    return hashlib.md5((html or "").encode()).hexdigest()


def _backup(doc, label):
    stamp = now_datetime().strftime("%Y%m%d_%H%M%S")
    path = frappe.get_site_path("private", "backups", f"print_format_swan_sales_invoice_{label}_{stamp}.json")
    with open(path, "w") as handle:
        json.dump(doc.as_dict(), handle, default=str, indent=1, ensure_ascii=False)
    return os.path.abspath(path)


def switch_swan_receipt(expected_md5=None):
    doc = frappe.get_doc("Print Format", PRINT_FORMAT)
    current = html_md5(doc.html)
    if current == html_md5(SWITCH_HTML):
        print("Already switched; nothing changed.")
        return
    if not expected_md5 or current != expected_md5:
        frappe.throw(
            f"{PRINT_FORMAT} HTML checksum is {current}, expected {expected_md5}. "
            "Compare the record with the archived copy before switching; nothing changed."
        )
    path = _backup(doc, "before_git_receipt")
    doc.html = SWITCH_HTML
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    frappe.clear_cache()
    print(f"Switched. Backup: {path}")


def restore_swan_receipt(backup_path):
    with open(backup_path) as handle:
        saved = json.load(handle)
    if saved.get("name") != PRINT_FORMAT or not saved.get("html"):
        frappe.throw(f"{backup_path} is not a backup of {PRINT_FORMAT}.")
    doc = frappe.get_doc("Print Format", PRINT_FORMAT)
    path = _backup(doc, "before_restore")
    doc.html = saved["html"]
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    frappe.clear_cache()
    print(f"Restored HTML from {backup_path}. Previous HTML saved to {path}")
