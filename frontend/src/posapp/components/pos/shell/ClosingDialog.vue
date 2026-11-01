<template>
	<v-dialog v-model="closingDialog" max-width="900px" persistent>
		<v-card elevation="8" class="closing-dialog-card">
			<ClosingHeader @close="closeDialog" />

			<v-card-text class="pa-0 white-background">
				<v-container class="pa-6">
					<v-row class="mb-6">
						<v-col cols="12" class="pa-1">
							<ShiftOverview
								:loading="overviewLoading"
								:primary-insights="primaryInsights"
								:secondary-insights="secondaryInsights"
								:multi-currency-totals="multiCurrencyTotals"
								:credit-invoices-by-currency="creditInvoicesByCurrency"
								:returns-by-currency="returnsByCurrency"
								:change-returned-rows="changeReturnedRows"
								:cash-expected-by-currency="cashExpectedByCurrency"
								:cash-movement-summary="cashMovementSummary"
								:loyalty-redemption-summary="loyaltyRedemptionSummary"
								:loyalty-redemption-by-currency="loyaltyRedemptionByCurrency"
								:customer-credit-redeemed-summary="customerCreditRedeemedSummary"
								:customer-credit-redeemed-by-currency="customerCreditRedeemedByCurrency"
								:customer-credit-issued-summary="customerCreditIssuedSummary"
								:customer-credit-issued-by-currency="customerCreditIssuedByCurrency"
								:payments-by-mode="paymentsByMode"
								:hide-expected-amounts="hideExpectedAmounts"
								:overview-company-currency="overviewCompanyCurrency"
								:format-currency-with-symbol="formatCurrencyWithSymbol"
								:should-show-company-equivalent="shouldShowCompanyEquivalent"
								:show-exchange-rates="showExchangeRates"
								:format-exchange-rates="formatExchangeRates"
								:is-cash-mode="isCashMode"
								:overpayment-deduction-for-currency="overpaymentDeductionForCurrency"
							/>
						</v-col>
					</v-row>
					<v-row>
						<v-col cols="12" class="pa-1">
							<PaymentReconciliation
								:payments="dialog_data.payment_reconciliation"
								:headers="headers"
								:items-per-page="itemsPerPage"
								:company-currency-symbol="companyCurrencySymbol"
								:format-currency="formatCurrency"
								:format-float="formatFloat"
								:currency-precision="currency_precision"
							/>
						</v-col>
					</v-row>
				</v-container>
			</v-card-text>

			<v-divider></v-divider>
			<v-card-actions class="dialog-actions-container">
				<v-spacer></v-spacer>
				<v-btn
					theme="dark"
					@click="closeDialog"
					class="pos-action-btn cancel-action-btn"
					size="large"
					elevation="2"
				>
					<v-icon start>mdi-close-circle-outline</v-icon>
					<span>{{ __("Close") }}</span>
				</v-btn>
				<v-btn
					theme="dark"
					@click="requestSubmit"
					class="pos-action-btn submit-action-btn"
					size="large"
					elevation="2"
				>
					<v-icon start>mdi-check-circle-outline</v-icon>
					<span>{{ __("Submit") }}</span>
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
	<CloseShiftConfirmDialog
		:model-value="confirmCloseDialog"
		:variances="closingVariances"
		:tolerance="closingVarianceTolerance"
		:hide-amounts="Boolean(pos_profile && pos_profile.hide_expected_amount)"
		:needs-supervisor="closingVarianceNeedsSupervisor"
		:can-approve="canApproveClosingVariance"
		:reason="varianceReason"
		:format-amount="(value) => formatCurrency(value, currency_precision)"
		@update:reason="(value) => (varianceReason = value)"
		@go-back="cancelConfirm"
		@confirm="confirmClose"
	/>
</template>

<script>
import { useUIStore } from "../../../stores/uiStore.js";
import { computed, ref, inject, onMounted, onBeforeUnmount, watch } from "vue";
import { useEmployeeStore } from "../../../stores/employeeStore";
import {
	getClosingVariances,
	resolveClosingVarianceTolerance,
} from "../../../utils/closingVariance";
import { useClosingShift } from "../../../composables/pos/closing/useClosingShift";
import { useClosingSummary } from "../../../composables/pos/closing/useClosingSummary";

import { useFormat } from "../../../format";
import ClosingHeader from "../closing/ClosingHeader.vue";
import ShiftOverview from "../closing/ShiftOverview.vue";
import PaymentReconciliation from "../closing/PaymentReconciliation.vue";
import CloseShiftConfirmDialog from "../closing/CloseShiftConfirmDialog.vue";

export default {
	name: "ClosingDialog",
	components: {
		ClosingHeader,
		ShiftOverview,
		PaymentReconciliation,
		CloseShiftConfirmDialog,
	},
	setup() {
		const uiStore = useUIStore();
		const eventBus = inject("eventBus");
		const __ = window.__ || ((t) => t);

		// Initialize composables
		const {
			closingDialog,
			dialog_data,
			overview,
			overviewLoading,
			pos_profile,
			closeDialog,
			fetchOverview,
			confirmCloseDialog,
			requestSubmit,
			cancelConfirm,
			confirmSubmit,
		} = useClosingShift(eventBus);

		const { formatCurrency, formatFloat, currencySymbol, currency_precision } = useFormat();
		const employeeStore = useEmployeeStore();

		// Closing amounts off by more than the POS Profile's tolerance need a
		// reason (and a POS supervisor when the profile asks); the server
		// re-checks it against its own expected amounts.
		const varianceReason = ref("");
		const closingVarianceTolerance = computed(() => resolveClosingVarianceTolerance(pos_profile.value));
		const closingVarianceNeedsSupervisor = computed(() =>
			Boolean(Number(pos_profile.value?.posa_closing_variance_needs_supervisor || 0)),
		);
		const closingVariances = computed(() =>
			getClosingVariances(
				dialog_data.value?.payment_reconciliation,
				closingVarianceTolerance.value,
				currency_precision.value,
			),
		);
		const canApproveClosingVariance = computed(
			() =>
				Boolean(employeeStore.currentCashier?.is_supervisor) ||
				Boolean(window.frappe?.user?.has_role?.("POS Awesome Supervisor")),
		);
		const confirmClose = () => {
			dialog_data.value.posa_variance_reason = closingVariances.value.length
				? String(varianceReason.value || "").trim()
				: null;
			confirmSubmit();
		};
		const translate = (t) => window.__(t);

		const summaryFormatters = {
			formatCurrencyWithSymbol: (amount, currency) => {
				const resolvedCurrency = currency || "";
				const symbol = currencySymbol(resolvedCurrency);
				const formatted = formatCurrency(amount || 0);
				if (symbol) return `${symbol} ${formatted}`;
				return `${resolvedCurrency} ${formatted}`.trim();
			},
			formatCount: (value) => formatFloat(value || 0, 0),
			formatCurrency,
			currencySymbol,
			__: translate,
		};
		
		// formatters
		const summary = useClosingSummary(overview, pos_profile, dialog_data, summaryFormatters);

		const headers = ref([]);
		const baseHeaders = [
			{
				title: __("Mode of Payment"),
				value: "mode_of_payment",
				align: "start",
				sortable: true,
			},
			{
				title: __("Opening Amount"),
				align: "end",
				sortable: true,
				value: "opening_amount",
			},
			{
				title: __("Closing Amount"),
				value: "closing_amount",
				align: "end",
				sortable: true,
			},
		];
		const extendedHeaders = [
			{
				title: __("Expected Amount (In Company Currency)"),
				value: "expected_amount",
				align: "end",
				sortable: false,
			},
			{
				title: __("Difference (In Company Currency)"),
				value: "difference",
				align: "end",
				sortable: false,
			},
			{
				title: __("Variance %"),
				value: "variance_percent",
				align: "end",
				sortable: false,
			},
		];

		const handleKeydown = (event) => {
			if (event.key !== "Escape" || !closingDialog.value) {
				return;
			}
			// With "Close your shift?" open, Esc only goes back to the closing
			// dialog, keeping the figures entered in it.
			if (confirmCloseDialog.value) {
				cancelConfirm();
				return;
			}
			closeDialog();
		};

		onMounted(() => {
			headers.value = [...baseHeaders];
			window.addEventListener("keydown", handleKeydown);

			if (eventBus) {
				eventBus.on("open_ClosingDialog", (data) => {
					closingDialog.value = true;
					varianceReason.value = "";
					dialog_data.value = data;
					fetchOverview(data.pos_opening_shift, pos_profile.value?.currency);
				});
			} else {
				console.error("ClosingDialog: eventBus not provided");
			}
		});

		onBeforeUnmount(() => {
			window.removeEventListener("keydown", handleKeydown);
			if (eventBus) {
				eventBus.off("open_ClosingDialog");
			}
		});

		watch(
			() => uiStore.posProfile,
			(profile) => {
				if (profile) {
					pos_profile.value = profile;
					if (!pos_profile.value.hide_expected_amount) {
						headers.value = [...baseHeaders, ...extendedHeaders];
					} else {
						headers.value = [...baseHeaders];
					}
				}
			},
			{ deep: true, immediate: true },
		);

		return {
			uiStore,
			eventBus,
			closingDialog,
			dialog_data,
			overview,
			overviewLoading,
			pos_profile,
			closeDialog,
			fetchOverview,
			confirmCloseDialog,
			requestSubmit,
			cancelConfirm,
			confirmSubmit,
			...summary,
			// Expose formatters used in template
			formatCurrency,
			formatFloat,
			currency_precision,
			varianceReason,
			closingVariances,
			closingVarianceTolerance,
			closingVarianceNeedsSupervisor,
			canApproveClosingVariance,
			confirmClose,
			formatCurrencyWithSymbol: summaryFormatters.formatCurrencyWithSymbol,
			shouldShowCompanyEquivalent: summary.shouldShowCompanyEquivalent,
			showExchangeRates: summary.showExchangeRates,
			formatExchangeRates: summary.formatExchangeRates,
			isCashMode: summary.isCashMode,
			overpaymentDeductionForCurrency: summary.overpaymentDeductionForCurrency,
			headers,
			itemsPerPage: 20,
		};
	},
};
</script>

<style scoped>
.closing-dialog-card {
	border-radius: 16px;
	overflow: hidden;
}

.white-background {
	background-color: rgb(var(--v-theme-surface));
}

.dialog-actions-container {
	padding: 16px 24px;
	border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.pos-action-btn {
	border-radius: 8px;
	text-transform: none;
	font-weight: 600;
	letter-spacing: 0.5px;
	padding: 0 24px;
}

.cancel-action-btn {
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.submit-action-btn {
	margin-left: 16px;
}
</style>
