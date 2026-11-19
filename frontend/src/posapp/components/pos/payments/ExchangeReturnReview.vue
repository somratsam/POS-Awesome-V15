<template>
	<!-- One-screen exchange, a return with no new items: the payment screen
	     is its review step (section 108). Nothing to pay; the credit note
	     voucher always prints. The return's Sales Person is the original
	     sale's (else the PIN cashier's), as the server saves it. -->
	<v-card class="return-review pos-themed-card" :class="{ 'mt-3': !dialogMode }" rounded="lg" data-testid="return-review">
		<v-progress-linear :active="checking || saving" indeterminate absolute location="top" color="info" />
		<div class="return-review__body">
			<section class="return-review__section">
				<h3 class="return-review__title">{{ __("Return") }}</h3>
				<p class="return-review__line">{{ __("Returning from {0}", [receiptName]) }}</p>
				<div class="return-review__row">
					<span>{{ backText }}</span>
					<strong data-testid="return-review-returned">−{{ money(returned) }}</strong>
				</div>
				<div class="return-review__row return-review__row--total">
					<span>{{ __("Credit note issued") }}</span>
					<strong data-testid="return-review-credit">{{ checking ? __("Checking…") : money(returned) }}</strong>
				</div>
				<p class="return-review__note">
					{{ __("For {0} — the credit note voucher prints.", [customerName]) }}
				</p>
			</section>
			<section class="return-review__section">
				<h3 class="return-review__title">{{ __("Sales Person") }}</h3>
				<v-text-field
					:model-value="salesPersonText"
					:label="__('Sales Person')"
					density="compact"
					variant="solo"
					prepend-inner-icon="mdi-lock"
					readonly
					hide-details
					data-testid="return-review-sales-person"
				/>
				<p class="mt-1 mb-0 text-caption text-medium-emphasis" data-testid="return-review-sales-person-why">
					{{ salesPersonWhy }}
				</p>
			</section>
		</div>
		<v-card-actions class="return-review__actions">
			<v-btn
				variant="tonal"
				size="large"
				data-testid="return-review-cancel"
				:disabled="saving"
				@click="$emit('cancel')"
			>
				{{ __("Cancel") }}
			</v-btn>
			<v-btn
				color="primary"
				variant="flat"
				size="large"
				class="return-review__submit"
				data-testid="return-review-submit"
				:disabled="saving || checking"
				@click="$emit('submit')"
			>
				<v-progress-circular v-if="saving" indeterminate size="16" width="2" class="me-2" />
				{{ saving ? __("Saving…") : checking ? __("Checking…") : __("Submit return & Print voucher") }}
			</v-btn>
		</v-card-actions>
	</v-card>
</template>

<script setup>
import { computed } from "vue";
import { useExchangeStore } from "../../../stores/exchangeStore";
import { formatQty } from "../../../utils/oneScreenExchange";

defineProps({
	dialogMode: { type: Boolean, default: false },
	money: { type: Function, required: true },
	saving: { type: Boolean, default: false },
});
defineEmits(["cancel", "submit"]);

const __ = window.__ || ((text, args) => (args || []).reduce((out, a, i) => out.replace(`{${i}}`, a), text));
const exchange = useExchangeStore();

const receiptName = computed(() => exchange.receipt?.name || "");
const customerName = computed(() => exchange.receipt?.customer_name || exchange.receipt?.customer || "");
const checking = computed(() => exchange.checking || exchange.quotedReturned === null);
const returned = computed(() => Number(exchange.returned) || 0);
const backText = computed(() => __("{0} back", [formatQty(exchange.backQty)]));
const salesPerson = computed(() => exchange.quote?.return_sales_person || null);
const salesPersonText = computed(() => {
	const info = salesPerson.value;
	if (!info) return checking.value ? __("Checking…") : "";
	if (info.sales_person) return info.sales_person;
	return __("{0} (no Sales Person)", [info.cashier_name || __("the cashier")]);
});
const salesPersonWhy = computed(() => {
	const source = salesPerson.value?.source;
	if (source === "original") return __("A return keeps the original sale's Sales Person.");
	if (source === "cashier") return __("The original sale has no Sales Person: the return goes to the cashier doing it.");
	if (source === "none") return __("The original sale has no Sales Person, and the cashier has none linked.");
	return "";
});

</script>

<style scoped>
.return-review {
	overflow: hidden;
}
.return-review__body {
	display: grid;
	grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
	gap: 16px;
	padding: 20px 20px 8px;
}
@media (max-width: 760px) {
	.return-review__body {
		grid-template-columns: minmax(0, 1fr);
	}
}
.return-review__section {
	padding: 16px;
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	border-radius: 12px;
}
.return-review__title {
	margin: 0 0 8px;
	font-size: 1.05rem;
	font-weight: 700;
}
.return-review__line {
	margin: 0 0 8px;
}
.return-review__row {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	padding: 6px 0;
}
.return-review__row--total {
	font-size: 1.1rem;
	border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.return-review__note {
	margin: 6px 0 0;
	font-size: 0.85rem;
	opacity: 0.8;
}
.return-review__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 12px 20px 20px;
}
.return-review__submit {
	min-width: 280px;
}
</style>
