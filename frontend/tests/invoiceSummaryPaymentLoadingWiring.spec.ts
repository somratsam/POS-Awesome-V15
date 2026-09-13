import { describe, expect, it } from "vitest";

import invoiceSummarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";

// InvoiceSummary.vue is too large/heavily-integrated to mount and render
// reliably in a unit test (its stub-based mounts in invoiceSummaryDrafts.spec.ts
// only ever assert against exposed setupState, never against actual rendered
// DOM output -- a full render silently produces empty HTML under those same
// stubs, a pre-existing environment limitation unrelated to this change) --
// so this asserts against the raw .vue source instead, same approach as
// itemsSelectorAutoSearchWiring.spec.ts.
//
// This guards a real double-click/double-tap bug: paymentLoading used to be
// driven by `await emit("show-payment")` inside handleShowPayment(). Vue's
// emit() does not propagate the listener's return value/promise, and the
// listener itself (Invoice.vue's handleShowPaymentRequest) called
// this.show_payment() without awaiting it -- so `await emit(...)` resolved on
// the next microtask regardless of how long the real update_invoice() network
// round trip actually took. paymentLoading flipped back to false almost
// instantly, well before the click actually finished, so the Pay button's
// :disabled="paymentLoading" binding (also added by this fix) never actually
// covered the risk window. The fix: show_payment() (dialogs.ts) now emits its
// own "payment_processing" true/false lifecycle over the eventBus, bracketing
// the entire in-flight duration, and InvoiceSummary.vue's paymentLoading is
// driven by that signal instead of the emit.
describe("InvoiceSummary.vue drives paymentLoading from the real payment_processing signal", () => {
	it("no longer wraps handleShowPayment's emit in an async paymentLoading toggle", () => {
		const handlerMatch = invoiceSummarySource.match(
			/function handleShowPayment\(\)\s*\{[\s\S]*?\n\}/,
		);
		expect(handlerMatch).not.toBeNull();
		expect(handlerMatch![0]).not.toMatch(/await\s+emit/);
		expect(handlerMatch![0]).not.toMatch(/paymentLoading\.value/);
		expect(handlerMatch![0]).toMatch(/emit\(\s*["']show-payment["']\s*\)/);
	});

	it("registers a payment_processing eventBus listener that sets paymentLoading", () => {
		expect(invoiceSummarySource).toMatch(
			/function handlePaymentProcessing\(value\)\s*\{\s*paymentLoading\.value\s*=\s*Boolean\(value\)/,
		);
	});

	it("subscribes to payment_processing on mount and unsubscribes on unmount", () => {
		const onMountedMatch = invoiceSummarySource.match(
			/onMounted\(\(\)\s*=>\s*\{[\s\S]*?\n\}\);/,
		);
		expect(onMountedMatch).not.toBeNull();
		expect(onMountedMatch![0]).toMatch(
			/eventBus\?\.on\?\.\(\s*["']payment_processing["']\s*,\s*handlePaymentProcessing\s*\)/,
		);

		const onUnmountMatch = invoiceSummarySource.match(
			/onBeforeUnmount\(\(\)\s*=>\s*\{[\s\S]*?\n\}\);/,
		);
		expect(onUnmountMatch).not.toBeNull();
		expect(onUnmountMatch![0]).toMatch(
			/eventBus\?\.off\?\.\(\s*["']payment_processing["']\s*,\s*handlePaymentProcessing\s*\)/,
		);
	});

	it("obtains eventBus via inject, not the fragile getCurrentInstance().proxy pattern", () => {
		expect(invoiceSummarySource).toMatch(
			/const eventBus\s*=\s*inject\(\s*["']eventBus["']\s*\)/,
		);
	});
});
