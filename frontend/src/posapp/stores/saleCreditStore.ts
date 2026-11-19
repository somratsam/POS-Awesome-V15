// A credit note voucher used from the main screen (section 108).
//
// Staff scan (or type) the voucher in the normal scan box: the POS checks it
// on the server (lookup_credit_voucher), switches the sale to the voucher's
// customer and locks it (Customer.vue), and keeps the voucher in the
// customers store -- the same place the payment screen keeps the vouchers
// scanned there, and re-applies them every time it opens.
//
// Under the cart: "Credit note −X" and the main button "Pay Y". These are
// exactly the payment screen's figures: the sale's total from the server
// (quote_sale_total, 0.4 s after the cart's last change, only while a voucher
// is on the sale) and the customer's credit rows, picked and allocated by the
// payment screen's own code (creditRowsToApply, allocateCredit).

import { defineStore, getActivePinia } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { useCustomersStore } from "./customersStore";
import { useUIStore } from "./uiStore";
import { useToastStore } from "./toastStore";
import { useEmployeeStore } from "./employeeStore";
import { peekExchangeStore } from "./exchangeStore";
import { useInvoiceStore } from "./invoiceStore";
import { isOffline } from "../../offline/index";
import { callWithoutDialog, voucherErrorToast } from "../utils/voucherMessages";
import { allocateCredit, creditRowsToApply } from "../composables/pos/payments/useRedemptionLogic";
import { useFormat } from "../format";

declare const frappe: any;
declare const __: (text: string, args?: any[]) => string;

const t = (text: string, args?: any[]) =>
	typeof __ === "function" ? __(text, args) : text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[i] ?? ""));

const LOOKUP = "posawesome.posawesome.api.credit_voucher.lookup_credit_voucher";
const QUOTE = "posawesome.posawesome.api.sale_credit_quote.quote_sale_credit";

export interface SaleCreditQuote {
	key: string;
	total: number;
	message: any;
}

/** "lookup failed / refused" vs "not a voucher at all" (item search goes on). */
export type VoucherScanResult = "applied" | "refused" | "not_voucher";

export const useSaleCreditStore = defineStore("saleCredit", () => {
	const quote = ref<SaleCreditQuote | null>(null);
	const checking = ref(false);
	const applying = ref(false);
	/** The customer-change question ("Use credit note X? The customer changes to Y."). */
	const prompt = ref<{ voucher: any; currentCustomer: string } | null>(null);
	let resolvePrompt: ((value: boolean) => void) | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let seq = 0;
	let pending: Promise<void> | null = null;
	// The cart's sale (registered by Invoice.vue) and what decides its total.
	// Reactive, so the figures follow a provider registered after them.
	const saleProvider = shallowRef<(() => any) | null>(null);
	const signatureProvider = shallowRef<(() => string) | null>(null);

	const customers = () => useCustomersStore();

	/** Vouchers scanned for the sale's customer. */
	const vouchers = computed<any[]>(() => {
		const store = customers();
		const customer = store.selectedCustomer;
		return Object.values(store.creditVouchers || {}).filter((voucher: any) => voucher?.customer === customer);
	});
	const active = computed(() => vouchers.value.length > 0 && !peekExchangeStore()?.active);

	// The payment screen's own precision and rounding (Payments.vue passes
	// useFormat's currency_precision and flt to useRedemptionLogic).
	const precision = () => Number(useFormat().currency_precision.value);
	const normalize = (value: any) => {
		const { flt } = useFormat();
		return Number(flt(value, precision())) || 0;
	};

	const currentKey = () =>
		JSON.stringify({
			cart: signatureProvider.value ? signatureProvider.value() : "",
			vouchers: vouchers.value.map((voucher: any) => voucher.credit_origin).sort(),
		});

	/**
	 * The figures under the cart, or null while they are being checked.
	 * {credit, pay, total}: credit the payment screen will apply, what the
	 * customer then pays, the sale's total (0 with no new items yet).
	 */
	const figures = computed(() => {
		if (!active.value || !quote.value || quote.value.key !== currentKey()) return null;
		const store = customers();
		const customer = store.selectedCustomer;
		const employee = useEmployeeStore();
		const picked = creditRowsToApply(quote.value.message, customer, {
			shift: useUIStore().posOpeningShift?.name || null,
			supervisor: Boolean((employee as any).currentCashier?.is_supervisor),
			vouchers: store.creditVouchers || {},
		});
		const total = normalize(quote.value.total);
		const used = allocateCredit(picked.rows, total, precision(), normalize);
		const credit = normalize(used.reduce((sum, value) => sum + value, 0));
		return { credit, pay: normalize(Math.max(total - credit, 0)), total };
	});

	const setProviders = (sale: (() => any) | null, signature: (() => string) | null) => {
		saleProvider.value = sale;
		signatureProvider.value = signature;
		return () => {
			if (saleProvider.value === sale) saleProvider.value = null;
			if (signatureProvider.value === signature) signatureProvider.value = null;
		};
	};

	const fetchQuote = async (mySeq: number) => {
		const key = currentKey();
		const sale = saleProvider.value ? saleProvider.value() : null;
		const customer = customers().selectedCustomer;
		const ui = useUIStore();
		const invoice = sale || {
			doctype: "Sales Invoice",
			customer,
			pos_profile: ui.posProfile?.name,
			company: ui.posProfile?.company,
			items: [],
		};
		invoice.customer = invoice.customer || customer;
		invoice.pos_profile = invoice.pos_profile || ui.posProfile?.name;
		const message: any = await callWithoutDialog(QUOTE, { invoice });
		if (mySeq === seq) quote.value = { key, total: Number(message?.total) || 0, message: message?.credit };
	};

	/**
	 * Check the cart on the server 0.4 s after its last change (each change
	 * restarts the wait); nothing when no voucher is on the sale or the
	 * figures already match the cart.
	 */
	const refresh = (delay = 400) => {
		if (timer) clearTimeout(timer);
		timer = null;
		if (!active.value || isOffline()) {
			if (!active.value) quote.value = null;
			return;
		}
		if (quote.value && quote.value.key === currentKey()) return;
		const mySeq = ++seq;
		checking.value = true;
		pending = new Promise<void>((resolve) => {
			timer = setTimeout(async () => {
				timer = null;
				try {
					await fetchQuote(mySeq);
				} catch (error: any) {
					console.warn("Credit note check failed", error);
				} finally {
					if (mySeq === seq) checking.value = false;
					resolve();
				}
			}, delay);
		});
	};

	/** Pay waits for a check that is under way (the button shows "Checking…"). */
	const settle = async () => {
		if (!active.value) return;
		if (quote.value && quote.value.key === currentKey()) return;
		if (!pending || !checking.value) refresh(0);
		await pending;
	};

	const ask = (voucher: any, currentCustomer: string) =>
		new Promise<boolean>((resolve) => {
			resolvePrompt?.(false);
			resolvePrompt = resolve;
			prompt.value = { voucher, currentCustomer };
		});
	const settlePrompt = (value: boolean) => {
		const resolve = resolvePrompt;
		resolvePrompt = null;
		prompt.value = null;
		resolve?.(Boolean(value));
	};

	const refuse = (message: string): VoucherScanResult => {
		useToastStore().show(voucherErrorToast(message));
		if (typeof frappe !== "undefined") frappe?.utils?.play_sound?.("error");
		return "refused";
	};

	/**
	 * A voucher-shaped code from the main screen's scan box. "not_voucher":
	 * the server knows no such voucher -- the caller looks the code up as an
	 * item instead.
	 */
	const applyFromScan = async (code: string): Promise<VoucherScanResult> => {
		if (applying.value) return "refused";
		const exchange = peekExchangeStore();
		if (exchange?.active || exchange?.receipt) {
			return refuse(t("An exchange is paid with its own return's credit only."));
		}
		const invoiceStore = useInvoiceStore();
		if (invoiceStore.invoiceDoc?.is_return) {
			return refuse(t("Finish or clear the return in the cart first."));
		}
		if (isOffline()) return refuse(t("Store credit can only be used while the POS is online."));
		const ui = useUIStore();
		applying.value = true;
		let voucher: any;
		try {
			voucher = await callWithoutDialog(LOOKUP, { code, pos_profile: ui.posProfile?.name, quiet_miss: 1 });
		} catch (error: any) {
			// Used, expired, another company, too many wrong numbers...
			applying.value = false;
			return refuse(error?.message || t("This voucher can't be used."));
		}
		try {
			if (!voucher?.credit_origin) return "not_voucher";
			const store = customers();
			if (store.creditVouchers?.[voucher.credit_origin]) {
				return refuse(t("Credit note {0} is already on this sale.", [voucher.voucher]));
			}
			const current = store.selectedCustomer || "";
			if (current !== voucher.customer) {
				// Credit of another customer is already on this sale: the
				// customer stays, as in an exchange.
				if (current && store.creditOnSaleFor(current)) {
					const name = invoiceStore.invoiceDoc?.customer_name || current;
					return refuse(
						t(
							"This sale is paid with {0}'s credit — the customer stays {0}. Switch off Use Customer Balance to change it.",
							[name],
						),
					);
				}
				const isDefault = !current || current === ui.posProfile?.customer;
				if (!isDefault && !(await ask(voucher, invoiceStore.invoiceDoc?.customer_name || current))) {
					return "refused";
				}
				store.setSelectedCustomer(voucher.customer);
			}
			if (voucher.bearer) store.markSharedCustomer(voucher.customer);
			store.addCreditVoucher(voucher);
			refresh(0);
			return "applied";
		} finally {
			applying.value = false;
		}
	};

	/** [Remove]: every voucher off the sale, the customer unlocked. */
	const remove = () => {
		const store = customers();
		store.dropCreditVouchers();
		store.setCreditOn(store.selectedCustomer, false);
		quote.value = null;
		if (timer) clearTimeout(timer);
		timer = null;
		checking.value = false;
		seq += 1;
	};

	const reset = () => {
		quote.value = null;
		if (timer) clearTimeout(timer);
		timer = null;
		checking.value = false;
		seq += 1;
	};

	return {
		quote,
		checking,
		applying,
		prompt,
		vouchers,
		active,
		figures,
		setProviders,
		refresh,
		settle,
		settlePrompt,
		applyFromScan,
		remove,
		reset,
	};
});

/** The store, or null when no Pinia is active (bare unit tests). */
export function peekSaleCreditStore() {
	return getActivePinia() ? useSaleCreditStore() : null;
}
