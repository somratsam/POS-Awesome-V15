// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

frappe.query_reports["Upload Stock Check"] = {
	filters: [
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "Select",
			options: [],
			// Convenience only: the server limits rows to the user's permitted warehouses
			// whatever is chosen here.
			on_change(report) {
				frappe.query_reports["Upload Stock Check"]
					.load_upload_options(report, report.get_filter_value("upload"))
					.then(() => report.refresh());
			},
		},
		{
			fieldname: "upload",
			label: __("Upload"),
			fieldtype: "Select",
			options: [],
			reqd: 1,
		},
	],

	onload(report) {
		const warehouse = report.get_filter("warehouse");
		const upload = report.get_filter("upload");
		// Default filter width cuts the label down to the upload number; staff need
		// the date and item count to pick the right one.
		warehouse.$wrapper.removeClass("col-md-2").addClass("col-md-4");
		upload.$wrapper.removeClass("col-md-2").addClass("col-md-8");
		// An upload passed in from the Stock Reconciliation shortcut arrives before the
		// options exist, so keep it and reapply once they are loaded.
		const wanted = upload.value;

		frappe
			.call("posawesome.posawesome.report.upload_stock_check.upload_stock_check.get_warehouses")
			.then((r) => {
				const { warehouses = [], restricted = false } = r.message || {};
				// A store user with one permitted warehouse gets only that one, selected.
				const only_one = restricted && warehouses.length === 1;
				// Frappe's Select renders option labels as HTML.
				const options = warehouses.map((w) => ({ value: w, label: frappe.utils.escape_html(w) }));
				warehouse.df.options = only_one ? options : [{ value: "", label: "" }, ...options];
				warehouse.refresh();
				warehouse.set_input(only_one ? warehouses[0] : "");
				return frappe.query_reports["Upload Stock Check"].load_upload_options(report, wanted);
			})
			.then(() => {
				if (report.get_filter_value("upload")) report.refresh();
			});
	},

	// Fill the Upload picker for the chosen warehouse, keeping `wanted` if it is still
	// listed. set_input (not set_value) so filling it doesn't start a report run.
	load_upload_options(report, wanted) {
		const upload = report.get_filter("upload");
		return frappe
			.call("posawesome.posawesome.report.upload_stock_check.upload_stock_check.get_uploads", {
				warehouse: report.get_filter_value("warehouse") || null,
			})
			.then((r) => {
				const uploads = r.message || [];
				upload.df.options = [{ value: "", label: "" }, ...uploads];
				upload.refresh();
				upload.set_description(uploads.length ? "" : __("No uploads found for your warehouses."));
				upload.set_input(uploads.some((u) => u.value === wanted) ? wanted : "");
			});
	},
};
