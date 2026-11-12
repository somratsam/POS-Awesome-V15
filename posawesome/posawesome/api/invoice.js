// Copyright (c) 20201 Youssef Restom and contributors
// For license information, please see license.txt

frappe.ui.form.on("Sales Invoice", {
	setup: function (frm) {
		frm.set_query("posa_delivery_charges", function (doc) {
			return {
				filters: { company: doc.company, disabled: 0 },
			};
		});
	},
	refresh: function (frm) {
		// The Sales Team decides who a sale is credited to: after submit only
		// a System Manager may change it (the server refuses anyone else).
		const locked = frm.doc.docstatus === 1 && !frappe.user.has_role("System Manager");
		frm.set_df_property("sales_team", "read_only", locked ? 1 : 0);
	},
});
