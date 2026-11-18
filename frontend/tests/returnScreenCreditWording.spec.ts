import { describe, expect, it } from "vitest";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import optionsSource from "../src/posapp/components/pos/payments/PaymentOptions.vue?raw";
import methodsSource from "../src/posapp/components/pos/payments/PaymentMethods.vue?raw";

// The old return payment screen (POS Profiles with one-screen exchange off):
// a credit return says "Credit note issued", never "Remaining Refund".
describe("old return screen wording", () => {
	it('labels what is left on a credit return "Credit note issued (OMR)"', () => {
		expect(paymentsSource).toMatch(
			/if \(doc\?\.is_return && \(is_credit_return\.value \|\| returnsCreditOnlyPolicy\.value\)\) \{\s*return `\$\{__\("Credit note issued"\)\} \(\$\{doc\.currency \|\| ""\}\)`;/,
		);
		expect(paymentsSource.match(/:diff_label="paymentDiffLabel"/g)?.length).toBe(2);
		expect(paymentsSource).not.toContain(':diff_label="diff_label"');
	});

	it("credit-only policy: one line instead of the Store as Credit switch and the policy note", () => {
		expect(optionsSource).toContain('v-if="invoiceDoc.is_return && creditOnlyPolicy"');
		expect(optionsSource).toContain("The return's value is issued as a credit note.");
		expect(optionsSource).toContain('v-if="invoiceDoc.is_return && !creditOnlyPolicy"');
		expect(optionsSource).not.toContain("Required by this POS Profile's return policy");
		expect(optionsSource).not.toContain("Customer Credit Return Active");
		expect(optionsSource).not.toContain("instead of cashback");
	});

	it('no "Refund" badge on the payment methods of a credit-only return', () => {
		expect(methodsSource).toContain('v-if="isReturn && !creditOnlyReturn"');
	});
});
