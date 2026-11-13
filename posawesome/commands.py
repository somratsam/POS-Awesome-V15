"""bench commands of POS Awesome.

Kept to click and frappe.commands imports only: bench imports this module for
every command it runs, so nothing here may fail at import time.
"""

import click
from frappe.commands import get_site, pass_context


@click.command("posa-refresh-sales-credit")
@click.option("--dry-run", is_flag=True, default=False, help="Only print what would change.")
@pass_context
def posa_refresh_sales_credit(context, dry_run=False):
    """Recompute "Sales credited to" on submitted Sales Invoices.

    Run after linking Sales Persons to POS Users. Changes only invoices whose
    credited person differs and prints the counts. Safe to run again.
    """
    import frappe

    site = get_site(context)
    frappe.init(site=site)
    frappe.connect()
    try:
        from posawesome.posawesome.api.sales_credit import refresh_sales_credit

        refresh_sales_credit(dry_run=dry_run)
    finally:
        frappe.destroy()


@click.command("posa-fill-sales-person")
@click.option("--dry-run", is_flag=True, default=False, help="Only print what would change.")
@pass_context
def posa_fill_sales_person(context, dry_run=False):
    """Give past POS invoices the Sales Person the POS now sets.

    Empty -> the PIN cashier's own Sales Person; returns -> the original's
    Sales Team (a different one is replaced and listed). Run after linking
    Sales Persons to POS Users, then posa-refresh-sales-credit. Safe to run
    again.
    """
    import frappe

    site = get_site(context)
    frappe.init(site=site)
    frappe.connect()
    try:
        from posawesome.posawesome.api.sales_credit import fill_pos_sales_team

        fill_pos_sales_team(dry_run=dry_run)
    finally:
        frappe.destroy()


commands = [posa_refresh_sales_credit, posa_fill_sales_person]
