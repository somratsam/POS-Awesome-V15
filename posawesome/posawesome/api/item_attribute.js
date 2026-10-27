// Copyright (c) 2026, Youssef Restom and contributors
// For license information, please see license.txt

const BULK_ADD_METHOD = "posawesome.posawesome.api.item_attribute_bulk";

frappe.ui.form.on("Item Attribute", {
	refresh: function (frm) {
		// Shown only to users who can save this attribute; the server re-checks.
		if (frm.is_new() || frm.doc.numeric_values || !frm.perm?.[0]?.write) {
			return;
		}
		frm.add_custom_button(__("Bulk Add Values"), function () {
			if (frm.is_dirty()) {
				frappe.msgprint(__("Save your changes to this attribute first."));
				return;
			}
			open_bulk_add_dialog(frm);
		});
	},
});

function open_bulk_add_dialog(frm) {
	// The text the shown preview was computed from; Add re-checks if it changed.
	let checked_text = null;
	let can_add = false;

	const dialog = new frappe.ui.Dialog({
		title: __("Bulk Add Values to {0}", [frappe.utils.escape_html(frm.doc.name)]),
		size: "large",
		fields: [
			{
				fieldname: "values",
				fieldtype: "Small Text",
				label: __("Values"),
				description: __("Paste one value per line, e.g. a single column copied from Excel."),
				reqd: 1,
			},
			{ fieldname: "preview", fieldtype: "HTML" },
		],
		primary_action_label: __("Check"),
		primary_action: function (values) {
			const text = values.values || "";
			if (checked_text === text) {
				if (can_add) add_values(text);
			} else {
				check_values(text);
			}
		},
	});

	function check_values(text) {
		frappe.call({
			method: `${BULK_ADD_METHOD}.preview_bulk_attribute_values`,
			args: { attribute: frm.doc.name, text: text },
			freeze: true,
			freeze_message: __("Checking..."),
			callback: function (r) {
				const result = r.message;
				dialog.fields_dict.preview.$wrapper.html(render_preview(result));
				checked_text = text;
				can_add = result.to_add.length > 0;
				if (can_add) {
					dialog.set_primary_action(
						__("Add {0} Values", [result.to_add.length]),
						dialog.primary_action,
					);
					dialog.enable_primary_action();
				} else {
					dialog.set_primary_action(__("Nothing to Add"), dialog.primary_action);
					dialog.disable_primary_action();
				}
			},
		});
	}

	function add_values(text) {
		frappe.call({
			method: `${BULK_ADD_METHOD}.add_bulk_attribute_values`,
			args: { attribute: frm.doc.name, text: text },
			freeze: true,
			freeze_message: __("Adding values..."),
			callback: function (r) {
				const result = r.message;
				dialog.hide();
				frappe.msgprint({
					title: __("Values Added"),
					indicator: "green",
					message: __("{0} added, {1} already existed.", [result.added, result.already_existed]),
				});
				frm.reload_doc();
			},
		});
	}

	// Editing the pasted text invalidates the preview.
	dialog.fields_dict.values.$input.on("input", function () {
		if (checked_text === null) return;
		checked_text = null;
		can_add = false;
		dialog.fields_dict.preview.$wrapper.empty();
		dialog.set_primary_action(__("Check"), dialog.primary_action);
		dialog.enable_primary_action();
	});

	dialog.show();
}

function render_preview(result) {
	const esc = frappe.utils.escape_html;
	const section = (title, count, items) => {
		if (!count) return "";
		const list = items.map((item) => `<li>${item}</li>`).join("");
		return `<div class="mt-3">
			<div class="font-weight-bold">${esc(title)} (${count})</div>
			<ul class="mb-0" style="max-height: 180px; overflow-y: auto;">${list}</ul>
		</div>`;
	};

	return `<div class="text-muted small">${esc(__("{0} lines checked. Nothing has been changed yet.", [result.total_lines]))}</div>
		${section(__("Will be added"), result.to_add.length, result.to_add.map(esc))}
		${section(__("Already exist (skipped)"), result.existing.length, result.existing.map(esc))}
		${section(
			__("Abbreviation already used (skipped)"),
			result.abbr_clashes.length,
			result.abbr_clashes.map((c) =>
				esc(__("{0}: abbreviation {1} belongs to {2}", [c.value, c.abbr, c.existing_value])),
			),
		)}
		${section(
			__("Repeated in the pasted list (counted once)"),
			result.duplicates.length,
			result.duplicates.map((d) => esc(__("Line {0}: {1}", [d.line, d.value]))),
		)}
		${section(
			__("Rejected lines"),
			result.rejected.length,
			result.rejected.map((r) => esc(__("Line {0}: {1} ({2})", [r.line, r.value || "", r.reason]))),
		)}`;
}
