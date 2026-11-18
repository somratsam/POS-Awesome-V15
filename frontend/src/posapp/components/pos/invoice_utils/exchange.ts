// One-screen exchange from the cart: the main button (and every key that
// opens Payments) when the customer doesn't pay more -- credit left, even
// exchange, or no new items -- submits straight from the cart after one
// confirmation, and always prints. When the customer pays more, Payments
// opens as usual (show_payment) and submits the exchange from there.
// Escape: "Discard? Nothing saved."

import { computed, ref } from "vue";
import { peekExchangeStore, useExchangeStore } from "../../../stores/exchangeStore";
import { useUIStore } from "../../../stores/uiStore";
import { useToastStore } from "../../../stores/toastStore";
import { isOffline } from "../../../../offline/index";
import { exchangeFigures } from "../../../utils/oneScreenExchange";
import { useExchangeSubmit } from "../../../composables/pos/exchange/useExchangeSubmit";
import { usePaymentPrinting } from "../../../composables/pos/payments/usePaymentPrinting";
import { get_invoice_doc, get_payments } from "./document";
import { callWithoutDialog } from "../../../utils/voucherMessages";

declare const __: (_text: string, _args?: any[]) => string;

const cartPrinter = () => {
	const ui = useUIStore();
	const { loadPrintPage } = usePaymentPrinting({
		invoiceDoc: ref(null),
		posProfile: computed(() => ui.posProfile),
		invoiceType: ref("Invoice"),
		printFormat: ref(null),
	} as any);
	return ({ name, settings }: { name: string; settings?: string }) =>
		loadPrintPage({ doctype: "Sales Invoice", name, doc: { name, doctype: "Sales Invoice" }, settings } as any);
};

/**
 * The cart's new items as the exchange's sale (null: none). The same payload
 * for the background check and the submit, so their figures match.
 */
export function buildExchangeSale(context: any) {
	const items = Array.isArray(context?.items) ? context.items : [];
	if (!items.length) return null;
	const sale = JSON.parse(JSON.stringify(get_invoice_doc(context)));
	sale.payments = (get_payments(context) || []).map((row: any) => ({ ...row, amount: 0, base_amount: 0 }));
	return sale;
}

/** What, in the cart, decides the exchange's figures: watched by Invoice.vue. */
export function exchangeCartSignature(context: any): string {
	const items = Array.isArray(context?.items) ? context.items : [];
	return [
		context?.customer || "",
		Number(context?.additional_discount) || 0,
		Number(context?.additional_discount_percentage) || 0,
		...items.map((item: any) =>
			[item.item_code, item.qty, item.rate, item.discount_percentage, item.discount_amount, item.uom].join(":"),
		),
	].join("|");
}

/** The cart after an exchange is saved: empty, default customer. */
export function finishExchangeInCart(context: any) {
	context.clear_invoice?.();
	const customer = context.pos_profile?.customer || "";
	context.customer = customer;
	context.customersStore?.setSelectedCustomer?.(customer || null);
	context.eventBus?.emit?.("focus_item_search");
}

/**
 * The cart's main action during an exchange. True when it was handled here;
 * false when Payments should open (the customer pays more).
 */
export async function runExchangeMainAction(
	context: any,
	ensureDiscountReasons: (_context: any) => Promise<boolean>,
): Promise<boolean> {
	const exchange = peekExchangeStore();
	if (!exchange?.active) return false;
	if (isOffline()) {
		useToastStore().show({ title: __("Return / Exchange needs the server connection."), color: "error" });
		return true;
	}
	if (exchange.submitting) return true;
	const items = Array.isArray(context.items) ? context.items : [];
	const precision = Number(context.currency_precision) || 3;
	const figures = exchangeFigures(exchange.returned, items.length ? Number(context.subtotal) || 0 : null, precision);
	if (figures.kind === "pays") return false;

	if (items.length) {
		if (context.ensure_auto_batch_selection) await context.ensure_auto_batch_selection();
		if (context.validate && !(await context.validate())) return true;
		if (!(await ensureDiscountReasons(context))) return true;
	}
	const sale = buildExchangeSale(context);
	const { submitExchange } = useExchangeSubmit();
	const submitted = await submitExchange({
		sale,
		print: true,
		expectKinds: items.length ? ["credit", "even"] : ["return"],
		printDoc: cartPrinter(),
	});
	if (submitted) finishExchangeInCart(context);
	return true;
}

/**
 * A discarded exchange leaves nothing behind: its own sale draft (saved when
 * Pay opened Payments) is deleted on the server, whatever the profile's
 * delete setting -- and only that draft (discard_exchange_draft). True when
 * there was nothing to delete or it is gone; false (with the reason shown)
 * when the server refused, so the exchange stays on the screen.
 */
export async function deleteExchangeDraft(context: any): Promise<boolean> {
	const exchange = peekExchangeStore();
	const draftName = context?.invoice_doc?.name;
	if (!exchange?.exchangeId || !draftName || context?.invoice_doc?.docstatus) return true;
	try {
		await callWithoutDialog("posawesome.posawesome.api.one_screen_exchange.discard_exchange_draft", {
			exchange_id: exchange.exchangeId,
			pos_profile: context.pos_profile?.name || useUIStore().posProfile?.name,
		});
		return true;
	} catch (error: any) {
		useToastStore().show({
			title: error?.message || __("The exchange could not be discarded."),
			color: "error",
		});
		return false;
	}
}

/** Escape during an exchange. */
export async function discardExchange(context: any) {
	const exchange = useExchangeStore();
	if (!exchange.active || exchange.submitting || exchange.prompt) return;
	const ok = await exchange.ask("discard");
	if (!ok) return;
	if (!(await deleteExchangeDraft(context))) return;
	exchange.reset();
	finishExchangeInCart(context);
}
