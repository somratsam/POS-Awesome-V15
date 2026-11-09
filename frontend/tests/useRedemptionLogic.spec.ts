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
			// These tests are about amounts; authorization is in creditAuthorization.spec.ts.
			getAuthorizationContext: () => ({ supervisor: true }),
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

	it("uses credit worth more than the sale up to the sale amount and leaves the rest on the credit note", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [
				{ type: "Invoice", credit_origin: "SINV-1", total_credit: 50, credit_to_redeem: 0, expires_on: "2027-02-01" },
			],
		}));
		const toastShow = vi.fn();
		const invoiceDoc = ref<any>({ customer: "CUST-0001", rounded_total: 45, grand_total: 45, currency: "OMR", conversion_rate: 1 });

		const {
			customer_credit_dict,
			redeemed_customer_credit,
			customer_credit_redemption_requested,
			customer_credit_blocked,
			credit_remainders,
			credit_remainder_total,
			get_available_credit,
		} = useRedemptionLogic({
			getAuthorizationContext: () => ({ supervisor: true }),
			invoiceDoc,
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(3),
			formatFloat: (value: any) => Number(value || 0),
			stores: { toastStore: { show: toastShow } },
		});

		get_available_credit(true);
		await flush();

		expect(customer_credit_redemption_requested.value).toBe(true);
		expect(customer_credit_blocked.value).toBe(false);
		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(45);
		expect(redeemed_customer_credit.value).toBe(45);
		expect(credit_remainder_total.value).toBe(5);
		expect(credit_remainders.value).toEqual([
			{ credit_origin: "SINV-1", voucher: undefined, total_credit: 50, used: 45, remaining: 5 },
		]);
		// No red "select items worth at least..." message any more.
		expect(toastShow).not.toHaveBeenCalled();

		// Cart grows past the credit: it is all used and nothing is left over.
		invoiceDoc.value = { ...invoiceDoc.value, rounded_total: 150, grand_total: 150 };
		await flush();
		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(50);
		expect(credit_remainder_total.value).toBe(0);

		// And shrinks again: back to a part use.
		invoiceDoc.value = { ...invoiceDoc.value, rounded_total: 20, grand_total: 20 };
		await flush();
		expect(customer_credit_dict.value[0].credit_to_redeem).toBe(20);
		expect(credit_remainder_total.value).toBe(30);
	});

	it("uses the credit that expires soonest first, advances last, so only the last one is used in part", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [
				{ type: "Advance", credit_origin: "PE-1", total_credit: 10, credit_to_redeem: 0 },
				{ type: "Invoice", credit_origin: "LATE", total_credit: 30, credit_to_redeem: 0, expires_on: "2027-03-01" },
				{ type: "Invoice", credit_origin: "SOON", total_credit: 30, credit_to_redeem: 0, expires_on: "2027-01-15" },
			],
		}));
		const invoiceDoc = ref<any>({ customer: "C", rounded_total: 45, grand_total: 45, currency: "OMR", conversion_rate: 1 });
		const { customer_credit_dict, redeemed_customer_credit, credit_remainders, get_available_credit } =
			useRedemptionLogic({
				getAuthorizationContext: () => ({ supervisor: true }),
				invoiceDoc,
				posProfile: ref({ company: "Test Co", currency: "OMR" }),
				customerInfo: ref({}),
				currencyPrecision: ref(3),
				formatFloat: (value: any) => Number(value || 0),
			});

		get_available_credit(true);
		await flush();

		const used = Object.fromEntries((customer_credit_dict.value as any[]).map((r) => [r.credit_origin, r.credit_to_redeem]));
		expect(used).toEqual({ SOON: 30, LATE: 15, "PE-1": 0 });
		expect(redeemed_customer_credit.value).toBe(45);
		expect(credit_remainders.value.map((r) => [r.credit_origin, r.remaining])).toEqual([["LATE", 15]]);
	});

	it("leaves room for gift cards: credit only covers what the sale still needs", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [{ type: "Invoice", credit_origin: "SINV-1", total_credit: 50, credit_to_redeem: 0, expires_on: "2027-02-01" }],
		}));
		const giftCards = ref(30);
		const invoiceDoc = ref<any>({ customer: "C", rounded_total: 45, grand_total: 45, currency: "OMR", conversion_rate: 1 });
		const { redeemed_customer_credit, credit_remainder_total, get_available_credit } = useRedemptionLogic({
			getAuthorizationContext: () => ({ supervisor: true }),
			invoiceDoc,
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(3),
			formatFloat: (value: any) => Number(value || 0),
			getGiftCardTotal: () => giftCards.value,
		});

		get_available_credit(true);
		await flush();
		expect(redeemed_customer_credit.value).toBe(15);
		expect(credit_remainder_total.value).toBe(35);
	});

	it("rounds each credit note to the currency before adding, as the server does", async () => {
		// Two return-credit rows of 2.2055 each. Each balance is rounded first
		// (2.206 + 2.206 = 4.412), the same figures the server adds up in
		// _validate_customer_credit_redemption, so the two always agree.
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: [
				{ type: "Invoice", credit_origin: "SINV-1", total_credit: 2.2055, credit_to_redeem: 0 },
				{ type: "Invoice", credit_origin: "SINV-2", total_credit: 2.2055, credit_to_redeem: 0 },
				{ type: "Invoice", credit_origin: "SINV-3", total_credit: 0, credit_to_redeem: 0 },
			],
		}));

		const invoiceDoc = ref<any>({ customer: "JUMA", rounded_total: 10, grand_total: 10, currency: "OMR", conversion_rate: 1 });

		const { available_customer_credit, redeemed_customer_credit, customer_credit_dict, credit_remainder_total, get_available_credit } =
			useRedemptionLogic({
				getAuthorizationContext: () => ({ supervisor: true }),
				invoiceDoc,
				posProfile: ref({ company: "Test Co", currency: "OMR" }),
				customerInfo: ref({}),
				currencyPrecision: ref(3),
				formatFloat: (value: any, prec = 3) =>
					Number((Math.round((Number(value) + Number.EPSILON) * 10 ** prec) / 10 ** prec).toFixed(prec)),
			});

		get_available_credit(true);
		await flush();

		expect(available_customer_credit.value).toBe(4.412);
		expect(redeemed_customer_credit.value).toBe(4.412);
		expect((customer_credit_dict.value as any[]).map((r) => r.credit_to_redeem)).toEqual([2.206, 2.206, 0]);
		expect(credit_remainder_total.value).toBe(0);
	});
});

describe("useRedemptionLogic expired store credit", () => {
	beforeEach(() => {
		(globalThis as any).__ = (str: string, args: any[] = []) =>
			str.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
	});

	it("applies only unexpired credit and tells the cashier about the expired part", async () => {
		const call = vi.fn(async () => ({
			message: {
				credit: [{ type: "Invoice", credit_origin: "CN-NEW", total_credit: 20, credit_to_redeem: 0 }],
				expired: [
					{ type: "Invoice", credit_origin: "CN-OLD", total_credit: 7.5, expires_on: "2026-10-01" },
				],
			},
		}));
		(globalThis as any).frappe = { call, datetime: { str_to_user: (d: string) => `user:${d}` } };
		const toastStore = { show: vi.fn() };

		const { customer_credit_dict, redeemed_customer_credit, get_available_credit } = useRedemptionLogic({
			// These tests are about amounts; authorization is in creditAuthorization.spec.ts.
			getAuthorizationContext: () => ({ supervisor: true }),
			invoiceDoc: ref<any>({ customer: "CUST-0001", rounded_total: 100, grand_total: 100, conversion_rate: 1 }),
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(3),
			formatFloat: (value: any) => Number(value || 0),
			stores: { toastStore },
		});

		get_available_credit(true);
		await flush();

		expect(call).toHaveBeenCalledWith("posawesome.posawesome.api.payments.get_available_credit", {
			customer: "CUST-0001",
			company: "Test Co",
			include_expired: 1,
		});
		expect(customer_credit_dict.value.map((row: any) => row.credit_origin)).toEqual(["CN-NEW"]);
		expect(redeemed_customer_credit.value).toBe(20);
		const expiredToast = toastStore.show.mock.calls
			.map(([payload]: any[]) => payload)
			.find((payload: any) => payload.key === "customer-credit-expired");
		expect(expiredToast?.title).toBe(
			"Store credit of 7.500 OMR has expired (expired on user:2026-10-01) and can't be used. Store credit is valid for 3 months.",
		);
		// Credit was applied: the expired part is an orange note, not an error.
		expect(expiredToast?.color).toBe("warning");
	});

	it("still accepts the old plain-list response", async () => {
		(globalThis as any).frappe = {
			call: vi.fn(async () => ({
				message: [{ type: "Invoice", credit_origin: "CN-1", total_credit: 10, credit_to_redeem: 0 }],
			})),
		};
		const { customer_credit_dict, get_available_credit } = useRedemptionLogic({
			// These tests are about amounts; authorization is in creditAuthorization.spec.ts.
			getAuthorizationContext: () => ({ supervisor: true }),
			invoiceDoc: ref<any>({ customer: "CUST-0001", rounded_total: 50, grand_total: 50, conversion_rate: 1 }),
			posProfile: ref({ company: "Test Co", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(3),
			formatFloat: (value: any) => Number(value || 0),
		});

		get_available_credit(true);
		await flush();

		expect(customer_credit_dict.value.map((row: any) => row.credit_origin)).toEqual(["CN-1"]);
	});
});
