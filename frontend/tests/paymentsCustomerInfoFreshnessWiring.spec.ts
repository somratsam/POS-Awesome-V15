import { describe, expect, it } from "vitest";

import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";

// Payments.vue cannot be mounted or even imported in this suite: it imports
// invoiceStore.js/customersStore.js/uiStore.js/toastStore.js with an explicit
// .js suffix even though those are really .ts files (this app's own
// established, deliberate convention -- see CLAUDE.md). Vitest bundles its
// own older Vite that fails to resolve those imports at SFC-transform time,
// before any vi.mock() call can even run. So this asserts against the raw
// .vue source instead, same approach as invoiceSummaryPaymentLoadingWiring.spec.ts
// and updateCustomerSubmitReentrancyWiring.spec.ts.
//
// This guards the fix for a redundant network call on every Pay click:
// refreshPaymentCustomerInfo() unconditionally re-fetched get_customer_info
// even though fetch_customer_details() (invoice_utils/customer.ts) already
// fetched and cached the exact same data moments earlier, when the customer
// was selected. The actual freshness-skip logic is covered executably by
// customersStore.spec.ts (isCustomerInfoFresh) and invoiceCustomerSync.spec.ts
// (the store gets stamped on a successful fetch) -- this test only confirms
// Payments.vue's refreshPaymentCustomerInfo() is actually wired to consult
// that tracker before hitting the network, not that the tracker itself works.
describe("Payments.vue refreshPaymentCustomerInfo() skips a redundant get_customer_info fetch when data is fresh", () => {
	const getFunctionBody = () => {
		const match = paymentsSource.match(
			/const refreshPaymentCustomerInfo = async \(doc\) => \{[\s\S]*?\n\};/,
		);
		expect(match).not.toBeNull();
		return match![0];
	};

	it("checks customersStore.isCustomerInfoFresh() before calling get_customer_info", () => {
		const body = getFunctionBody();
		expect(body).toMatch(
			/if\s*\(\s*customersStore\.isCustomerInfoFresh\(customer,\s*CUSTOMER_INFO_FRESHNESS_MS\)\s*\)\s*\{\s*return;\s*\}/,
		);
	});

	it("places the freshness check after the offline early-return and before the frappe.call", () => {
		const body = getFunctionBody();
		const offlineIndex = body.indexOf("if (isOffline())");
		const freshnessIndex = body.indexOf("customersStore.isCustomerInfoFresh(");
		const callIndex = body.indexOf("get_customer_info");
		expect(offlineIndex).toBeGreaterThan(-1);
		expect(freshnessIndex).toBeGreaterThan(offlineIndex);
		expect(callIndex).toBeGreaterThan(freshnessIndex);
	});

	it("defines a real freshness window constant, not a stray/unused one", () => {
		expect(paymentsSource).toMatch(
			/const CUSTOMER_INFO_FRESHNESS_MS = \d+;/,
		);
	});

	it("still applies the locally cached customer before the freshness check, so offline/instant UI feedback is unaffected", () => {
		const body = getFunctionBody();
		const cachedIndex = body.indexOf("applyPaymentCustomerInfo(cachedCustomer, customer)");
		const freshnessIndex = body.indexOf("customersStore.isCustomerInfoFresh(");
		expect(cachedIndex).toBeGreaterThan(-1);
		expect(cachedIndex).toBeLessThan(freshnessIndex);
	});
});
