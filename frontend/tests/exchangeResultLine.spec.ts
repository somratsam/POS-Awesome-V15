// @vitest-environment jsdom
// Section 109: the exchange's big result line -- "Customer pays: OMR X",
// "Credit note to issue: OMR X", "Even exchange — nothing to pay" -- from the
// server-checked figures only, live as lines are ticked and items scanned.

import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const ui: any = reactive({
	posProfile: { name: "Test Pos", company: "Swan", currency: "OMR", currency_precision: 3, posa_decimal_precision: 3, posa_one_screen_exchange: 1 },
	posOpeningShift: { name: "SHIFT-1" },
});
let offline = false;
vi.mock("../src/offline/index", () => ({ isOffline: () => offline }));
vi.mock("../src/posapp/utils/voucherMessages", () => ({ callWithoutDialog: (...args: any[]) => call(...args) }));
vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ui }));
vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: vi.fn() }) }));
vi.mock("../src/posapp/stores/customersStore", () => ({
	useCustomersStore: () => ({ selectedCustomer: null, setSelectedCustomer: vi.fn() }),
}));
vi.mock("../src/posapp/stores/invoiceStore", () => ({ useInvoiceStore: () => ({ items: [], invoiceDoc: null }) }));

import { useExchangeStore } from "../src/posapp/stores/exchangeStore";
import { useExchangeResult } from "../src/posapp/composables/pos/exchange/useExchangeResult";
import { exchangeResultLine } from "../src/posapp/utils/oneScreenExchangeText";
import summarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import lineSource from "../src/posapp/components/pos/invoice/ExchangeResultLine.vue?raw";
import exchangeSource from "../src/posapp/components/pos/invoice_utils/exchange.ts?raw";
import arCsv from "../../posawesome/translations/ar.csv?raw";

const t = (text: string, args?: any[]) => text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));
(globalThis as any).__ = t;
(globalThis as any).flt = (v: any, p = 3) => Math.round((Number(v) || 0) * 10 ** p) / 10 ** p;
(globalThis as any).get_currency_symbol = () => "OMR";
const money = (v: number) => `OMR ${v.toFixed(3)}`;

const RECEIPT = {
	found: 1,
	name: "MCO-2026-00008",
	customer: "test loyalty",
	lines: [{ name: "L1", item_code: "A", sold: 2, returned: 0, left: 2, rate: 80.85 }],
};

beforeEach(() => {
	setActivePinia(createPinia());
	call.mockReset();
	offline = false;
	(globalThis as any).frappe = { utils: { play_sound: vi.fn() }, defaults: { get_default: () => 3 } };
});
afterEach(() => useExchangeStore().reset());

describe("wording", () => {
	it("customer pays / credit note to issue / even / return only / checking", () => {
		expect(exchangeResultLine({ kind: "pays", pay: 28.65, credit: 0 }, money, t)).toEqual({ tone: "pays", text: "Customer pays: OMR 28.650" });
		expect(exchangeResultLine({ kind: "credit", pay: 0, credit: 39.27 }, money, t)).toEqual({ tone: "credit", text: "Credit note to issue: OMR 39.270" });
		expect(exchangeResultLine({ kind: "even", pay: 0, credit: 0 }, money, t)).toEqual({ tone: "even", text: "Even exchange — nothing to pay" });
		expect(exchangeResultLine({ kind: "return", pay: 0, credit: 66.15 }, money, t)).toEqual({ tone: "credit", text: "Credit note to issue: OMR 66.150" });
		expect(exchangeResultLine(null, money, t)).toEqual({ tone: "checking", text: "Checking…" });
	});

	it("Arabic for both new lines", () => {
		const keys = new Set(arCsv.split("\n").map((row) => (row.startsWith('"') ? row.slice(1, row.indexOf('",')) : row.split(",")[0])));
		for (const text of ["Customer pays: {0}", "Credit note to issue: {0}", "Even exchange — nothing to pay", "Checking…"]) {
			expect(keys.has(text), text).toBe(true);
		}
	});
});

describe("live, from the server's figures only", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};

	it("return only, then a new item scanned: the line follows the server each time", async () => {
		const store = await ready();
		const cart = reactive<{ items: any[] }>({ items: [] });
		store.setSaleProvider(() => (cart.items.length ? { customer: "test loyalty", items: cart.items } : null));
		const { result } = useExchangeResult();

		call.mockResolvedValueOnce({ returned: 80.85, sale_total: null, pay: null, credit_left: 80.85 });
		store.refreshQuote(0);
		await vi.waitFor(() => expect(result.value.checking).toBe(false));
		expect(result.value).toMatchObject({ tone: "credit", text: "Credit note to issue: OMR 80.850" });

		// A new item scanned: until the server answers, the last line stays, dimmed.
		cart.items.push({ item_code: "N", qty: 1, rate: 109.5 });
		expect(result.value).toMatchObject({ tone: "credit", checking: true });
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 109.5, pay: 28.65, credit_left: 0 });
		store.refreshQuote(0);
		await vi.waitFor(() => expect(result.value.checking).toBe(false));
		expect(result.value).toMatchObject({ tone: "pays", text: "Customer pays: OMR 28.650" });
	});

	it("never the till's own estimate: before the first server answer it says Checking…", async () => {
		await ready();
		const { result } = useExchangeResult();
		expect(result.value).toMatchObject({ tone: "checking", text: "Checking…", checking: true });
	});

	it("a quote for another cart does not count", async () => {
		const store = await ready();
		const cart = reactive<{ qty: number }>({ qty: 1 });
		store.setSaleProvider(() => ({ customer: "x", items: [{ item_code: "N", qty: cart.qty, rate: 50 }] }));
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 50, pay: 0, credit_left: 30.85 });
		store.refreshQuote(0);
		await vi.waitFor(() => expect(store.serverQuote).not.toBeNull());
		cart.qty = 2;
		expect(store.serverQuote).toBeNull();
	});
});

describe("never stuck on Checking… (section 110)", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};
	const QUOTE = { returned: 80.85, sale_total: 186.9, pay: 106.05, credit_left: 0 };

	it("back from the payment screen: the cart came back as the server's draft (prices, taxes) -> checked again by itself", async () => {
		const store = await ready();
		// What Pay -> Cancel leaves in the cart: same items, but the saved
		// draft's price_list_rate and taxes -- fields the cart's own watch
		// never looked at.
		const cart = reactive<any>({ items: [{ item_code: "N", qty: 1, rate: 186.9 }], taxes_and_charges: null });
		store.setSaleProvider(() => ({ customer: "test loyalty", ...cart }));
		const { result } = useExchangeResult();
		call.mockResolvedValue(QUOTE);
		store.refreshQuote(0);
		await vi.waitFor(() => expect(result.value).toMatchObject({ tone: "pays", checking: false }));

		cart.items = [{ item_code: "N", qty: 1, rate: 186.9, price_list_rate: 186.9 }];
		cart.taxes_and_charges = "Oman VAT 5%";
		expect(result.value.checking).toBe(true);
		// No call from the cart's own watch here: the store sees it.
		await vi.waitFor(() => expect(result.value).toMatchObject({ tone: "pays", checking: false }), { timeout: 3000 });
		expect(result.value.text).toBe("Customer pays: OMR\u00A0106.050");
		expect(store.figuresPending).toBe(false);
	});

	it("a failed check says so, with Retry; Retry fixes it", async () => {
		const store = await ready();
		const { result } = useExchangeResult();
		call.mockRejectedValueOnce(new Error("Server error"));
		store.refreshQuote(0);
		await vi.waitFor(() => expect(result.value.tone).toBe("error"));
		expect(result.value).toMatchObject({ text: "Totals not checked", error: "Server error", checking: false });
		expect(store.figuresPending).toBe(false); // Pay is not left disabled
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: null, pay: null, credit_left: 80.85 });
		result.value.retry();
		await vi.waitFor(() => expect(result.value).toMatchObject({ tone: "credit", checking: false }));
	});

	it("a check that never answers times out after 15 s with the same Retry state", async () => {
		vi.useFakeTimers();
		try {
			const store = await ready();
			const { result } = useExchangeResult();
			call.mockImplementationOnce(() => new Promise(() => {}));
			store.refreshQuote(0);
			await vi.advanceTimersByTimeAsync(14000);
			expect(result.value.checking).toBe(true);
			await vi.advanceTimersByTimeAsync(1500);
			expect(result.value).toMatchObject({ tone: "error", error: "The exchange check took too long." });
		} finally {
			vi.useRealTimers();
		}
	});

	it("offline: says so at once instead of Checking…", async () => {
		const store = await ready();
		const { result } = useExchangeResult();
		offline = true;
		store.refreshQuote(0);
		expect(result.value).toMatchObject({ tone: "error", error: "Return / Exchange needs the server connection." });
	});

	it("Pay is disabled while the figures are being checked, and waits for them", () => {
		expect((summarySource.match(/:exchange-checking="exchangeStore.checking \|\| exchangeStore.figuresPending"/g) || []).length).toBe(2);
		expect(exchangeSource).toContain("await exchange.checkNow();");
		expect(lineSource).toContain('data-testid="exchange-result-retry"');
	});

	it("Arabic for the new strings", () => {
		const keys = new Set(arCsv.split("\n").map((row) => (row.startsWith('"') ? row.slice(1, row.indexOf('",')) : row.split(",")[0])));
		for (const text of ["Totals not checked", "Retry", "The exchange check took too long.", "Return / Exchange needs the server connection."]) {
			expect(keys.has(text), text).toBe(true);
		}
	});
});

describe("wiring and fit", () => {
	it("normal screen, fast counter mode and the small-screen dock all show it", () => {
		expect(summarySource).toContain('<ExchangeResultLine :result="exchangeResult" />');
		expect(summarySource).toContain('<ExchangeResultLine :result="exchangeResult" compact />');
		expect(posSource).toContain('<ExchangeResultLine v-if="exchangeStore.active" :result="exchangeResult" compact />');
		expect(summarySource).toContain("exchangeServerNewTotal ?? exchangeNewTotal");
	});

	it("scales with its box and keeps the amount with its symbol", () => {
		expect(lineSource).toContain("container-type: inline-size");
		expect(lineSource).toMatch(/font-size: clamp\(1\.3rem, 6\.5cqi, 2rem\)/);
		expect(lineSource).toContain('aria-live="polite"');
	});
});
