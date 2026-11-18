import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("InvoiceManagement uses the tags everywhere", () => {
	const source = readFileSync(
		`${process.cwd()}/src/posapp/components/pos/flows/InvoiceManagement.vue`,
		"utf8",
	);
	it("History list and cards, Returns list and cards, and the detail popup", () => {
		expect(source.match(/<InvoiceCreditTags[^>]*part="badge"/g)?.length).toBe(5);
		expect(source.match(/part="lines"/g)?.length).toBe(5);
		expect(source.match(/@open="openLinkedInvoice"/g)?.length).toBe(5);
		expect(source).not.toContain("exchangeCreditBadgeColor");
	});
	it("chip filters on History and Returns", () => {
		expect(source).toContain('data-testid="history-credit-filters"');
		expect(source).toContain('data-testid="return-credit-filters"');
	});
	it('the status filter has no "Credit Note Issued" and compares the shown status', () => {
		expect(source).toContain('historyStatusItems: ["All", "Paid", "Partly Paid", "Unpaid", "Overdue"],');
		expect(source).toContain("displayInvoiceStatus(item) !== status");
		expect(source).not.toMatch(/statusColor\((item|invoice)\.status\)/);
	});
});
