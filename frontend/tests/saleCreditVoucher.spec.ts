// @vitest-environment jsdom
// Section 108: a credit note voucher used from the main screen, and every
// one-screen exchange case going through the payment screen.
//  - scan routing: item / receipt / voucher / misread voucher -> item;
//  - used / expired / another company's voucher refused, cart unchanged;
//  - voucher + exchange refused; offline refused; the same voucher twice;
//  - customer switched and locked, [Remove] unlocks it;
//  - "Credit note −X / Pay Y" = the payment screen's own calculation;
//  - Continue opens the payment screen (return only: its review).

import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const toastShow = vi.fn();
let offline = false;
const ui: any = reactive({
	posProfile: {
		name: "Test Pos",
		company: "Swan",
		currency: "OMR",
		customer: "Walk-in",
		posa_decimal_precision: 3,
		posa_one_screen_exchange: 1,
	},
	posOpeningShift: { name: "SHIFT-1" },
	openPaymentDialog: vi.fn(),
	closePaymentDialog: vi.fn(),
	setActiveView: vi.fn(),
});
const employee: any = reactive({ currentCashier: { user: "cashier@x", is_supervisor: 0 } });
const invoice: any = reactive({ items: [] as any[], invoiceDoc: null as any });

vi.mock("../src/offline/index", () => ({
	db: { isOpen: () => true, open: vi.fn(async () => undefined), table: vi.fn() },
	checkDbHealth: vi.fn(async () => undefined),
	setCustomerStorage: vi.fn(async () => undefined),
	saveStoredValueSnapshot: vi.fn(),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => offline),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));
vi.mock("../src/posapp/utils/voucherMessages", () => ({
	callWithoutDialog: (...args: any[]) => call(...args),
	voucherErrorToast: (title: string) => ({ title, color: "red-darken-3" }),
}));
vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ui }));
vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: toastShow }) }));
vi.mock("../src/posapp/stores/employeeStore", () => ({ useEmployeeStore: () => employee }));
vi.mock("../src/posapp/stores/invoiceStore", () => ({ useInvoiceStore: () => invoice }));
vi.mock("../src/posapp/composables/pos/payments/usePaymentPrinting", () => ({
	usePaymentPrinting: () => ({ loadPrintPage: vi.fn() }),
}));

import { useCustomersStore } from "../src/posapp/stores/customersStore";
import { useSaleCreditStore } from "../src/posapp/stores/saleCreditStore";
import { useExchangeStore } from "../src/posapp/stores/exchangeStore";
import {
	dispatchVoucherScan,
	looksLikeVoucher,
	resetVoucherScanRoute,
} from "../src/posapp/composables/pos/items/voucherScanRoute";
import { dispatchExchangeScan, resetExchangeScanRoute } from "../src/posapp/composables/pos/items/exchangeScanRoute";
import { looksLikeReceipt } from "../src/posapp/utils/oneScreenExchange";
import { allocateCredit, creditRowsToApply } from "../src/posapp/composables/pos/payments/useRedemptionLogic";
import { runExchangeMainAction } from "../src/posapp/components/pos/invoice_utils/exchange";

import scannerSource from "../src/posapp/composables/pos/items/useScannerInput.ts?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import customerSource from "../src/posapp/components/pos/customer/Customer.vue?raw";
import summarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import buttonsSource from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue?raw";
import dialogsSource from "../src/posapp/components/pos/invoice_utils/dialogs.ts?raw";
import actionsSource from "../src/posapp/components/pos/invoice_utils/actions.ts?raw";
import invoiceVueSource from "../src/posapp/components/pos/Invoice.vue?raw";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import redemptionSource from "../src/posapp/composables/pos/payments/useRedemptionLogic.ts?raw";
import reviewSource from "../src/posapp/components/pos/payments/ExchangeReturnReview.vue?raw";
import selectionFieldsSource from "../src/posapp/components/pos/payments/PaymentSelectionFields.vue?raw";
import arCsv from "../../posawesome/translations/ar.csv?raw";

const t = (text: string, args?: any[]) => text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));
(globalThis as any).__ = t;
(globalThis as any).flt = (value: any, precision = 3) => {
	const factor = Math.pow(10, precision);
	return Math.round((Number(value) || 0) * factor) / factor;
};

const VOUCHER = {
	voucher: "C26-MCO-00001-K7Q4",
	code: "C26MCO00001K7Q4",
	credit_origin: "MCO-CN-2026-00001",
	customer: "CUST-AHMED",
	customer_name: "Ahmed",
	amount: 12.5,
	expires_on: "2027-05-01",
	bearer: 0,
};
const CREDIT_ROW = {
	type: "Invoice",
	credit_origin: "MCO-CN-2026-00001",
	total_credit: 12.5,
	expires_on: "2027-05-01",
	pos_opening_shift: "OLD-SHIFT",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	setActivePinia(createPinia());
	call.mockReset();
	toastShow.mockReset();
	offline = false;
	invoice.items = [];
	invoice.invoiceDoc = null;
	ui.openPaymentDialog.mockReset();
	ui.setActiveView.mockReset();
	employee.currentCashier = { user: "cashier@x", is_supervisor: 0 };
	resetVoucherScanRoute();
	resetExchangeScanRoute();
	(globalThis as any).frappe = { utils: { play_sound: vi.fn() }, defaults: { get_default: () => 3 } };
	useCustomersStore().setSelectedCustomer("Walk-in");
});

afterEach(() => {
	useSaleCreditStore().reset();
	useExchangeStore().reset();
});

describe("scan routing: item / receipt / voucher", () => {
	it("tells a voucher, a receipt and an item barcode apart", () => {
		for (const voucher of ["C26MCO00001K7Q4", "C26-MCO-00001-K7Q4", "c26-mco-00001-k7q4", "C2600247K7Q4", "C26-00247-ENV2"]) {
			expect(looksLikeVoucher(voucher), voucher).toBe(true);
			expect(looksLikeReceipt(voucher), voucher).toBe(false);
		}
		for (const receipt of ["MCO-2026-00010", "2026-00210", "ACC-SINV-2026-00399", "MCO-CN-2026-00001"]) {
			expect(looksLikeVoucher(receipt), receipt).toBe(false);
			expect(looksLikeReceipt(receipt), receipt).toBe(true);
		}
		// Item barcodes are digits only; a store called "C" can't fake a voucher
		// (0 and 1 are not check characters).
		for (const item of ["6291234567890", "45240197030024", "4524019703", "jersey", "C-2026-00010", "C26MCO00001K0Q1", ""]) {
			expect(looksLikeVoucher(item), item).toBe(false);
		}
	});

	it("an item barcode never reaches the voucher lookup", () => {
		expect(dispatchVoucherScan("6291234567890", vi.fn())).toBe(false);
		expect(call).not.toHaveBeenCalled();
	});

	it("a receipt goes to the exchange, not the voucher route", async () => {
		call.mockResolvedValueOnce({ found: 0 });
		expect(dispatchExchangeScan("MCO-2026-00010", vi.fn())).toBe(true);
		expect(dispatchVoucherScan("MCO-2026-00010", vi.fn())).toBe(false);
		await flush();
		expect(call.mock.calls[0][0]).toMatch(/get_exchange_receipt$/);
	});

	it("a voucher is looked up quietly (a miss is not an error yet)", async () => {
		call.mockResolvedValueOnce(VOUCHER);
		expect(dispatchVoucherScan("C26-MCO-00001-K7Q4", vi.fn())).toBe(true);
		await vi.waitFor(() => expect(call).toHaveBeenCalled());
		expect(call.mock.calls[0][0]).toMatch(/credit_voucher\.lookup_credit_voucher$/);
		expect(call.mock.calls[0][1]).toMatchObject({ code: "C26-MCO-00001-K7Q4", pos_profile: "Test Pos", quiet_miss: 1 });
	});

	it("a misread voucher falls back to the item search, once", async () => {
		call.mockResolvedValueOnce({ found: 0 });
		const rescan = vi.fn((code: string) => dispatchVoucherScan(code, rescan));
		expect(dispatchVoucherScan("C26MCO00001K7Q5", rescan)).toBe(true);
		await vi.waitFor(() => expect(rescan).toHaveBeenCalledWith("C26MCO00001K7Q5"));
		// Second time through: not taken as a voucher -> the item search runs.
		expect(rescan.mock.results[0].value).toBe(false);
		expect(call).toHaveBeenCalledTimes(1);
		expect(toastShow).not.toHaveBeenCalled();
		expect(useCustomersStore().selectedCustomer).toBe("Walk-in");
	});

	it("order in the scanner: stock lookup, receipt, voucher, then the item pipeline", () => {
		const handler = scannerSource.slice(scannerSource.indexOf("const onBarcodeScanned = ("));
		const stock = handler.indexOf("dispatchStockLookupScan(normalizedCode)");
		const receipt = handler.indexOf("dispatchExchangeScan(normalizedCode");
		const voucher = handler.indexOf("dispatchVoucherScan(normalizedCode");
		const items = handler.indexOf("const runScanPipeline");
		expect(stock).toBeGreaterThan(-1);
		expect(receipt).toBeGreaterThan(stock);
		expect(voucher).toBeGreaterThan(receipt);
		expect(items).toBeGreaterThan(voucher);
	});

	it("typed vouchers work in both search boxes, after the receipt check", () => {
		const enter = selectorSource.slice(selectorSource.indexOf("const onEnter = (e) => {"));
		expect(enter.indexOf("looksLikeVoucher(typed)")).toBeGreaterThan(enter.indexOf("looksLikeReceipt(typed)"));
		expect(enter).toContain('if (result === "not_voucher") itemsSelectorSearch.onEnter(e);');
		const counter = posSource.slice(posSource.indexOf("const openCounterItemSearch"));
		expect(counter.indexOf("looksLikeVoucher(normalizedQuery)")).toBeGreaterThan(
			counter.indexOf("exchangeStore.openReceipt(normalizedQuery)"),
		);
		expect(posSource).toContain("<SaleCreditHost />");
	});
});

describe("using a voucher from the main screen", () => {
	const scan = (code = "C26-MCO-00001-K7Q4") => useSaleCreditStore().applyFromScan(code);

	it("walk-in sale: the voucher's customer is selected and locked, the voucher is on the sale", async () => {
		call.mockResolvedValueOnce(VOUCHER);
		expect(await scan()).toBe("applied");
		const customers = useCustomersStore();
		expect(customers.selectedCustomer).toBe("CUST-AHMED");
		expect(customers.creditVouchers["MCO-CN-2026-00001"]).toMatchObject({ amount: 12.5 });
		expect(customers.creditOnSaleFor("CUST-AHMED")).toMatchObject({ vouchers: ["C26-MCO-00001-K7Q4"] });
		expect(useSaleCreditStore().active).toBe(true);
	});

	it("an Anonymous (bearer) voucher selects Anonymous and marks it shared", async () => {
		call.mockResolvedValueOnce({ ...VOUCHER, customer: "Anonymous", customer_name: "Anonymous", bearer: 1 });
		expect(await scan()).toBe("applied");
		const customers = useCustomersStore();
		expect(customers.selectedCustomer).toBe("Anonymous");
		expect(customers.isSharedCustomer("Anonymous")).toBe(true);
		expect(customers.hasBearerVoucherFor("Anonymous")).toBe(true);
	});

	it("[Remove] takes the voucher off and unlocks the customer", async () => {
		call.mockResolvedValueOnce(VOUCHER);
		await scan();
		const customers = useCustomersStore();
		useSaleCreditStore().remove();
		expect(customers.creditVouchers).toEqual({});
		expect(customers.creditOnSaleFor("CUST-AHMED")).toBeNull();
		expect(useSaleCreditStore().active).toBe(false);
		// The lock note and the Walk-in button follow creditOnSaleFor / the vouchers.
		expect(customerSource).toContain('data-testid="sale-credit-remove"');
		expect(customerSource).toContain("const removeSaleCredit = () => saleCredit.remove();");
		expect(customerSource).toContain("Paying with credit note {0} ({1}) — the customer stays {2}.");
	});

	for (const [label, message] of [
		["used", "Voucher C26-MCO-00001-K7Q4 has already been used."],
		["expired", "Voucher C26-MCO-00001-K7Q4 expired on 01-11-2026 and can't be used."],
		["another company's", "Voucher C26-MCO-00001-K7Q4 belongs to another company."],
		["blocked after wrong numbers", "Too many wrong voucher numbers on this till. Wait 15 minutes, or switch the till to a POS supervisor with their PIN and try again."],
	]) {
		it(`a ${label} voucher is refused with the server's reason; nothing changes`, async () => {
			call.mockRejectedValueOnce(new Error(message));
			const rescan = vi.fn();
			expect(dispatchVoucherScan("C26-MCO-00001-K7Q4", rescan)).toBe(true);
			await vi.waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: message })));
			expect(rescan).not.toHaveBeenCalled();
			expect(useCustomersStore().selectedCustomer).toBe("Walk-in");
			expect(useCustomersStore().creditVouchers).toEqual({});
		});
	}

	it("refused during an exchange: an exchange is paid with its own return's credit only", async () => {
		const exchange = useExchangeStore();
		exchange.receipt = { found: 1, name: "MCO-2026-00008", customer: "X", lines: [] } as any;
		expect(await scan()).toBe("refused");
		expect(call).not.toHaveBeenCalled();
		expect(toastShow.mock.calls[0][0].title).toBe("An exchange is paid with its own return's credit only.");
	});

	it("refused offline, with no server call", async () => {
		offline = true;
		expect(await scan()).toBe("refused");
		expect(call).not.toHaveBeenCalled();
		expect(toastShow.mock.calls[0][0].title).toBe("Store credit can only be used while the POS is online.");
	});

	it("refused on a return in the cart", async () => {
		invoice.invoiceDoc = { is_return: 1 };
		expect(await scan()).toBe("refused");
		expect(call).not.toHaveBeenCalled();
	});

	it("the same voucher twice is refused", async () => {
		call.mockResolvedValue(VOUCHER);
		await scan();
		expect(await scan()).toBe("refused");
		expect(toastShow.mock.calls.at(-1)[0].title).toBe("Credit note C26-MCO-00001-K7Q4 is already on this sale.");
	});

	it("another named customer on the sale: asked first; Cancel changes nothing", async () => {
		useCustomersStore().setSelectedCustomer("CUST-OTHER");
		call.mockResolvedValueOnce(VOUCHER);
		const store = useSaleCreditStore();
		const running = store.applyFromScan("C26-MCO-00001-K7Q4");
		await vi.waitFor(() => expect(store.prompt).not.toBeNull());
		expect(store.prompt?.voucher.voucher).toBe("C26-MCO-00001-K7Q4");
		store.settlePrompt(false);
		expect(await running).toBe("refused");
		expect(useCustomersStore().selectedCustomer).toBe("CUST-OTHER");
		expect(useCustomersStore().creditVouchers).toEqual({});
	});

	it("another named customer: Use credit note switches and locks", async () => {
		useCustomersStore().setSelectedCustomer("CUST-OTHER");
		call.mockResolvedValueOnce(VOUCHER);
		const store = useSaleCreditStore();
		const running = store.applyFromScan("C26-MCO-00001-K7Q4");
		await vi.waitFor(() => expect(store.prompt).not.toBeNull());
		store.settlePrompt(true);
		expect(await running).toBe("applied");
		expect(useCustomersStore().selectedCustomer).toBe("CUST-AHMED");
	});

	it("another customer's credit already on the sale: refused, the customer stays", async () => {
		call.mockResolvedValueOnce(VOUCHER);
		await useSaleCreditStore().applyFromScan("C26-MCO-00001-K7Q4");
		call.mockResolvedValueOnce({ ...VOUCHER, credit_origin: "MCO-CN-2026-00002", voucher: "C26-MCO-00002-AAAA", customer: "CUST-B" });
		expect(await useSaleCreditStore().applyFromScan("C26-MCO-00002-AAAA")).toBe("refused");
		expect(useCustomersStore().selectedCustomer).toBe("CUST-AHMED");
	});

	it("Cancel Sale and Save & Clear drop every voucher", () => {
		const cancel = actionsSource.slice(actionsSource.indexOf("A cancelled sale drops"));
		expect(cancel.slice(0, 300)).toContain("peekSaleCreditStore()?.remove();");
		const hold = actionsSource.slice(actionsSource.indexOf("A parked sale doesn't keep"));
		expect(hold.slice(0, 300)).toContain("peekSaleCreditStore()?.remove();");
	});
});

describe("Credit note −X / Pay Y: the payment screen's own figures", () => {
	const quoted = async (total: number, rows: any[], options: { generic?: boolean } = {}) => {
		call.mockResolvedValueOnce(VOUCHER);
		const store = useSaleCreditStore();
		await store.applyFromScan("C26-MCO-00001-K7Q4");
		const sale = { customer: "CUST-AHMED", pos_profile: "Test Pos", items: [{ item_code: "A", qty: 1 }] };
		store.setProviders(() => sale, () => "cart-1");
		call.mockResolvedValueOnce({ total, credit: { credit: rows, expired: [], generic_customer: options.generic ? 1 : 0 } });
		store.refresh(0);
		await vi.waitFor(() => expect(store.figures).not.toBeNull());
		return store;
	};

	it("checks the cart's total on the server, never the till's own figure", async () => {
		const store = await quoted(20, [CREDIT_ROW]);
		const quote = call.mock.calls.find(([method]) => method.endsWith("quote_sale_credit"));
		expect(quote[1].invoice.items).toEqual([{ item_code: "A", qty: 1 }]);
		expect(store.figures).toEqual({ credit: 12.5, pay: 7.5, total: 20 });
	});

	it("credit worth more than the sale: used up to the sale, nothing to pay", async () => {
		const store = await quoted(8.25, [CREDIT_ROW]);
		expect(store.figures).toEqual({ credit: 8.25, pay: 0, total: 8.25 });
	});

	it("also counts the customer's same-shift credit, as the payment screen does", async () => {
		const sameShift = { ...CREDIT_ROW, credit_origin: "MCO-CN-2026-00009", total_credit: 3, pos_opening_shift: "SHIFT-1" };
		const otherShift = { ...CREDIT_ROW, credit_origin: "MCO-CN-2026-00010", total_credit: 50, pos_opening_shift: "OLD" };
		const store = await quoted(20, [CREDIT_ROW, sameShift, otherShift]);
		expect(store.figures).toEqual({ credit: 15.5, pay: 4.5, total: 20 });
		// Exactly the payment screen's selection and allocation:
		const picked = creditRowsToApply({ credit: [CREDIT_ROW, sameShift, otherShift] }, "CUST-AHMED", {
			shift: "SHIFT-1",
			vouchers: useCustomersStore().creditVouchers,
		});
		const used = allocateCredit(picked.rows, 20, 3, (v) => Number(v));
		expect(used.reduce((a, b) => a + b, 0)).toBe(15.5);
	});

	it("a cart change is checked again 0.4 s after the last change: one call", async () => {
		const store = await quoted(20, [CREDIT_ROW]);
		vi.useFakeTimers();
		try {
			call.mockClear();
			// The cart is reactive in the till (Invoice.vue), so the figures
			// follow it: "Checking…" as soon as it changes.
			const cart = reactive({ key: 1 });
			store.setProviders(
				() => ({ customer: "CUST-AHMED", items: [{ item_code: "A", qty: cart.key }] }),
				() => `cart-${cart.key}`,
			);
			call.mockResolvedValue({ total: 40, credit: { credit: [CREDIT_ROW] } });
			for (let i = 2; i < 6; i++) {
				cart.key = i;
				store.refresh(400);
				await vi.advanceTimersByTimeAsync(150);
			}
			expect(store.figures).toBeNull(); // "Checking…" until it is in
			await vi.advanceTimersByTimeAsync(400);
			expect(call).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
		await vi.waitFor(() => expect(store.figures).toEqual({ credit: 12.5, pay: 27.5, total: 40 }));
	});

	it("the payment screen and the main screen share the selection and the allocation", () => {
		expect(redemptionSource).toContain("const picked = creditRowsToApply(message, customer, {");
		expect(redemptionSource).toContain("computed_credit_to_redeem = allocateCredit(rows, maxRedeemable, prec,");
		expect(paymentsSource).toContain("formatFloat: (val, prec) => flt(val, prec)");
	});

	it("wiring: summary line, Pay label, Pay waits, background check from Invoice.vue", () => {
		expect((summarySource.match(/:credit-active="saleCredit.active"/g) || []).length).toBe(2);
		expect((summarySource.match(/:credit-pay-label="saleCreditLabels.pay"/g) || []).length).toBe(2);
		expect(summarySource).toContain('data-testid="sale-credit-line"');
		expect(summarySource).toContain('data-testid="sale-credit-metric"');
		expect(buttonsSource).toContain("creditActive: Boolean,");
		const show = dialogsSource.slice(dialogsSource.indexOf("export async function show_payment"));
		expect(show.indexOf("await saleCredit.settle()")).toBeGreaterThan(-1);
		expect(show.indexOf("await saleCredit.settle()")).toBeLessThan(show.indexOf("context._paymentInFlight = true"));
		expect(invoiceVueSource).toContain("saleCredit.refresh(400)");
		expect(invoiceVueSource).toContain("this._unregisterSaleCredit?.()");
	});

	it("the payment screen says when the voucher was used on another till meanwhile", () => {
		expect(paymentsSource).toContain("onCreditRows: (rows) => notifyChangedVoucherBalances(rows),");
		expect(paymentsSource).toContain("Credit note {0} now has {1} left — part of it was used on another till.");
	});
});

describe("A: every exchange case goes through the payment screen", () => {
	const ready = async () => {
		const store = useExchangeStore();
		call.mockResolvedValueOnce({
			found: 1,
			name: "MCO-2026-00008",
			customer: "test loyalty",
			customer_name: "test loyalty",
			lines: [{ name: "L1", item_code: "A", sold: 1, returned: 0, left: 1, rate: 80.85 }],
		});
		await store.openReceipt("MCO-2026-00008");
		store.closePicker({ L1: 1 });
		call.mockReset();
		return store;
	};

	it("new items (pays more, credit left, even): Pay waits for the server's figures, then Payments opens as for a sale", async () => {
		await ready();
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: 109.5, pay: 28.65, credit_left: 0 });
		expect(await runExchangeMainAction({ items: [{ item_code: "N" }] })).toBe(false);
		expect(call.mock.calls.map(([m]) => m.split(".").pop())).toEqual(["quote_exchange"]);
	});

	it("a failed check stops Pay with the reason (nothing opens)", async () => {
		await ready();
		call.mockRejectedValueOnce(new Error("Server down"));
		expect(await runExchangeMainAction({ items: [{ item_code: "N" }] })).toBe(true);
		expect(toastShow.mock.calls.at(-1)[0].title).toBe("Server down");
	});

	it("return only: the payment screen's review opens; nothing is saved or asked", async () => {
		const store = await ready();
		const emit = vi.fn();
		call.mockResolvedValueOnce({ returned: 80.85, sale_total: null, pay: null, credit_left: 80.85 });
		expect(await runExchangeMainAction({ items: [], uiStore: ui, eventBus: { emit } })).toBe(true);
		expect(store.reviewingReturn).toBe(true);
		expect(store.prompt).toBeNull();
		// Only the read-only check; nothing is saved before Submit.
		expect(call.mock.calls.map(([m]) => m.split(".").pop())).toEqual(["quote_exchange"]);
		expect(emit).toHaveBeenCalledWith("show_payment", "true");
	});

	it("the review: one button, credit note voucher always prints, Sales Person locked", () => {
		expect(reviewSource).toContain('__("Submit return & Print voucher")');
		expect(reviewSource).not.toContain('__("Submit return")');
		expect(reviewSource).toContain("readonly");
		const submit = paymentsSource.slice(paymentsSource.indexOf("const submitReturnReview = async"));
		expect(submit.slice(0, 400)).toMatch(/sale: null,\s*print: true,\s*expectKinds: \["return"\]/);
		const wrapper = paymentsSource.slice(paymentsSource.indexOf("const submitInvoiceWrapper"));
		expect(wrapper.indexOf("returnReviewMode.value")).toBeLessThan(wrapper.indexOf("exchangeMode.value"));
	});

	it("credit left / even: Cash and Card greyed out, nothing to pay", () => {
		expect(paymentsSource).toContain(':inert="exchangeNothingDue || undefined"');
		expect(paymentsSource).toContain('expectKinds: ["pays", "credit", "even"]');
		expect(paymentsSource).toContain("Credit note issued {0} — the BALANCE voucher prints.");
	});

	it("Sales Person: the field is the new sale's, the return's shows under it", () => {
		expect(paymentsSource).toContain(`:return-credited-to="exchangeMode ? exchangeReturnSalesPerson : ''"`);
		expect(selectionFieldsSource).toContain('data-testid="sales-person-return-credited-to"');
	});

	it("an offline exchange is refused before anything opens", async () => {
		await ready();
		offline = true;
		expect(await runExchangeMainAction({ items: [] })).toBe(true);
		expect(useExchangeStore().reviewingReturn).toBe(false);
	});
});

describe("Arabic", () => {
	it("every new string has Arabic", () => {
		const keys = new Set(
			arCsv.split("\n").map((row) => (row.startsWith('"') ? row.slice(1, row.indexOf('",')) : row.split(",")[0])),
		);
		for (const text of [
			"Continue",
			"Paying with credit note {0} ({1}) — the customer stays {2}.",
			"Remove",
			"Credit note",
			"To pay",
			"Credit note {0} — scan the new items",
			"Credit note {0} is already on this sale.",
			"An exchange is paid with its own return's credit only.",
			"Credit note {0} now has {1} left — part of it was used on another till.",
			"Nothing to pay",
			"Even exchange — nothing to pay",
			"Credit note issued {0} — the BALANCE voucher prints.",
			"Return credited to: {0}",
			"{0} (no Sales Person)",
			"the cashier",
			"Return",
			"Returning from {0}",
			"For {0} — the credit note voucher prints.",
			"Submit return & Print voucher",
			"A return keeps the original sale's Sales Person.",
			"The original sale has no Sales Person: the return goes to the cashier doing it.",
			"The original sale has no Sales Person, and the cashier has none linked.",
			"Too many wrong voucher numbers on this till. Wait 15 minutes, or switch the till to a POS supervisor with their PIN and try again.",
			"This credit note was just used on another till. Open Payments again to see what is left on it.",
			"A credit note pays for a sale, not a return.",
		]) {
			expect(keys.has(text), text).toBe(true);
		}
	});
});
