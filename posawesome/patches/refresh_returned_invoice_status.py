"""Refresh the status of sales that have a submitted return.

POS returns keep their credit on themselves (update_outstanding_for_self),
so ERPNext never re-saves the original's status after a return: some
originals said "Credit Note Issued", others still "Paid" (section 104). From
now on invoice.refresh_returned_invoice_status does it on every return's
submit and cancel; this patch brings existing invoices in line.

Only the status column changes, through ERPNext's own set_status (no GL, no
modified date). Dry run first:

    bench --site <site> execute posawesome.patches.refresh_returned_invoice_status.dry_run
"""

import frappe


def _originals():
    return frappe.db.sql_list(
        """
        select distinct o.name
        from `tabSales Invoice` o
        inner join `tabSales Invoice` r on r.return_against = o.name and r.is_return = 1 and r.docstatus = 1
        where o.docstatus = 1 and o.is_return = 0
        order by o.name
        """
    )


def _changes():
    changes = []
    for name in _originals():
        doc = frappe.get_doc("Sales Invoice", name)
        before = doc.status
        doc.set_status()
        if doc.status != before:
            changes.append((name, before, doc.status))
    return changes


def dry_run():
    """What execute() would change, without changing anything."""
    originals = _originals()
    changes = _changes()
    summary = {}
    for _name, before, after in changes:
        summary[f"{before} -> {after}"] = summary.get(f"{before} -> {after}", 0) + 1
    result = {"originals_with_returns": len(originals), "would_change": len(changes), "by_change": summary}
    print(result)
    return result


def execute():
    for name, _before, after in _changes():
        frappe.db.set_value("Sales Invoice", name, "status", after, update_modified=False)
