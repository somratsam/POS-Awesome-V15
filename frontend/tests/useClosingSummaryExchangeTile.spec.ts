import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useClosingSummary } from "../src/posapp/composables/pos/closing/useClosingSummary";

const formatters = {
	formatCurrencyWithSymbol: (value: number, currency: string) => `${value} ${currency}`,
	formatCount: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: (currency: string) => currency,
	__: (text: string) => text,
};

describe("useClosingSummary Exchanges Today tile", () => {
	it("surfaces same_shift_exchange_total as its own tile, labeled as a subset of credit used/issued", () => {
		const overview = ref({
			company_currency: "OMR",
			same_shift_exchange_total: 40,
			customer_credit_redeemed: { count: 1, company_currency_total: 40, by_currency: [] },
			customer_credit_issued: { count: 1, company_currency_total: 40, by_currency: [] },
		});

		const { secondaryInsights } = useClosingSummary(overview, ref(null), ref(null), formatters);

		const tile = secondaryInsights.value.find((row: any) => row.key === "same-shift-exchange");
		expect(tile).toBeDefined();
		expect(tile.label).toBe("Exchanges Today");
		expect(tile.value).toBe("40 OMR");
		expect(tile.caption).toBe("Included in Customer Credit Used & Issued above");
	});

	it("shows zero, not a crash, when the overview payload doesn't include the field yet", () => {
		const overview = ref({ company_currency: "OMR" });

		const { secondaryInsights } = useClosingSummary(overview, ref(null), ref(null), formatters);

		const tile = secondaryInsights.value.find((row: any) => row.key === "same-shift-exchange");
		expect(tile.value).toBe("0 OMR");
	});

	it("updates reactively when the overview ref changes", () => {
		const overview = ref<any>({ company_currency: "OMR", same_shift_exchange_total: 0 });
		const { secondaryInsights } = useClosingSummary(overview, ref(null), ref(null), formatters);

		expect(
			secondaryInsights.value.find((row: any) => row.key === "same-shift-exchange").value,
		).toBe("0 OMR");

		overview.value = { company_currency: "OMR", same_shift_exchange_total: 72.5 };

		expect(
			secondaryInsights.value.find((row: any) => row.key === "same-shift-exchange").value,
		).toBe("72.5 OMR");
	});
});
