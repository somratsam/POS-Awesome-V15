// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

// Store-to-store transfers (see api/stock_transit.py, which enforces the rules).

frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		// Set on refresh: ERPNext's onload gives every Warehouse field its own query.
		// Convenience only: the server rejects any other choice.
		frm.set_query("posa_destination_store", () => ({
			filters: [
				["Warehouse", "company", "=", frm.doc.company],
				["Warehouse", "is_group", "=", 0],
				["Warehouse", "disabled", "=", 0],
				["Warehouse", "warehouse_type", "!=", "Transit"],
				["Warehouse", "name", "!=", frm.doc.from_warehouse || ""],
			],
		}));
		sync_scan_warehouse(frm);
		show_transit_as_source(frm);
		// ERPNext's refresh adds End Transit for anyone; only the destination store
		// (and a Stock Manager) can receive. The server refuses everyone else anyway.
		if (frm.doc.docstatus === 1 && frm.doc.add_to_transit && !can_receive_transit(frm)) {
			frm.remove_custom_button(__("End Transit"));
		}
	},
	add_to_transit: sync_scan_warehouse,
	from_warehouse: sync_scan_warehouse,
	before_save(frm) {
		// Never store the value we filled in: a stale one would put the wrong
		// Source Warehouse on rows scanned after the store is changed.
		if (filled_by_us(frm)) {
			frm.doc.last_scanned_warehouse = "";
		}
		explain_warehouses_not_permitted(frm);
	},
});

// End Transit opens with the user's own store as Default Source Warehouse (an
// "Is Default" Warehouse permission fills every Warehouse field of a new form),
// while its rows come from transit. Show the warehouse they really come from.
// Display only: set directly, because ERPNext's from_warehouse handler would
// rewrite every row's Source Warehouse.
function show_transit_as_source(frm) {
	if (frm.doc.docstatus !== 0 || !frm.doc.outgoing_stock_entry) {
		return;
	}
	const sources = new Set(
		(frm.doc.items || []).filter((row) => row.against_stock_entry && row.s_warehouse).map((row) => row.s_warehouse)
	);
	if (sources.size !== 1) {
		return;
	}
	const [source] = sources;
	if (frm.doc.from_warehouse !== source) {
		frm.doc.from_warehouse = source;
		frm.refresh_field("from_warehouse");
	}
}

// The user's Warehouse User Permissions for Stock Entry, or null when unrestricted.
// Same list and rule the server applies (frappe/permissions.py), descendants included.
function permitted_warehouses() {
	const permissions = (frappe.defaults.get_user_permissions() || {}).Warehouse || [];
	const allowed = permissions
		.filter((p) => !p.applicable_for || p.applicable_for === "Stock Entry")
		.map((p) => p.doc);
	return allowed.length ? new Set(allowed) : null;
}

function can_receive_transit(frm) {
	const destination = frm.doc.posa_destination_store;
	if (!destination || frappe.user.has_role("Stock Manager")) {
		return true; // entries from before Destination Store keep ERPNext's behaviour
	}
	const allowed = permitted_warehouses();
	return !allowed || allowed.has(destination);
}

// Frappe refuses a warehouse outside the user's permissions before any server hook
// runs, with "You need the 'create' permission on Stock Entry". Say what is wrong
// instead. Convenience only: Frappe still enforces it.
function explain_warehouses_not_permitted(frm) {
	const allowed = permitted_warehouses();
	if (!allowed) {
		return;
	}
	const fields = (doctype) =>
		frappe.meta
			.get_docfields(doctype)
			.filter((df) => df.fieldtype === "Link" && df.options === "Warehouse" && !df.ignore_user_permissions);
	const esc = frappe.utils.escape_html;
	const problems = [];
	for (const df of fields(frm.doctype)) {
		const value = frm.doc[df.fieldname];
		if (value && !allowed.has(value)) {
			problems.push(`${esc(__(df.label))}: <b>${esc(value)}</b>`);
		}
	}
	for (const row of frm.doc.items || []) {
		for (const df of fields(row.doctype)) {
			const value = row[df.fieldname];
			if (value && !allowed.has(value)) {
				problems.push(`${__("Row {0}", [row.idx])} ${esc(__(df.label))}: <b>${esc(value)}</b>`);
			}
		}
	}
	if (!problems.length) {
		return;
	}
	frappe.throw({
		title: __("Store Not Allowed"),
		message:
			__("You can only use these warehouses: {0}.", [[...allowed].map(esc).join(", ")]) +
			"<br><br>" +
			problems.join("<br>") +
			"<br><br>" +
			__("To send goods to another store, tick Add to Transit and choose it as the Destination Store."),
	});
}

// ERPNext's scanner only adds to an existing row when the row's Source Warehouse
// equals the "Last Scanned Warehouse" (or else the item's own default warehouse),
// so sending from any other store gave one row per scan. Filling it with the
// Default Source Warehouse does what scanning the store's name does. A warehouse
// the user scanned themselves is left alone.
function sync_scan_warehouse(frm) {
	if (frm.doc.last_scanned_warehouse && !filled_by_us(frm)) {
		return;
	}
	const sending =
		frm.doc.docstatus === 0 &&
		frm.doc.purpose === "Material Transfer" &&
		frm.doc.add_to_transit &&
		!frm.doc.outgoing_stock_entry;
	const wanted = (sending && frm.doc.from_warehouse) || "";
	// Set directly so opening a draft does not mark it unsaved.
	frm.doc.last_scanned_warehouse = wanted;
	frm.posa_filled_scan_warehouse = { name: frm.doc.name, value: wanted };
}

function filled_by_us(frm) {
	const filled = frm.posa_filled_scan_warehouse;
	return (
		!!filled &&
		filled.name === frm.doc.name &&
		!!frm.doc.last_scanned_warehouse &&
		frm.doc.last_scanned_warehouse === filled.value
	);
}
