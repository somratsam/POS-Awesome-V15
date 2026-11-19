// One-screen Return / Exchange: the receipt being returned and its ticked
// lines (the RETURN lines of the cart). The new items stay ordinary cart
// lines in invoiceStore; the two become one return + one sale only on the
// server (one_screen_exchange.submit_exchange), together or not at all.
//
// Questions ("Add a return from this receipt?", "Discard?") are asked
// through `prompt` and shown by ExchangeHost.vue. Submitting has no
// confirmation: every case goes through the payment screen (section 108).

import { defineStore, getActivePinia } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { useUIStore } from "./uiStore";
import { useToastStore } from "./toastStore";
import { useCustomersStore } from "./customersStore";
import { useInvoiceStore } from "./invoiceStore";
import { isOffline } from "../../offline/index";
import { callWithoutDialog } from "../utils/voucherMessages";
import {
	estimateReturned,
	isOneScreenExchangeOn,
	looksLikeReceipt,
	pickedCount,
	pickedQty,
	returnRequestItems,
	setPick,
	type ExchangeLine,
	type ExchangeReceipt,
	type Picks,
} from "../utils/oneScreenExchange";

declare const __: (text: string, args?: any[]) => string;

const API = "posawesome.posawesome.api.one_screen_exchange";
const QUOTE_TIMEOUT_MS = 15000;
const t = (text: string, args?: any[]) =>
	typeof __ === "function" ? __(text, args) : text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[i] ?? ""));

export type ExchangePromptType = "add_return" | "discard";

export interface ExchangePrompt {
	type: ExchangePromptType;
	data: Record<string, any>;
}

/** The server's figures for one exact cart (quote_exchange). */
export interface ExchangeQuote {
	key: string;
	returned: number;
	sale_total: number | null;
	pay: number | null;
	credit_left: number;
	/** The return's Sales Person as the server will save it (sales_credit). */
	return_sales_person?: { sales_person: string; source: string; cashier_name: string } | null;
}

/** What decides the server's figures for a sale -- nothing volatile. */
export function saleSignature(sale: any): any {
	if (!sale) return null;
	return {
		customer: sale.customer || null,
		items: (Array.isArray(sale.items) ? sale.items : []).map((item: any) => [
			item.item_code,
			Number(item.qty) || 0,
			Number(item.rate) || 0,
			Number(item.price_list_rate) || 0,
			Number(item.discount_percentage) || 0,
			Number(item.discount_amount) || 0,
			item.uom || "",
		]),
		discount_amount: Number(sale.discount_amount) || 0,
		additional_discount_percentage: Number(sale.additional_discount_percentage) || 0,
		taxes_and_charges: sale.taxes_and_charges || null,
	};
}

const newExchangeId = () =>
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID().replace(/-/g, "")
		: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export const useExchangeStore = defineStore("exchange", () => {
	const receipt = ref<ExchangeReceipt | null>(null);
	const picks = ref<Picks>({});
	const pickerOpen = ref(false);
	const quotedReturned = ref<number | null>(null);
	const quoting = ref(false);
	const submitting = ref(false);
	const exchangeId = ref("");
	/** A return with no new items is on the payment screen for review. */
	const reviewingReturn = ref(false);
	const prompt = ref<ExchangePrompt | null>(null);
	let resolvePrompt: ((value: boolean) => void) | null = null;
	let quoteTimer: ReturnType<typeof setTimeout> | null = null;
	let quoteSeq = 0;
	/** Last server figures, for the cart as it was then (quote.key). */
	const quote = ref<ExchangeQuote | null>(null);
	/** A check the cashier is waiting for ("Checking…" on the button). */
	const checking = ref(false);
	/** The last check failed or timed out (offline, server error): shown with Retry. */
	const quoteError = ref("");
	// The cart's new items as a sale payload (registered by Invoice.vue).
	// Reactive, so `serverFigures` follows a provider registered after it.
	const saleProvider = shallowRef<(() => any) | null>(null);

	const enabled = computed(() => isOneScreenExchangeOn(useUIStore().posProfile));
	const receiptLines = computed<ExchangeLine[]>(() => receipt.value?.lines || []);
	/** An exchange is on the screen: a receipt with at least one line ticked. */
	const active = computed(() => Boolean(receipt.value) && pickedCount(picks.value) > 0);
	/** The cart's RETURN lines. */
	const lines = computed(() =>
		receiptLines.value
			.filter((line) => Number(picks.value[line.name]) > 0)
			.map((line) => ({ ...line, qty: Number(picks.value[line.name]) })),
	);
	const backQty = computed(() => pickedQty(picks.value));
	const estimate = computed(() => estimateReturned(receiptLines.value, picks.value));
	/** Value of the returned lines: the server's figure once quoted. */
	const returned = computed(() => (quotedReturned.value === null ? estimate.value : quotedReturned.value));

	const ask = (type: ExchangePromptType, data: Record<string, any> = {}) =>
		new Promise<boolean>((resolve) => {
			resolvePrompt?.(false);
			resolvePrompt = resolve;
			prompt.value = { type, data };
		});
	const settlePrompt = (value: boolean) => {
		const resolve = resolvePrompt;
		resolvePrompt = null;
		prompt.value = null;
		resolve?.(Boolean(value));
	};
	const closePrompt = () => {
		prompt.value = null;
	};

	const reset = () => {
		receipt.value = null;
		picks.value = {};
		pickerOpen.value = false;
		quotedReturned.value = null;
		quote.value = null;
		checking.value = false;
		quoteError.value = "";
		exchangeId.value = "";
		reviewingReturn.value = false;
		if (quoteTimer) clearTimeout(quoteTimer);
		quoteTimer = null;
		quoteSeq += 1;
	};

	const ensureExchangeId = () => {
		if (!exchangeId.value) exchangeId.value = newExchangeId();
		return exchangeId.value;
	};

	/** The return as the till sends it: which lines, how many. */
	const returnRequest = () => {
		const ui = useUIStore();
		return {
			doctype: "Sales Invoice",
			pos_profile: ui.posProfile?.name,
			company: ui.posProfile?.company,
			customer: receipt.value?.customer,
			posa_pos_opening_shift: ui.posOpeningShift?.name || null,
			is_return: 1,
			return_against: receipt.value?.name,
			items: returnRequestItems(picks.value),
			payments: [],
		};
	};

	const setSaleProvider = (provider: (() => any) | null) => {
		saleProvider.value = provider;
		return () => {
			if (saleProvider.value === provider) saleProvider.value = null;
		};
	};
	const currentSale = () => {
		try {
			return saleProvider.value ? saleProvider.value() : null;
		} catch (error) {
			console.warn("Exchange sale not built", error);
			return null;
		}
	};
	const quoteKey = (sale: any) => JSON.stringify({ picks: picks.value, sale: saleSignature(sale) });

	const fetchQuote = async (sale: any): Promise<ExchangeQuote> => {
		const key = quoteKey(sale);
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const message: any = await Promise.race([
			callWithoutDialog(`${API}.quote_exchange`, {
				return_invoice: returnRequest(),
				sale_invoice: sale || null,
			}),
			new Promise((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(t("The exchange check took too long."))),
					QUOTE_TIMEOUT_MS,
				);
			}),
		]).finally(() => {
			if (timeout) clearTimeout(timeout);
		});
		return {
			key,
			returned: Number(message?.returned) || 0,
			sale_total: message?.sale_total ?? null,
			pay: message?.pay ?? null,
			credit_left: Number(message?.credit_left) || 0,
			return_sales_person: message?.return_sales_person || null,
		};
	};
	/**
	 * The server's figures for the cart exactly as it is now (section 109's
	 * result line), or null while the cart has changed since the last check.
	 */
	const serverQuote = computed<ExchangeQuote | null>(() => {
		if (!active.value || !quote.value) return null;
		return quote.value.key === quoteKey(currentSale()) ? quote.value : null;
	});
	/**
	 * Whatever changed the cart -- an item scanned, a line ticked, or the
	 * sale coming back from the payment screen with the server's own draft
	 * (prices, taxes) -- the cart is checked again when it no longer matches
	 * the last check (section 110: it used to stay "Checking…" after Pay ->
	 * Cancel, because the cart's own watch didn't see those fields).
	 */
	const liveKey = computed(() => (active.value ? quoteKey(currentSale()) : ""));
	watch(liveKey, (key) => {
		if (key && (!quote.value || quote.value.key !== key)) refreshQuote(400);
	});
	/** The figures for the cart as it is now are being checked. */
	const figuresPending = computed(() => active.value && !serverQuote.value && !quoteError.value);
	/** Check the cart as it is now (Pay waits for this). */
	const checkNow = () => figuresFor(currentSale());
	/** Retry after a failed or timed-out check. */
	const retryQuote = () => refreshQuote(0);
	const keepQuote = (result: ExchangeQuote) => {
		quote.value = result;
		quotedReturned.value = result.returned;
		quoteError.value = "";
	};

	/**
	 * Background check of the whole cart, 0.4 s after its last change (each
	 * change restarts the wait), so the confirmation can open at once. No
	 * server call when nothing that decides the figures has changed.
	 */
	const refreshQuote = (delay = 400) => {
		if (quoteTimer) clearTimeout(quoteTimer);
		quoteTimer = null;
		if (!active.value) return;
		if (isOffline()) {
			quoteError.value = t("Return / Exchange needs the server connection.");
			return;
		}
		quoteError.value = "";
		const seq = ++quoteSeq;
		quoteTimer = setTimeout(async () => {
			quoteTimer = null;
			const sale = currentSale();
			if (quote.value && quote.value.key === quoteKey(sale)) return;
			quoting.value = true;
			try {
				const result = await fetchQuote(sale);
				if (seq === quoteSeq) keepQuote(result);
			} catch (error: any) {
				console.warn("Exchange quote failed", error);
				if (seq === quoteSeq) quoteError.value = error?.message || t("The exchange could not be checked.");
			} finally {
				if (seq === quoteSeq) quoting.value = false;
			}
		}, delay);
	};

	/**
	 * The server's figures for exactly this sale (null: no new items): the
	 * background check when it matches the cart, else a check now, shown as
	 * "Checking…".
	 */
	const figuresFor = async (sale: any): Promise<ExchangeQuote> => {
		const key = quoteKey(sale);
		if (quote.value && quote.value.key === key) return quote.value;
		if (quoteTimer) clearTimeout(quoteTimer);
		quoteTimer = null;
		const seq = ++quoteSeq;
		checking.value = true;
		quoteError.value = "";
		try {
			const result = await fetchQuote(sale);
			if (seq === quoteSeq) {
				keepQuote(result);
				quoting.value = false;
			}
			return result;
		} catch (error: any) {
			if (seq === quoteSeq) {
				quoting.value = false;
				quoteError.value = error?.message || t("The exchange could not be checked.");
			}
			throw error;
		} finally {
			checking.value = false;
		}
	};

	const setPicks = (next: Picks) => {
		picks.value = { ...next };
		quotedReturned.value = null;
		refreshQuote();
	};

	const step = (lineName: string, delta: number) => {
		const line = receiptLines.value.find((row) => row.name === lineName);
		if (!line) return;
		setPicks(setPick(picks.value, line, (Number(picks.value[lineName]) || 0) + delta));
		if (!active.value) reset();
	};

	const openPicker = () => {
		if (receipt.value) pickerOpen.value = true;
	};

	/** The picker closed with these picks (Back keeps the cart as it was). */
	const closePicker = (next: Picks | null) => {
		pickerOpen.value = false;
		if (next) setPicks(next);
		if (!active.value) reset();
	};

	const fetchReceipt = async (text: string): Promise<ExchangeReceipt> => {
		const message: any = await callWithoutDialog(`${API}.get_exchange_receipt`, {
			receipt: text,
			pos_profile: useUIStore().posProfile?.name,
		});
		return message || { found: 0 };
	};

	/**
	 * A receipt scanned in the item box or picked in "Return / Exchange".
	 * True when it was handled as a receipt (picker opened or a message
	 * shown); false when it isn't a receipt (the item search goes on).
	 * `fromSearch`: picked by name from the Returns search, always a receipt.
	 */
	const openReceipt = async (text: string, { fromSearch = false } = {}): Promise<boolean> => {
		const value = String(text || "").trim();
		if (!enabled.value || !value || (!fromSearch && !looksLikeReceipt(value))) return false;
		const toast = useToastStore();
		if (isOffline()) {
			toast.show({ title: t("Return / Exchange needs the server connection."), color: "error" });
			return true;
		}
		if (receipt.value && (receipt.value.name === value || receipt.value.name?.endsWith(`-${value}`))) {
			openPicker();
			return true;
		}
		let found: ExchangeReceipt;
		try {
			found = await fetchReceipt(value);
		} catch (error: any) {
			toast.show({ title: error?.message || t("Error loading invoice details"), color: "error" });
			return true;
		}
		if (!found.found) return fromSearch ? (toast.show({ title: t("Receipt {0} was not found.", [value]), color: "error" }), true) : false;
		if (found.error) {
			toast.show({ title: found.error, color: "error" });
			return true;
		}
		if (receipt.value && receipt.value.name === found.name) {
			openPicker();
			return true;
		}
		if (receipt.value) {
			toast.show({
				title: t("One receipt per exchange. Finish or discard this exchange first."),
				color: "warning",
			});
			return true;
		}

		const invoiceStore = useInvoiceStore();
		const customers = useCustomersStore();
		const cartCount = invoiceStore.items?.length || 0;
		const currentCustomer = customers.selectedCustomer;
		const customerChanges = Boolean(currentCustomer) && currentCustomer !== found.customer;
		if (cartCount > 0 || invoiceStore.invoiceDoc?.is_return) {
			if (invoiceStore.invoiceDoc?.is_return) {
				toast.show({ title: t("Finish or clear the return in the cart first."), color: "warning" });
				return true;
			}
			const ok = await ask("add_return", {
				receipt: found.name,
				customer: found.customer_name || found.customer,
				customerChanges,
			});
			if (!ok) return true;
		}
		if (found.customer && currentCustomer !== found.customer) {
			customers.setSelectedCustomer(found.customer);
		}
		receipt.value = found;
		picks.value = {};
		quotedReturned.value = null;
		ensureExchangeId();
		pickerOpen.value = true;
		return true;
	};

	return {
		receipt,
		picks,
		pickerOpen,
		quotedReturned,
		quoting,
		submitting,
		exchangeId,
		reviewingReturn,
		prompt,
		enabled,
		receiptLines,
		active,
		lines,
		backQty,
		estimate,
		returned,
		quote,
		serverQuote,
		checking,
		quoteError,
		figuresPending,
		retryQuote,
		checkNow,
		ask,
		settlePrompt,
		closePrompt,
		setSaleProvider,
		figuresFor,
		reset,
		ensureExchangeId,
		returnRequest,
		refreshQuote,
		setPicks,
		step,
		openPicker,
		closePicker,
		openReceipt,
	};
});

/** The exchange store, or null when no Pinia is active (bare unit tests). */
export function peekExchangeStore() {
	return getActivePinia() ? useExchangeStore() : null;
}
