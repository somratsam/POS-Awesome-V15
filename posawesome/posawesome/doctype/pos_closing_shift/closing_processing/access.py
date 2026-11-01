import frappe
from frappe import _
from frappe.utils import cstr

from posawesome.posawesome.api.pos_access import (
    get_authenticated_pos_user,
    get_authorized_pos_profile,
    get_pos_roles,
    user_is_pos_supervisor,
)


def user_can_close_others_shifts(user):
    """A POS Awesome Supervisor or System Manager may close another cashier's
    shift. Sales Manager is not enough: every cashier who can close a shift at
    all has it (closing writes POS Opening Shift), so it would let any
    same-store cashier close a colleague's shift."""
    if user == "Administrator":
        return True
    return user_is_pos_supervisor(user) or "System Manager" in get_pos_roles(user)


def check_shift_close_allowed(opening, user):
    """Refuse unless `user` owns the opening shift or may close others'."""
    if user != opening.user and not user_can_close_others_shifts(user):
        frappe.throw(
            _(
                "You can't close this shift: it belongs to {0}. Ask a POS supervisor to close it."
            ).format(opening.user),
            frappe.PermissionError,
        )


def authorize_shift_close(opening_shift):
    """Return the POS Opening Shift if the session user may close it.

    Every whitelisted closing method calls this first, so a caller can't
    prepare, read or submit a closing for a shift that isn't theirs (or, for a
    supervisor, one on a POS Profile they can't access). `opening_shift` is a
    name or a dict with a name; only the stored record is trusted.
    """
    user = get_authenticated_pos_user()
    name = opening_shift.get("name") if isinstance(opening_shift, dict) else opening_shift
    name = cstr(name).strip()
    if not name or not frappe.db.exists("POS Opening Shift", name):
        frappe.throw(_("POS Opening Shift {0} was not found.").format(name or "-"))

    opening = frappe.get_doc("POS Opening Shift", name)
    if opening.docstatus != 1 or opening.status != "Open":
        frappe.throw(
            _("Selected POS Opening Shift should be open."),
            title=_("Invalid Opening Entry"),
        )
    get_authorized_pos_profile(opening.pos_profile, company=opening.company)
    check_shift_close_allowed(opening, user)
    return opening
