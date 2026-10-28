# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""Store-to-store transfers on top of ERPNext's own Add to Transit / End Transit.

ERPNext moves the goods: a Material Transfer with "Add to Transit" puts them in
a Transit warehouse, and "End Transit" makes the receiving entry. It has no idea
which store the goods are for, so this module adds a Destination Store
(`posa_destination_store`) and enforces it:

- a transit entry must name a real store as its destination;
- on submit it is shared read-only with that store's users and they get a bell
  notification (email only when the site config `posa_transit_email` is set);
- a receiving entry must put each row into that row's Destination Store. A Stock
  Manager may instead return a row to the store it was sent from (a shortage);
- stock can only leave a Transit warehouse through End Transit; the one exception
  is a Stock Manager writing a shortage off with a Material Issue.

Every check reads the sent entry from the database; nothing on the receiving
form is trusted. Shortage handling is ERPNext's: units not received stay in transit.
"""

import frappe
from frappe import _
from frappe.core.doctype.user_permission.user_permission import get_user_permissions
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.permissions import get_role_permissions
from frappe.share import add_docshare
from frappe.utils import cint, cstr, escape_html, get_url_to_form

DESTINATION_FIELD = "posa_destination_store"
TRANSIT_WAREHOUSE_TYPE = "Transit"
# The only role that may return a shortage to the sending store, or write one off
# with a Material Issue from a Transit warehouse.
OVERRIDE_ROLE = "Stock Manager"
EMAIL_CONFIG_KEY = "posa_transit_email"


def validate(doc, method=None):
    if doc.get(DESTINATION_FIELD) and not is_transit_send(doc):
        # Only a sending entry has a destination (e.g. one copied from an old draft).
        doc.set(DESTINATION_FIELD, None)
    if is_transit_send(doc):
        validate_destination(doc)
    validate_rows_leaving_transit(doc)


def on_submit(doc, method=None):
    if not is_transit_send(doc) or not doc.get(DESTINATION_FIELD):
        return
    destination = doc.get(DESTINATION_FIELD)
    receivers = get_receivers(destination, exclude={frappe.session.user, doc.owner})
    if not receivers:
        frappe.msgprint(
            _(
                "Nobody at {0} has been set up to receive transfers, so nobody was told about {1}. "
                "Tell the store yourself, or ask a manager to give a store user a Warehouse permission for {0}."
            ).format(_bold(destination), _bold(doc.name)),
            title=_("Nobody Notified"),
            indicator="orange",
        )
        return
    share_with(doc, receivers)
    notify(doc, receivers)


def _bold(value):
    return frappe.bold(escape_html(cstr(value)))


def is_transit_send(doc):
    return doc.purpose == "Material Transfer" and cint(doc.add_to_transit) and not doc.outgoing_stock_entry


def is_transit_warehouse(warehouse):
    return bool(warehouse) and frappe.get_cached_value("Warehouse", warehouse, "warehouse_type") == TRANSIT_WAREHOUSE_TYPE


def has_override_role(user=None):
    return OVERRIDE_ROLE in frappe.get_roles(user or frappe.session.user)


def validate_destination(doc):
    destination = doc.get(DESTINATION_FIELD)
    if not destination:
        frappe.throw(_("Choose the Destination Store: the store these goods are going to."), title=_("Destination Store Missing"))

    store = frappe.db.get_value("Warehouse", destination, ["company", "is_group", "disabled", "warehouse_type"], as_dict=True)
    if not store:
        frappe.throw(_("Destination Store {0} does not exist.").format(_bold(destination)))
    if store.is_group or store.disabled or store.warehouse_type == TRANSIT_WAREHOUSE_TYPE:
        frappe.throw(_("{0} cannot be a Destination Store. Choose a store.").format(_bold(destination)))
    if store.company != doc.company:
        frappe.throw(_("Destination Store {0} belongs to a different company.").format(_bold(destination)))
    if destination in {row.s_warehouse for row in doc.items}:
        frappe.throw(_("Destination Store {0} is the store you are sending from.").format(_bold(destination)))


def validate_rows_leaving_transit(doc):
    """Each row taking stock out of a Transit warehouse must be End Transit of a sent
    row, received into that row's Destination Store.

    And each row ERPNext counts as received against a sent row (`against_stock_entry`
    / `ste_detail` on an End Transit entry) must take its goods from that sent row's
    Transit warehouse; otherwise a transfer could be marked received while the goods
    never left transit. That rule has no role exemption."""
    receiving = doc.purpose == "Material Transfer" and bool(doc.outgoing_stock_entry)
    rows = [
        row
        for row in doc.items
        if is_transit_warehouse(row.s_warehouse) or (receiving and (row.against_stock_entry or row.ste_detail))
    ]
    if not rows:
        return
    override = has_override_role()
    sent_rows = _get_sent_rows(rows)

    for row in rows:
        sent = sent_rows.get(row.ste_detail) if row.against_stock_entry else None
        matches_sent_row = bool(
            sent
            and sent.parent == row.against_stock_entry
            and sent.item_code == row.item_code
            and sent.t_warehouse == row.s_warehouse
        )
        if receiving and (row.against_stock_entry or row.ste_detail) and not matches_sent_row:
            frappe.throw(
                _(
                    "Row {0}: a row received with End Transit must take the goods from {1}, "
                    "where transfer {2} sent them."
                ).format(
                    row.idx,
                    _bold(sent.t_warehouse if sent else _("the transit warehouse")),
                    _bold(row.against_stock_entry or doc.outgoing_stock_entry),
                ),
                title=_("Not Allowed"),
            )
        if not (receiving and matches_sent_row):
            if override and doc.purpose == "Material Issue":
                continue  # a Stock Manager writing a shortage off
            frappe.throw(
                _(
                    "Row {0}: goods in {1} can only be received with End Transit on the transfer that sent them."
                ).format(row.idx, _bold(row.s_warehouse)),
                title=_("Not Allowed"),
            )

        destination = sent.get(DESTINATION_FIELD)
        if not destination or row.t_warehouse == destination:
            # Entries sent before Destination Store existed keep ERPNext's own behaviour.
            continue
        if override and row.t_warehouse == sent.s_warehouse:
            continue  # a Stock Manager returning a shortage to the sending store
        frappe.throw(
            _("Row {0}: transfer {1} must be received into {2}, not {3}.").format(
                row.idx,
                _bold(sent.parent),
                _bold(destination),
                _bold(row.t_warehouse or _("an empty Target Warehouse")),
            ),
            title=_("Wrong Store"),
        )


def _get_sent_rows(rows):
    names = sorted({row.ste_detail for row in rows if row.ste_detail})
    if not names:
        return {}
    se = frappe.qb.DocType("Stock Entry")
    sed = frappe.qb.DocType("Stock Entry Detail")
    sent = (
        frappe.qb.from_(sed)
        .join(se)
        .on(se.name == sed.parent)
        .select(sed.name, sed.parent, sed.item_code, sed.s_warehouse, sed.t_warehouse, se[DESTINATION_FIELD])
        .where(
            (sed.name.isin(names))
            & (sed.parenttype == "Stock Entry")
            & (se.docstatus == 1)
            & (se.purpose == "Material Transfer")
            & (se.add_to_transit == 1)
        )
        .run(as_dict=True)
    )
    return {row.name: row for row in sent}


def validate_no_stock_out_of_transit(doc, method=None):
    """Refuse any document other than End Transit that would take stock out of a
    Transit warehouse (or, for a Stock Reservation Entry, hold it there so End
    Transit can't move it; a Stock Reconciliation is refused either way). No role
    is exempt.

    Runs on every invoice, so it only reads cached Warehouse docs and builds the
    message only when it refuses.
    """
    checked = {}  # a document's rows usually share one or two warehouses
    for table, row, field in _fields_taking_stock_out(doc):
        warehouse = (row or doc).get(field)
        if not warehouse:
            continue
        if warehouse not in checked:
            checked[warehouse] = is_transit_warehouse(warehouse)
        if checked[warehouse]:
            frappe.throw(
                _(
                    "{0}: {1} is a transit warehouse. Goods in transit can only leave it with End Transit, "
                    "so they can't be {2} from there. Choose a store warehouse."
                ).format(_field_label(doc, table, row, field), _bold(warehouse), _TRANSIT_ACTIONS.get(doc.doctype, _("used"))),
                title=_("Goods Still in Transit"),
            )


_TRANSIT_ACTIONS = {
    "Delivery Note": _("sold or delivered"),
    "Sales Invoice": _("sold or delivered"),
    "POS Invoice": _("sold or delivered"),
    "Purchase Receipt": _("returned or moved"),
    "Purchase Invoice": _("returned or moved"),
    "Subcontracting Receipt": _("returned or used for subcontracting"),
    "Stock Reservation Entry": _("reserved"),
    "Stock Reconciliation": _("reconciled"),
    "Asset Capitalization": _("used for an asset"),
}


def _fields_taking_stock_out(doc):
    """(table, row, fieldname) for every field the document's stock ledger takes
    stock out of on submit, following ERPNext's selling, buying and subcontracting
    controllers. `row` is None for a field on the document itself."""
    is_return = cint(doc.get("is_return"))
    items = doc.get("items") or []

    if doc.doctype == "Stock Reservation Entry":
        return [(None, None, "warehouse")]

    if doc.doctype == "Stock Reconciliation":
        # Can lower (or raise) the quantity; a write-off is a Material Issue instead.
        return [("items", r, "warehouse") for r in items]

    if doc.doctype == "Asset Capitalization":
        return [("stock_items", r, "warehouse") for r in doc.get("stock_items") or []]

    if doc.doctype in ("Delivery Note", "Sales Invoice", "POS Invoice"):
        if doc.doctype == "Sales Invoice" and not cint(doc.get("update_stock")):
            return []  # no stock moves; a Delivery Note would, and is checked itself
        if is_return:
            # A return puts stock back, except an internal transfer's, which takes it
            # out of the Target Warehouse it went to.
            return [("items", r, "target_warehouse") for r in items]
        return [("items", r, "warehouse") for r in items] + [
            ("packed_items", r, "warehouse") for r in doc.get("packed_items") or []
        ]

    if doc.doctype in ("Purchase Receipt", "Purchase Invoice", "Subcontracting Receipt"):
        if doc.doctype == "Purchase Invoice" and not cint(doc.get("update_stock")):
            return []
        if is_return:
            found = [("items", r, f) for r in items for f in ("warehouse", "rejected_warehouse")]
        else:
            found = [("items", r, "from_warehouse") for r in items]  # internal transfer
        if doc.get("supplied_items"):
            found.append((None, None, "supplier_warehouse"))
        return found

    return []


def _field_label(doc, table, row, field):
    label = _(doc.meta.get_label(field)) if row is None else _(frappe.get_meta(row.doctype).get_label(field))
    if row is None:
        return label
    prefix = _("Packed Items row {0}") if table == "packed_items" else _("Row {0}")
    return f"{prefix.format(row.idx)} ({label})"


def get_permitted_warehouses(user=None, doctype="Stock Entry"):
    """Warehouses the user's Warehouse User Permissions allow for `doctype`, or None
    when unrestricted (same rule as Frappe's list queries)."""
    permissions = get_user_permissions(user).get("Warehouse") or []
    allowed = {
        p.get("doc")
        for p in permissions
        if p.get("doc") and (not p.get("applicable_for") or p.get("applicable_for") == doctype)
    }
    return allowed or None


def get_receivers(warehouse, exclude=()):
    """Enabled desk users whose Warehouse permission for Stock Entry names `warehouse`
    and whose roles let them read Stock Entries."""
    up = frappe.qb.DocType("User Permission")
    user = frappe.qb.DocType("User")
    candidates = (
        frappe.qb.from_(up)
        .join(user)
        .on(user.name == up.user)
        .select(up.user)
        .distinct()
        .where(
            (up.allow == "Warehouse")
            & (up.for_value == warehouse)
            & ((up.apply_to_all_doctypes == 1) | (up.applicable_for == "Stock Entry"))
            & (user.enabled == 1)
            & (user.user_type == "System User")
        )
        .run(pluck=True)
    )
    meta = frappe.get_meta("Stock Entry")
    return sorted(
        u for u in candidates if u not in exclude and get_role_permissions(meta, user=u).get("read")
    )


def share_with(doc, users):
    for user in users:
        add_docshare(
            doc.doctype, doc.name, user, read=1, flags={"ignore_share_permission": True}, notify=0
        )


def notify(doc, users):
    source = _sending_store(doc)
    subject = _("Incoming transfer {0} from {1}").format(
        _bold(doc.name), _bold(source)
    )
    enqueue_create_notification(
        users,
        {
            # "Alert" never sends email, whatever the user's Notification Settings say.
            "type": "Alert",
            "document_type": doc.doctype,
            "document_name": doc.name,
            "subject": subject,
            "from_user": frappe.session.user,
        },
    )
    if cint(frappe.conf.get(EMAIL_CONFIG_KEY)):
        send_email(doc, users, source)


def send_email(doc, users, source):
    # An email problem must never stop the goods being sent; the bell already went.
    recipients = frappe.get_all("User", filters={"name": ("in", users)}, pluck="email")
    url = get_url_to_form(doc.doctype, doc.name)
    try:
        frappe.sendmail(
            recipients=[r for r in recipients if r],
            subject=_("Incoming transfer {0} from {1}").format(doc.name, source),
            message=_("Transfer {0} from {1} is on its way to {2}. <a href=\"{3}\">Open it</a>, then use End Transit when the goods arrive.").format(
                escape_html(doc.name), escape_html(source), escape_html(doc.get(DESTINATION_FIELD)), url
            ),
            reference_doctype=doc.doctype,
            reference_name=doc.name,
        )
    except frappe.OutgoingEmailError:
        frappe.log_error(title=_("Incoming transfer email not sent"), reference_doctype=doc.doctype, reference_name=doc.name)


def _sending_store(doc):
    stores = [row.s_warehouse for row in doc.items if row.s_warehouse]
    return cstr(doc.from_warehouse or (stores[0] if stores else ""))
