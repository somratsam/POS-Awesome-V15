// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import {
	creditBadge,
	creditLines,
	matchesCreditFilter,
	hasUnusedCredit,
	displayInvoiceStatus,
} from "../src/posapp/utils/invoiceCreditLabels";
import InvoiceCreditTags from "../src/posapp/components/pos/flows/InvoiceCreditTags.vue";

const fmt = { money: (v: number) => v.toFixed(3), date: (d: string) => d.split("-").reverse().join("-") };
const text = (lines: any[]) =>
	lines.map((line) => line.segments.map((s: any) => ("link" in s ? `[${s.link}]` : s.text)).join(""));

const sale = (extra: Record<string, unknown> = {}) => ({
	name: "S-1",
	is_return: 0,
	credit_kind: "sale",
	exchange_returns: [],
	credit_notes_used: [],
	returned_state: null,
	returned_by: [],
	...extra,
});
const ret = (extra: Record<string, unknown> = {}) => ({
	name: "R-1",
	is_return: 1,
	credit_kind: "credit_note",
	exchange_credit_badge: "Credit note",
	exchange_sales: [],
	credit_issued: 30.45,
	credit_left: 30.45,
	credit_valid_until: "2027-02-18",
	credit_expired: false,
	credit_used_on: [],
	...extra,
});

describe("Invoice Management credit labels (approved table)", () => {
	it("normal sale: no badge, no line", () => {
		expect(creditBadge(sale())).toBeNull();
		expect(creditLines(sale(), fmt)).toEqual([]);
	});

	it("credit note unused / part used / fully used / expired", () => {
		expect(creditBadge(ret())).toMatchObject({ text: "Credit note", color: "warning" });
		expect(text(creditLines(ret(), fmt))).toEqual(["Credit note issued 30.450"]);
		expect(text(creditLines(ret({ credit_left: 12 }), fmt))).toEqual(["12.000 left of 30.450"]);
		expect(text(creditLines(ret({ credit_left: 0 }), fmt))).toEqual(["Used"]);
		expect(text(creditLines(ret({ credit_expired: true }), fmt))).toEqual([
			"Credit note issued 30.450 · Expired on 18-02-2027",
		]);
	});

	it("detail popup adds Valid until and where the credit was used", () => {
		const row = ret({ credit_left: 12, credit_used_on: [{ sale: "S-9", used: 18.45, exchange: false }] });
		expect(text(creditLines(row, fmt, { detail: true }))).toEqual([
			"12.000 left of 30.450",
			"Valid until 18-02-2027",
			"Used 18.450 on [S-9]",
		]);
	});

	it("exchange return links its sale; credit left shows as a credit note issued", () => {
		const row = ret({ exchange_credit_badge: "Exchange", credit_kind: "exchange", exchange_sales: ["S-2"], credit_issued: 0, credit_left: 0 });
		expect(creditBadge(row)).toMatchObject({ text: "Exchange", color: "info" });
		expect(text(creditLines(row, fmt))).toEqual(["Exchange → [S-2]"]);
		const withRest = ret({ exchange_credit_badge: "Exchange", exchange_sales: ["S-2"], credit_issued: 31.5, credit_left: 31.5 });
		expect(text(creditLines(withRest, fmt))).toEqual(["Exchange → [S-2]", "Credit note issued 31.500"]);
	});

	it("exchange sale, sale paid with an older credit note, originals part/whole returned", () => {
		expect(text(creditLines(sale({ exchange_returns: ["R-1"] }), fmt))).toEqual(["Exchange for return [R-1]"]);
		expect(text(creditLines(sale({ credit_notes_used: ["R-0"] }), fmt))).toEqual(["Paid with credit note [R-0]"]);
		expect(text(creditLines(sale({ returned_state: "part", returned_by: ["R-1"] }), fmt))).toEqual([
			"Returned: part — [R-1]",
		]);
		expect(text(creditLines(sale({ returned_state: "whole", returned_by: ["R-1", "R-2"] }), fmt))).toEqual([
			"Returned: whole — [R-1], [R-2]",
		]);
	});

	it("money refund (old data): no badge and no credit line", () => {
		const row = ret({ exchange_credit_badge: null, credit_kind: "refund", credit_issued: 0, credit_left: 0 });
		expect(creditBadge(row)).toBeNull();
		expect(creditLines(row, fmt)).toEqual([]);
	});

	it("chip filters", () => {
		const exchangeSale = sale({ credit_kind: "exchange" });
		const creditSale = sale({ credit_kind: "credit_note" });
		const returnedSale = sale({ returned_state: "part" });
		expect(matchesCreditFilter(sale(), "sales")).toBe(true);
		expect(matchesCreditFilter(returnedSale, "sales")).toBe(true);
		expect(matchesCreditFilter(exchangeSale, "sales")).toBe(false);
		expect(matchesCreditFilter(exchangeSale, "exchanges")).toBe(true);
		expect(matchesCreditFilter(creditSale, "credit_notes")).toBe(true);
		expect(matchesCreditFilter(returnedSale, "returned")).toBe(true);
		expect(matchesCreditFilter(sale(), "returned")).toBe(false);
		expect(hasUnusedCredit(ret())).toBe(true);
		expect(hasUnusedCredit(ret({ credit_left: 0 }))).toBe(false);
		expect(hasUnusedCredit(ret({ credit_expired: true }))).toBe(false);
		expect(matchesCreditFilter(ret({ credit_kind: "refund" }), "credit_notes")).toBe(false);
		expect(matchesCreditFilter(ret({ credit_kind: "refund" }), "all")).toBe(true);
	});
});

describe("InvoiceCreditTags", () => {
	it("renders the lines; a link emits open with the invoice", async () => {
		const onOpen = vi.fn();
		const lines = mount(InvoiceCreditTags, {
			props: { invoice: sale({ exchange_returns: ["R-7"] }), part: "lines", onOpen },
		});
		expect(lines.text()).toBe("Exchange for return R-7");
		await lines.find("a").trigger("click");
		expect(onOpen).toHaveBeenCalledWith("R-7");
	});
});

describe("original invoice status in the POS", () => {
	it('shows ERPNext\'s "Credit Note Issued" on a sale as "Paid"; everything else unchanged', () => {
		expect(displayInvoiceStatus({ status: "Credit Note Issued", is_return: 0 })).toBe("Paid");
		expect(displayInvoiceStatus({ status: "Paid", is_return: 0 })).toBe("Paid");
		expect(displayInvoiceStatus({ status: "Overdue", is_return: 0 })).toBe("Overdue");
		expect(displayInvoiceStatus({ status: "Return", is_return: 1 })).toBe("Return");
		expect(displayInvoiceStatus({ status: "Credit Note Issued", is_return: 1 })).toBe("Credit Note Issued");
	});
});
