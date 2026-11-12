"""Who a sale is credited to: the chosen Sales Person's user, else the PIN cashier.

Staff performance (Sales by Cashier in the POS, Staff / Cashier Performance on
the POS dashboard) counts each Sales Invoice for one person, saved on the
invoice as "Sales credited to" (posa_credited_user + posa_credited_user_name):

- The invoice's Sales Team row with the highest share (the POS only ever
  writes one row at 100%). When that Sales Person has a "POS User"
  (Sales Person.posa_user), the sale is credited to that user.
- Otherwise -- no Sales Person, or one without a POS User -- the PIN cashier
  (posa_cashier).
- A return against an invoice is credited to whoever was credited on that
  invoice, whatever Sales Person or cashier is on the return, so a refund
  always comes off the person who got the sale.

posa_cashier (who rang the sale up, from the PIN) is never changed here.

The value is a snapshot: it is set when the invoice is saved or submitted
and when its Sales Team is changed after submit (Desk), and relinking a
Sales Person later doesn't move past sales until `refresh_sales_credit` is
run (bench --site <site> posa-refresh-sales-credit), which recomputes every
submitted invoice with these same rules and changes only the ones that
differ.

Only a System Manager (or Administrator) can change the Sales Team of a
submitted invoice (before_update_after_submit).

Sales Person "POS User": one user per Sales Person, not on a group heading,
set or changed only by a System Manager (validate_sales_person).

POS checks on the chosen Sales Person (check_pos_sales_team): enabled, not a
group heading, and on the POS Profile's "Allowed Sales Persons" list when
one is set.
"""

from __future__ import annotations

from collections import Counter, defaultdict

import frappe
from frappe import _
from frappe.utils import cstr, flt

CREDITED_USER_FIELD = "posa_credited_user"
CREDITED_NAME_FIELD = "posa_credited_user_name"
SALES_PERSON_USER_FIELD = "posa_user"
CASHIER_FIELD = "posa_cashier"
EXEMPT_ROLE = "System Manager"
OFFLINE_SOURCE = "offline_sync"
AMENDMENT_SOURCE = "submitted_amendment"


def _has_credit_fields(doctype):
    return doctype == "Sales Invoice" and frappe.get_meta(doctype).has_field(CREDITED_USER_FIELD)


def _sales_person_users(names):
    names = [name for name in {cstr(n).strip() for n in names} if name]
    if not names or not frappe.get_meta("Sales Person").has_field(SALES_PERSON_USER_FIELD):
        return {}
    rows = frappe.get_all(
        "Sales Person",
        filters={"name": ["in", names]},
        fields=["name", SALES_PERSON_USER_FIELD],
        ignore_permissions=True,
    )
    return {row.name: cstr(row.get(SALES_PERSON_USER_FIELD)).strip() for row in rows}


def top_sales_person(rows):
    """The Sales Team row with the highest share (first one on a tie)."""
    best = None
    for row in rows or []:
        name = cstr(row.get("sales_person")).strip()
        if not name:
            continue
        if best is None or flt(row.get("allocated_percentage")) > flt(best[1]):
            best = (name, row.get("allocated_percentage"))
    return best[0] if best else None


def credit_for(sales_team_rows, cashier, sales_person_users=None):
    """The credited user of a sale (not a return against an invoice)."""
    sales_person = top_sales_person(sales_team_rows)
    if sales_person:
        users = sales_person_users if sales_person_users is not None else _sales_person_users([sales_person])
        linked = cstr(users.get(sales_person)).strip()
        if linked:
            return linked
    return cstr(cashier).strip() or None


def _stored_credit(doctype, name):
    """Credited user of a saved invoice (computed if it was never filled)."""
    values = frappe.db.get_value(doctype, name, [CREDITED_USER_FIELD, CASHIER_FIELD], as_dict=True)
    if not values:
        return None
    if cstr(values.get(CREDITED_USER_FIELD)).strip():
        return cstr(values.get(CREDITED_USER_FIELD)).strip()
    rows = frappe.get_all(
        "Sales Team",
        filters={"parent": name, "parenttype": doctype},
        fields=["sales_person", "allocated_percentage"],
        order_by="idx asc",
        ignore_permissions=True,
    )
    return credit_for(rows, values.get(CASHIER_FIELD))


def user_full_name(user):
    user = cstr(user).strip()
    if not user:
        return None
    return cstr(frappe.db.get_value("User", user, "full_name")).strip() or user


def set_credited_user(doc, method=None):
    """Fill "Sales credited to" on a Sales Invoice (validate / update after submit)."""
    if not _has_credit_fields(doc.doctype):
        return
    if doc.get("is_return") and cstr(doc.get("return_against")).strip():
        credited = _stored_credit(doc.doctype, doc.return_against) or cstr(doc.get(CASHIER_FIELD)).strip() or None
    else:
        credited = credit_for(doc.get("sales_team"), doc.get(CASHIER_FIELD))
    doc.set(CREDITED_USER_FIELD, credited)
    doc.set(CREDITED_NAME_FIELD, user_full_name(credited))


def _sales_team_key(rows):
    return [
        (cstr(row.get("sales_person")).strip(), flt(row.get("allocated_percentage")))
        for row in rows or []
        if cstr(row.get("sales_person")).strip()
    ]


def before_update_after_submit(doc, method=None):
    """Only a System Manager may change the Sales Team of a submitted invoice.

    The Sales Team decides who a sale is credited to, so a change after
    submit moves staff performance. Contact or incentive edits on the same
    rows are still allowed.
    """
    if doc.doctype == "Sales Invoice" and not _is_exempt(frappe.session.user):
        before = doc.get_doc_before_save()
        if before and _sales_team_key(before.get("sales_team")) != _sales_team_key(doc.get("sales_team")):
            frappe.throw(
                _("Only a System Manager can change the Sales Person of a submitted invoice."),
                frappe.PermissionError,
                title=_("Sales Person"),
            )
    set_credited_user(doc, method)


def on_update_after_submit(doc, method=None):
    """A Sales Team corrected after submit also moves the returns against it."""
    if not _has_credit_fields(doc.doctype) or doc.get("is_return"):
        return
    before = doc.get_doc_before_save()
    if before and cstr(before.get(CREDITED_USER_FIELD)) == cstr(doc.get(CREDITED_USER_FIELD)):
        return
    frappe.db.sql(
        f"""UPDATE `tabSales Invoice`
            SET `{CREDITED_USER_FIELD}` = %(user)s, `{CREDITED_NAME_FIELD}` = %(name)s
            WHERE return_against = %(invoice)s AND is_return = 1 AND docstatus = 1""",
        {"user": doc.get(CREDITED_USER_FIELD), "name": doc.get(CREDITED_NAME_FIELD), "invoice": doc.name},
    )


# --- POS: the chosen Sales Person -------------------------------------------


def _allowed_sales_persons(profile_doc):
    rows = (profile_doc.get("posa_sales_persons") if profile_doc else None) or []
    return {cstr(row.get("sales_person")).strip() for row in rows if cstr(row.get("sales_person")).strip()}


def _sales_person_problem(name, info, allowed):
    if not info:
        return _("Sales Person {0} does not exist.").format(name)
    if info.get("is_group"):
        return _("{0} is a group heading, not a Sales Person. Choose a Sales Person.").format(name)
    if not info.get("enabled"):
        return _("Sales Person {0} is disabled.").format(name)
    if allowed and name not in allowed:
        return _("Sales Person {0} is not allowed for this store.").format(name)
    return None


def check_pos_sales_team(invoice_doc, profile_doc):
    """The POS's chosen Sales Person: enabled, not a group, allowed for the store.

    A sale from the till is refused with the reason. An offline sale being
    synced can't be fixed by the cashier any more, so a wrong row is dropped
    (the sale goes to the PIN cashier) and logged instead. An Edit Invoice
    amendment keeps the original invoice's Sales Team as it was accepted.
    """
    rows = [row for row in (invoice_doc.get("sales_team") or []) if cstr(row.get("sales_person")).strip()]
    if not rows:
        return
    audit = getattr(frappe.flags, "posa_trusted_shift_audit", None) or {}
    source = audit.get("source")
    if source == AMENDMENT_SOURCE:
        return

    names = {cstr(row.get("sales_person")).strip() for row in rows}
    info = {
        row.name: row
        for row in frappe.get_all(
            "Sales Person",
            filters={"name": ["in", list(names)]},
            fields=["name", "enabled", "is_group"],
            ignore_permissions=True,
        )
    }
    allowed = _allowed_sales_persons(profile_doc)
    problems = []
    for row in rows:
        name = cstr(row.get("sales_person")).strip()
        problem = _sales_person_problem(name, info.get(name), allowed)
        if problem:
            problems.append((row, problem))
    if not problems:
        return

    if source == OFFLINE_SOURCE:
        bad = {id(row) for row, _problem in problems}
        invoice_doc.set("sales_team", [row for row in invoice_doc.get("sales_team") if id(row) not in bad])
        frappe.log_error(
            title="POS Sales Person dropped on offline sync",
            message="\n".join(
                [f"Invoice: {invoice_doc.get('name') or invoice_doc.get('posa_client_request_id') or 'new'}"]
                + [problem for _row, problem in problems]
            ),
        )
        return
    frappe.throw(problems[0][1], title=_("Sales Person"))


# --- Sales Person: POS User --------------------------------------------------


def _is_exempt(user):
    return user == "Administrator" or EXEMPT_ROLE in frappe.get_roles(user)


def validate_sales_person(doc, method=None):
    if not doc.meta.has_field(SALES_PERSON_USER_FIELD):
        return
    value = cstr(doc.get(SALES_PERSON_USER_FIELD)).strip() or None
    before = None if doc.is_new() else doc.get_doc_before_save()
    previous = cstr(before.get(SALES_PERSON_USER_FIELD)).strip() or None if before else None

    if value != previous and not _is_exempt(frappe.session.user):
        # Read-only for everyone but System Manager, through the API too.
        doc.set(SALES_PERSON_USER_FIELD, previous)
        return
    doc.set(SALES_PERSON_USER_FIELD, value)
    if not value or value == previous:
        return
    if doc.get("is_group"):
        frappe.throw(_("A group heading can't have a POS User. Link the user to a Sales Person instead."))
    taken = frappe.db.get_value(
        "Sales Person", {SALES_PERSON_USER_FIELD: value, "name": ["!=", doc.name or ""]}, "name"
    )
    if taken:
        frappe.throw(_("{0} is already the POS User of Sales Person {1}.").format(value, taken))


# --- Refresh (re-runnable) -------------------------------------------------------


def refresh_sales_credit(dry_run=False, verbose=True):
    """Recompute "Sales credited to" on every submitted Sales Invoice.

    Changes only invoices whose credited person (or its name) differs from
    the rules, without touching `modified` or making a Version. Run after
    linking Sales Persons to users; safe to run again.
    """
    if not _has_credit_fields("Sales Invoice"):
        frappe.throw(_("Run bench migrate first: the Sales credited to fields are missing."))

    invoices = frappe.db.sql(
        f"""SELECT name, is_return, return_against, `{CASHIER_FIELD}` AS cashier,
                   `{CREDITED_USER_FIELD}` AS credited, `{CREDITED_NAME_FIELD}` AS credited_name
            FROM `tabSales Invoice` WHERE docstatus = 1""",
        as_dict=True,
    )
    team = defaultdict(list)
    for row in frappe.db.sql(
        """SELECT parent, sales_person, allocated_percentage FROM `tabSales Team`
           WHERE parenttype = 'Sales Invoice' ORDER BY parent, idx""",
        as_dict=True,
    ):
        team[row.parent].append(row)
    users = _sales_person_users({row.sales_person for rows in team.values() for row in rows})

    expected = {}
    unlinked = Counter()
    for inv in invoices:
        if inv.is_return and cstr(inv.return_against).strip():
            continue
        expected[inv.name] = credit_for(team.get(inv.name), inv.cashier, users)
        top = top_sales_person(team.get(inv.name))
        if top and not users.get(top):
            unlinked[top] += 1
    for inv in invoices:
        if inv.is_return and cstr(inv.return_against).strip():
            original = inv.return_against
            credited = expected.get(original)
            if original not in expected:
                credited = _stored_credit("Sales Invoice", original)
            expected[inv.name] = credited or cstr(inv.cashier).strip() or None

    names = {}
    for user in {u for u in expected.values() if u}:
        names[user] = user_full_name(user)

    changed = []
    for inv in invoices:
        user = expected.get(inv.name)
        name = names.get(user) if user else None
        if cstr(inv.credited) != cstr(user) or cstr(inv.credited_name) != cstr(name):
            changed.append((inv, user, name))

    moves = Counter()
    filled = 0
    for inv, user, name in changed:
        if not cstr(inv.credited).strip():
            filled += 1
        if cstr(inv.credited).strip() and cstr(inv.credited) != cstr(user):
            moves[(names.get(inv.credited) or inv.credited_name or inv.credited, name or "-")] += 1
        elif not cstr(inv.credited).strip() and cstr(user) != cstr(inv.cashier):
            moves[(_("PIN cashier"), name or "-")] += 1

    if not dry_run:
        for inv, user, name in changed:
            frappe.db.set_value(
                "Sales Invoice",
                inv.name,
                {CREDITED_USER_FIELD: user, CREDITED_NAME_FIELD: name},
                update_modified=False,
            )
        frappe.db.commit()

    to_sales_person = sum(
        1 for inv in invoices if expected.get(inv.name) and expected.get(inv.name) != cstr(inv.cashier).strip()
    )
    summary = {
        "checked": len(invoices),
        "changed": len(changed),
        "filled": filled,
        "unchanged": len(invoices) - len(changed),
        "credited_to_other_than_cashier": to_sales_person,
        "moves": [{"from": a, "to": b, "count": n} for (a, b), n in sorted(moves.items())],
        "unlinked_sales_persons": dict(sorted(unlinked.items())),
        "dry_run": bool(dry_run),
    }
    if verbose:
        prefix = "Sales credit refresh (dry run, nothing written)" if dry_run else "Sales credit refresh"
        print(
            f"{prefix}: {summary['checked']} submitted invoices checked, {summary['changed']} "
            f"{'would change' if dry_run else 'changed'} ({filled} were blank), {summary['unchanged']} unchanged."
        )
        print(f"Credited to someone other than their PIN cashier: {to_sales_person}.")
        for move in summary["moves"]:
            print(f"  {move['from']} -> {move['to']}: {move['count']}")
        if unlinked:
            print("Sales Persons on invoices without a POS User (those sales stay with the PIN cashier):")
            for sales_person, count in summary["unlinked_sales_persons"].items():
                print(f"  {sales_person}: {count}")
    return summary
