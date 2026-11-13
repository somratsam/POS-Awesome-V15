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

Every POS sale gets a Sales Person when one can be known, so ERPNext's
Sales Person reports and commission see the same people
(apply_pos_sales_team, at submit):
- A Sales Person chosen on the till is kept (after the checks above).
- None chosen: the PIN cashier's own Sales Person (the one whose POS User
  they are) at 100% -- whatever the store's Allowed list, so staff covering
  another store still get it. A cashier without one: left empty.
- A return against an invoice always gets the original's Sales Team,
  whatever was picked on the till (a disabled Sales Person can't be put on
  a new invoice, so then it is left empty; the credit still follows the
  original). A return without an original is treated like a sale.
- Edit Invoice (an amendment) keeps the Sales Team it copied from the
  original, and its credit stays with the original sale: with no linked
  Sales Person, the PIN cashier of the first invoice in the chain, not the
  supervisor who made the edit (original_cashier).

`fill_pos_sales_team` (bench --site <site> posa-fill-sales-person) applies
the same rules to past submitted POS invoices.
"""

from __future__ import annotations

from collections import Counter, defaultdict

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

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


def original_cashier(doctype, amended_from, cashier=None):
    """The PIN cashier of the first invoice of an Edit Invoice chain."""
    current, seen = cstr(amended_from).strip(), set()
    while current and current not in seen:
        seen.add(current)
        row = frappe.db.get_value(doctype, current, ["amended_from", CASHIER_FIELD], as_dict=True)
        if not row:
            break
        cashier = cstr(row.get(CASHIER_FIELD)).strip() or cashier
        current = cstr(row.get("amended_from")).strip()
    return cstr(cashier).strip() or None


def set_credited_user(doc, method=None):
    """Fill "Sales credited to" on a Sales Invoice (validate / update after submit)."""
    if not _has_credit_fields(doc.doctype):
        return
    if doc.get("is_return") and cstr(doc.get("return_against")).strip():
        credited = _stored_credit(doc.doctype, doc.return_against) or cstr(doc.get(CASHIER_FIELD)).strip() or None
    else:
        cashier = doc.get(CASHIER_FIELD)
        if cstr(doc.get("amended_from")).strip():
            # Edit Invoice: posa_cashier is whoever made the edit.
            cashier = original_cashier(doc.doctype, doc.amended_from, cashier)
        credited = credit_for(doc.get("sales_team"), cashier)
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
    source = _trusted_source()
    if source == AMENDMENT_SOURCE or _is_return_against(invoice_doc):
        return  # the original's Sales Team (apply_pos_sales_team)

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


def _trusted_source():
    audit = getattr(frappe.flags, "posa_trusted_shift_audit", None) or {}
    return audit.get("source") if isinstance(audit, dict) else None


def _is_return_against(doc):
    return bool(cint(doc.get("is_return")) and cstr(doc.get("return_against")).strip())


def linked_sales_person(user):
    """The enabled Sales Person whose POS User is this user, if any."""
    user = cstr(user).strip()
    if not user or not frappe.get_meta("Sales Person").has_field(SALES_PERSON_USER_FIELD):
        return None
    return frappe.db.get_value(
        "Sales Person", {SALES_PERSON_USER_FIELD: user, "enabled": 1, "is_group": 0}, "name"
    )


def _team_rows(doctype, name):
    return frappe.get_all(
        "Sales Team",
        filters={"parent": name, "parenttype": doctype, "parentfield": "sales_team"},
        fields=["sales_person", "allocated_percentage"],
        order_by="idx asc",
        ignore_permissions=True,
    )


def apply_pos_sales_team(invoice_doc, profile_doc):
    """The POS invoice's Sales Team at submit (see the module docstring)."""
    if invoice_doc.get("doctype") not in ("Sales Invoice", "POS Invoice"):
        return
    if _trusted_source() == AMENDMENT_SOURCE or cstr(invoice_doc.get("amended_from")).strip():
        return  # Edit Invoice keeps what it copied from the original
    if _is_return_against(invoice_doc):
        rows = [r for r in _team_rows(invoice_doc.doctype, invoice_doc.return_against) if cstr(r.sales_person).strip()]
        names = [r.sales_person for r in rows]
        enabled = set(
            frappe.get_all("Sales Person", filters={"name": ["in", names], "enabled": 1}, pluck="name", ignore_permissions=True)
        ) if names else set()
        if any(name not in enabled for name in names):
            rows = []  # ERPNext refuses a disabled Sales Person on a new invoice
        invoice_doc.set(
            "sales_team",
            [{"sales_person": r.sales_person, "allocated_percentage": r.allocated_percentage} for r in rows],
        )
        return
    check_pos_sales_team(invoice_doc, profile_doc)
    if any(cstr(row.get("sales_person")).strip() for row in invoice_doc.get("sales_team") or []):
        return
    own = linked_sales_person(invoice_doc.get(CASHIER_FIELD))
    if own:
        invoice_doc.set("sales_team", [{"sales_person": own, "allocated_percentage": 100}])


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
        f"""SELECT name, is_return, return_against, amended_from, `{CASHIER_FIELD}` AS cashier,
                   `{CREDITED_USER_FIELD}` AS credited, `{CREDITED_NAME_FIELD}` AS credited_name
            FROM `tabSales Invoice` WHERE docstatus = 1""",
        as_dict=True,
    )
    chain = {
        row.name: row
        for row in frappe.db.sql(
            f"""SELECT name, amended_from, `{CASHIER_FIELD}` AS cashier FROM `tabSales Invoice`
                WHERE IFNULL(amended_from, '') <> '' OR name IN (
                    SELECT amended_from FROM `tabSales Invoice` WHERE IFNULL(amended_from, '') <> '')""",
            as_dict=True,
        )
    }

    def first_cashier(inv):
        # Edit Invoice: the credit stays with the first invoice's PIN cashier.
        cashier, current, seen = inv.cashier, cstr(inv.amended_from).strip(), set()
        while current and current not in seen and current in chain:
            seen.add(current)
            cashier = cstr(chain[current].cashier).strip() or cashier
            current = cstr(chain[current].amended_from).strip()
        return cashier
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
        expected[inv.name] = credit_for(team.get(inv.name), first_cashier(inv), users)
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


# --- Fill past POS invoices (re-runnable) ---------------------------------------


def _key(rows):
    return [(cstr(r.get("sales_person")).strip(), flt(r.get("allocated_percentage"))) for r in rows or []
            if cstr(r.get("sales_person")).strip()]


def fill_pos_sales_team(dry_run=False, verbose=True):
    """Give past submitted POS Sales Invoices the Sales Team the POS now sets.

    Same rules as apply_pos_sales_team: an invoice without a Sales Person
    gets its PIN cashier's own Sales Person (an Edit Invoice amendment: the
    first invoice's cashier); a return against an invoice gets the
    original's Sales Team, replacing a different one (listed). Invoices that
    already have a Sales Person are left alone. Rows are written directly
    with ERPNext's allocated amount and incentives, without touching
    `modified` or making a Version; no accounting entries. Run after linking
    Sales Persons to users, then run posa-refresh-sales-credit. Safe to run
    again.
    """
    from frappe.model.meta import get_field_precision

    invoices = frappe.db.sql(
        f"""SELECT name, is_return, return_against, amended_from, `{CASHIER_FIELD}` AS cashier,
                   amount_eligible_for_commission, base_net_total
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND IFNULL(pos_profile, '') <> ''
            ORDER BY posting_date, creation""",
        as_dict=True,
    )
    team = defaultdict(list)
    for row in frappe.db.sql(
        """SELECT parent, sales_person, allocated_percentage FROM `tabSales Team`
           WHERE parenttype = 'Sales Invoice' AND parentfield = 'sales_team' ORDER BY parent, idx""",
        as_dict=True,
    ):
        team[row.parent].append(row)
    chain = {
        row.name: row
        for row in frappe.db.sql(
            f"""SELECT name, amended_from, `{CASHIER_FIELD}` AS cashier FROM `tabSales Invoice`
                WHERE IFNULL(amended_from, '') <> '' OR name IN (
                    SELECT amended_from FROM `tabSales Invoice` WHERE IFNULL(amended_from, '') <> '')""",
            as_dict=True,
        )
    }
    linked = {}
    if frappe.get_meta("Sales Person").has_field(SALES_PERSON_USER_FIELD):
        for row in frappe.get_all(
            "Sales Person",
            filters={SALES_PERSON_USER_FIELD: ["is", "set"], "enabled": 1, "is_group": 0},
            fields=["name", SALES_PERSON_USER_FIELD, "commission_rate"],
            ignore_permissions=True,
        ):
            linked[cstr(row.get(SALES_PERSON_USER_FIELD)).strip()] = row.name
    rates = dict(frappe.get_all("Sales Person", fields=["name", "commission_rate"], as_list=True, ignore_permissions=True))

    def first_cashier(inv):
        cashier, current, seen = inv.cashier, cstr(inv.amended_from).strip(), set()
        while current and current not in seen and current in chain:
            seen.add(current)
            cashier = cstr(chain[current].cashier).strip() or cashier
            current = cstr(chain[current].amended_from).strip()
        return cstr(cashier).strip()

    expected = {}
    counts = Counter()
    unlinked = Counter()
    overwritten = []
    ordered = [i for i in invoices if not (i.is_return and cstr(i.return_against).strip())] + [
        i for i in invoices if i.is_return and cstr(i.return_against).strip()
    ]
    for inv in ordered:
        current = _key(team.get(inv.name))
        if inv.is_return and cstr(inv.return_against).strip():
            original = expected.get(inv.return_against)
            if original is None:
                original = _key(team.get(inv.return_against))
            expected[inv.name] = original
            if current != original:
                counts["return_copied"] += 1
                if current:
                    overwritten.append((inv.name, inv.return_against, current, original))
            continue
        if current:
            expected[inv.name] = current
            counts["had_sales_person"] += 1
            continue
        cashier = first_cashier(inv) if cstr(inv.amended_from).strip() else cstr(inv.cashier).strip()
        own = linked.get(cashier)
        if own:
            expected[inv.name] = [(own, 100.0)]
            counts["amendment_filled" if cstr(inv.amended_from).strip() else "filled"] += 1
        else:
            expected[inv.name] = []
            unlinked[cashier or _("(no cashier)")] += 1

    changes = [(inv, expected[inv.name]) for inv in invoices if _key(team.get(inv.name)) != expected[inv.name]]
    if not dry_run and changes:
        df = frappe.get_meta("Sales Team").get_field("allocated_amount")
        precision = cint(get_field_precision(df, currency=frappe.db.get_default("currency"))) or 3
        for inv, rows in changes:
            frappe.db.delete("Sales Team", {"parent": inv.name, "parenttype": "Sales Invoice", "parentfield": "sales_team"})
            base = flt(inv.amount_eligible_for_commission) if inv.amount_eligible_for_commission is not None else flt(inv.base_net_total)
            for idx, (sales_person, pct) in enumerate(rows, 1):
                amount = flt(base * pct / 100.0, precision)
                rate = flt(rates.get(sales_person))
                row = frappe.get_doc(
                    {
                        "doctype": "Sales Team",
                        "parent": inv.name,
                        "parenttype": "Sales Invoice",
                        "parentfield": "sales_team",
                        "idx": idx,
                        "sales_person": sales_person,
                        "allocated_percentage": pct,
                        "allocated_amount": amount,
                        "commission_rate": rate,
                        "incentives": flt(amount * rate / 100.0, precision) if rate else 0,
                    }
                )
                row.db_insert()
        frappe.db.commit()

    summary = {
        "checked": len(invoices),
        "changed": len(changes),
        "filled_from_cashier": counts["filled"],
        "amendments_filled_from_first_cashier": counts["amendment_filled"],
        "returns_given_original": counts["return_copied"],
        "returns_overwritten": [
            {"return": r, "original": o, "was": [sp for sp, _p in was], "now": [sp for sp, _p in now]}
            for r, o, was, now in overwritten
        ],
        "already_had_sales_person": counts["had_sales_person"],
        "left_empty_cashier_not_linked": dict(sorted(unlinked.items())),
        "dry_run": bool(dry_run),
    }
    if verbose:
        verb = "would change" if dry_run else "changed"
        prefix = "POS Sales Person fill (dry run, nothing written)" if dry_run else "POS Sales Person fill"
        print(f"{prefix}: {summary['checked']} submitted POS invoices checked, {summary['changed']} {verb}.")
        print(f"  Filled with the PIN cashier's own Sales Person: {summary['filled_from_cashier']}")
        print(f"  Edit Invoice amendments filled from the first invoice's cashier: {summary['amendments_filled_from_first_cashier']}")
        print(f"  Returns given their original's Sales Team: {summary['returns_given_original']}")
        if overwritten:
            print(f"  Of those, returns that had a different Sales Person ({len(overwritten)}):")
            for item in summary["returns_overwritten"]:
                print(f"    {item['return']} (original {item['original']}): {', '.join(item['was'])} -> {', '.join(item['now']) or '(none)'}")
        print(f"  Already had a Sales Person (left as is): {summary['already_had_sales_person']}")
        if unlinked:
            print("  Left empty -- PIN cashier has no linked Sales Person:")
            for cashier, count in summary["left_empty_cashier_not_linked"].items():
                print(f"    {cashier}: {count}")
        if not dry_run:
            print("Now run posa-refresh-sales-credit.")
    return summary
