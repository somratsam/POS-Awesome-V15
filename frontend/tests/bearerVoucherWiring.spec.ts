// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Anonymous bearer voucher: wiring", () => {
	it("the customer box is locked, with a note, on a return or voucher sale of a shared customer", () => {
		const source = read("src/posapp/components/pos/customer/Customer.vue");
		const field = source.slice(source.indexOf("<v-autocomplete"), source.indexOf(">", source.indexOf(":disabled=", source.indexOf("<v-autocomplete"))));
		expect(field).toContain('Boolean(sharedCustomerLockNote)');
		const walkin = source.slice(source.indexOf("walkin-customer-btn"), source.indexOf("</v-btn>", source.indexOf("walkin-customer-btn")));
		expect(walkin).toContain('Boolean(sharedCustomerLockNote)');
		expect(source).toContain('v-if="!sharedCustomerLockNote" :text="__(\'Add new customer\')"');
		expect(source).toContain('data-testid="shared-customer-lock-note"');
		expect(source).toContain("This sale was to {0} — the credit is given as a voucher.");
		expect(source).toContain("doc.is_return && doc.return_against");
		expect(source).toContain("customersStore.hasBearerVoucherFor(customer)");
		// Typing or the Walk-in button can't change a locked customer either.
		const change = source.slice(source.indexOf("const onCustomerChange"), source.indexOf("tempSelectedCustomer.value = val;"));
		expect(change).toContain("if (sharedCustomerLockNote.value)");
		const walkinFn = source.slice(source.indexOf("const select_walkin_customer"), source.indexOf("const walkinCustomer"));
		expect(walkinFn).toContain("if (sharedCustomerLockNote.value) return;");
	});

	it("both return flows load a sale to a shared customer instead of refusing it", () => {
		for (const path of [
			"src/posapp/components/pos/flows/Returns.vue",
			"src/posapp/components/pos/flows/InvoiceManagement.vue",
		]) {
			const source = read(path);
			expect(source, path).not.toContain('Use "Return without Invoice" instead');
			expect(source, path).toMatch(/customersStore\.markSharedCustomer\((return_doc|returnDoc)\.customer\)/);
			expect(source, path).toContain("customersStore.dropBearerVouchers()");
		}
	});

	it("cancel and park drop a bearer voucher; switching credit off does too", () => {
		const actions = read("src/posapp/components/pos/invoice_utils/actions.ts");
		expect(actions.match(/customersStore\?\.dropBearerVouchers\?\.\(\)/g)?.length).toBe(2);
		const payments = read("src/posapp/components/pos/Payments.vue");
		const toggle = payments.slice(payments.indexOf("const setRedeemCustomerCredit"), payments.indexOf("};", payments.indexOf("const setRedeemCustomerCredit")));
		expect(toggle).toContain("if (!value) customersStore.dropBearerVouchers();");
		expect(payments).toContain("if (voucher.bearer) customersStore.markSharedCustomer(voucher.customer);");
	});
});
