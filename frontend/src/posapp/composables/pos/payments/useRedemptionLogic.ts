import { ref, watch, computed, unref, type Ref } from "vue";
import { isOffline, saveStoredValueSnapshot } from "../../../../offline/index";
import { fromCompanyCurrency } from "../../../utils/erpnextCurrency";
import {
	selectAuthorizedCredit,
	type CreditAuthorizationContext,
	type CreditVoucher,
} from "../../../utils/creditAuthorization";
import { voucherErrorToast } from "../../../utils/voucherMessages";

declare const frappe: any;
declare const __: (_str: string, _args?: any[]) => string;

export interface RedemptionLogicOptions {
	invoiceDoc: Ref<any>;
	posProfile: Ref<any>;
	customerInfo?: Ref<any>;
	currencyPrecision: Ref<number>;
	formatFloat: (_val: any, _prec?: number) => number;
	stores?: {
		toastStore?: any;
	};
	onClearAmounts?: () => void;
	// This sale's shift and whether a POS supervisor is on the till; decides
	// which credit rows can be used without a voucher (creditAuthorization.ts).
	getAuthorizationContext?: () => Omit<CreditAuthorizationContext, "vouchers">;
	// Where scanned vouchers are kept; Payments passes the customers store's,
	// so they survive Payments closing and reopening.
	creditVouchers?: Ref<Record<string, CreditVoucher>>;
	// Also shown as a red line under the voucher box ("" clears it).
	onCreditMessage?: (message: string) => void;
	// Gift cards settle part of the sale before store credit, as on the
	// server (creation.py _amount_due_before_credit).
	getGiftCardTotal?: () => number;
}

// A credit note used in part on this sale: what is left stays on it (same
// voucher, same code, same expiry) and a balance voucher prints after it.
export interface CreditRemainder {
	credit_origin: string;
	voucher?: string;
	total_credit: number;
	used: number;
	remaining: number;
}

// Order credit is used in: the credit that expires soonest first; advances
// (no expiry) last. Same order as the server checks.
export function creditUseOrder(rows: any[]): number[] {
	const key = (row: any) =>
		row?.type === "Invoice" && row?.expires_on ? `0|${String(row.expires_on)}` : "1|";
	return (Array.isArray(rows) ? rows : [])
		.map((row, index) => ({ index, key: key(row) }))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
		.map((entry) => entry.index);
}

export function useRedemptionLogic(options: RedemptionLogicOptions) {
	const { invoiceDoc, posProfile, customerInfo, currencyPrecision, formatFloat, stores } =
		options;

	const currencyContext = (doc = unref(invoiceDoc)) => ({
		...(doc || {}),
		pos_profile: unref(posProfile),
	});

	// State
	const loyalty_amount = ref(0);
	const redeemed_customer_credit = ref(0);
	const customer_credit_dict = ref<any[]>([]);
	// True only when the current customer_credit_dict/redeemed_customer_credit
	// state came from the genuine "Use Customer Balance" toggle below -- not
	// from M-Pesa or the phone payment-request flow, which reuse the same
	// state shape for an unrelated, deliberately-partial settlement amount.
	// Backend validation (customer_credit_redemption_requested in the submit
	// payload) mirrors this flag exactly.
	const customer_credit_redemption_requested = ref(false);
	// Kept for callers that still reset it; credit is never blocked any more:
	// credit bigger than the sale is used up to the sale amount and the rest
	// stays on the credit note.
	const customer_credit_blocked = ref(false);
	// Vouchers scanned/typed for this customer, by credit note name.
	const credit_vouchers = options.creditVouchers || ref<Record<string, CreditVoucher>>({});
	const addCreditVoucher = (voucher: CreditVoucher) => {
		credit_vouchers.value = { ...credit_vouchers.value, [voucher.credit_origin]: voucher };
	};
	// keepCustomer: keep that customer's vouchers (the sale was just switched
	// to them because of a voucher), drop everyone else's.
	const clearCreditVouchers = (keepCustomer: string | null = null) => {
		credit_vouchers.value = keepCustomer
			? Object.fromEntries(
					Object.entries(credit_vouchers.value).filter(([, v]) => v.customer === keepCustomer),
				)
			: {};
	};
	// Raw sum, rounded once: only for the amounts quoted in messages about
	// credit that can't be used (expired, needs a voucher).
	const sumRawCredit = (rows: any[]) =>
		(Array.isArray(rows) ? rows : []).reduce(
			(total, row) => total + (Number(row?.total_credit) || 0),
			0,
		);
	// Each credit note's balance rounded to the currency, then added: the same
	// figures the allocation below and the server use, so what is shown as
	// available is exactly what can be used.
	const available_customer_credit = computed(() => {
		const rows = Array.isArray(customer_credit_dict.value) ? customer_credit_dict.value : [];
		return normalizeFloat(rows.reduce((sum, row) => sum + normalizeFloat(row?.total_credit || 0), 0));
	});

	const available_points_amount = computed(() => {
		const info = unref(customerInfo) || {};
		const doc = unref(invoiceDoc);
		const profile = unref(posProfile);

		if (!doc || !info?.loyalty_points) {
			return 0;
		}

		let amount =
			normalizeFloat(info.loyalty_points) *
			normalizeFloat(info.conversion_factor || 1);

		if (doc.currency && profile?.currency && doc.currency !== profile.currency) {
			amount = normalizeFloat(fromCompanyCurrency(currencyContext(doc), amount));
		}

		return amount;
	});

	const getMaxRedeemableCustomerCredit = () => {
		const doc = unref(invoiceDoc);
		if (!doc) {
			return 0;
		}

		const invoiceTotal = normalizeFloat(doc.rounded_total || doc.grand_total || 0);
		const loyaltyCovered = normalizeFloat(unref(loyalty_amount) || 0);
		const giftCards = normalizeFloat(options.getGiftCardTotal?.() || 0);
		return Math.max(normalizeFloat(invoiceTotal - loyaltyCovered - giftCards), 0);
	};

	// Seeds customer_credit_dict from a freshly-fetched set of credit sources
	// for a genuine "Use Customer Balance" toggle. Marking
	// customer_credit_redemption_requested here (before the assignment below
	// triggers the deep watcher) is what tells normalizeCustomerCreditAllocations
	// -- the single place that actually decides eligibility and fills/zeros
	// amounts -- that this data came from real balance redemption, not
	// M-Pesa/phone payment reusing the same state shape for a specific amount.
	const applyCreditRows = (data: any[]) => {
		customer_credit_redemption_requested.value = true;
		customer_credit_blocked.value = false;
		customer_credit_dict.value = data;
	};

	const resetCustomerCreditState = () => {
		customer_credit_dict.value = [];
		customer_credit_redemption_requested.value = false;
		customer_credit_blocked.value = false;
	};

	// Credit older than its expiry date (3 months, decided by the server) is
	// left out of the redeemable rows; tell the cashier why it isn't there.
	const expiredCreditMessage = (expiredRows: any[]) => {
		const total = normalizeFloat(sumRawCredit(expiredRows)).toFixed(unref(currencyPrecision) ?? 2);
		const latest = expiredRows
			.map((row: any) => String(row?.expires_on || ""))
			.filter(Boolean)
			.sort()
			.pop();
		const currency = unref(posProfile)?.currency || "";
		const expiredOn =
			latest && typeof frappe !== "undefined" && frappe?.datetime?.str_to_user
				? frappe.datetime.str_to_user(latest)
				: latest || "";
		return __(
			"Store credit of {0}{1} has expired (expired on {2}) and can't be used. Store credit is valid for 3 months.",
			[total, currency ? ` ${currency}` : "", expiredOn],
		);
	};

	// Red, long enough to read, above the Payments screen (voucherMessages.ts).
	const showCreditProblem = (message: string) => {
		options.onCreditMessage?.(message);
		stores?.toastStore?.show(voucherErrorToast(message));
	};

	// Credit that can't be used yet: no voucher, no same-shift return, no
	// supervisor on the till.
	const needsVoucherMessage = (rows: any[]) => {
		const currency = unref(posProfile)?.currency || "";
		return __(
			"{0}{1} of this customer's credit needs their credit note voucher: scan or type it below Use Customer Balance. If the voucher is lost, a POS supervisor must approve: switch the till to a supervisor with their PIN, then type the return number in the voucher box.",
			[
				normalizeFloat(sumRawCredit(rows)).toFixed(unref(currencyPrecision) ?? 2),
				currency ? ` ${currency}` : "",
			],
		);
	};

	// Get available customer credit
	const get_available_credit = (use_credit: boolean) => {
		if (options.onClearAmounts) {
			options.onClearAmounts();
		}

		if (use_credit) {
			const customer = unref(invoiceDoc)?.customer;
			const company = unref(posProfile)?.company;

			if (!customer || !company) return;

			// Credit needs the server: a voucher is checked there, and so is a
			// supervisor's approval. (An offline sale with credit would be
			// refused when it syncs.)
			if (isOffline()) {
				resetCustomerCreditState();
				showCreditProblem(__("Store credit can only be used while the POS is online."));
				return;
			}

			frappe
				.call(
					"posawesome.posawesome.api.payments.get_available_credit",
					{
						customer,
						company,
						include_expired: 1,
					},
				)
				.then((r: any) => {
					const message = r.message;
					const data = Array.isArray(message) ? message : message?.credit || [];
					const expired = Array.isArray(message?.expired) ? message.expired : [];
					if (message?.generic_customer) {
						resetCustomerCreditState();
						showCreditProblem(
							__(
								"{0} is a shared customer account: store credit on it can't be used. Select the customer the credit belongs to, or scan their credit note voucher.",
								[customer],
							),
						);
						return;
					}
					// One message, so neither replaces the other on screen; nothing
					// when credit was applied (the applied-voucher message stays up).
					const problems: string[] = [];
					if (data && data.length) {
						saveStoredValueSnapshot(customer, company, data);
					}
					const { authorized, needVoucher } = selectAuthorizedCredit(data || [], {
						...(options.getAuthorizationContext?.() || {}),
						vouchers: credit_vouchers.value,
					});
					// Only when nothing can be used: after a voucher or an exchange is
					// applied, the customer's other credit simply stays on their account.
					if (!authorized.length && expired.length) {
						problems.push(expiredCreditMessage(expired));
					}
					if (needVoucher.length && !authorized.length) {
						problems.push(needsVoucherMessage(needVoucher));
					}
					if (authorized.length) {
						options.onCreditMessage?.("");
						applyCreditRows(authorized);
						if (expired.length) {
							// Not a problem with what was applied: an orange note after it.
							stores?.toastStore?.show({
								title: expiredCreditMessage(expired),
								color: "warning",
								key: "customer-credit-expired",
							});
						}
					} else {
						resetCustomerCreditState();
					}
					if (problems.length) {
						showCreditProblem(problems.join(" "));
					}
				});
		} else {
			resetCustomerCreditState();
		}
	};

	// Watchers
	const normalizeFloat = (value: any, precision?: number) => {
		const parser =
			formatFloat || ((v: any) => parseFloat(String(v)) || 0);
		const prec = precision ?? unref(currencyPrecision) ?? 2;
		return parser(value, prec);
	};

	// The single place that fills each credit row's credit_to_redeem, re-run
	// every time the rows, loyalty or the sale total change (e.g. the cashier
	// leaves Payments to add items and comes back).
	//
	// A genuine "Use Customer Balance" redemption uses the credit up to what
	// the sale still needs, soonest-expiring first (creditUseOrder); when the
	// credit is worth more, the last credit note is used in part and the rest
	// stays on it. The cashier can't type a smaller amount. The server checks
	// the same rule (_validate_customer_credit_redemption).
	const normalizeCustomerCreditAllocations = () => {
		const rows = Array.isArray(customer_credit_dict.value) ? customer_credit_dict.value : [];
		const genuine = customer_credit_redemption_requested.value && rows.length > 0;
		const maxRedeemable = getMaxRedeemableCustomerCredit();

		// Computed into a plain local array first and written to each reactive
		// row once, at its final value: writing twice would re-trigger the deep
		// watcher that calls this very function.
		const computed_credit_to_redeem: number[] = rows.map(() => 0);
		if (genuine) {
			// Whole minor units (baisa), so 50.000 - 45.000 is exactly 5.000.
			const prec = unref(currencyPrecision) ?? 2;
			const factor = Math.pow(10, Math.max(prec, 0));
			let remainingMinor = Math.round(maxRedeemable * factor);
			for (const index of creditUseOrder(rows)) {
				// Each balance rounded to the currency first, as the server does.
				const availableMinor = Math.max(Math.round(normalizeFloat(rows[index]?.total_credit || 0) * factor), 0);
				const useMinor = Math.min(availableMinor, Math.max(remainingMinor, 0));
				computed_credit_to_redeem[index] = useMinor / factor;
				remainingMinor -= useMinor;
			}
		} else {
			// M-Pesa/phone payment (or no redemption in progress): keep whatever
			// amount was already set on each row, within its balance and the sale.
			let remainingAllowed = maxRedeemable;
			rows.forEach((row: any, index: number) => {
				const available = Math.max(normalizeFloat(row?.total_credit || 0), 0);
				const requested = Math.max(normalizeFloat(row?.credit_to_redeem || 0), 0);
				const allowed = normalizeFloat(Math.min(requested, available, Math.max(remainingAllowed, 0)));
				computed_credit_to_redeem[index] = allowed;
				remainingAllowed = normalizeFloat(Math.max(remainingAllowed - allowed, 0));
			});
		}

		rows.forEach((row: any, index: number) => {
			if (row.credit_to_redeem !== computed_credit_to_redeem[index]) {
				row.credit_to_redeem = computed_credit_to_redeem[index];
			}
		});

		redeemed_customer_credit.value = normalizeFloat(
			computed_credit_to_redeem.reduce((sum, value) => sum + value, 0),
		);
	};

	// Credit notes used in part on this sale (normally one).
	const credit_remainders = computed<CreditRemainder[]>(() => {
		if (!customer_credit_redemption_requested.value) return [];
		const rows = Array.isArray(customer_credit_dict.value) ? customer_credit_dict.value : [];
		return rows
			.filter((row: any) => row?.type === "Invoice")
			.map((row: any) => {
				const total = normalizeFloat(row?.total_credit || 0);
				const used = normalizeFloat(row?.credit_to_redeem || 0);
				return {
					credit_origin: String(row.credit_origin || ""),
					voucher: credit_vouchers.value[row.credit_origin]?.voucher,
					total_credit: total,
					used,
					remaining: normalizeFloat(total - used),
				};
			})
			.filter((row) => row.used > 0 && row.remaining > 0);
	});
	const credit_remainder_total = computed(() =>
		normalizeFloat(credit_remainders.value.reduce((sum, row) => sum + row.remaining, 0)),
	);

	watch(redeemed_customer_credit, (newVal) => {
		const limit = Math.min(
			unref(available_customer_credit),
			getMaxRedeemableCustomerCredit(),
		);
		if (normalizeFloat(newVal) > normalizeFloat(limit)) {
			redeemed_customer_credit.value = limit;
			if (stores?.toastStore) {
				stores.toastStore.show({
					title: `You can redeem customer credit up to ${limit}`,
					color: "error",
				});
			}
		}
	});

	watch(
		customer_credit_dict,
		() => {
			normalizeCustomerCreditAllocations();
		},
		{ deep: true },
	);

	watch(loyalty_amount, () => {
		normalizeCustomerCreditAllocations();
	});

	// Cart/invoice total changing after credit was already applied or
	// blocked -- e.g. the cashier leaves the Payments screen to add more
	// items, then comes back -- must re-run the eligibility check too, not
	// just the amount clamping. There is no separate re-fetch trigger for
	// this case elsewhere in the app.
	const invoiceSettlementTotal = computed(() => {
		const doc = unref(invoiceDoc);
		return normalizeFloat(doc?.rounded_total || doc?.grand_total || 0);
	});
	watch(invoiceSettlementTotal, () => {
		normalizeCustomerCreditAllocations();
	});

	// Kept for backward compatibility with previous interface.
	const get_loyalty_points = () => {
		return unref(available_points_amount);
	};

	return {
		loyalty_amount,
		redeemed_customer_credit,
		customer_credit_dict,
		customer_credit_redemption_requested,
		customer_credit_blocked,
		credit_remainders,
		credit_remainder_total,
		credit_vouchers,
		addCreditVoucher,
		clearCreditVouchers,
		available_customer_credit,
		available_points_amount,
		get_available_credit,
		get_loyalty_points,
	};
}
