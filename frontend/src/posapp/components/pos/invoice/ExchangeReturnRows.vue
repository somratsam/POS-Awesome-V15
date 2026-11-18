<template>
	<template v-if="exchange.active">
		<tr
			v-for="line in exchange.lines"
			:key="line.name"
			class="exchange-return-row"
			:data-testid="`exchange-return-row-${line.idx}`"
		>
			<!-- Same columns as the cart's own rows (CartItemRow); price and
			     discount are the receipt's, grey and not editable. -->
			<template v-for="column in visibleColumns" :key="column.key">
				<td v-if="column.key === 'item_name'" class="text-start exchange-return-row__cell">
					<div class="exchange-return-row__item">
						<v-chip size="x-small" color="error" variant="flat" label class="exchange-return-row__tag">
							{{ __("RETURN") }}
						</v-chip>
						<button
							type="button"
							class="exchange-return-row__name-btn"
							:title="`${line.item_name || line.item_code} · ${__('Receipt {0}', [exchange.receipt?.name])}`"
							@click="exchange.openPicker()"
						>
							<span class="exchange-return-row__name">{{ line.item_name || line.item_code }}</span>
							<span class="exchange-return-row__receipt">
								{{ __("Receipt {0}", [exchange.receipt?.name]) }}
							</span>
						</button>
					</div>
				</td>
				<td v-else-if="column.key === 'qty'" class="text-center exchange-return-row__cell">
					<div class="exchange-return-row__qty">
						<v-btn
							icon="mdi-minus"
							size="x-small"
							variant="tonal"
							:aria-label="__('One less')"
							:disabled="exchange.submitting"
							@click.stop="exchange.step(line.name, -1)"
						/>
						<span class="exchange-return-row__qty-value">-{{ formatQty(line.qty) }}</span>
						<v-btn
							icon="mdi-plus"
							size="x-small"
							variant="tonal"
							:aria-label="__('One more')"
							:disabled="exchange.submitting || line.qty >= line.left"
							@click.stop="exchange.step(line.name, 1)"
						/>
					</div>
				</td>
				<td v-else-if="column.key === 'uom'" class="text-center exchange-return-row__cell exchange-return-row__locked">
					{{ line.uom }}
				</td>
				<td
					v-else-if="LOCKED_MONEY[column.key]"
					class="text-end exchange-return-row__cell exchange-return-row__locked"
					:title="__('Price and discount from the receipt')"
					:data-testid="`exchange-return-${column.key}`"
				>
					<template v-if="column.key === 'discount_percentage'">
						{{ Number(line.discount_percentage || 0).toFixed(3) }}%
					</template>
					<div v-else class="currency-display right-aligned">
						<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
						<span class="amount-value">{{ formatCurrency(Math.abs(line[LOCKED_MONEY[column.key]] || 0)) }}</span>
					</div>
				</td>
				<td v-else-if="column.key === 'amount'" class="text-end exchange-return-row__cell">
					<div class="currency-display right-aligned">
						<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
						<span class="amount-value negative-number exchange-return-row__amount">
							-{{ formatCurrency(Math.abs(line.rate * line.qty)) }}
						</span>
					</div>
				</td>
				<td v-else-if="column.key === 'actions'" class="text-center exchange-return-row__cell">
					<v-btn
						size="small"
						variant="flat"
						class="posa-cart-table__delete-btn delete-action-btn"
						:aria-label="__('Remove item')"
						:disabled="exchange.submitting"
						@click.stop="exchange.step(line.name, -line.qty)"
					>
						<v-icon size="small">mdi-delete-outline</v-icon>
					</v-btn>
				</td>
				<td v-else class="exchange-return-row__cell"></td>
			</template>
		</tr>
		<tr v-if="invoiceDiscount > 0" class="exchange-return-note" data-testid="exchange-invoice-discount-note">
			<td :colspan="visibleColumns.length || 1" class="exchange-return-note__cell">
				{{ __("Invoice discount on the receipt: -{0} (included in Returned)", [money(invoiceDiscount)]) }}
			</td>
		</tr>
	</template>
</template>

<script setup>
import { computed } from "vue";
import { useExchangeStore } from "../../../stores/exchangeStore";
import { formatQty } from "../../../utils/oneScreenExchange";

const props = defineProps({
	visibleColumns: { type: Array, default: () => [] },
	formatCurrency: { type: Function, required: true },
	currencySymbol: { type: Function, required: true },
	displayCurrency: { type: String, default: "" },
});

// Column -> the receipt line's field, shown as plain grey text.
const LOCKED_MONEY = {
	price_list_rate: "price_list_rate",
	discount_percentage: "discount_percentage",
	discount_amount: "discount_amount",
	rate: "rate",
};

const __ = window.__ || ((text, args) => (args || []).reduce((s, a, i) => s.replace(`{${i}}`, a), text));
const exchange = useExchangeStore();
const money = (value) => `${props.currencySymbol(props.displayCurrency)}${props.formatCurrency(Math.abs(value))}`;

// A receipt with an invoice-level discount: the server's "Returned" includes
// its share, so the rows (rate x qty) add up to more. Shown once quoted.
const invoiceDiscount = computed(() => {
	if (!exchange.receipt?.has_invoice_discount || exchange.quotedReturned === null) return 0;
	const share = Math.round((exchange.estimate - exchange.quotedReturned) * 1000) / 1000;
	return share > 0 ? share : 0;
});
</script>

<style scoped>
.exchange-return-row > td {
	background: rgba(var(--v-theme-error), 0.07);
}
.exchange-return-row__item {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 2px;
	min-width: 0;
	overflow: hidden;
}
.exchange-return-row__tag {
	font-weight: 700;
	letter-spacing: 0.04em;
	flex: 0 0 auto;
}
.exchange-return-row__name-btn {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	width: 100%;
	min-width: 0;
	overflow: hidden;
	text-align: start;
	background: none;
	border: 0;
	padding: 0;
	color: inherit;
	cursor: pointer;
}
.exchange-return-row__name,
.exchange-return-row__receipt {
	display: block;
	max-width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.exchange-return-row__name {
	font-weight: 600;
}
.exchange-return-row__receipt {
	font-size: 0.75rem;
	opacity: 0.75;
}
.exchange-return-row__qty {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.exchange-return-row__qty-value {
	min-width: 26px;
	text-align: center;
	font-weight: 700;
}
.exchange-return-row__locked,
.exchange-return-row__locked :deep(.currency-symbol),
.exchange-return-row__locked :deep(.amount-value) {
	color: rgba(var(--v-theme-on-surface), 0.55) !important;
	font-weight: 400;
	white-space: nowrap;
	cursor: default;
}
.exchange-return-row__amount {
	white-space: nowrap;
	font-weight: 600;
	color: rgb(var(--v-theme-error));
}
.exchange-return-note__cell {
	padding: 4px 16px !important;
	font-size: 0.8rem;
	color: rgba(var(--v-theme-on-surface), 0.6);
	background: rgba(var(--v-theme-error), 0.03);
}
</style>
