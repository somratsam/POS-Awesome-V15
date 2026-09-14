// Copyright (c) 20201 Youssef Restom and contributors
// For license information, please see license.txt

const set_pos_profile_queries = (frm) => {
	const set_field_query = (fieldname, query_factory) => {
		if (frm.fields_dict[fieldname]) {
			frm.set_query(fieldname, query_factory);
		}
	};

	const set_child_query = (fieldname, table_fieldname, query_factory) => {
		const table = frm.fields_dict[table_fieldname];
		if (table && table.grid) {
			frm.set_query(fieldname, table_fieldname, query_factory);
		}
	};

	set_field_query("posa_cash_mode_of_payment", function () {
		return {
			filters: { type: "Cash" },
		};
	});

	set_field_query("posa_default_expense_account", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				root_type: "Expense",
			},
		};
	});

	set_field_query("posa_back_office_cash_account", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				account_type: "Cash",
			},
		};
	});

	set_field_query("posa_default_source_account", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				account_type: "Cash",
			},
		};
	});

	set_field_query("posa_gift_card_liability_account", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				root_type: "Liability",
			},
		};
	});

	// ERPNext core hardcodes this field's query to doc_type = "POS Invoice"
	// (accounts/doctype/pos_profile/pos_profile.js), regardless of which
	// doctype this profile actually creates. Override it to match
	// create_pos_invoice_instead_of_sales_invoice, so a profile that
	// creates Sales Invoices (the flag off) can actually select one of its
	// own Sales Invoice print formats as the default here -- previously
	// impossible, since only POS Invoice-doctype formats were selectable.
	set_field_query("print_format", function (doc) {
		return {
			filters: {
				doc_type: doc.create_pos_invoice_instead_of_sales_invoice
					? "POS Invoice"
					: "Sales Invoice",
			},
		};
	});

	set_child_query("account", "posa_allowed_expense_accounts", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				root_type: "Expense",
			},
		};
	});

	set_child_query("account", "posa_allowed_source_accounts", function (doc) {
		return {
			filters: {
				company: doc.company,
				is_group: 0,
				account_type: "Cash",
			},
		};
	});
};

frappe.ui.form.on("POS Profile", {
	setup: function (frm) {
		set_pos_profile_queries(frm);
		frappe.call({
			method: "posawesome.posawesome.api.utilities.get_language_options",
			callback: function (r) {
				if (!r.exc && frm.fields_dict["posa_language"]) {
					frm.fields_dict["posa_language"].df.options = r.message;
					frm.refresh_field("posa_language");
				}
			},
		});
	},
	refresh: function (frm) {
		set_pos_profile_queries(frm);
	},
});
