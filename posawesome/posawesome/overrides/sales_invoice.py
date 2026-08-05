"""Override Sales Invoice to avoid a spurious Sales Order lookup on non-subcontracted invoices."""

from __future__ import annotations

import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice as ERPNextSalesInvoice


class CustomSalesInvoice(ERPNextSalesInvoice):
    """Skip the subcontracted Sales Order lookup when no item references a Sales Order.

    ERPNext's ``is_subcontracted`` unconditionally queries for a subcontracted
    Sales Order, even when no item has ``sales_order`` set (the normal case for
    POS Awesome invoices). That query resolves to
    ``{"name": ["in", []], "is_subcontracted": 1}`` and raises
    ``Sales Order ... not found``.
    """

    @frappe.whitelist()
    def is_subcontracted(self):
        if not self.has_subcontracted:
            sales_orders = [item.sales_order for item in self.items if item.sales_order]
            if sales_orders:
                self.has_subcontracted = bool(
                    frappe.get_cached_value(
                        "Sales Order",
                        {"name": ["in", sales_orders], "is_subcontracted": 1},
                        "name",
                    )
                )
        if self.has_subcontracted:
            self.update_stock = 0
        return self.has_subcontracted
