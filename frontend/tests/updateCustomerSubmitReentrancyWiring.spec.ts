import { describe, expect, it } from "vitest";

import updateCustomerSource from "../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue?raw";

// UpdateCustomer.vue cannot be mounted or even imported in this suite:
// it imports customersStore.js/uiStore.js/toastStore.js/offline's index.js
// with an explicit .js suffix even though those are really .ts files (this
// app's own established, deliberate convention -- see CLAUDE.md and
// Returns.vue's identical, already-accepted gap). Vitest bundles its own
// older Vite that fails to resolve those imports at SFC-transform time,
// before any vi.mock() call can even run -- confirmed empirically: mocking
// every one of those modules still fails with "Failed to resolve import".
// So this asserts against the raw .vue source instead, same approach as
// invoiceSummaryPaymentLoadingWiring.spec.ts and
// itemsSelectorAutoSearchWiring.spec.ts.
//
// This guards a real double-click/double-tap bug: the "Create/Update
// Customer" Submit button had neither :loading nor :disabled, submit_dialog()
// had no synchronous in-flight guard, and the actual create_customer request
// was fire-and-forget (frappe.call({..., callback: ...}), never awaited) --
// so a second rapid click re-ran the async duplicate-name check before the
// first request had created anything, both duplicate checks came back
// clean, and both proceeded to create a separate Customer record. The fix
// mirrors show_payment()'s _paymentInFlight / save_and_clear_invoice()'s
// _saveAndClearInFlight guards exactly, plus properly awaiting the create
// call so the guard only releases once creation has actually finished.
//
// The actual double-click race is additionally verified executably against
// the identical guard shape in actions.ts (saveAndClearInvoiceReentrancy.spec.ts)
// and dialogs.ts (invoiceDialogs.spec.ts) -- both confirmed, by disabling the
// guard, to genuinely reproduce a duplicate/hung concurrent call without it.
describe("UpdateCustomer.vue Submit button guards against a rapid double-click", () => {
	it("submit_dialog() checks a synchronous in-flight flag before doing any work", () => {
		const methodMatch = updateCustomerSource.match(
			/async submit_dialog\(\)\s*\{[\s\S]*?\n\t\t\},/,
		);
		expect(methodMatch).not.toBeNull();
		const body = methodMatch![0];
		expect(body).toMatch(/if\s*\(\s*this\.submitLoading\s*\)\s*\{\s*return;\s*\}/);
		expect(body).toMatch(/this\.submitLoading\s*=\s*true;/);
	});

	it("resets submitLoading in a finally block, so the guard can't get stuck permanently true", () => {
		const methodMatch = updateCustomerSource.match(
			/async submit_dialog\(\)\s*\{[\s\S]*?\n\t\t\},/,
		);
		expect(methodMatch).not.toBeNull();
		expect(methodMatch![0]).toMatch(
			/finally\s*\{\s*this\.submitLoading\s*=\s*false;\s*\}/,
		);
	});

	it("submit_dialog() delegates the real work to a separate function awaited inside the guard", () => {
		const methodMatch = updateCustomerSource.match(
			/async submit_dialog\(\)\s*\{[\s\S]*?\n\t\t\},/,
		);
		expect(methodMatch).not.toBeNull();
		expect(methodMatch![0]).toMatch(/await this\._submit_dialog_impl\(\);/);
		expect(updateCustomerSource).toMatch(/async _submit_dialog_impl\(\)\s*\{/);
	});

	it("binds both :loading and :disabled to submitLoading on the Submit button", () => {
		const buttonMatch = updateCustomerSource.match(
			/<v-btn[^>]*@click="submit_dialog"[\s\S]{0,400}/,
		);
		// The button attributes may appear before @click in source order --
		// search the whole <v-btn ...> opening tag around the click handler.
		const submitButtonBlock = updateCustomerSource
			.split(/<v-btn/)
			.find((chunk) => chunk.includes('@click="submit_dialog"'));
		expect(submitButtonBlock).toBeDefined();
		expect(submitButtonBlock).toMatch(/:loading="submitLoading"/);
		expect(submitButtonBlock).toMatch(/:disabled="submitLoading"/);
		// Keep the original loose match from going unused/misleading if the
		// button markup is ever restructured across multiple lines.
		expect(buttonMatch || submitButtonBlock).toBeTruthy();
	});

	it("the create_customer call is properly awaited, not a fire-and-forget callback", () => {
		// The awaited form: an object literal with only method+args (no
		// trailing callback: property) -- this match itself is proof the old
		// fire-and-forget `callback: async (r) => {...}` shape is gone, since
		// that shape could never match this exact "ends right after args"
		// pattern.
		const createCallMatch = updateCustomerSource.match(
			/const r = await frappe\.call\(\{\s*method:\s*"posawesome\.posawesome\.api\.customers\.create_customer",\s*args:\s*apiArgs,\s*\}\);/,
		);
		expect(createCallMatch).not.toBeNull();
	});

	it("wraps the awaited create_customer call in try/catch so a transport failure surfaces a toast instead of an unhandled rejection", () => {
		const tryBlockMatch = updateCustomerSource.match(
			/try\s*\{\s*const r = await frappe\.call\(\{[\s\S]*?\}\s*catch \(error\) \{[\s\S]*?Customer creation failed[\s\S]*?\}/,
		);
		expect(tryBlockMatch).not.toBeNull();
	});
});
