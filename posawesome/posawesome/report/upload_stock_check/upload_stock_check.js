// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

frappe.query_reports["Upload Stock Check"] = {
	filters: [
		{
			fieldname: "upload",
			label: __("Upload"),
			fieldtype: "Select",
			options: [],
			reqd: 1,
		},
	],

	onload(report) {
		const filter = report.get_filter("upload");
		// Default filter width cuts the label down to the upload number; staff need
		// the date and item count to pick the right one.
		filter.$wrapper.removeClass("col-md-2").addClass("col-md-8");
		// An upload passed in from the Stock Reconciliation shortcut arrives before the
		// options exist, so keep it and reapply once they are loaded.
		const wanted = filter.value;

		frappe
			.call("posawesome.posawesome.report.upload_stock_check.upload_stock_check.get_uploads")
			.then((r) => {
				const uploads = r.message || [];
				filter.df.options = [{ value: "", label: "" }, ...uploads];
				filter.refresh();
				if (!uploads.length) {
					filter.set_description(__("No uploads found for your warehouses."));
				}
				filter.set_value(uploads.some((u) => u.value === wanted) ? wanted : "");
			});
	},
};
