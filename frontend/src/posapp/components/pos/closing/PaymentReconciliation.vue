<template>
	<div class="reconciliation-section">
		<div class="table-header mb-4">
			<h4 class="text-h6 text-high-emphasis mb-1">
				{{ __("Payment Reconciliation") }}
			</h4>
			<p class="text-body-2 text-medium-emphasis">
				{{ __("Verify closing amounts for each payment method") }}
			</p>
		</div>

		<v-data-table
			:headers="headers"
			:items="payments"
			item-key="mode_of_payment"
			class="elevation-0 rounded-lg white-table"
			:items-per-page="itemsPerPage"
			hide-default-footer
			density="compact"
		>
			<template v-slot:item.closing_amount="props">
				<v-text-field
					:model-value="closingAmountDisplay(props.item.closing_amount)"
					@update:model-value="(value) => (props.item.closing_amount = value)"
					@focus="onClosingAmountFocus"
					@mouseup="onClosingAmountMouseUp"
					@blur="onClosingAmountBlur(props.item)"
					:data-test="`closing-amount-${props.item.mode_of_payment}`"
					:rules="[closingAmountRule]"
					:placeholder="zeroPlaceholder"
					:aria-label="__('Closing amount for {0}', [props.item.mode_of_payment])"
					single-line
					counter
					type="number"
					density="compact"
					variant="outlined"
					color="primary"
					class="pos-themed-input"
					hide-details
					:prefix="companyCurrencySymbol"
				></v-text-field>
			</template>
			<template v-slot:item.difference="{ item }">
				{{ companyCurrencySymbol }}
				{{ formatCurrency(calculateDifference(item)) }}
			</template>
			<template v-slot:item.opening_amount="{ item }">
				{{ companyCurrencySymbol }}
				{{ formatCurrency(item.opening_amount) }}</template
			>
			<template v-slot:item.expected_amount="{ item }">
				{{ companyCurrencySymbol }}
				{{ formatCurrency(item.expected_amount) }}</template
			>
			<template v-slot:item.variance_percent="{ item }">
				<span :class="['variance-chip', varianceClass(item)]">
					{{ formatVariancePercent(item) }}
				</span>
			</template>
		</v-data-table>
	</div>
</template>

<script setup>
import { computed, inject, nextTick } from "vue";
import { amountInputRule, normalizeClosingAmount } from "../../../utils/closingAmount";

const props = defineProps({
	payments: Array,
	headers: Array,
	itemsPerPage: {
		type: Number,
		default: 20,
	},
	companyCurrencySymbol: String,
	// Formatters
	formatCurrency: Function,
	formatFloat: Function,
	// Decimal places allowed in a closing amount (3 for OMR).
	currencyPrecision: {
		type: Number,
		default: 2,
	},
});

const $frappe = inject("frappe", window.frappe);
const __ = window.__ || ((t) => t);

const closingAmountRule = (v) => amountInputRule(v, props.currencyPrecision, __);

// An empty box shows a faint 0 at the currency precision (e.g. "0.000").
const zeroPlaceholder = computed(() => props.formatCurrency(0, props.currencyPrecision));

// A closing amount of 0 shows as an empty box; while the cashier types, the
// raw text is shown as-is. Leaving a box empty stores 0, never blank or null.
const closingAmountDisplay = (value) =>
	value === 0 || value === null || value === undefined ? "" : value;

const onClosingAmountBlur = (item) => {
	item.closing_amount = normalizeClosingAmount(item.closing_amount);
	selectClosingOnMouseUp = false;
};

// Focus selects the whole value so typing replaces it; a mouse click's
// mouseup would otherwise move the caret and undo that once.
let selectClosingOnMouseUp = false;
const selectAllIn = (input) => {
	try {
		input?.select?.();
	} catch {
		// Some input types don't support selection; nothing to do.
	}
};

const onClosingAmountFocus = (event) => {
	selectClosingOnMouseUp = true;
	const input = event?.target;
	nextTick(() => selectAllIn(input));
};

const onClosingAmountMouseUp = (event) => {
	if (!selectClosingOnMouseUp) return;
	selectClosingOnMouseUp = false;
	event?.preventDefault?.();
	selectAllIn(event?.target);
};

const calculateDifference = (item) => {
	const closing = Number(item?.closing_amount) || 0;
	const expected = Number(item?.expected_amount) || 0;
	return expected - closing;
};

const formatVariancePercent = (item) => {
	const expected = Number(item?.expected_amount) || 0;
	if (!expected) {
		const closing = Number(item?.closing_amount) || 0;
		return closing ? __("N/A") : "0%";
	}
	const variance = (calculateDifference(item) / expected) * 100;
	const prefix = variance > 0 ? "+" : variance < 0 ? "" : "";
	return `${prefix}${props.formatFloat(variance, 2)}%`;
};

const varianceClass = (item) => {
	const expected = Number(item?.expected_amount) || 0;
	if (!expected) {
		return "variance-neutral";
	}
	const variance = (calculateDifference(item) / expected) * 100;
	if (!variance) {
		return "variance-neutral";
	}
	return variance > 0 ? "variance-negative" : "variance-positive";
};
</script>

<style scoped>
.white-table {
	background: rgb(var(--v-theme-surface)) !important;
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.pos-themed-input :deep(.v-field__outline__start),
.pos-themed-input :deep(.v-field__outline__end) {
	border-color: rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}

.variance-chip {
	display: inline-block;
	padding: 4px 12px;
	border-radius: 12px;
	font-size: 0.75rem;
	font-weight: 600;
	letter-spacing: 0.5px;
}

.variance-positive {
	background-color: rgba(var(--v-theme-success), 0.1);
	color: rgb(var(--v-theme-success));
}

.variance-negative {
	background-color: rgba(var(--v-theme-error), 0.1);
	color: rgb(var(--v-theme-error));
}

.variance-neutral {
	background-color: rgba(var(--v-theme-on-surface), 0.05);
	opacity: 0.7;
}
</style>
