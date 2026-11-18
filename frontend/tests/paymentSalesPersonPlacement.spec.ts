// Payment screen: Sales Person sits at the top of the right column, right
// above Redemption and Totals (no empty gap), and is still wired to the sale's
// Sales Team exactly as before. Auto-fill happens on the server at submit
// (sales_credit.apply_pos_sales_team) and doesn't depend on this placement.

import { describe, expect, it } from "vitest";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";

const template = paymentsSource.slice(0, paymentsSource.indexOf("<script"));
const style = paymentsSource.slice(paymentsSource.indexOf("<style"));

describe("payment screen: Sales Person placement", () => {
	it("puts Sales Person first in the right column, then the totals", () => {
		const side = template.indexOf('<div class="payment-side">');
		const meta = template.indexOf("payment-section--meta");
		const totals = template.indexOf("payment-section--adjustments");
		const settlement = template.indexOf("payment-section--settlement");
		expect(side).toBeGreaterThan(-1);
		expect(side).toBeLessThan(meta);
		expect(meta).toBeLessThan(totals);
		// both panels are inside the wrapper, which closes before the left column's settlement panel
		const sideEnd = template.indexOf("</div>\n", totals);
		expect(template.lastIndexOf('<div class="payment-side">', totals)).toBe(side);
		expect(settlement).toBeGreaterThan(totals);
		expect(template.indexOf("<PaymentSelectionFields")).toBeGreaterThan(meta);
		expect(template.indexOf("<PaymentSelectionFields")).toBeLessThan(totals);
		expect(sideEnd).toBeGreaterThan(totals);
	});

	it("has no grid row that pushes it below the long left-hand panels", () => {
		expect(style).toMatch(/grid-template-areas:\s*"summary side"\s*"methods side"\s*"settlement side";/);
		expect(style).not.toMatch(/"settlement meta"/);
		expect(style).toMatch(/\.payment-sections--dialog \.payment-side \{[^}]*grid-area: side;/);
	});

	it("still saves the chosen Sales Person on the sale (100%) and follows the original on returns", () => {
		expect(template).toMatch(/:sales-person="sales_person"/);
		expect(template).toMatch(/@update:sales-person="sales_person = \$event"/);
		expect(template).toMatch(/:follows-original="!!\(invoice_doc\?\.is_return && invoice_doc\?\.return_against\)"/);
		expect(paymentsSource).toMatch(
			/watch\(sales_person, \(newVal\) => \{[\s\S]*?sales_team = \[\s*\{\s*sales_person: newVal,\s*allocated_percentage: 100,/,
		);
	});
});
