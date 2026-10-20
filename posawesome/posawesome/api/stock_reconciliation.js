// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

frappe.ui.form.on("Stock Reconciliation", {
	refresh: function (frm) {
		// Shortcut for managers; store staff open the Upload Stock Check report directly.
		if (frm.doc.docstatus !== 1 || !frappe.boot.user.all_reports?.["Upload Stock Check"]) {
			return;
		}
		frm.add_custom_button(__("Upload Stock Check"), function () {
			frappe.set_route("query-report", "Upload Stock Check", { upload: frm.doc.name });
		});
	},
});
