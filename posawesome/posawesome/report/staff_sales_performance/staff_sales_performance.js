// Staff Sales Performance: each staff member's POS sales across stores.
// Who a sale counts for and who may see which store: see the .py file.

frappe.query_reports["Staff Sales Performance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
			on_change: function () {
				frappe.query_report.set_filter_value("stores", []);
			},
		},
		{
			fieldname: "from_date",
			label: __("From"),
			fieldtype: "Date",
			default: frappe.datetime.month_start(),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "stores",
			label: __("Stores"),
			fieldtype: "MultiSelectList",
			description: __("None chosen = all your stores"),
			get_data: function (txt) {
				return frappe.xcall(
					"posawesome.posawesome.report.staff_sales_performance.staff_sales_performance.get_store_options",
					{ company: frappe.query_report.get_filter_value("company"), txt: txt },
				);
			},
		},
		{
			fieldname: "group_by",
			label: __("Group by"),
			fieldtype: "Select",
			options: ["Staff", "Staff and store"],
			default: "Staff",
		},
		{
			fieldname: "sales_counted",
			label: __("Sales counted"),
			fieldtype: "Select",
			options: ["Till sales", "All POS sales"],
			default: "Till sales",
		},
	],
	// "Group by: Staff" shows each person with their stores folded under them.
	tree: true,
	name_field: "row_id",
	parent_field: "parent_row",
	initial_depth: 0,
	formatter: function (value, row, column, data, default_formatter) {
		// Names are typed by people (User full name, POS Profile name): show them as text.
		if (column.fieldname === "staff" || column.fieldname === "store") {
			value = frappe.utils.escape_html(value == null ? "" : String(value));
		}
		value = default_formatter(value, row, column, data);
		if (data && data.bold) {
			value = `<b>${value}</b>`;
		}
		return value;
	},
};
