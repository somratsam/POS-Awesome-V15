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
	// True while available credit exceeds what this invoice can absorb --
	// redemption is held at 0 and a banner/toast explains why, without
	// switching the toggle back off (see PaymentOptions.vue).
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
	// Sum the raw total_credit values first, then round once at the end --
	// matching creation.py's _validate_customer_credit_redemption() exactly
	// (real_total = sum(flt(row.total_credit) for row in ...), rounded only
	// at the final comparison). Rounding each row before summing can disagree
	// with the backend's own figure whenever a row's true value isn't already
	// clean at currency precision (e.g. a return split evenly across two
	// lines, 2.2055 + 2.2055 -- true sum 4.411, but 2.21 + 2.21 = 4.42).
	// get_available_credit() never rounds outstanding_amount-derived rows at
	// all, so this isn't a rare edge case -- see PROGRESS_NOTES.md.
	const sumRawCredit = (rows: any[]) =>
		(Array.isArray(rows) ? rows : []).reduce(
			(total, row) => total + (Number(row?.total_credit) || 0),
			0,
		);
	const available_customer_credit = computed(() => {
		return normalizeFloat(sumRawCredit(customer_credit_dict.value));
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
		return Math.max(normalizeFloat(invoiceTotal - loyaltyCovered), 0);
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

	// The single place that decides, every time it runs, whether the current
	// customer_credit_dict is eligible for full redemption -- re-derived
	// fresh each call so it reacts correctly to the cart/loyalty total
	// changing *after* credit was already applied or blocked (e.g. cashier
	// leaves Payments to add more items, then comes back), not just at the
	// moment the toggle was first switched on.
	const normalizeCustomerCreditAllocations = () => {
		const rows = Array.isArray(customer_credit_dict.value) ? customer_credit_dict.value : [];
		const available_total = normalizeFloat(sumRawCredit(rows));

		// Only re-derive eligibility for rows that came from a genuine balance
		// redemption (applyCreditRows already set one of these flags true).
		// M-Pesa/phone payment never touch either flag, so their rows fall
		// through to the legacy preserve-existing-value branch below,
		// completely untouched by this policy.
		const inGenuineRedemptionMode =
			customer_credit_redemption_requested.value || customer_credit_blocked.value;

		if (inGenuineRedemptionMode && rows.length) {
			const max_redeemable = getMaxRedeemableCustomerCredit();
			const eligible = normalizeFloat(available_total) <= normalizeFloat(max_redeemable);

			if (eligible !== customer_credit_redemption_requested.value) {
				customer_credit_redemption_requested.value = eligible;
				customer_credit_blocked.value = !eligible;
				if (!eligible && stores?.toastStore) {
					const currency = unref(posProfile)?.currency || "";
					stores.toastStore.show({
						title: __(
							"Customer must select items worth at least their available credit ({0}{1}) to redeem it.",
							[normalizeFloat(available_total), currency ? ` ${currency}` : ""],
						),
						color: "error",
					});
				}
			}
		}

		let remainingAllowed = getMaxRedeemableCustomerCredit();
		const isFullRedemption = customer_credit_redemption_requested.value && rows.length > 0;

		// Compute each row's final credit_to_redeem into a plain local array
		// first -- NOT onto the reactive row objects yet. row.credit_to_redeem
		// is written exactly once per row, below, already at its final value.
		// (An earlier version wrote the naive per-row-rounded value onto the
		// row first and then patched one row a second time to fix the
		// rounding-allocation mismatch below -- two real, different writes to
		// the same reactive property, each one re-triggering the deep watcher
		// on customer_credit_dict that calls this very function, so the
		// "naive" and "patched" values kept overwriting each other forever.
		// Computing locally and writing once avoids that entirely.)
		const computed_credit_to_redeem: number[] = rows.map((row: any) => {
			const available = Math.max(normalizeFloat(row?.total_credit || 0), 0);
			let requested: number;
			if (customer_credit_redemption_requested.value) {
				// Eligible genuine redemption: full amount is mandatory --
				// ignore any manually-typed-down value so it snaps back
				// rather than allowing a partial redemption.
				requested = available;
			} else if (customer_credit_blocked.value) {
				// Ineligible genuine redemption: nothing gets applied.
				requested = 0;
			} else {
				// M-Pesa/phone payment (or no redemption in progress): keep
				// whatever amount was already set on this row.
				requested = Math.max(normalizeFloat(row?.credit_to_redeem || 0), 0);
			}
			const allowed = Math.min(requested, available, Math.max(remainingAllowed, 0));
			const rounded = normalizeFloat(allowed);
			remainingAllowed = normalizeFloat(Math.max(remainingAllowed - rounded, 0));
			return rounded;
		});

		// Redeeming the full available balance must land on the exact same
		// total the backend independently computes (available_total, above --
		// which now matches _validate_customer_credit_redemption()'s
		// real_total exactly, since both sum raw values and round once).
		// Rounding each row separately, as the map above just did, can still
		// under/overshoot that total even with correct rounding: "round each
		// part, then sum" and "sum, then round once" are different operations
		// whenever a row's raw value sits close to a rounding boundary (e.g.
		// two rows of 2.2055 each round to 2.206 individually, summing to
		// 4.412, while the true total 4.411 rounds cleanly on its own). Patch
		// the discrepancy onto the last row with enough headroom to absorb it
		// (not always literally the last row -- it may have no available
		// credit of its own to give back) before ever writing to the row
		// objects, so the backend's exact-match check on
		// redeemed_customer_credit can never fail on rounding alone.
		if (isFullRedemption) {
			const allocatedSoFar = normalizeFloat(
				computed_credit_to_redeem.reduce((sum, value) => sum + value, 0),
			);
			const delta = normalizeFloat(available_total - allocatedSoFar);
			if (delta !== 0) {
				for (let i = rows.length - 1; i >= 0; i -= 1) {
					const rowAvailable = Math.max(normalizeFloat(rows[i]?.total_credit || 0), 0);
					const adjusted = normalizeFloat((computed_credit_to_redeem[i] ?? 0) + delta);
					if (adjusted >= 0 && adjusted <= rowAvailable) {
						computed_credit_to_redeem[i] = adjusted;
						break;
					}
				}
			}
		}

		rows.forEach((row: any, index: number) => {
			row.credit_to_redeem = computed_credit_to_redeem[index];
		});

		redeemed_customer_credit.value = normalizeFloat(
			computed_credit_to_redeem.reduce((sum, value) => sum + value, 0),
		);
	};

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
		credit_vouchers,
		addCreditVoucher,
		clearCreditVouchers,
		available_customer_credit,
		available_points_amount,
		get_available_credit,
		get_loyalty_points,
	};
}
