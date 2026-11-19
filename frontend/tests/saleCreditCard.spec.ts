// Section 112: the credit note voucher card in the Active sale box.
import { describe, expect, it } from "vitest";
import { buildSaleCreditCard, daysUntil } from "../src/posapp/utils/saleCreditCard";
import summarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import buttonsSource from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue?raw";
import cardSource from "../src/posapp/components/pos/invoice/SaleCreditCard.vue?raw";
import composableSource from "../src/posapp/composables/pos/payments/useSaleCreditCard.ts?raw";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import arCsv from "../../posawesome/translations/ar.csv?raw";

const t = (text: string, args: any[] = []) => text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
const money = (value: number) => `OMR ${Math.abs(value).toFixed(3)}`;
const VOUCHER = { voucher: "C26-00415-7HRG", credit_origin: "ACC-SINV-2026-00415", amount: 15.75, expires_on: "2026-12-12", store: "test 222" };
const build = (figures: any, vouchers: any[] = [VOUCHER], today = "2026-11-19") =>
	buildSaleCreditCard({ vouchers, figures, today, money, formatDate: (d) => `D(${d})`, t });

describe("voucher card text", () => {
	it("the voucher's own facts: code, available, valid until, issuing store", () => {
		const card = build({ credit: 0, pay: 0, total: 0, left: 15.75 });
		expect(card.title).toBe("C26-00415-7HRG");
		expect(card.available).toBe("OMR 15.750");
		expect(card.validUntil).toBe("D(2026-12-12)");
		expect(card.store).toBe("test 222");
		expect(card.expiryChip).toBe("");
	});

	it("checking: the result row says so, PAY gets no new label", () => {
		const card = build(null);
		expect(card.state).toBe("checking");
		expect(card.result).toBe("Checking…");
		expect(card.pay).toBe("");
	});

	it("empty cart: now scan the new items", () => {
		const card = build({ credit: 0, pay: 0, total: 0, left: 15.75 });
		expect(card.state).toBe("scan");
		expect(card.result).toBe("Now scan the new items");
		expect(card.pay).toBe("Pay");
	});

	it("cart more than the credit: customer pays the rest", () => {
		const card = build({ credit: 15.75, pay: 4.25, total: 20, left: 0 });
		expect(card.state).toBe("pays");
		expect(card.result).toBe("Credit used −OMR 15.750 · Customer pays OMR 4.250");
		expect(card.resultShort).toBe("Customer pays OMR 4.250");
		expect(card.pay).toBe("Pay OMR 4.250");
	});

	it("cart less than the credit: the BALANCE voucher", () => {
		const card = build({ credit: 9, pay: 0, total: 9, left: 6.75 });
		expect(card.state).toBe("balance");
		expect(card.result).toBe("Credit used −OMR 9.000 · Balance voucher OMR 6.750");
		expect(card.resultShort).toBe("Balance voucher OMR 6.750");
		expect(card.pay).toBe("Pay OMR 0.000");
	});

	it("exactly the credit: covered, customer pays 0", () => {
		const card = build({ credit: 15.75, pay: 0, total: 15.75, left: 0 });
		expect(card.state).toBe("covered");
		expect(card.result).toBe("Credit covers it · Customer pays OMR 0.000");
		expect(card.resultShort).toBe("Credit covers it");
	});

	it("amber chip from 7 days before expiry, not 8; today; none once expired", () => {
		const at = (today: string) => build({ credit: 0, pay: 0, total: 0 }, [VOUCHER], today).expiryChip;
		expect(at("2026-12-04")).toBe(""); // 8 days
		expect(at("2026-12-05")).toBe("Expires in 7 days");
		expect(at("2026-12-11")).toBe("Expires in 1 day");
		expect(at("2026-12-12")).toBe("Expires today");
		expect(at("2026-12-13")).toBe(""); // the server refuses an expired voucher anyway
		expect(daysUntil("2027-01-02", "2026-12-30")).toBe(3); // across the year
	});

	it("two vouchers: counted, added, the earliest expiry, both stores", () => {
		const second = { ...VOUCHER, voucher: "C26-MCO-00019-6S78", credit_origin: "MCO-CN-2026-00019", amount: 14.25, expires_on: "2026-11-24", store: "Avenues" };
		const card = build({ credit: 0, pay: 0, total: 0 }, [VOUCHER, second]);
		expect(card.title).toBe("2 credit notes");
		expect(card.available).toBe("OMR 30.000");
		expect(card.validUntil).toBe("D(2026-11-24)");
		expect(card.expiryChip).toBe("Expires in 5 days");
		expect(card.store).toBe("test 222, Avenues");
	});

	it("a return made in Desk has no store: nothing shown", () => {
		expect(build(null, [{ ...VOUCHER, store: "" }]).store).toBe("");
	});
});

describe("wiring", () => {
	it("the card in the Active sale box, under 1100 px, and in Counter Grid", () => {
		expect(summarySource).toContain('<SaleCreditCard variant="full" :card="saleCreditCard" />');
		expect(summarySource).toContain("heroCreditVariant === 'full'");
		expect((summarySource.match(/<SaleCreditCard variant="compact" :card="saleCreditCard" \/>/g) || []).length).toBe(2);
		expect(summarySource).toContain('<SaleCreditCard variant="counter" :card="saleCreditCard"');
		expect(summarySource).toContain('responsive.windowWidth.value >= 1600 && responsive.windowHeight.value >= 960 ? "full" : "compact"');
	});

	it("PAY keeps the last amount, dimmed: the new prop reaches both buttons", () => {
		expect((summarySource.match(/:credit-pay-pending="saleCreditLabels.pending"/g) || []).length).toBe(2);
		expect(buttonsSource).toContain("creditPayPending: { type: Boolean, default: false },");
		expect((buttonsSource.match(/'pay-btn--credit-pending': creditPending/g) || []).length).toBe(2);
		expect(composableSource).toContain("pay: card.value.pay || lastPay.value,");
	});

	it("the small-screen sale dock shows the two-line card too", () => {
		expect(posSource).toContain('variant="compact"');
		expect(posSource).toContain(':card="dockSaleCreditCard"');
		expect(posSource).toContain("SaleCreditCard,");
	});

	it("the card flashes on each new voucher and has a real Remove button", () => {
		expect(cardSource).toContain("() => saleCredit.appliedCount");
		expect(cardSource).toContain("if (Date.now() - (Number(saleCredit.appliedAt) || 0) < 1000) flash();");
		expect(cardSource).toContain("sale-credit-card--flash");
		expect((cardSource.match(/data-testid="sale-credit-remove"/g) || []).length).toBe(3);
	});
});

describe("Arabic", () => {
	const keys = new Set(arCsv.split("\n").map((row) => row.split(",")[0]));
	it("every new string has Arabic", () => {
		for (const text of [
			"Customer from credit note",
			"{0} credit notes",
			"{0} available",
			"Valid until {0}",
			"until {0}",
			"From {0}",
			"Now scan the new items",
			"After this sale:",
			"Credit used",
			"Customer pays {0}",
			"Balance voucher {0}",
			"Credit covers it",
			"Expires today",
			"Expires in 1 day",
			"Expires in {0} days",
			"Pay {0}",
			"Remove",
			"Checking…",
		]) {
			expect(keys.has(text), text).toBe(true);
		}
	});
});
