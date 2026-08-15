// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import customerSource from "../src/posapp/components/pos/customer/Customer.vue?raw";
import invoiceCustomerSectionSource from "../src/posapp/components/pos/invoice/InvoiceCustomerSection.vue?raw";

describe("pos_profile prop actually reaches Customer.vue (regression: it previously didn't)", () => {
	// Customer.vue's own posa_walkin_customer gate is meaningless if no real
	// caller ever forwards pos_profile down to it -- this was a real bug:
	// the prop was declared and used in Customer.vue's template, but every
	// actual <Customer> usage in the app omitted the binding, so
	// pos_profile was always undefined at runtime regardless of what was
	// configured in the database. Assert the primary caller (the main
	// invoice customer search row) actually forwards it.
	it("InvoiceCustomerSection.vue forwards pos_profile to its <Customer> child", () => {
		expect(invoiceCustomerSectionSource).toMatch(/<Customer\b[^>]*:pos_profile="pos_profile"/s);
	});
});

describe("Walk-in / No Loyalty button", () => {
	it("is gated on the POS Profile's posa_walkin_customer field, not shown unconditionally", () => {
		expect(customerSource).toContain('v-if="pos_profile?.posa_walkin_customer"');
	});

	it("carries the exact agreed label", () => {
		expect(customerSource).toContain('{{ __("Walk-in / No Loyalty") }}');
	});

	it("is visually muted (text variant, small size), not equal weight to the search field", () => {
		expect(customerSource).toMatch(/<v-btn[^>]*class="walkin-customer-btn"[^>]*variant="text"/s);
		expect(customerSource).toMatch(/<v-btn[^>]*class="walkin-customer-btn"[^>]*size="small"/s);
	});

	it("respects the same readonly/search-lock disabled state as the rest of the field", () => {
		expect(customerSource).toContain(':disabled="effectiveReadonly || isCustomerSearchLocked"');
	});

	it("selects the configured walk-in customer via the same setSelectedCustomer path as the rest of the component, not a separate mechanism", () => {
		expect(customerSource).toContain("const select_walkin_customer = () => {");
		expect(customerSource).toContain("const walkinCustomer = props.pos_profile?.posa_walkin_customer;");
		expect(customerSource).toContain("customersStore.setSelectedCustomer(walkinCustomer);");
		expect(customerSource).toContain("closeCustomerMenu();");
	});

	it("does nothing when the POS Profile field is unset, instead of erroring or selecting a blank customer", () => {
		expect(customerSource).toMatch(
			/const select_walkin_customer = \(\) => \{\s*const walkinCustomer = props\.pos_profile\?\.posa_walkin_customer;\s*if \(!walkinCustomer\) \{\s*return;\s*\}/,
		);
	});

	it("is exposed to the template via the setup return object", () => {
		expect(customerSource).toMatch(/return \{[\s\S]*select_walkin_customer,[\s\S]*\};/);
	});
});
