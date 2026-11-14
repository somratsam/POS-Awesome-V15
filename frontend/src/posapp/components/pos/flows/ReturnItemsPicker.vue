<template>
	<!-- Tick-to-return (utils/returnItemSelection.ts): the receipt's returnable
	     lines with nothing selected; staff tick the lines being returned and
	     set each quantity, up to what is still returnable. Price and discount
	     stay the receipt's. A one-line receipt comes ticked. -->
	<v-dialog
		:model-value="modelValue"
		max-width="760"
		scrollable
		persistent
		@keydown.esc.stop.prevent="$emit('cancel')"
	>
		<v-card class="return-picker pos-themed-card" data-testid="return-items-picker">
			<div class="return-picker__head">
				<div class="return-picker__title-copy">
					<span class="text-h6">{{ __("Choose items to return") }}</span>
					<span class="return-picker__subtitle" data-testid="return-picker-invoice">
						{{ invoiceLine }}
					</span>
				</div>
				<v-btn
					icon="mdi-close"
					variant="text"
					size="small"
					:aria-label="__('Close')"
					:title="__('Close')"
					@click="$emit('cancel')"
				/>
			</div>

			<v-card-text class="return-picker__body">
				<div class="return-picker__all">
					<v-checkbox-btn
						:model-value="allSelected"
						:indeterminate="someSelected && !allSelected"
						color="primary"
						data-testid="return-picker-all"
						@update:model-value="selectAll"
					/>
					<span>{{ __("Select all") }}</span>
					<span class="return-picker__hint">{{ __("Tick the items the customer is returning.") }}</span>
				</div>

				<div
					v-for="(line, index) in returnableLines"
					:key="line.name"
					class="return-picker__row"
					:class="{ 'return-picker__row--selected': picks[index].selected }"
					data-testid="return-picker-row"
				>
					<div class="return-picker__tick">
						<v-checkbox-btn
							:model-value="picks[index].selected"
							color="primary"
							density="compact"
							:aria-label="__('Return {0}', [line.item_name || line.item_code])"
							data-testid="return-picker-tick"
							@update:model-value="(value) => tick(index, value)"
						/>
					</div>
					<div class="return-picker__item" @click="tick(index, !picks[index].selected)">
						<div class="return-picker__name">{{ line.item_name || line.item_code }}</div>
						<div class="return-picker__meta">
							<span>{{ line.item_code }}</span>
							<span>·</span>
							<span>{{ __("Returnable: {0}", [formatQty(picks[index].max)]) }}</span>
						</div>
					</div>
					<div class="return-picker__qty">
						<v-btn
							icon="mdi-minus"
							size="x-small"
							variant="tonal"
							:disabled="picks[index].qty <= 0"
							:aria-label="__('Less')"
							data-testid="return-picker-minus"
							@click="step(index, -1)"
						/>
						<input
							class="return-picker__qty-input"
							type="number"
							inputmode="decimal"
							min="0"
							:max="picks[index].max"
							:value="picks[index].qty"
							:aria-label="__('Quantity to return')"
							data-testid="return-picker-qty"
							@change="(event) => setQty(index, event.target.value)"
						/>
						<v-btn
							icon="mdi-plus"
							size="x-small"
							variant="tonal"
							:disabled="picks[index].qty >= picks[index].max"
							:aria-label="__('More')"
							data-testid="return-picker-plus"
							@click="step(index, 1)"
						/>
					</div>
					<div class="return-picker__price">
						<div>{{ formatCurrency(line.rate) }}</div>
						<div v-if="Number(line.discount_percentage) > 0" class="return-picker__disc">
							-{{ formatQty(line.discount_percentage) }}%
						</div>
					</div>
					<div class="return-picker__amount" data-testid="return-picker-amount">
						{{ picks[index].selected ? formatCurrency(-lineAmount(index)) : "—" }}
					</div>
				</div>

				<p v-if="error" class="return-picker__error" data-testid="return-picker-error">{{ error }}</p>
			</v-card-text>

			<v-card-actions class="return-picker__actions">
				<span class="return-picker__summary" data-testid="return-picker-summary">
					{{ summary }}
				</span>
				<v-spacer />
				<v-btn variant="tonal" color="error" data-testid="return-picker-cancel" @click="$emit('cancel')">
					{{ __("Cancel") }}
				</v-btn>
				<v-btn color="success" variant="flat" data-testid="return-picker-confirm" @click="confirm">
					{{ __("Return selected") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
	NOTHING_SELECTED_MESSAGE,
	initialReturnPicks,
	pickedCount,
	pickedReturnLines,
	returnableQty,
	setPicked,
	setPickedQty,
} from "../../../utils/returnItemSelection";

const props = defineProps({
	modelValue: Boolean,
	// get_invoice_for_return's result: name, customer_name, posting_date, items.
	returnDoc: { type: Object, default: null },
	formatCurrency: { type: Function, default: (value) => Number(value || 0).toFixed(3) },
});

const emit = defineEmits(["confirm", "cancel"]);

const __ = window.__ || ((text, args) => (args || []).reduce((s, a, i) => s.replace(`{${i}}`, a), text));

const returnableLines = computed(() =>
	(props.returnDoc?.items || []).filter((line) => returnableQty(line) > 0),
);
const picks = ref([]);
const error = ref("");

watch(
	() => [props.modelValue, props.returnDoc],
	([open]) => {
		if (!open) return;
		picks.value = initialReturnPicks(returnableLines.value);
		error.value = "";
	},
	{ immediate: true },
);

const invoiceLine = computed(() => {
	const doc = props.returnDoc || {};
	return [doc.name, doc.customer_name || doc.customer, doc.posting_date].filter(Boolean).join(" · ");
});
const allSelected = computed(() => picks.value.length > 0 && picks.value.every((pick) => pick.selected));
const someSelected = computed(() => picks.value.some((pick) => pick.selected));

const formatQty = (value) => {
	const number = Number(value) || 0;
	return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "");
};
const lineAmount = (index) => (Number(returnableLines.value[index]?.rate) || 0) * (picks.value[index]?.qty || 0);

const summary = computed(() => {
	const count = pickedCount(picks.value);
	if (!count) return __("Nothing selected");
	const total = picks.value.reduce((sum, _pick, index) => sum + (picks.value[index].selected ? lineAmount(index) : 0), 0);
	return __("{0} of {1} lines · {2}", [count, picks.value.length, props.formatCurrency(-total)]);
});

const update = (index, pick) => {
	const next = picks.value.slice();
	next[index] = pick;
	picks.value = next;
	if (pick.selected) error.value = "";
};
const tick = (index, value) => update(index, setPicked(picks.value[index], Boolean(value)));
const setQty = (index, value) => update(index, setPickedQty(picks.value[index], value));
const step = (index, delta) => setQty(index, (picks.value[index].qty || 0) + delta);
const selectAll = (value) => {
	picks.value = picks.value.map((pick) => setPicked(pick, Boolean(value)));
	if (value) error.value = "";
};

const confirm = () => {
	const lines = pickedReturnLines(returnableLines.value, picks.value);
	if (!lines.length) {
		error.value = __(NOTHING_SELECTED_MESSAGE);
		return;
	}
	emit("confirm", lines);
};
</script>

<style scoped>
.return-picker__head {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 16px 12px 4px 20px;
}
.return-picker__title-copy {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
}
.return-picker__subtitle {
	font-size: 0.85rem;
	opacity: 0.75;
	word-break: break-word;
}
.return-picker__body {
	padding-top: 4px;
}
.return-picker__all {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 0 8px;
	border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	font-weight: 600;
}
.return-picker__hint {
	margin-left: auto;
	font-weight: 400;
	font-size: 0.8rem;
	opacity: 0.7;
}
.return-picker__row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto 90px 100px;
	align-items: center;
	gap: 10px;
	padding: 8px 0;
	border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.return-picker__row--selected {
	background: rgba(var(--v-theme-primary), 0.06);
}
.return-picker__tick {
	display: flex;
	align-items: center;
}
.return-picker__tick :deep(.v-selection-control) {
	grid-area: auto;
	flex: 0 0 auto;
}
.return-picker__item {
	min-width: 0;
	cursor: pointer;
}
.return-picker__name {
	font-weight: 600;
	overflow-wrap: anywhere;
}
.return-picker__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	font-size: 0.8rem;
	opacity: 0.75;
}
.return-picker__qty {
	display: flex;
	align-items: center;
	gap: 4px;
}
.return-picker__qty-input {
	width: 56px;
	text-align: center;
	padding: 4px;
	border: 1px solid rgba(var(--v-border-color), 0.4);
	border-radius: 6px;
	background: transparent;
	color: inherit;
}
.return-picker__price,
.return-picker__amount {
	text-align: right;
	white-space: nowrap;
}
.return-picker__disc {
	font-size: 0.75rem;
	color: rgb(var(--v-theme-success));
}
.return-picker__amount {
	font-weight: 600;
	color: rgb(var(--v-theme-error));
}
.return-picker__error {
	margin: 10px 0 0;
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}
.return-picker__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 16px 16px;
}
.return-picker__summary {
	font-weight: 600;
}
@media (max-width: 600px) {
	.return-picker__row {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}
	.return-picker__price {
		display: none;
	}
	.return-picker__amount {
		grid-column: 2 / 4;
		text-align: left;
	}
	.return-picker__hint {
		display: none;
	}
}
</style>
