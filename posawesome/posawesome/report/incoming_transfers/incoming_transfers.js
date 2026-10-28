// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

frappe.query_reports["Incoming Transfers"] = {
	filters: [
		{
			fieldname: "destination_store",
			label: __("Destination Store"),
			fieldtype: "Select",
			options: [],
			// Convenience only: the server limits rows to the user's permitted stores
			// whatever is chosen here.
		},
	],

	onload(report) {
		const store = report.get_filter("destination_store");
		store.$wrapper.removeClass("col-md-2").addClass("col-md-4");
		frappe
			.call("posawesome.posawesome.report.incoming_transfers.incoming_transfers.get_destination_stores")
			.then((r) => {
				const stores = r.message || [];
				store.df.options = [""].concat(stores);
				store.refresh();
				if (stores.length === 1 && !store.get_value()) {
					store.set_value(stores[0]);
				}
			});
	},
};
