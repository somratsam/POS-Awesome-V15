// POS Awesome: Posting Date as one From - To range at the top of the Sales
// Invoice List and Report views (both read frappe.listview_settings).
//
// - Frappe's own `custom_filter_configs` adds a DateRange field named
//   posting_date with the "Between" condition (both days included).
// - ERPNext's single-date Posting Date is taken out of the top row by the
//   Property Setter Sales Invoice-posting_date-in_standard_filter (two top
//   fields can't share a fieldname).
// - Frappe only puts "=" / "like" filters back into a top field; a saved or
//   linked range would otherwise land under the Filter button, and a single
//   date sent to a DateRange field is dropped. So posting_date filters with
//   "=" or "Between" are moved into the range box: in onload for filters
//   applied before it ran (saved view, saved report), and through this list's
//   filter_area.add() for everything after (links, route options).
//   Other conditions (>=, <, Timespan ...) stay under the Filter button.
// - Staff (no System Manager) get a "Submitted only" label; the lock itself is
//   on the server (sales_invoice_list_lock.py).
// - Loaded after ERPNext's sales_invoice_list.js (doctype_list_js hook), so it
//   extends ERPNext's settings and keeps its onload.
(() => {
	const DOCTYPE = "Sales Invoice";
	const FIELD = "posting_date";
	const settings = (frappe.listview_settings[DOCTYPE] = frappe.listview_settings[DOCTYPE] || {});
	if (settings.posa_posting_date_range) return;
	settings.posa_posting_date_range = true;

	const existing = Array.isArray(settings.custom_filter_configs) ? settings.custom_filter_configs : [];
	settings.custom_filter_configs = existing
		.filter((config) => config.fieldname !== FIELD)
		.concat([
			{
				fieldname: FIELD,
				fieldtype: "DateRange",
				label: __("Posting Date"),
				condition: "Between",
			},
		]);

	function rangeField(listview) {
		const field = listview?.page?.fields_dict?.[FIELD];
		return field?.df?.fieldtype === "DateRange" ? field : null;
	}

	// [doctype, fieldname, condition, value] -> [from, to] or null
	function toRange(filter) {
		if (!Array.isArray(filter) || filter.length < 4) return null;
		const [doctype, fieldname, condition, value] = filter;
		if (fieldname !== FIELD || (doctype && doctype !== DOCTYPE)) return null;
		if (condition === "Between" && Array.isArray(value) && value[0] && value[1]) {
			return [value[0], value[1]];
		}
		if (condition === "=" && value && typeof value === "string") {
			return [value, value];
		}
		return null;
	}

	function setRange(listview, range) {
		const field = rangeField(listview);
		if (!field) return Promise.resolve();
		field.df.match_type = "Between";
		return Promise.resolve(field.set_value(range));
	}

	// Filters applied before onload ran: a range went under the Filter button,
	// a single date was dropped by the DateRange field.
	function moveInitialFilters(listview) {
		const area = listview.filter_area;
		const field = rangeField(listview);
		if (!area || !field) return;
		field.df.match_type = "Between";

		let range = null;
		(listview.filters || []).forEach((filter) => {
			range = toRange(filter) || range;
		});

		const filterList = area.filter_list;
		if (filterList && Array.isArray(filterList.filters)) {
			const moved = filterList.filters.filter((f) => {
				if (!f.field) return false;
				const value = f.get_value();
				const asRange = toRange(value);
				if (asRange) range = asRange;
				return Boolean(asRange);
			});
			if (moved.length) {
				moved.forEach((f) => f.remove());
				filterList.filters = filterList.filters.filter((f) => !moved.includes(f));
				filterList.update_filter_button && filterList.update_filter_button();
				if (!filterList.filters.length && filterList.toggle_empty_filters) {
					filterList.toggle_empty_filters(true);
				}
			}
		}

		const current = field.get_value();
		if (range && !(Array.isArray(current) && current[0] === range[0] && current[1] === range[1])) {
			setRange(listview, range);
		}
	}

	// Later filters (links, route options): take posting_date ranges/dates out
	// before Frappe's add() and put them in the range box instead.
	function wrapAdd(listview) {
		const area = listview.filter_area;
		if (!area || typeof area.add !== "function" || area.posa_posting_date_range) return;
		area.posa_posting_date_range = true;
		const originalAdd = area.add.bind(area);

		area.add = function (filters, refresh = true) {
			if (!rangeField(listview)) return originalAdd.apply(area, arguments);

			let list = filters;
			if (typeof filters?.[0] === "string") {
				// add(doctype, fieldname, condition, value) form
				list = [Array.from(arguments).slice(0, 4)];
				refresh = true;
			}
			if (!Array.isArray(list)) return originalAdd.apply(area, arguments);

			let range = null;
			const rest = list.filter((filter) => {
				const asRange = toRange(filter);
				if (asRange) range = asRange;
				return !asRange;
			});
			if (!range) return originalAdd.apply(area, arguments);

			const previous = area.trigger_refresh;
			area.trigger_refresh = false;
			return setRange(listview, range)
				.then(() => originalAdd(rest, false))
				.then(() => {
					area.trigger_refresh = previous;
					if (refresh) listview.refresh();
				});
		};
	}

	// Frappe gives every top filter the same narrow column; "01-11-2026 to
	// 10-11-2026" needs more, or the To date is cut off.
	function widen(listview) {
		const field = rangeField(listview);
		if (field?.$wrapper) field.$wrapper.css({ "min-width": "220px" });
	}

	// The server shows staff submitted invoices only in List / Report view and
	// export (sales_invoice_list_lock.py, same exemption rule); say so next to
	// the range box so an empty Draft/Cancelled search isn't a surprise.
	function isExempt() {
		return frappe.session?.user === "Administrator" || Boolean(frappe.user?.has_role?.("System Manager"));
	}

	function addSubmittedOnlyLabel(listview) {
		const field = rangeField(listview);
		if (!field?.$wrapper || typeof field.$wrapper.after !== "function" || isExempt()) return;
		const parent = typeof field.$wrapper.parent === "function" ? field.$wrapper.parent() : null;
		if (parent?.find && parent.find(".posa-submitted-only").length) return;
		const label = $('<div class="form-group posa-submitted-only"></div>')
			.css({ "align-self": "center", "white-space": "nowrap", margin: "0 8px" })
			.attr("title", __("Draft and cancelled invoices are not shown in this list or its export."))
			.append($('<span class="indicator-pill gray"></span>').text(__("Submitted only")));
		field.$wrapper.after(label);
	}

	const erpnextOnload = settings.onload;
	settings.onload = function (listview) {
		if (typeof erpnextOnload === "function") erpnextOnload.call(this, listview);
		if (listview?.doctype !== DOCTYPE) return;
		widen(listview);
		addSubmittedOnlyLabel(listview);
		moveInitialFilters(listview);
		wrapAdd(listview);
	};
})();
