import { ref, watch, computed, unref, type Ref } from "vue";
import {
	isOffline,
	getCachedStoredValueSnapshot,
	saveStoredValueSnapshot,
} from "../../../../offline/index";
import { fromCompanyCurrency } from "../../../utils/erpnextCurrency";

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
	const available_customer_credit = computed(() => {
		return customer_credit_dict.value.reduce(
			(total, row) => total + normalizeFloat(row?.total_credit || 0),
			0,
		);
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

	// Get available customer credit
	const get_available_credit = (use_credit: boolean) => {
		if (options.onClearAmounts) {
			options.onClearAmounts();
		}

		if (use_credit) {
			const customer = unref(invoiceDoc)?.customer;
			const company = unref(posProfile)?.company;

			if (!customer || !company) return;

			if (isOffline()) {
				const cachedSnapshot = getCachedStoredValueSnapshot(customer, company);
				const data = Array.isArray(cachedSnapshot?.sources)
					? JSON.parse(JSON.stringify(cachedSnapshot.sources))
					: [];
				if (data.length) {
					applyCreditRows(data);
				} else {
					resetCustomerCreditState();
				}
				return;
			}

			frappe
				.call(
					"posawesome.posawesome.api.payments.get_available_credit",
					{
						customer,
						company,
					},
				)
				.then((r: any) => {
					const data = r.message;
					if (data && data.length) {
						saveStoredValueSnapshot(customer, company, data);
						applyCreditRows(data);
					} else {
						resetCustomerCreditState();
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

		// Only re-derive eligibility for rows that came from a genuine balance
		// redemption (applyCreditRows already set one of these flags true).
		// M-Pesa/phone payment never touch either flag, so their rows fall
		// through to the legacy preserve-existing-value branch below,
		// completely untouched by this policy.
		const inGenuineRedemptionMode =
			customer_credit_redemption_requested.value || customer_credit_blocked.value;

		if (inGenuineRedemptionMode && rows.length) {
			const available_total = rows.reduce(
				(total, row) => total + normalizeFloat(row?.total_credit || 0),
				0,
			);
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

		rows.forEach((row: any) => {
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
			row.credit_to_redeem = normalizeFloat(allowed);
			remainingAllowed = normalizeFloat(Math.max(remainingAllowed - row.credit_to_redeem, 0));
		});

		const total = rows.reduce(
			(sum, row) => sum + normalizeFloat(row?.credit_to_redeem || 0),
			0,
		);
		redeemed_customer_credit.value = normalizeFloat(total);
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
		available_customer_credit,
		available_points_amount,
		get_available_credit,
		get_loyalty_points,
	};
}
