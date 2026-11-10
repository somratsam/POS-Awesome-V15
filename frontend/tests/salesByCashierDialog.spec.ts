// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick, ref } from "vue";

const display = { width: ref(1920) };
vi.mock("vuetify", () => ({ useDisplay: () => display }));

const apiCall = vi.fn();
vi.mock("../src/posapp/services/api", () => ({ default: { call: (...args: any[]) => apiCall(...args) } }));

const offline = { value: false };
vi.mock("../src/offline/index", () => ({ isOffline: () => offline.value }));

import SalesByCashierDialog from "../src/posapp/components/pos/reports/SalesByCashierDialog.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { useEmployeeStore } from "../src/posapp/stores/employeeStore";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";

const METHOD = "posawesome.posawesome.api.sales_by_cashier.get_sales_by_cashier";

// Mirrors Vuetify: Esc closes the dialog unless it is persistent.
const VDialogStub = defineComponent({
	name: "VDialog",
	props: {
		modelValue: { type: Boolean, default: false },
		fullscreen: { type: Boolean, default: false },
		persistent: { type: Boolean, default: false },
	},
	emits: ["update:modelValue"],
	setup(props, { slots, emit }) {
		return () =>
			props.modelValue
				? h(
						"div",
						{
							class: "v-overlay__content",
							"data-fullscreen": String(props.fullscreen),
							"data-persistent": String(props.persistent),
						},
						[
							h("button", {
								"data-test": "dialog-esc",
								onClick: () => !props.persistent && emit("update:modelValue", false),
							}),
							slots.default?.(),
						],
					)
				: null;
	},
});
const VIconStub = defineComponent({ name: "VIcon", setup: () => () => h("i") });

const v = (gross: number, returns: number, sales: number) => ({
	gross,
	returns,
	net: Math.round((gross + returns) * 1000) / 1000,
	sales,
	avg_basket: sales ? Math.round((gross / sales) * 1000) / 1000 : null,
});

const REPORT = {
	allowed: true,
	store: "SWAN GALLERIA MCC",
	currency: "OMR",
	precision: 3,
	hidden_mode: "others",
	periods: [{ from: "2026-11-01", to: "2026-11-10" }],
	rows: [
		{ label: "Fatma Nasser", kind: "cashier", values: [v(2050.92, -110, 48)] },
		{ label: "Salim", kind: "cashier", values: [v(1102.56, -50, 31)] },
		{ label: "Others", kind: "others", values: [v(366.77, 0, 14)] },
		{ label: "Cashier not recorded", kind: "not_recorded", values: [v(12.5, 0, 1)] },
	],
	totals: {
		store: [v(3532.75, -160, 94)],
		shown_net: [2993.48],
		others_net: [366.77],
		not_recorded_net: [12.5],
	},
};

const COMPARE = {
	...REPORT,
	periods: [
		{ from: "2026-11-01", to: "2026-11-10" },
		{ from: "2026-10-01", to: "2026-10-10" },
	],
	rows: [
		{ label: "Fatma Nasser", kind: "cashier", values: [v(2050.92, -110, 48), v(1720.4, 0, 44)] },
		{ label: "Huda", kind: "cashier", values: [v(397.94, 0, 12), v(0, 0, 0)] },
	],
	totals: {
		store: [v(2448.86, -110, 60), v(1720.4, 0, 44)],
		shown_net: [2338.86, 1720.4],
		others_net: [0, 0],
		not_recorded_net: [0, 0],
	},
};

describe("Sales by Cashier full-screen view", () => {
	let ui: ReturnType<typeof useUIStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
		(window as any).frappe = {
			datetime: { get_today: () => "2026-11-10", nowdate: () => "2026-11-10" },
			boot: { sysdefaults: { first_day_of_the_week: "Sunday" } },
			defaults: { get_default: () => 3 },
		};
		(window as any).flt = (value: number) => value;
		(window as any).get_currency_symbol = () => "";
		(window as any).matchMedia = undefined;
		display.width.value = 1920;
		offline.value = false;
		apiCall.mockReset();
		apiCall.mockResolvedValue(REPORT);
		ui = useUIStore();
		ui.posProfile = { name: "SWAN GALLERIA MCC" } as any;
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	const open = async () => {
		const wrapper = mount(SalesByCashierDialog, {
			attachTo: document.body,
			global: {
				components: { VDialog: VDialogStub, VIcon: VIconStub },
				mocks: { __: (text: string, args?: any[]) => (window as any).__(text, args) },
			},
		});
		ui.openSalesByCashier();
		await flushPromises();
		return wrapper;
	};
	const lastArgs = () => apiCall.mock.calls.at(-1)![1];
	const T = (id: string) => `[data-testid="${id}"]`;
	const texts = (wrapper: any, selector: string) => wrapper.findAll(selector).map((el: any) => el.text());

	it("opens full screen on This month, for the till's store, logged as an opening", async () => {
		const wrapper = await open();
		expect(wrapper.get(".v-overlay__content").attributes("data-fullscreen")).toBe("true");
		expect(apiCall.mock.calls[0][0]).toBe(METHOD);
		expect(lastArgs()).toEqual({ pos_profile: "SWAN GALLERIA MCC", from_date: "2026-11-01", to_date: "2026-11-10", opened: 1 });
		expect(wrapper.get(T("sbc-preset-this_month")).attributes("aria-pressed")).toBe("true");
		expect(wrapper.get(T("sbc-subtitle")).text()).toBe("SWAN GALLERIA MCC · Net sales incl. VAT");
		expect(wrapper.get(T("sbc-back")).text()).toContain("Back to till");
		expect(wrapper.get(T("sbc-range-1")).text()).toContain("1 – 10 Nov 2026");
		wrapper.unmount();
	});

	it("four tiles: Net sales, Sales, Avg basket (before returns), Returns", async () => {
		const wrapper = await open();
		const tile = (id: string) => wrapper.get(T(`sbc-tile-${id}`)).text();
		expect(tile("net")).toContain("Net sales");
		expect(tile("net")).toContain("OMR3,372.750");
		expect(tile("net")).toContain("Till sales · incl. VAT");
		expect(tile("sales")).toContain("94");
		expect(tile("basket")).toContain("Avg basket (before returns)");
		expect(tile("basket")).toContain("37.582");
		expect(tile("returns")).toContain("-160.000");
		expect(tile("returns")).toContain("4.5% of gross");
		wrapper.unmount();
	});

	it("ranked bars with initials, Net value, share; leader marked; Others and Not recorded last", async () => {
		const wrapper = await open();
		const rows = wrapper.findAll(T("sbc-bar-row"));
		expect(rows.map((r) => r.get(T("sbc-bar-name")).text())).toEqual(["Fatma Nasser", "Salim", "Others", "Cashier not recorded"]);
		expect(rows.map((r) => r.attributes("data-kind"))).toEqual(["cashier", "cashier", "others", "not_recorded"]);
		expect(texts(wrapper, T("sbc-avatar"))).toEqual(["FN", "SA", "··", "?"]);
		expect(texts(wrapper, T("sbc-bar-value"))).toEqual(["1,940.920", "1,052.560", "366.770", "12.500"]);
		expect(texts(wrapper, T("sbc-bar-end"))).toEqual(["58%", "31%", "11%", "0%"]);
		expect(rows[0].classes()).toContain("sbc-row--lead");
		expect(rows[1].classes()).not.toContain("sbc-row--lead");
		expect(rows[2].classes()).toContain("sbc-row--first-special");
		expect(rows.map((r) => r.get(T("sbc-bar")).attributes("data-ratio"))).toEqual(["1.0000", "0.5423", "0.1890", "0.0064"]);
		expect(rows[2].text()).toContain("Hidden accounts and former staff");
		wrapper.unmount();
	});

	it("side panel: store summary, then the tapped cashier, then back", async () => {
		const wrapper = await open();
		const side = () => wrapper.get(T("sbc-side"));
		expect(side().get(T("sbc-detail-title")).text()).toBe("Store · 1 – 10 Nov 2026");
		expect(side().get(T("sbc-detail-top")).text()).toBe("Fatma Nasser");
		expect(side().text()).toContain("Avg basket (before returns)");
		expect(side().text()).toContain("Tap a bar to see one cashier.");

		await wrapper.findAll(T("sbc-bar-row"))[1].trigger("click");
		expect(wrapper.findAll(T("sbc-bar-row"))[1].attributes("aria-pressed")).toBe("true");
		expect(side().get(T("sbc-detail-name")).text()).toBe("Salim");
		expect(side().get(T("sbc-detail-rank")).text()).toBe("#2 of 2 · 1 – 10 Nov 2026");
		expect(side().get(T("sbc-detail-share")).text()).toBe("31% of the store's net sales");
		expect(side().text()).toContain("1,102.560");
		expect(wrapper.find(T("sbc-sheet")).exists()).toBe(false); // no sheet on a till

		await side().get(T("sbc-detail-clear")).trigger("click");
		expect(side().get(T("sbc-detail-title")).text()).toContain("Store");
		// A second tap on the same row also goes back.
		await wrapper.findAll(T("sbc-bar-row"))[0].trigger("click");
		await wrapper.findAll(T("sbc-bar-row"))[0].trigger("click");
		expect(side().get(T("sbc-detail-title")).text()).toContain("Store");
		wrapper.unmount();
	});

	it("Chart | Table switch: the table has Gross / Returns / Net / Sales / Avg basket / Share and the store total", async () => {
		const wrapper = await open();
		expect(wrapper.get(T("sbc-view-chart")).attributes("aria-pressed")).toBe("true");
		await wrapper.get(T("sbc-view-table")).trigger("click");
		expect(wrapper.find(T("sbc-bars")).exists()).toBe(false);
		expect(texts(wrapper, "th")).toEqual(["Cashier", "Gross", "Returns", "Net", "Sales", "Avg basket (before returns)", "Share"]);
		const cells = wrapper.findAll(T("sbc-table-row")).map((row) => row.findAll("td").map((td) => td.text()));
		expect(cells[0]).toEqual(["FNFatma Nasser", "2,050.920", "-110.000", "1,940.920", "48", "42.728", "58%"]);
		expect(cells.at(-1)).toEqual(["Store total", "3,532.750", "-160.000", "3,372.750", "94", "37.582", "100%"]);
		await wrapper.get(T("sbc-view-chart")).trigger("click");
		expect(wrapper.find(T("sbc-bars")).exists()).toBe(true);
		wrapper.unmount();
	});

	it("the reconciliation line and notes; Hide mode says 'not shown' with the same total", async () => {
		const wrapper = await open();
		const reconcile = wrapper.get(T("sbc-reconcile")).text();
		expect(reconcile).toContain("Store total 3,372.750 = shown cashiers 2,993.480 + Others 366.770 + Cashier not recorded 12.500");
		expect(reconcile).toContain("Till sales only. Matches the Z Reports for these dates when every shift opened and closed within them.");
		expect(wrapper.get(T("sbc-others-note")).text()).toBe("Others: cashiers hidden by the store and staff no longer assigned.");
		wrapper.unmount();

		apiCall.mockResolvedValue({ ...REPORT, hidden_mode: "hide", rows: REPORT.rows.filter((row) => row.kind !== "others") });
		const hidden = await open();
		expect(texts(hidden, T("sbc-bar-name"))).not.toContain("Others");
		expect(hidden.get(T("sbc-reconcile")).text()).toContain(
			"Store total 3,372.750 = shown cashiers 2,993.480 + not shown 366.770 + Cashier not recorded 12.500",
		);
		expect(hidden.get(T("sbc-others-note")).text()).toContain("Not shown:");
		hidden.unmount();
	});

	it("presets reload; Custom opens the two-month calendar with dd-mm-yyyy dates and a picked range is sent", async () => {
		const wrapper = await open();
		await wrapper.get(T("sbc-preset-last_month")).trigger("click");
		await flushPromises();
		expect(lastArgs()).toMatchObject({ from_date: "2026-10-01", to_date: "2026-10-31", opened: 0 });

		await wrapper.get(T("sbc-preset-custom")).trigger("click");
		expect(apiCall).toHaveBeenCalledTimes(2); // nothing sent until a range is picked
		const pop = wrapper.get(T("sbc-pop-1"));
		expect(texts(pop, T("sbc-cal-month"))).toEqual(["September 2026", "October 2026"]);
		expect(pop.get(T("sbc-cal-from")).text()).toBe("01-10-2026");
		expect(pop.get(T("sbc-cal-to")).text()).toBe("31-10-2026");
		expect(pop.get(T("sbc-cal-hint")).text()).toBe("Tap the first day, then the last day.");
		await pop.get('[data-day="2026-10-25"]').trigger("click");
		expect(pop.get(T("sbc-cal-hint")).text()).toBe("Now tap the last day.");
		await pop.get('[data-day="2026-10-12"]').trigger("click");
		await flushPromises();
		expect(lastArgs()).toMatchObject({ from_date: "2026-10-12", to_date: "2026-10-25" });
		expect(wrapper.find(T("sbc-pop-1")).exists()).toBe(false);
		expect(wrapper.get(T("sbc-preset-custom")).attributes("aria-pressed")).toBe("true");
		expect(wrapper.get(T("sbc-range-1")).text()).toContain("12 – 25 Oct 2026");
		wrapper.unmount();
	});

	it("tapping outside or Esc closes the calendar first, not the view", async () => {
		const wrapper = await open();
		await wrapper.get(T("sbc-range-1")).trigger("click");
		expect(wrapper.find(T("sbc-pop-1")).exists()).toBe(true);
		expect(wrapper.get(".v-overlay__content").attributes("data-persistent")).toBe("true");
		await wrapper.get('[data-test="dialog-esc"]').trigger("click");
		expect(ui.salesByCashierDialog).toBe(true);
		await wrapper.get(T("sales-by-cashier-dialog")).trigger("keydown", { key: "Escape" });
		expect(wrapper.find(T("sbc-pop-1")).exists()).toBe(false);
		await wrapper.get(T("sbc-range-1")).trigger("click");
		await wrapper.get(T("sbc-pop-catcher")).trigger("click");
		expect(wrapper.find(T("sbc-pop-1")).exists()).toBe(false);
		await wrapper.get('[data-test="dialog-esc"]').trigger("click");
		expect(ui.salesByCashierDialog).toBe(false);
		wrapper.unmount();
	});

	it("compare: switch, bullet markers, values column with Period 2, change badges and tiles", async () => {
		const wrapper = await open();
		const sw = wrapper.get(T("sbc-compare"));
		expect(sw.attributes("role")).toBe("switch");
		expect(sw.attributes("aria-checked")).toBe("false");
		apiCall.mockResolvedValue(COMPARE);
		await sw.trigger("click");
		await flushPromises();
		expect(wrapper.get(T("sbc-compare")).attributes("aria-checked")).toBe("true");
		expect(lastArgs()).toMatchObject({ compare_from: "2026-10-01", compare_to: "2026-10-10" });
		expect(wrapper.get(T("sbc-range-2")).text()).toContain("vs1 – 10 Oct 2026");
		expect(wrapper.get(T("sbc-legend")).text()).toContain("Period 2 · 1 – 10 Oct 2026");

		const rows = wrapper.findAll(T("sbc-bar-row"));
		expect(rows[0].get(T("sbc-marker")).attributes("data-ratio")).toBe("0.8864"); // 1720.4 / 1940.92
		expect(texts(wrapper, T("sbc-bar-p2"))).toEqual(["P2 1,720.400", "P2 0.000"]);
		const badges = wrapper.findAll(`${T("sbc-bar-end")} ${T("sbc-change")}`);
		expect(badges.map((b) => [b.attributes("data-kind"), b.text()])).toEqual([
			["up", "▲ 12.8%"],
			["new", "New"],
		]);
		expect(wrapper.get(T("sbc-tile-net")).text()).toContain("▲ 35.9%");
		expect(wrapper.get(T("sbc-tile-net")).text()).toContain("vs 1 – 10 Oct 2026");
		expect(wrapper.get(T("sbc-tile-sales")).get(T("sbc-badge")).text()).toBe("▲ 16 sales");
		expect(wrapper.get(T("sbc-tile-returns")).text()).toContain("was 0.0%");
		expect(wrapper.get(T("sbc-reconcile")).text()).toContain("Period 2: Store total 1,720.400");

		await wrapper.get(T("sbc-range-2")).trigger("click");
		await wrapper.get(T("sbc-compare-preset-last_year")).trigger("click");
		await flushPromises();
		expect(lastArgs()).toMatchObject({ compare_from: "2025-11-01", compare_to: "2025-11-10" });

		await wrapper.get(T("sbc-view-table")).trigger("click");
		expect(texts(wrapper, "th")).toEqual(["Cashier", "Net · Period 1", "Net · Period 2", "Change", "Sales 1", "Sales 2"]);
		wrapper.unmount();
	});

	it("tablet: no side panel; a tapped bar opens the detail sheet, which ✕ or the scrim closes", async () => {
		display.width.value = 1024;
		const wrapper = await open();
		expect(wrapper.get(T("sales-by-cashier-dialog")).attributes("data-layout")).toBe("tablet");
		expect(wrapper.find(T("sbc-side")).exists()).toBe(false);
		expect(wrapper.find(T("sbc-compare")).exists()).toBe(true); // in the controls row
		await wrapper.findAll(T("sbc-bar-row"))[1].trigger("click");
		const sheet = wrapper.get(T("sbc-sheet"));
		expect(sheet.attributes("data-sheet")).toBe("detail");
		expect(sheet.get(T("sbc-detail-name")).text()).toBe("Salim");
		expect(wrapper.get(".v-overlay__content").attributes("data-persistent")).toBe("true");
		await wrapper.get(T("sbc-sheet-close")).trigger("click");
		expect(wrapper.find(T("sbc-sheet")).exists()).toBe(false);
		expect(wrapper.findAll(T("sbc-bar-row"))[1].attributes("aria-pressed")).toBe("false");

		await wrapper.findAll(T("sbc-bar-row"))[0].trigger("click");
		await wrapper.get(T("sbc-sheet-scrim")).trigger("click");
		expect(wrapper.find(T("sbc-sheet")).exists()).toBe(false);
		wrapper.unmount();
	});

	it("phone: chips open the period sheet (presets, one-month calendar, compare switch); cards for the table", async () => {
		display.width.value = 390;
		const wrapper = await open();
		expect(wrapper.find(T("sbc-preset-today")).exists()).toBe(false); // presets live in the sheet
		expect(wrapper.get(T("sbc-back")).text()).toBe(""); // icon only
		expect(wrapper.get(T("sbc-chip-period")).text()).toContain("This month · 1 – 10 Nov 2026");

		await wrapper.get(T("sbc-chip-period")).trigger("click");
		let sheet = wrapper.get(T("sbc-sheet"));
		expect(sheet.attributes("data-sheet")).toBe("period");
		expect(texts(sheet, T("sbc-cal-month"))).toEqual(["November 2026"]);
		await sheet.get(T("sbc-preset-this_week")).trigger("click");
		await flushPromises();
		expect(lastArgs()).toMatchObject({ from_date: "2026-11-08", to_date: "2026-11-10" });
		expect(wrapper.find(T("sbc-sheet")).exists()).toBe(false);

		apiCall.mockResolvedValue(COMPARE);
		await wrapper.get(T("sbc-chip-compare")).trigger("click");
		await wrapper.get(T("sbc-sheet")).get(T("sbc-compare")).trigger("click");
		await flushPromises();
		sheet = wrapper.get(T("sbc-sheet"));
		expect(sheet.get(T("sbc-sheet-tab-p2")).attributes("aria-pressed")).toBe("true");
		expect(sheet.find(T("sbc-compare-preset-previous")).exists()).toBe(true);
		await sheet.get(T("sbc-sheet-tab-p1")).trigger("click");
		expect(wrapper.get(T("sbc-sheet")).find(T("sbc-preset-today")).exists()).toBe(true);
		await wrapper.get(T("sales-by-cashier-dialog")).trigger("keydown", { key: "Escape" });
		expect(wrapper.find(T("sbc-sheet")).exists()).toBe(false);
		expect(ui.salesByCashierDialog).toBe(true);
		expect(wrapper.get(T("sbc-chip-compare")).text()).toContain("vs 5 – 7 Nov 2026");

		await wrapper.get(T("sbc-view-table")).trigger("click");
		expect(wrapper.find(T("sbc-table")).exists()).toBe(false);
		expect(wrapper.findAll(T("sbc-card"))).toHaveLength(3);
		expect(wrapper.findAll(T("sbc-card"))[0].text()).toContain("Fatma Nasser");
		wrapper.unmount();
	});

	it("loading, empty, error (Try again), offline and refused states", async () => {
		let resolve!: (value: any) => void;
		apiCall.mockReturnValue(new Promise((r) => (resolve = r)));
		const wrapper = await open();
		expect(wrapper.get(T("sbc-loading")).text()).toContain("Loading sales…");
		resolve({ ...REPORT, rows: [], totals: { ...REPORT.totals, store: [v(0, 0, 0)] } });
		await flushPromises();
		expect(wrapper.get(T("sbc-empty")).text()).toContain("No sales in this period.");
		expect(wrapper.get(T("sbc-empty")).text()).toContain("Pick another period above.");

		apiCall.mockRejectedValue(new Error("network"));
		await wrapper.get(T("sbc-preset-today")).trigger("click");
		await flushPromises();
		expect(wrapper.get(T("sbc-problem")).text()).toContain("Couldn't load the report. Check the connection and try again.");
		apiCall.mockResolvedValue(REPORT);
		await wrapper.get(T("sbc-retry")).trigger("click");
		await flushPromises();
		expect(wrapper.find(T("sbc-problem")).exists()).toBe(false);
		expect(wrapper.find(T("sbc-report")).exists()).toBe(true);

		offline.value = true;
		const calls = apiCall.mock.calls.length;
		await wrapper.get(T("sbc-preset-yesterday")).trigger("click");
		await flushPromises();
		expect(apiCall.mock.calls.length).toBe(calls);
		expect(wrapper.get(T("sbc-problem")).text()).toContain("This report needs a connection to the server.");
		offline.value = false;

		for (const [reason, text] of [
			["locked", "Unlock the till with your PIN to see this report."],
			["disabled", "Sales by Cashier is turned off for this store."],
			["not_assigned", "You are not assigned to this store."],
		]) {
			apiCall.mockResolvedValue({ allowed: false, reason, message: "server text" });
			await wrapper.get(T("sbc-preset-this_week")).trigger("click");
			await flushPromises();
			expect(wrapper.get(T("sbc-problem")).text()).toContain(text);
			expect(wrapper.find(T("sbc-report")).exists()).toBe(false);
		}
		wrapper.unmount();
	});

	it("only the newest request is shown", async () => {
		const resolvers: Array<(value: any) => void> = [];
		apiCall.mockImplementation(() => new Promise((r) => resolvers.push(r)));
		const wrapper = await open();
		await wrapper.get(T("sbc-preset-last_month")).trigger("click");
		resolvers[1]({ ...REPORT, store: "NEWER" });
		await flushPromises();
		resolvers[0]({ ...REPORT, store: "OLDER" });
		await flushPromises();
		expect(wrapper.get(T("sbc-subtitle")).text()).toContain("NEWER");
		wrapper.unmount();
	});

	it("← Back to till closes it; so does a lock or another PIN; it reopens fresh and is logged again", async () => {
		(useEmployeeStore() as any).lockDialogOpen = false; // an unlocked till
		const wrapper = await open();
		await wrapper.get(T("sbc-back")).trigger("click");
		expect(ui.salesByCashierDialog).toBe(false);

		ui.openSalesByCashier();
		await flushPromises();
		useEmployeeStore().lockTerminal();
		await nextTick();
		expect(ui.salesByCashierDialog).toBe(false);

		(useEmployeeStore() as any).lockDialogOpen = false;
		ui.openSalesByCashier();
		await flushPromises();
		(useEmployeeStore() as any).currentCashier = { user: "other@swan.test", full_name: "Other" };
		await nextTick();
		expect(ui.salesByCashierDialog).toBe(false);

		ui.openSalesByCashier();
		await flushPromises();
		await wrapper.get(T("sbc-preset-today")).trigger("click");
		await wrapper.get(T("sbc-view-table")).trigger("click");
		await flushPromises();
		ui.closeSalesByCashier();
		await nextTick();
		ui.openSalesByCashier();
		await flushPromises();
		expect(lastArgs()).toMatchObject({ from_date: "2026-11-01", to_date: "2026-11-10", opened: 1 });
		expect(wrapper.get(T("sbc-view-chart")).attributes("aria-pressed")).toBe("true");
		expect(wrapper.get(T("sbc-compare")).attributes("aria-checked")).toBe("false");
		wrapper.unmount();
	});

	it("leaves the cart as it was", async () => {
		const invoice = useInvoiceStore();
		invoice.addItems([{ item_code: "SKU-1", item_name: "Navy 38", qty: 2, rate: 10, posa_row_id: "r1" }]);
		const snapshot = () => JSON.stringify({ items: invoice.items, doc: invoice.invoiceDoc });
		const before = snapshot();
		const wrapper = await open();
		await wrapper.get(T("sbc-preset-last_month")).trigger("click");
		await wrapper.get(T("sbc-compare")).trigger("click");
		await flushPromises();
		await wrapper.findAll(T("sbc-bar-row"))[0].trigger("click");
		await wrapper.get(T("sbc-back")).trigger("click");
		expect(snapshot()).toBe(before);
		expect(apiCall.mock.calls.every((call) => call[0] === METHOD)).toBe(true);
		wrapper.unmount();
	});

	it("bars grow from zero on open, one after another; with reduced motion they are drawn at once", async () => {
		const wrapper = await open();
		const salim = () => wrapper.findAll(T("sbc-bar"))[1].element as HTMLElement;
		expect(salim().style.clipPath).toContain("inset(0 100.000%");
		await new Promise((r) => setTimeout(r, 80));
		expect(salim().style.clipPath).toContain("inset(0 45.770%");
		expect(salim().style.transitionDelay).toBe("55ms");
		expect(wrapper.get(T("sales-by-cashier-dialog")).classes()).not.toContain("sbc--still");
		wrapper.unmount();

		(window as any).matchMedia = (query: string) => ({ matches: query.includes("reduce") });
		const still = await open();
		expect(still.get(T("sales-by-cashier-dialog")).classes()).toContain("sbc--still");
		expect(still.get(T("sbc-bars")).classes()).toContain("sbc-bars--still");
		const bar = still.findAll(T("sbc-bar"))[1].element as HTMLElement;
		expect(bar.style.clipPath).toContain("inset(0 45.770%");
		expect(bar.style.transitionDelay).toBe("0ms");
		still.unmount();
	});
});
