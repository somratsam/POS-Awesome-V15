import unittest

import frappe

from posawesome.posawesome.api.invoices import get_draft_invoice_doc


class TestGetDraftInvoiceDoc(unittest.TestCase):
    """get_draft_invoice_doc is whitelisted: it loads only POS invoice
    doctypes, and only a document the caller may read."""

    def tearDown(self):
        frappe.set_user("Administrator")

    def _invoice(self):
        name = frappe.db.get_value("Sales Invoice", {}, "name")
        if not name:
            raise unittest.SkipTest("No Sales Invoice on this site")
        return name

    def test_loads_a_sales_invoice_the_user_may_read(self):
        name = self._invoice()
        doc = get_draft_invoice_doc(name, "Sales Invoice")
        self.assertEqual(doc.name, name)
        self.assertEqual(doc.doctype, "Sales Invoice")

    def test_refuses_any_other_doctype(self):
        for doctype, name in (("User", "Administrator"), ("System Settings", "System Settings")):
            with self.assertRaises(frappe.PermissionError):
                get_draft_invoice_doc(name, doctype)

    def test_refuses_a_user_without_read_permission(self):
        name = self._invoice()
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            get_draft_invoice_doc(name, "Sales Invoice")
