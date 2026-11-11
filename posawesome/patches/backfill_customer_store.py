"""Fill Customer.posa_store ("Store") for existing customers.

Rules, in order (same as the preview run on production):
1. Walk-in / generic customers: stay blank (shared by every store).
2. The creating user (owner) is on exactly one POS Profile: that store.
3. Otherwise: the POS Profile of the customer's first submitted Sales Invoice.
4. No such invoice: blank.

Only blank customers are filled, so a second run changes nothing. Written
with update_modified=False: no Version, and Customer `modified` stays, so POS
terminals (customer delta sync by modified) and the rewards sync don't
re-download every customer. Prints a summary to migrate output.
"""

import json
import pathlib
from collections import Counter

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from posawesome.posawesome.api.customer_store import FIELDNAME, single_store

FIELD_NAME = "Customer-posa_store"
FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "custom_field.json"
SKIP_KEYS = {"doctype", "dt", "name"}


def execute():
    # Patches run before fixture sync: create the column from the fixture's
    # own definition (fixture sync re-applies it right after).
    _ensure_custom_field()

    customers = frappe.get_all(
        "Customer",
        filters={FIELDNAME: ["is", "not set"]},
        fields=["name", "owner", "posa_is_generic_customer"],
        order_by="name",
    )
    first_store = _first_invoice_stores()
    owner_store = {}
    per_rule, per_store, updated = Counter(), Counter(), 0

    for customer in customers:
        if customer.posa_is_generic_customer:
            per_rule["walk-in (blank)"] += 1
            continue
        if customer.owner not in owner_store:
            owner_store[customer.owner] = single_store(customer.owner)
        store = owner_store[customer.owner]
        rule = "creating user"
        if not store:
            store = first_store.get(customer.name)
            rule = "first invoice"
        if not store:
            per_rule["no invoice (blank)"] += 1
            continue
        frappe.db.set_value("Customer", customer.name, FIELDNAME, store, update_modified=False)
        per_rule[rule] += 1
        per_store[store] += 1
        updated += 1

    print(f"Customer Store backfill: {len(customers)} customers without a store, {updated} filled.")
    for rule, count in per_rule.items():
        print(f"  by {rule}: {count}")
    for store, count in sorted(per_store.items()):
        print(f"  {store}: {count}")


def _first_invoice_stores():
    rows = frappe.db.sql(
        """
        SELECT customer, pos_profile
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND IFNULL(pos_profile, '') != '' AND IFNULL(customer, '') != ''
        ORDER BY posting_date, posting_time, creation
        """,
        as_dict=True,
    )
    stores = {}
    for row in rows:
        stores.setdefault(row.customer, row.pos_profile)
    return stores


def _ensure_custom_field():
    fixture = {row["name"]: row for row in json.loads(FIXTURE_PATH.read_text())}
    definition = fixture[FIELD_NAME]
    if not frappe.db.exists("Custom Field", FIELD_NAME):
        create_custom_field(
            definition["dt"],
            {key: value for key, value in definition.items() if key not in SKIP_KEYS},
        )
    frappe.clear_cache(doctype=definition["dt"])
