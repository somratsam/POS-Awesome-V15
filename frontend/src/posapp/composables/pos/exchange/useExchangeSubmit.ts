// Submitting a one-screen exchange from the payment screen -- every case
// goes there, like a normal sale, and the payment screen is the review step:
// no confirmation (section 108). The server's figures first (quote_exchange,
// unless the payment screen already shows them), then the return and the new
// sale together (submit_exchange), then printing:
//   - the exchange receipt only when "Submit exchange & Print" was pressed
//     (customer pays more, credit left, even exchange);
//   - the credit always prints its voucher, whichever button: the BALANCE
//     voucher when credit is left (section 87), the credit note voucher of a
//     return with no new items -- the customer can't use the credit without it.

import { useExchangeStore } from "../../../stores/exchangeStore";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";
import { isOffline } from "../../../../offline/index";
import { callWithoutDialog } from "../../../utils/voucherMessages";
import { balanceVoucherSettings, recordBalanceVoucherPrint, REPRINT_SETTINGS } from "../../../utils/creditNoteReprint";
import { exchangeFigures, type ExchangeKind } from "../../../utils/oneScreenExchange";

declare const frappe: any;
declare const __: (text: string, args?: any[]) => string;

const API = "posawesome.posawesome.api.one_screen_exchange";

export type PrintDoc = (input: { name: string; settings?: string }) => Promise<any> | any;

export interface ExchangeSubmitOptions {
	/** The new items' sale, or null for a plain return. */
	sale: any | null;
	/** Payments' extra data (paid_change). */
	saleData?: Record<string, any>;
	print: boolean;
	/** What the screen showed: the server must agree before anything is asked. */
	expectKinds: ExchangeKind[];
	printDoc: PrintDoc;
	/**
	 * Server figures already on screen (Payments: the returned value quoted
	 * for the RETURN lines and the sale's own saved draft). Without them, the
	 * cart's background check is used when it matches, else one runs now
	 * ("Checking…"). submit_exchange re-checks everything either way.
	 */
	figures?: { returned: number; sale_total: number | null; pay: number | null } | null;
	/** After a successful submit, before the cart is cleared. */
	onSubmitted?: (result: any) => void;
}

const precisionOf = () => Number(useUIStore().posProfile?.currency_precision) || 3;

const paidOf = (sale: any) =>
	(Array.isArray(sale?.payments) ? sale.payments : []).reduce(
		(sum: number, row: any) => sum + Math.max(Number(row?.amount) || 0, 0),
		0,
	);

export function useExchangeSubmit() {
	const store = useExchangeStore();
	const toast = useToastStore();

	const fail = (message: string) => {
		toast.show({ title: message, color: "error" });
		frappe?.utils?.play_sound?.("error");
		return false;
	};

	const format = (value: number) =>
		typeof frappe?.format === "function"
			? frappe.format(value, { fieldtype: "Currency", options: useUIStore().posProfile?.currency })
			: Number(value || 0).toFixed(precisionOf());

	const printAfter = async (result: any, print: boolean, printDoc: PrintDoc) => {
		const profile = useUIStore().posProfile?.name || null;
		try {
			if (!result.sale) {
				// Plain return: the credit note voucher, first print.
				await printDoc({ name: result.return.name });
				return;
			}
			if (print) await printDoc({ name: result.sale.name });
			if (Number(result.credit_left) > 0) {
				const recorded = await recordBalanceVoucherPrint({
					name: result.return.name,
					sale: result.sale.name,
					posProfile: profile,
				});
				await printDoc({
					name: result.return.name,
					settings: recorded.balance ? balanceVoucherSettings(result.sale.name) : REPRINT_SETTINGS,
				});
			}
		} catch (error: any) {
			console.warn("Exchange print failed", error);
			toast.show({
				title:
					error?.message ||
					__("The exchange was saved but didn't print. Reprint {0} from Invoice Management.", [
						result.sale?.name || result.return?.name,
					]),
				color: "warning",
			});
		}
	};

	/** True when the exchange was submitted. */
	const submitExchange = async (options: ExchangeSubmitOptions): Promise<boolean> => {
		if (store.submitting || !store.active) return false;
		if (isOffline()) return fail(__("Return / Exchange needs the server connection."));
		store.submitting = true;
		try {
			const returnInvoice = store.returnRequest();
			let quote: any = options.figures || null;
			if (!quote) {
				try {
					quote = await store.figuresFor(options.sale || null);
				} catch (error: any) {
					return fail(error?.message || __("The exchange could not be checked."));
				}
			}
			const precision = precisionOf();
			const figures = exchangeFigures(quote.returned, options.sale ? quote.sale_total : null, precision);
			if (!options.expectKinds.includes(figures.kind)) {
				if (figures.kind === "pays") {
					return fail(__("Totals changed: the customer pays {0}. Press Pay.", [format(figures.pay)]));
				}
				return fail(__("Totals changed. Go back to the cart and check it."));
			}
			if (figures.kind === "pays") {
				const short = Math.round((figures.pay - paidOf(options.sale)) * Math.pow(10, precision));
				if (short > 0) {
					return fail(__("Remaining {0} to pay.", [format(short / Math.pow(10, precision))]));
				}
			}

			let result: any;
			try {
				result = await callWithoutDialog(`${API}.submit_exchange`, {
					return_invoice: returnInvoice,
					return_data: {},
					sale_invoice: options.sale || null,
					sale_data: options.saleData || {},
					exchange_id: store.ensureExchangeId(),
					expected: {
						returned: quote.returned,
						sale_total: quote.sale_total,
						pay: quote.pay,
					},
				});
			} catch (error: any) {
				return fail(error?.message || __("The exchange was not saved."));
			}
			frappe?.utils?.play_sound?.("submit");
			options.onSubmitted?.(result);
			void printAfter(result, options.print, options.printDoc);
			store.reset();
			return true;
		} finally {
			store.submitting = false;
		}
	};

	return { submitExchange };
}

export function newItemsQty(sale: any): number {
	return (Array.isArray(sale?.items) ? sale.items : []).reduce(
		(sum: number, item: any) => sum + Math.abs(Number(item?.qty) || 0),
		0,
	);
}
