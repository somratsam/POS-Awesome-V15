import frappe


def execute():
	"""Splice posa_receipt_logo into the QZ/print insert_after chain in-place.

	posa_receipt_logo was originally added with insert_after="posa_qz_printer_name",
	the same target posa_raw_printing already used. Frappe's field-order resolver
	(frappe.model.meta.Meta.sort_fields) inserts every field sharing a target in
	one pass, then keeps nudging whichever field lands second forward every time a
	later link in that field's own downstream insert_after chain resolves --
	posa_raw_printing -> posa_raw_print_width -> posa_print_format_rules ->
	posa_section_cash_movement. Since posa_raw_printing consistently won that
	position tie, posa_receipt_logo got walked all the way past the whole Cash
	Movement/Sales Returns block instead of landing next to "QZ Tray Printer
	Name". Re-pointing posa_raw_printing at posa_receipt_logo makes the chain
	strictly linear (no two fields share a target), which removes the tie
	entirely.
	"""
	if frappe.db.exists("Custom Field", "POS Profile-posa_receipt_logo") and frappe.db.exists(
		"Custom Field", "POS Profile-posa_raw_printing"
	):
		frappe.db.set_value(
			"Custom Field",
			"POS Profile-posa_receipt_logo",
			"insert_after",
			"posa_qz_printer_name",
			update_modified=False,
		)
		frappe.db.set_value(
			"Custom Field",
			"POS Profile-posa_raw_printing",
			"insert_after",
			"posa_receipt_logo",
			update_modified=False,
		)

	frappe.clear_cache(doctype="POS Profile")
