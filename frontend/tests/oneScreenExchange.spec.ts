// @vitest-environment jsdom
// One-screen Return / Exchange (POS Profile "One-screen exchange"): the
// picker's rules, the cart wording, the store's receipt flow, the scan route,
// the submit flow (server figures, one confirmation, then printing) and the
// wiring at every place the cart, Payments and the scanner reach it.

import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const toastShow = vi.fn();
const setSelectedCustomer = vi.fn();
const recordBalanceVoucherPrint = vi.fn(async () => ({ creditNote: true, balance: true }));
const ui: any = reactive({ posProfile: { name: "Test Pos", company: "Swan", currency: "OMR", posa_one_screen_exchange: 1 }, posOpeningShift: { name: "SHIFT-1" } });
const customers: any = { selectedCustomer: null as string | null, setSelectedCustomer };
const invoice: any = { items: [] as any[], invoiceDoc: null as any };
let offline = false;

vi.mock("../src/offline/index", () => ({ isOffline: () => offline }));
vi.mock("../src/posapp/utils/voucherMessages", () => ({ callWithoutDialog: (...args: any[]) => call(...args) }));
vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ui }));
vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: toastShow }) }));
vi.mock("../src/posapp/stores/customersStore", () => ({ useCustomersStore: () => customers }));
vi.mock("../src/posapp/stores/invoiceStore", () => ({ useInvoiceStore: () => invoice }));
vi.mock("../src/posapp/composables/pos/payments/usePaymentPrinting", () => ({
	usePaymentPrinting: () => ({ loadPrintPage: vi.fn() }),
}));
vi.mock("../src/posapp/utils/creditNoteReprint", () => ({
	recordBalanceVoucherPrint: (...args: any[]) => recordBalanceVoucherPrint(...args),
	balanceVoucherSettings: (sale: string) => JSON.stringify({ balance_for: sale }),
	REPRINT_SETTINGS: JSON.stringify({ is_reprint: 1 }),
}));

import {
	exchangeFigures,
	initialPicks,
	lineBlockedReason,
	lineHistoryNote,
	looksLikeReceipt,
	returnRequestItems,
	tickByScan,
	type ExchangeLine,
} from "../src/posapp/utils/oneScreenExchange";
import { exchangeCartLabels, exchangeConfirmText, exchangeQtyText } from "../src/posapp/utils/oneScreenExchangeText";
import { useExchangeStore } from "../src/posapp/stores/exchangeStore";
import { dispatchExchangeScan, registerExchangePickerScan, resetExchangeScanRoute } from "../src/posapp/composables/pos/items/exchangeScanRoute";
import { useExchangeSubmit } from "../src/posapp/composables/pos/exchange/useExchangeSubmit";
import { discardExchange } from "../src/posapp/components/pos/invoice_utils/exchange";
import documentSource from "../src/posapp/components/pos/invoice_utils/document.ts?raw";

import summarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import buttonsSource from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue?raw";
import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";
import returnRowsSource from "../src/posapp/components/pos/invoice/ExchangeReturnRows.vue?raw";
import dialogsSource from "../src/posapp/components/pos/invoice_utils/dialogs.ts?raw";
import actionsSource from "../src/posapp/components/pos/invoice_utils/actions.ts?raw";
import shortcutsSource from "../src/posapp/components/pos/invoice/invoiceShortcuts.ts?raw";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import paymentButtonsSource from "../src/posapp/components/pos/payments/PaymentActionButtons.vue?raw";
import scannerSource from "../src/posapp/composables/pos/items/useScannerInput.ts?raw";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import returnsSource from "../src/posapp/components/pos/flows/Returns.vue?raw";
import customerSource from "../src/posapp/components/pos/customer/Customer.vue?raw";
import pickerSource from "../src/posapp/components/pos/flows/ExchangePicker.vue?raw";
import invoiceVueSource from "../src/posapp/components/pos/Invoice.vue?raw";
import hostSource from "../src/posapp/components/pos/flows/ExchangeHost.vue?raw";
import arCsv from "../../posawesome/translations/ar.csv?raw";

const t = (text: string, args?: any[]) => text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));
(globalThis as any).__ = t;

const line = (over: Partial<ExchangeLine> = {}): ExchangeLine => ({
	name: "L1",
	idx: 1,
	item_code: "A",
	item_name: "Jersey",
	barcodes: ["6624"],
	sold: 2,
	returned: 0,
	left: 2,
	history: [],
	rate: 80.85,
	...over,
});

const RECEIPT = {
	found: 1,
	name: "MCO-2026-00008",
	customer: "test loyalty",
	customer_name: "test loyalty",
	posting_date: "2026-11-16",
	returnable_until: "2026-12-01",
	lines: [line(), line({ name: "L2", idx: 2, item_code: "B", barcodes: ["7777"], rate: 50.4, sold: 1, left: 1 })],
};

beforeEach(() => {
	setActivePinia(createPinia());
	call.mockReset();
	toastShow.mockReset();
	setSelectedCustomer.mockReset();
	recordBalanceVoucherPrint.mockClear();
	customers.selectedCustomer = null;
	invoice.items = [];
	invoice.invoiceDoc = null;
	offline = false;
	ui.posProfile.posa_one_screen_exchange = 1;
	resetExchangeScanRoute();
	(globalThis as any).frappe = { utils: { play_sound: vi.fn() } };
});

// A store's 0.4 s background check must not fire into the next test.
afterEach(() => {
	useExchangeStore().reset();
});

describe("picker rules", () => {
	it("recognises receipt numbers, never item barcodes", () => {
		expect(looksLikeReceipt("2026-00210")).toBe(true);
		expect(looksLikeReceipt("MCO-2026-00008")).toBe(true);
		expect(looksLikeReceipt("ACC-SINV-2026-00399")).toBe(true);
		expect(looksLikeReceipt("45240197030024")).toBe(false);
		expect(looksLikeReceipt("4524019703")).toBe(false);
		expect(looksLikeReceipt("jersey")).toBe(false);
	});

	it("nothing ticked at first; a one-line receipt with 1 left comes ticked", () => {
		expect(initialPicks(RECEIPT.lines)).toEqual({});
		expect(initialPicks([line({ left: 1 })])).toEqual({ L1: 1 });
		expect(initialPicks([line({ left: 2 })])).toEqual({});
	});

	it("a scan ticks one more, never above what is left", () => {
		let result = tickByScan(RECEIPT.lines, {}, "6624");
		expect(result).toMatchObject({ error: "", picks: { L1: 1 } });
		result = tickByScan(RECEIPT.lines, result.picks, "A");
		expect(result.picks).toEqual({ L1: 2 });
		expect(tickByScan(RECEIPT.lines, result.picks, "6624").error).toBe("nothing_left");
		expect(tickByScan(RECEIPT.lines, {}, "999").error).toBe("not_on_receipt");
	});

	it("greys out a line with nothing left and says why", () => {
		const done = line({ left: 0, returned: 1, sold: 1, history: [{ qty: 1, date: "2026-11-13", name: "CN-1" }] });
		expect(lineBlockedReason(done, () => "13 Nov", t)).toBe("returned 1 on 13 Nov");
		expect(lineBlockedReason(line({ left: 0, sold: 0 }), () => "", t)).toBe("0 left");
		expect(lineBlockedReason(line(), () => "", t)).toBe("");
		const part = line({ left: 1, returned: 1, history: [{ qty: 1, date: "2026-11-13", name: "CN-1" }] });
		expect(lineHistoryNote(part, () => "13 Nov", t)).toBe("returned 1 on 13 Nov");
	});

	it("the till sends only which lines and how many", () => {
		expect(returnRequestItems({ L1: 2, L2: 0 })).toEqual([{ sales_invoice_item: "L1", qty: 2 }]);
	});
});

describe("figures and wording", () => {
	const money = (value: number) => `OMR ${Number(value).toFixed(3)}`;

	it("pays more, credit left, even, plain return -- to the baisa", () => {
		expect(exchangeFigures(84.11, 89.56)).toEqual({ kind: "pays", pay: 5.45, credit: 0 });
		expect(exchangeFigures(84.11, 50.4)).toEqual({ kind: "credit", pay: 0, credit: 33.71 });
		expect(exchangeFigures(80.85, 80.85)).toEqual({ kind: "even", pay: 0, credit: 0 });
		expect(exchangeFigures(80.85, null)).toEqual({ kind: "return", pay: 0, credit: 80.85 });
	});

	it("cart bar: Pay X / Credit note issued X / Even exchange (no amount)", () => {
		expect(exchangeCartLabels({ kind: "pays", pay: 59.1, credit: 0 }, money, t)).toEqual({
			headline: "Customer pays",
			amount: "OMR 59.100",
			button: "Pay OMR 59.100",
		});
		expect(exchangeCartLabels({ kind: "credit", pay: 0, credit: 31.1 }, money, t)).toEqual({
			headline: "Credit note issued",
			amount: "OMR 31.100",
			button: "Submit exchange",
		});
		expect(exchangeCartLabels({ kind: "even", pay: 0, credit: 0 }, money, t)).toEqual({
			headline: "Even exchange",
			amount: null,
			button: "Submit exchange",
		});
		expect(exchangeCartLabels({ kind: "return", pay: 0, credit: 50.4 }, money, t).button).toBe(
			"Submit return → Credit note",
		);
		expect(exchangeQtyText(1, 1, t)).toBe("1 back · 1 new");
		expect(exchangeQtyText(2, 0, t)).toBe("2 back");
	});

	it("the confirmation", () => {
		const data = { backQty: 1, returned: 50.4, newQty: 1, saleTotal: 109.5 };
		expect(exchangeConfirmText({ type: "submit", data: { ...data, kind: "pays", pay: 59.1 } }, money, t)).toEqual({
			title: "Submit this exchange?",
			body: ["1 back (OMR 50.400), 1 new (OMR 109.500), customer pays OMR 59.100."],
			ok: "Submit exchange",
		});
		expect(
			exchangeConfirmText({ type: "submit", data: { ...data, saleTotal: 20, kind: "credit", credit: 30.4 } }, money, t).body[0],
		).toBe("1 back (OMR 50.400), 1 new (OMR 20.000), credit note issued OMR 30.400.");
		expect(exchangeConfirmText({ type: "submit", data: { ...data, kind: "even" } }, money, t).body[0]).toMatch(
			/even exchange\.$/,
		);
		expect(exchangeConfirmText({ type: "submit", data: { backQty: 1, returned: 50.4, kind: "return", credit: 50.4 } }, money, t)).toEqual({
			title: "Submit this return?",
			body: ["1 back (OMR 50.400), credit note issued OMR 50.400."],
			ok: "Submit return → Credit note",
		});
		expect(exchangeConfirmText({ type: "discard", data: {} }, money, t).title).toBe("Discard? Nothing saved.");
	});
});

describe("exchangeStore receipts", () => {
	it("off, or not a receipt: the item search goes on", async () => {
		const store = useExchangeStore();
		ui.posProfile.posa_one_screen_exchange = 0;
		expect(await store.openReceipt("MCO-2026-00008")).toBe(false);
		ui.posProfile.posa_one_screen_exchange = 1;
		expect(await store.openReceipt("66249600030015")).toBe(false);
		call.mockResolvedValueOnce({ found: 0 });
		expect(await store.openReceipt("2026-99999")).toBe(false);
		expect(call).toHaveBeenCalledTimes(1);
	});

	it("a receipt that can't be exchanged shows the server's reason", async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce({ found: 1, name: "X", error: "This receipt was cancelled" });
		expect(await store.openReceipt("MCO-2026-00009")).toBe(true);
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: "This receipt was cancelled" }));
		expect(store.receipt).toBeNull();
	});

	it("opens the picker for the receipt's customer, nothing ticked", async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		expect(await store.openReceipt("MCO-2026-00008")).toBe(true);
		expect(store.pickerOpen).toBe(true);
		expect(store.active).toBe(false);
		expect(setSelectedCustomer).toHaveBeenCalledWith("test loyalty");
		expect(store.exchangeId).not.toBe("");
	});

	it("new items first: asks before adding the return, and Back adds nothing", async () => {
		const store = useExchangeStore();
		invoice.items = [{ item_code: "Z" }];
		customers.selectedCustomer = "Someone";
		call.mockResolvedValueOnce(RECEIPT);
		const opening = store.openReceipt("MCO-2026-00008");
		await vi.waitFor(() => expect(store.prompt?.type).toBe("add_return"));
		expect(store.prompt?.data).toMatchObject({ receipt: "MCO-2026-00008", customerChanges: true });
		store.settlePrompt(false);
		expect(await opening).toBe(true);
		expect(store.receipt).toBeNull();
		expect(setSelectedCustomer).not.toHaveBeenCalled();
	});

	it("the same receipt again reopens the picker; another one is refused", async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		expect(store.active).toBe(true);
		expect(await store.openReceipt("MCO-2026-00008")).toBe(true);
		expect(store.pickerOpen).toBe(true);
		store.closePicker(null);
		call.mockResolvedValueOnce({ ...RECEIPT, name: "MCO-2026-00007" });
		expect(await store.openReceipt("MCO-2026-00007")).toBe(true);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ title: "One receipt per exchange. Finish or discard this exchange first." }),
		);
		expect(store.receipt?.name).toBe("MCO-2026-00008");
	});

	it("offline: no exchange", async () => {
		offline = true;
		expect(await useExchangeStore().openReceipt("MCO-2026-00008")).toBe(true);
		expect(call).not.toHaveBeenCalled();
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: "Return / Exchange needs the server connection." }));
	});

	it("−/+ stays within what is left; the last one off ends the exchange", async () => {
		const store = useExchangeStore();
		call.mockResolvedValue(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		store.step("L1", 5);
		expect(store.picks).toEqual({ L1: 2 });
		store.step("L1", -2);
		expect(store.active).toBe(false);
		expect(store.receipt).toBeNull();
	});

	it("Back on a fresh picker drops the receipt", async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker(null);
		expect(store.receipt).toBeNull();
	});
});

describe("scan route", () => {
	it("with the picker open, scans go to the picker, never to the cart", () => {
		const picker = vi.fn();
		const unregister = registerExchangePickerScan(picker);
		expect(dispatchExchangeScan("6624", vi.fn())).toBe(true);
		expect(picker).toHaveBeenCalledWith("6624");
		unregister();
		expect(dispatchExchangeScan("6624", vi.fn())).toBe(false);
	});

	it("a receipt-shaped code that isn't a receipt goes back to selling once", async () => {
		call.mockResolvedValueOnce({ found: 0 });
		const rescan = vi.fn((code: string) => dispatchExchangeScan(code, rescan));
		expect(dispatchExchangeScan("2026-12345", rescan)).toBe(true);
		await vi.waitFor(() => expect(rescan).toHaveBeenCalledWith("2026-12345"));
		expect(rescan.mock.results[0].value).toBe(false);
	});

	it("setting off: everything goes to selling", () => {
		ui.posProfile.posa_one_screen_exchange = 0;
		expect(dispatchExchangeScan("MCO-2026-00008", vi.fn())).toBe(false);
		expect(call).not.toHaveBeenCalled();
	});
});

describe("submitting", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};
	const sale = (paid = 0) => ({ items: [{ item_code: "N", qty: 1 }], payments: [{ mode_of_payment: "Visa", amount: paid }] });
	const answer = async (store: any, value: boolean) => {
		await vi.waitFor(() => expect(store.prompt?.type).toBe("submit"));
		store.settlePrompt(value);
	};

	it("credit left: server figures, one confirmation, then the pair; receipt and BALANCE voucher print", async () => {
		const store = await ready();
		const printDoc = vi.fn();
		call.mockImplementation(async (method: string) => {
			if (method.endsWith("quote_exchange")) return { returned: 80.85, sale_total: 50.4, pay: 0, credit_left: 30.45 };
			return { return: { name: "CN-9" }, sale: { name: "S-12" }, credit_left: 30.45 };
		});
		const running = useExchangeSubmit().submitExchange({ sale: sale(), print: true, expectKinds: ["credit", "even"], printDoc });
		await answer(store, true);
		expect(await running).toBe(true);
		const submit = call.mock.calls.find(([method]) => method.endsWith("submit_exchange"))![1];
		expect(submit.expected).toEqual({ returned: 80.85, sale_total: 50.4, pay: 0 });
		expect(submit.return_invoice.items).toEqual([{ sales_invoice_item: "L1", qty: 1 }]);
		expect(submit.exchange_id).toBeTruthy();
		await vi.waitFor(() => expect(printDoc).toHaveBeenCalledTimes(2));
		expect(printDoc.mock.calls[0][0]).toEqual({ name: "S-12" });
		expect(printDoc.mock.calls[1][0]).toEqual({ name: "CN-9", settings: JSON.stringify({ balance_for: "S-12" }) });
		expect(store.active).toBe(false);
	});

	it("Back on the confirmation saves nothing", async () => {
		const store = await ready();
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 80.85, pay: 0, credit_left: 0 });
		const running = useExchangeSubmit().submitExchange({ sale: sale(), print: true, expectKinds: ["credit", "even"], printDoc: vi.fn() });
		await answer(store, false);
		expect(await running).toBe(false);
		expect(call.mock.calls.some(([m]) => m.endsWith("submit_exchange"))).toBe(false);
		expect(store.active).toBe(true);
	});

	it("the server says the customer pays more: nothing is asked or saved", async () => {
		await ready();
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 90, pay: 9.15, credit_left: 0 });
		const ok = await useExchangeSubmit().submitExchange({ sale: sale(), print: true, expectKinds: ["credit", "even"], printDoc: vi.fn() });
		expect(ok).toBe(false);
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ color: "error" }));
		expect(call).toHaveBeenCalledTimes(1);
	});

	it("pays more from Payments: Cash/Card must cover the difference first", async () => {
		await ready();
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 109.5, pay: 28.65, credit_left: 0 });
		const ok = await useExchangeSubmit().submitExchange({ sale: sale(20), print: false, expectKinds: ["pays"], printDoc: vi.fn() });
		expect(ok).toBe(false);
		expect(toastShow.mock.calls.at(-1)[0].title).toMatch(/^Remaining /);
	});

	it("a refused submit keeps the exchange on the screen and says why", async () => {
		const store = await ready();
		call.mockImplementation(async (method: string) => {
			if (method.endsWith("quote_exchange")) return { returned: 80.85, sale_total: null, pay: null, credit_left: 80.85 };
			throw new Error("Totals changed: the returned value is 80.850, the till showed 80.000.");
		});
		const running = useExchangeSubmit().submitExchange({ sale: null, print: true, expectKinds: ["return"], printDoc: vi.fn() });
		await answer(store, true);
		expect(await running).toBe(false);
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^Totals changed/) }));
		expect(store.active).toBe(true);
	});

	it("plain return: the credit note voucher prints", async () => {
		const store = await ready();
		const printDoc = vi.fn();
		call.mockImplementation(async (method: string) =>
			method.endsWith("quote_exchange")
				? { returned: 80.85, sale_total: null, pay: null, credit_left: 80.85 }
				: { return: { name: "CN-10" }, sale: null, credit_left: 80.85 },
		);
		const running = useExchangeSubmit().submitExchange({ sale: null, print: false, expectKinds: ["return"], printDoc });
		await answer(store, true);
		expect(await running).toBe(true);
		await vi.waitFor(() => expect(printDoc).toHaveBeenCalledWith({ name: "CN-10" }));
		expect(recordBalanceVoucherPrint).not.toHaveBeenCalled();
	});
});

describe("instant confirmation", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};
	const sale = { customer: "test loyalty", items: [{ item_code: "N", qty: 1, rate: 50.4 }], payments: [] };
	const QUOTE = { returned: 80.85, sale_total: 50.4, pay: 0, credit_left: 30.45 };

	it("the background check waits 0.4 s after the last change: one server call for many changes", async () => {
		vi.useFakeTimers();
		try {
			const store = await ready();
			store.setSaleProvider(() => sale);
			call.mockResolvedValue(QUOTE);
			for (let i = 0; i < 6; i++) {
				store.refreshQuote(400);
				await vi.advanceTimersByTimeAsync(150);
			}
			expect(call).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(400);
			expect(call).toHaveBeenCalledTimes(1);
			// nothing that decides the figures changed: no second call
			store.refreshQuote(400);
			await vi.advanceTimersByTimeAsync(500);
			expect(call).toHaveBeenCalledTimes(1);
			expect(store.quote?.sale_total).toBe(50.4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("a matching background check opens the confirmation with no server call", async () => {
		const store = await ready();
		store.setSaleProvider(() => sale);
		call.mockResolvedValue(QUOTE);
		store.refreshQuote(0);
		await vi.waitFor(() => expect(store.quote).not.toBeNull());
		call.mockClear();
		const running = useExchangeSubmit().submitExchange({ sale, print: true, expectKinds: ["credit"], printDoc: vi.fn() });
		await vi.waitFor(() => expect(store.prompt?.type).toBe("submit"));
		expect(call).not.toHaveBeenCalled();
		store.settlePrompt(false);
		await running;
	});

	it("a changed cart is checked now, shown as Checking…", async () => {
		const store = await ready();
		let release: (v: any) => void = () => {};
		call.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		const running = useExchangeSubmit().submitExchange({ sale, print: true, expectKinds: ["credit"], printDoc: vi.fn() });
		await vi.waitFor(() => expect(store.checking).toBe(true));
		release(QUOTE);
		await vi.waitFor(() => expect(store.prompt?.type).toBe("submit"));
		expect(store.checking).toBe(false);
		store.settlePrompt(false);
		await running;
	});

	it("Payments passes the figures it shows: no check before the confirmation", async () => {
		const store = await ready();
		const running = useExchangeSubmit().submitExchange({
			sale: { ...sale, payments: [{ mode_of_payment: "Visa", amount: 28.65 }] },
			figures: { returned: 80.85, sale_total: 109.5, pay: 28.65 },
			print: false,
			expectKinds: ["pays"],
			printDoc: vi.fn(),
		});
		await vi.waitFor(() => expect(store.prompt?.type).toBe("submit"));
		expect(call).not.toHaveBeenCalled();
		store.settlePrompt(false);
		await running;
	});

	it("payment screen: no confirmation -- straight to saving; a second press does nothing", async () => {
		const store = await ready();
		let release: (v: any) => void = () => {};
		call.mockImplementation(() => new Promise((resolve) => (release = resolve)));
		const options = {
			confirm: false,
			sale: { ...sale, payments: [{ mode_of_payment: "Visa", amount: 28.65 }] },
			figures: { returned: 80.85, sale_total: 109.5, pay: 28.65 },
			print: true,
			expectKinds: ["pays"] as any,
			printDoc: vi.fn(),
		};
		const running = useExchangeSubmit().submitExchange(options);
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
		expect(call.mock.calls[0][0]).toMatch(/submit_exchange$/);
		expect(store.prompt).toBeNull();
		expect(store.submitting).toBe(true);
		expect(await useExchangeSubmit().submitExchange(options)).toBe(false);
		expect(call).toHaveBeenCalledTimes(1);
		release({ return: { name: "CN-1" }, sale: { name: "S-1" }, credit_left: 0 });
		expect(await running).toBe(true);
		expect(store.submitting).toBe(false);
	});

	it("confirmed: the dialog stays open as Saving… (Back ignored) until the save ends", async () => {
		const store = await ready();
		let release: (v: any) => void = () => {};
		call.mockImplementation((method: string) =>
			method.endsWith("quote_exchange") ? Promise.resolve(QUOTE) : new Promise((resolve) => (release = resolve)),
		);
		const running = useExchangeSubmit().submitExchange({ sale, print: true, expectKinds: ["credit"], printDoc: vi.fn() });
		await vi.waitFor(() => expect(store.prompt?.type).toBe("submit"));
		store.settlePrompt(true);
		expect(store.prompt?.saving).toBe(true);
		store.settlePrompt(false);
		expect(store.prompt?.saving).toBe(true);
		await vi.waitFor(() => expect(call.mock.calls.some(([m]) => m.endsWith("submit_exchange"))).toBe(true));
		release({ return: { name: "CN-1" }, sale: { name: "S-1" }, credit_left: 30.45 });
		expect(await running).toBe(true);
		expect(store.prompt).toBeNull();
	});
});

describe("discarding", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce(RECEIPT);
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};
	const cart = (name?: string) => ({
		invoice_doc: name ? { name, docstatus: 0 } : {},
		pos_profile: { name: "Test Pos", customer: "" },
		clear_invoice: vi.fn(),
		customersStore: { setSelectedCustomer: vi.fn() },
		eventBus: { emit: vi.fn() },
	});

	it("Discard deletes the exchange's own draft on the server, then clears the cart", async () => {
		const store = await ready();
		const context = cart("MCO-2026-00023");
		call.mockResolvedValue({ deleted: ["MCO-2026-00023"] });
		const running = discardExchange(context);
		await vi.waitFor(() => expect(store.prompt?.type).toBe("discard"));
		const id = store.exchangeId;
		store.settlePrompt(true);
		await running;
		expect(call).toHaveBeenCalledWith(
			"posawesome.posawesome.api.one_screen_exchange.discard_exchange_draft",
			{ exchange_id: id, pos_profile: "Test Pos" },
		);
		expect(context.clear_invoice).toHaveBeenCalled();
		expect(store.active).toBe(false);
	});

	it("no draft saved yet: nothing to delete", async () => {
		const store = await ready();
		const context = cart();
		const running = discardExchange(context);
		await vi.waitFor(() => expect(store.prompt?.type).toBe("discard"));
		store.settlePrompt(true);
		await running;
		expect(call).not.toHaveBeenCalled();
		expect(context.clear_invoice).toHaveBeenCalled();
	});

	it("the server refuses: the exchange stays and the reason shows", async () => {
		const store = await ready();
		const context = cart("MCO-2026-00023");
		call.mockRejectedValue(new Error("Can't reach the server."));
		const running = discardExchange(context);
		await vi.waitFor(() => expect(store.prompt?.type).toBe("discard"));
		store.settlePrompt(true);
		await running;
		expect(store.active).toBe(true);
		expect(context.clear_invoice).not.toHaveBeenCalled();
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: "Can't reach the server." }));
	});

	it("the sale draft carries the exchange's key; Cancel Sale uses the same delete", () => {
		expect(documentSource).toContain("doc.posa_client_request_id = `${exchange.ensureExchangeId()}:sale`");
		expect(actionsSource).toContain("exchangeActive && !(await deleteExchangeDraft(context))");
		expect(actionsSource).toContain("context.pos_profile.posa_allow_delete && !exchangeActive");
	});
});

describe("wiring", () => {
	it("the summary forwards the exchange props to every InvoiceActionButtons", () => {
		expect((summarySource.match(/<InvoiceActionButtons/g) || []).length).toBe(2);
		expect((summarySource.match(/:exchange-button-label="exchangeLabels.button"/g) || []).length).toBe(2);
		expect((summarySource.match(/:exchange-active="exchangeStore.active"/g) || []).length).toBe(2);
		expect(buttonsSource).toContain('exchangeActive ? (exchangeChecking ? __("Checking…") : exchangeButtonLabel) : __("PAY")');
		expect(buttonsSource).toContain('exchangeActive ? (exchangeChecking ? __("Checking…") : exchangeButtonLabel) : __("Pay")');
		expect(buttonsSource).toContain('__("Return / Exchange")');
	});

	it("RETURN lines sit in the cart's own columns: grey receipt values, −/+ qty, delete, no chart", () => {
		expect(itemsTableSource).toContain("<template #body.prepend>");
		expect(itemsTableSource).toMatch(/<ExchangeReturnRows\s+:visible-columns="finalVisibleColumns"/);
		expect(returnRowsSource).toContain('v-for="column in visibleColumns"');
		for (const key of ["price_list_rate", "discount_percentage", "discount_amount", "rate"]) {
			expect(returnRowsSource).toContain(`${key}: "${key}"`);
		}
		expect(returnRowsSource).toContain(":title=\"__('Price and discount from the receipt')\"");
		expect(returnRowsSource).not.toMatch(/<input|v-text-field|DiscountReason|mdi-lock|mdi-chart-line/);
		expect(returnRowsSource).toContain("exchange.step(line.name, -1)");
		expect(returnRowsSource).toContain("exchange.step(line.name, -line.qty)");
		expect(returnRowsSource).toContain("mdi-delete-outline");
		expect(returnRowsSource).toContain("Invoice discount on the receipt: -{0} (included in Returned)");
	});

	it("the Walk-in button hides while the customer is locked", () => {
		expect(customerSource).toContain('v-if="pos_profile?.posa_walkin_customer && !sharedCustomerLockNote"');
	});

	it("every route to Payments asks the exchange first; no hold during an exchange", () => {
		const show = dialogsSource.slice(dialogsSource.indexOf("export async function show_payment"));
		expect(show.indexOf("runExchangeMainAction")).toBeGreaterThan(-1);
		expect(show.indexOf("runExchangeMainAction")).toBeLessThan(show.indexOf("context._paymentInFlight = true"));
		expect(actionsSource).toContain("No hold or draft during an exchange");
		expect(actionsSource).toContain("peekExchangeStore()?.reset()");
		expect(shortcutsSource).toContain("discardExchange(this)");
		expect(shortcutsSource).toMatch(/key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/);
	});

	it("Payments submits the exchange, not a normal invoice, and hides other credit", () => {
		const wrapper = paymentsSource.slice(paymentsSource.indexOf("const submitInvoiceWrapper"));
		expect(wrapper.indexOf("submitExchangeFromPayments")).toBeLessThan(wrapper.indexOf("resolveReturnSubmit"));
		expect(paymentsSource).toContain('data-testid="exchange-credit-row"');
		expect(paymentsSource).toContain('v-if="!exchangeMode" class="payment-section payment-section--settlement"');
		expect(paymentsSource).toContain("Boolean(pos_profile?.posa_use_gift_cards) && !exchangeMode");
		expect(paymentsSource).toContain(':exchange="exchangeMode"');
		expect(paymentButtonsSource).toContain('__("Submit exchange & Print")');
	});

	it("receipts reach the exchange from the scanner, both search boxes and Return / Exchange", () => {
		const handler = scannerSource.slice(scannerSource.indexOf("const onBarcodeScanned = ("));
		expect(handler.indexOf("dispatchExchangeScan")).toBeGreaterThan(handler.indexOf("dispatchStockLookupScan(normalizedCode)"));
		expect(posSource).toContain("<ExchangeHost />");
		expect(posSource).toContain("exchangeStore.openReceipt(normalizedQuery)");
		expect(selectorSource).toContain("exchangeStore.openReceipt(typed)");
		expect(returnsSource).toContain("openReceipt(selectedInvoice.name, { fromSearch: true })");
		expect(customerSource).toContain("Exchange for receipt {0} — the customer stays {1}.");
		expect(pickerSource).toContain("registerExchangePickerScan");
	});

	it("the cart's background check: same sale builder, triggered by cart changes", () => {
		expect(invoiceVueSource).toContain("exchangeStore.setSaleProvider(() => buildExchangeSale(this))");
		expect(invoiceVueSource).toContain("exchangeStore.refreshQuote(400)");
		expect(invoiceVueSource).toContain("this._unregisterExchangeSale?.()");
		expect(buttonsSource).toContain('exchangeChecking ? __("Checking…") : exchangeButtonLabel');
		expect((summarySource.match(/:exchange-checking="exchangeStore.checking"/g) || []).length).toBe(2);
		expect(paymentButtonsSource).toMatch(/checking\s*\?\s*__\("Checking…"\)\s*:\s*saving\s*\?\s*__\("Saving…"\)\s*:\s*__\("Submit exchange & Print"\)/);
		expect(paymentsSource).toContain(':checking="exchangeStore.checking"');
		expect(paymentsSource).toContain(':saving="exchangeMode && exchangeStore.submitting"');
		expect(paymentsSource).toMatch(/submitExchange\(\{\s*confirm: false,/);
		expect(paymentButtonsSource).toContain('__("Saving…")');
		expect(hostSource).toContain('saving ? __("Saving…") : okLabel');
	});

	it("the whole picker row ticks and unticks; −/+ and the box keep their own clicks", () => {
		expect(pickerSource).toContain('@click="toggleRow(line)"');
		expect(pickerSource).toContain('<div class="exchange-picker__qty" @click.stop>');
		expect(pickerSource).toContain('<div class="exchange-picker__tick" @click.stop>');
	});

	it("every new string has Arabic", () => {
		const keys = new Set(
			arCsv
				.split("\n")
				.map((row) => (row.startsWith('"') ? row.slice(1, row.indexOf('",')) : row.split(",")[0])),
		);
		for (const text of [
			"Return / Exchange",
			"Items on receipt",
			"returnable until {0}",
			"This item isn't on this receipt",
			"returned {0} on {1}",
			"RETURN",
			"Returned",
			"New items",
			"Customer pays",
			"Credit note issued",
			"Even exchange",
			"Pay {0}",
			"Submit exchange",
			"Submit exchange & Print",
			"Submit this exchange?",
			"Submit this return?",
			"Discard? Nothing saved.",
			"Add a return from this receipt?",
			"Exchange credit",
			"This receipt was cancelled",
			"This is a return receipt, not a sale",
			"Return period ended on {0}",
			"Used in exchange {0}",
			"One-screen exchange",
			"Price and discount from the receipt",
			"Invoice discount on the receipt: -{0} (included in Returned)",
			"Checking…",
			"Saving…",
		]) {
			expect(keys.has(text), text).toBe(true);
		}
	});
});
