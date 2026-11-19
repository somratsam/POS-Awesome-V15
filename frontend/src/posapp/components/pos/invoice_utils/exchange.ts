// One-screen exchange from the cart: the main button ("Pay X" / "Continue")
// and every key that opens Payments go to the payment screen in every case,
// like a normal sale; the payment screen is the review step (section 108):
// - new items (customer pays more, credit left, even exchange): Payments
//   opens as usual (show_payment saves the sale draft) and submits the
//   exchange from there;
// - no new items (a return only): the payment screen's return review
//   (ExchangeReturnReview in Payments.vue), nothing saved before Submit.
// Escape: "Discard? Nothing saved."

import { peekExchangeStore, useExchangeStore } from "../../../stores/exchangeStore";
import { useUIStore } from "../../../stores/uiStore";
import { useToastStore } from "../../../stores/toastStore";
import { isOffline } from "../../../../offline/index";
import { get_invoice_doc, get_payments } from "./document";
import { callWithoutDialog } from "../../../utils/voucherMessages";

declare const __: (_text: string, _args?: any[]) => string;

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
 * The cart's main action during an exchange. True when it was handled here
 * (offline, saving, or the return review opened); false when Payments
 * should open as for a sale (the exchange has new items).
 */
export async function runExchangeMainAction(
	context: any,
	_ensureDiscountReasons?: (_context: any) => Promise<boolean>,
): Promise<boolean> {
	const exchange = peekExchangeStore();
	if (!exchange?.active) return false;
	if (isOffline()) {
		useToastStore().show({ title: __("Return / Exchange needs the server connection."), color: "error" });
		return true;
	}
	if (exchange.submitting) return true;
	// Pay waits for the server's figures of the cart as it is now (the
	// button shows "Checking…"); a failed check stops here with the reason.
	if (!exchange.serverQuote) {
		try {
			await exchange.checkNow();
		} catch (error: any) {
			useToastStore().show({
				title: error?.message || __("The exchange could not be checked."),
				color: "error",
			});
			return true;
		}
	}
	const items = Array.isArray(context.items) ? context.items : [];
	if (items.length) return false;
	openReturnReview(context);
	return true;
}

/** A return with no new items: the payment screen, as its review step. */
export function openReturnReview(context: any) {
	const exchange = useExchangeStore();
	const ui = context?.uiStore || useUIStore();
	exchange.reviewingReturn = true;
	const useDesktopPaymentDialog = typeof window !== "undefined" && window.innerWidth >= 992;
	if (useDesktopPaymentDialog && ui?.openPaymentDialog) {
		ui.openPaymentDialog();
	} else if (ui?.setActiveView) {
		ui.closePaymentDialog?.();
		ui.setActiveView("payment");
	}
	context?.eventBus?.emit?.("set_compact_panel", "selector");
	context?.eventBus?.emit?.("show_payment", "true");
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
