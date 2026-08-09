import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRedemptionLogic } from "../src/posapp/composables/pos/payments/useRedemptionLogic";

// Flushes both the frappe.call().then() microtask chain and Vue's watcher
// scheduler -- a single nextTick() isn't reliably enough hops for both.
const flush = async () => {
	for (let i = 0; i < 5; i += 1) {
		await Promise.resolve();
	}
	await nextTick();
	await nextTick();
};

describe("useRedemptionLogic", () => {
	beforeEach(() => {
		(globalThis as any).frappe = {
			call: vi.fn(),
		};
		(globalThis as any).__ = (str: string) => str;
	});

	it("caps customer credit allocations to the remaining invoice amount after loyalty", async () => {
		const invoiceDoc = ref<any>({
			customer: "CUST-0001",
			rounded_total: 500,
			grand_total: 500,
			currency: "PKR",
			conversion_rate: 1,
		});

		const { customer_credit_dict, redeemed_customer_credit, loyalty_amount } =
			useRedemptionLogic({
				invoiceDoc,
				posProfile: ref({ company: "Test Co", currency: "PKR" }),
				customerInfo: ref({}),
				currencyPrecision: ref(2),
				formatFloat: (value: any) => Number(value || 0),
			});

		loyalty_amount.value = 100;
		customer_credit_dict.value = [
			{ total_credit: 300, credit_to_redeem: 300 },
			{ total_credit: 300, credit_to_redeem: 200 },
		];

		await nextTick();
		await nextTick();

		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(300);
		expect(customer_credit_dict.value[1].credit_to_redeem).toBe(100);
		expect(redeemed_customer_credit.value).toBe(400);
	});

	it("normalizes per-source amounts so they stay within each source balance", async () => {
		const invoiceDoc = ref<any>({
			customer: "CUST-0001",
			rounded_total: 500,
			grand_total: 500,
			currency: "PKR",
			conversion_rate: 1,
		});

		const { customer_credit_dict, redeemed_customer_credit } = useRedemptionLogic({
			invoiceDoc,
			posProfile: ref({ company: "Test Co", currency: "PKR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(2),
			formatFloat: (value: any) => Number(value || 0),
		});

		customer_credit_dict.value = [
			{ total_credit: 150, credit_to_redeem: 250 },
			{ total_credit: 90, credit_to_redeem: -10 },
		];

		await nextTick();
		await nextTick();

		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(150);
		expect(customer_credit_dict.value[1].credit_to_redeem).toBe(0);
		expect(redeemed_customer_credit.value).toBe(150);
	});

	it("applies the full available credit automatically when eligible via get_available_credit", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [
				{ type: "Invoice", credit_origin: "SINV-1", total_credit: 60, credit_to_redeem: 0 },
			],
		}));

		const invoiceDoc = ref<any>({
			customer: "CUST-0001",
			rounded_total: 100,
			grand_total: 100,
			currency: "OMR",
			conversion_rate: 1,
		});

		const {
			customer_credit_dict,
			redeemed_customer_credit,
			customer_credit_redemption_requested,
			customer_credit_blocked,
			get_available_credit,
		} = useRedemptionLogic({
			invoiceDoc,
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(2),
			formatFloat: (value: any) => Number(value || 0),
		});

		get_available_credit(true);
		await flush();

		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(60);
		expect(redeemed_customer_credit.value).toBe(60);
		expect(customer_credit_redemption_requested.value).toBe(true);
		expect(customer_credit_blocked.value).toBe(false);

		// A manual attempt to reduce it (bypassing the readonly UI field)
		// snaps back to the full amount rather than allowing a partial
		// redemption.
		customer_credit_dict.value[0].credit_to_redeem = 10;
		await flush();

		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(60);
		expect(redeemed_customer_credit.value).toBe(60);
	});

	it("blocks redemption and shows a message when available credit exceeds the invoice total", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [
				{ type: "Invoice", credit_origin: "SINV-1", total_credit: 100, credit_to_redeem: 0 },
			],
		}));
		const toastShow = vi.fn();

		const invoiceDoc = ref<any>({
			customer: "CUST-0001",
			rounded_total: 60,
			grand_total: 60,
			currency: "OMR",
			conversion_rate: 1,
		});

		const {
			customer_credit_dict,
			redeemed_customer_credit,
			customer_credit_redemption_requested,
			customer_credit_blocked,
			get_available_credit,
		} = useRedemptionLogic({
			invoiceDoc,
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(2),
			formatFloat: (value: any) => Number(value || 0),
			stores: { toastStore: { show: toastShow } },
		});

		get_available_credit(true);
		await flush();

		expect(redeemed_customer_credit.value).toBe(0);
		expect(customer_credit_redemption_requested.value).toBe(false);
		expect(customer_credit_blocked.value).toBe(true);
		expect(toastShow).toHaveBeenCalled();
		// The rows themselves (and their real total_credit) stay visible so
		// the UI can still show "Available Stored Value: 100" while blocked.
		expect(customer_credit_dict.value[0].total_credit).toBe(100);

		// Cart grows enough to cover the credit -- auto-applies in full
		// without needing get_available_credit to be called again.
		invoiceDoc.value = { ...invoiceDoc.value, rounded_total: 150, grand_total: 150 };
		await flush();

		expect(customer_credit_redemption_requested.value).toBe(true);
		expect(customer_credit_blocked.value).toBe(false);
		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(100);
		expect(redeemed_customer_credit.value).toBe(100);
	});
});
