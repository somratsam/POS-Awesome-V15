import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Desk list-view file (doctype_list_js), not part of the POS bundle: run the
// real source against a small fake of Frappe's list/filter-area objects.
const SOURCE = readFileSync(
	resolve(process.cwd(), "../posawesome/posawesome/api/sales_invoice_list.js"),
	"utf8",
);
const SI = "Sales Invoice";

// Tiny jQuery stand-in: records what the label code builds.
function fakeJq() {
	const made: any[] = [];
	const $ = (html: string) => {
		const el: any = { html, css: vi.fn(() => el), attr: vi.fn(() => el), text: vi.fn(() => el), children: [] };
		el.append = vi.fn((child: any) => (el.children.push(child), el));
		made.push(el);
		return el;
	};
	return { $, made };
}

function load(existingSettings?: Record<string, any>, { user = "staff@test.invalid", roles = ["Accounts User"] } = {}) {
	const frappe: any = {
		listview_settings: {},
		session: { user },
		user: { has_role: (role: string) => roles.includes(role) },
	};
	if (existingSettings) frappe.listview_settings[SI] = existingSettings;
	const jq = fakeJq();
	new Function("frappe", "__", "$", SOURCE)(frappe, (s: string) => s, jq.$);
	return { frappe, settings: frappe.listview_settings[SI], jq };
}

function makeFilter(value: any[]) {
	return { field: {}, get_value: () => value, remove: vi.fn() };
}

function makeListview({ initial = [] as any[], underButton = [] as any[] } = {}) {
	let rangeValue: any = null;
	const afterLabels: any[] = [];
	const field: any = {
		df: { fieldname: "posting_date", fieldtype: "DateRange", condition: "Between" } as any,
		get_value: () => rangeValue,
		set_value: vi.fn((v: any) => {
			rangeValue = v;
			return Promise.resolve();
		}),
		$wrapper: {
			css: vi.fn(),
			after: vi.fn((el: any) => afterLabels.push(el)),
			parent: () => ({ find: () => ({ length: afterLabels.length }) }),
		},
	};
	const filterList: any = {
		filters: underButton.map(makeFilter),
		update_filter_button: vi.fn(),
		toggle_empty_filters: vi.fn(),
	};
	const originalAdd = vi.fn((_filters: any, _refresh?: boolean) => Promise.resolve());
	const area: any = { add: originalAdd, filter_list: filterList, trigger_refresh: true };
	const listview: any = {
		doctype: SI,
		filters: initial,
		page: { fields_dict: { posting_date: field } },
		filter_area: area,
		refresh: vi.fn(),
	};
	return { listview, field, filterList, area, originalAdd };
}

describe("Sales Invoice list: Posting Date range at the top", () => {
	it("adds a Between DateRange top filter and keeps ERPNext's settings and onload", () => {
		const erpnextOnload = vi.fn();
		const { settings } = load({ add_fields: ["customer"], onload: erpnextOnload, right_column: "grand_total" });

		expect(settings.add_fields).toEqual(["customer"]);
		expect(settings.right_column).toBe("grand_total");
		expect(settings.custom_filter_configs).toEqual([
			{ fieldname: "posting_date", fieldtype: "DateRange", label: "Posting Date", condition: "Between" },
		]);

		const { listview } = makeListview();
		settings.onload(listview);
		expect(erpnextOnload).toHaveBeenCalledWith(listview);
	});

	it("does not wrap twice when the script runs again", () => {
		const erpnextOnload = vi.fn();
		const frappe: any = { listview_settings: { [SI]: { onload: erpnextOnload } } };
		new Function("frappe", "__", "$", SOURCE)(frappe, (s: string) => s, fakeJq().$);
		const once = frappe.listview_settings[SI].onload;
		new Function("frappe", "__", "$", SOURCE)(frappe, (s: string) => s, fakeJq().$);
		expect(frappe.listview_settings[SI].onload).toBe(once);
		expect(frappe.listview_settings[SI].custom_filter_configs).toHaveLength(1);
	});

	it("moves a saved range from under the Filter button into the range box", () => {
		const { settings } = load({});
		const saved = [SI, "posting_date", "Between", ["2026-11-01", "2026-11-10"]];
		const other = [SI, "status", "=", "Paid"];
		const { listview, field, filterList } = makeListview({ initial: [saved, other], underButton: [saved] });
		field.df.match_type = "=";

		settings.onload(listview);

		expect(field.set_value).toHaveBeenCalledWith(["2026-11-01", "2026-11-10"]);
		expect(field.df.match_type).toBe("Between");
		expect(filterList.filters).toHaveLength(0);
		expect(filterList.update_filter_button).toHaveBeenCalled();
		expect(field.$wrapper.css).toHaveBeenCalledWith({ "min-width": "220px" });
	});

	it("turns an old saved single date into that day to that day", () => {
		const { settings } = load({});
		const { listview, field } = makeListview({ initial: [[SI, "posting_date", "=", "2026-11-05"]] });
		field.df.match_type = "="; // what Frappe sets when it pushes "=" into the top field

		settings.onload(listview);

		expect(field.set_value).toHaveBeenCalledWith(["2026-11-05", "2026-11-05"]);
		expect(field.df.match_type).toBe("Between");
	});

	it("leaves other date conditions under the Filter button", () => {
		const { settings } = load({});
		const gte = [SI, "posting_date", ">=", "2026-11-09"];
		const { listview, field, filterList } = makeListview({ initial: [gte], underButton: [gte] });

		settings.onload(listview);

		expect(field.set_value).not.toHaveBeenCalled();
		expect(filterList.filters).toHaveLength(1);
	});

	it("puts a linked date into the range box and passes the other filters on, with one refresh", async () => {
		const { settings } = load({});
		const { listview, field, area, originalAdd } = makeListview();
		settings.onload(listview);

		await area.add([
			[SI, "posting_date", "=", "2026-11-05"],
			[SI, "status", "=", "Paid"],
		]);

		expect(field.set_value).toHaveBeenCalledWith(["2026-11-05", "2026-11-05"]);
		expect(originalAdd).toHaveBeenCalledWith([[SI, "status", "=", "Paid"]], false);
		expect(listview.refresh).toHaveBeenCalledTimes(1);
		expect(area.trigger_refresh).toBe(true);
	});

	it("handles the add(doctype, fieldname, condition, value) form and linked ranges", async () => {
		const { settings } = load({});
		const { listview, field, area } = makeListview();
		settings.onload(listview);

		await area.add(SI, "posting_date", "Between", ["2026-11-01", "2026-11-03"]);

		expect(field.set_value).toHaveBeenCalledWith(["2026-11-01", "2026-11-03"]);
		expect(listview.refresh).toHaveBeenCalledTimes(1);
	});

	it("passes filters without a posting date range through unchanged", async () => {
		const { settings } = load({});
		const { listview, field, area, originalAdd } = makeListview();
		settings.onload(listview);

		const filters = [
			[SI, "posting_date", ">=", "2026-11-09"],
			[SI, "posting_date", "Between", ["2026-11-01"]], // incomplete range
		];
		await area.add(filters, false);

		expect(originalAdd).toHaveBeenCalledWith(filters, false);
		expect(field.set_value).not.toHaveBeenCalled();
	});

	it("does nothing for another doctype's list", () => {
		const { settings } = load({});
		const { listview, area, originalAdd } = makeListview();
		listview.doctype = "POS Invoice";
		settings.onload(listview);
		expect(area.add).toBe(originalAdd);
	});

	it("shows a Submitted only label for staff, once", () => {
		const { settings, jq } = load({});
		const { listview, field } = makeListview();
		settings.onload(listview);
		settings.onload(listview); // a second onload must not add a second label

		expect(field.$wrapper.after).toHaveBeenCalledTimes(1);
		const label = field.$wrapper.after.mock.calls[0][0];
		expect(label.html).toContain("posa-submitted-only");
		const pill = jq.made.find((el) => el.html.includes("indicator-pill"));
		expect(pill.text).toHaveBeenCalledWith("Submitted only");
	});

	it("shows no label for System Manager or Administrator", () => {
		for (const who of [
			{ user: "it@test.invalid", roles: ["System Manager", "Accounts User"] },
			{ user: "Administrator", roles: [] },
		]) {
			const { settings } = load({}, who);
			const { listview, field } = makeListview();
			settings.onload(listview);
			expect(field.$wrapper.after).not.toHaveBeenCalled();
		}
	});
});
