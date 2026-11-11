"""Customer "Store": the POS Profile (store) that created the customer.

A read-only Link on Customer (posa_store), shown as a top filter on the Desk
Customer list. It is a filter only: the field has ignore_user_permissions, so
POS Profile User Permissions never limit who sees which customer, and nothing
in the POS (search, creation, loyalty, credit) reads it.

- POS creation (customers.create_customer, and the customer created during a
  sale in invoice_processing.creation.update_invoice) passes the POS Profile
  in the new doc. The profile comes from the client, so before_insert keeps
  it only when the creating user is on that profile's POS Profile User list
  (or is System Manager / Administrator).
- Otherwise (Desk, Data Import, or a profile the user isn't on): the creating
  user's store when they are on exactly one POS Profile; else blank.
- Walk-in / generic customers stay blank (shared by every store).
- After creation only a System Manager can change it (validate keeps the
  saved value for everyone else); corrections are done by IT.
- Existing customers: patches/backfill_customer_store.py.
Never throws: creating a customer must not fail because of the store.
"""

import frappe

FIELDNAME = "posa_store"
EXEMPT_ROLE = "System Manager"


def _is_exempt(user):
    return user == "Administrator" or EXEMPT_ROLE in frappe.get_roles(user)


def user_profiles(user):
    if not user:
        return []
    return frappe.get_all(
        "POS Profile User",
        filters={"user": user, "parenttype": "POS Profile"},
        pluck="parent",
        distinct=True,
        ignore_permissions=True,
    )


def single_store(user):
    """The user's store when they are on exactly one POS Profile."""
    profiles = user_profiles(user)
    return profiles[0] if len(profiles) == 1 else None


def allowed_store(pos_profile, user):
    if not pos_profile or not frappe.db.exists("POS Profile", pos_profile):
        return None
    if _is_exempt(user) or pos_profile in user_profiles(user):
        return pos_profile
    return None


def before_insert(doc, method=None):
    try:
        if doc.get("posa_is_generic_customer"):
            doc.set(FIELDNAME, None)
            return
        user = frappe.session.user
        doc.set(FIELDNAME, allowed_store(doc.get(FIELDNAME), user) or single_store(user))
    except Exception:
        frappe.log_error(title="Customer store: could not set the store")
        doc.set(FIELDNAME, None)


def validate(doc, method=None):
    if doc.is_new() or not doc.has_value_changed(FIELDNAME):
        return
    if _is_exempt(frappe.session.user):
        return
    before = doc.get_doc_before_save()
    doc.set(FIELDNAME, before.get(FIELDNAME) if before else None)
