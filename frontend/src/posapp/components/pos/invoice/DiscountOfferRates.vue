<template>
	<!-- The ⓘ beside the cart's Disc % title: a read-only list of the bank
	     offer rates (POS Discount Reason "Offer %"), so staff can check the
	     rate before typing it. A reminder only: it never sets a discount. -->
	<v-menu v-if="rated.length" location="bottom" :close-on-content-click="false">
		<template #activator="{ props: activator }">
			<button
				v-bind="activator"
				type="button"
				class="posa-offer-rates__button"
				data-testid="discount-offer-rates-button"
				:aria-label="__('Bank offer rates')"
				:title="__('Bank offer rates')"
				@click.stop
				@keydown.enter.stop
				@keydown.space.stop
			>
				<v-icon icon="mdi-information-outline" size="15" />
			</button>
		</template>
		<v-card class="posa-offer-rates" data-testid="discount-offer-rates">
			<div class="posa-offer-rates__title">{{ __("Bank offer rates") }}</div>
			<ul class="posa-offer-rates__list">
				<li
					v-for="reason in rated"
					:key="reason.name"
					class="posa-offer-rates__row"
					:data-testid="`discount-offer-rate-${reason.name}`"
				>
					<span class="posa-offer-rates__name">{{ reason.name }}</span>
					<span class="posa-offer-rates__sep" aria-hidden="true">·</span>
					<span class="posa-offer-rates__rate">{{ formatOfferRate(reasonOfferRate(reason)) }}</span>
				</li>
			</ul>
			<div v-if="unrated.length" class="posa-offer-rates__unrated" data-testid="discount-offer-rates-unrated">
				{{ __("No fixed rate: {0}", [unrated.map((reason) => reason.name).join(", ")]) }}
			</div>
		</v-card>
	</v-menu>
</template>

<script setup>
import { computed } from "vue";
import { formatOfferRate, reasonOfferRate } from "../../../utils/discountReasons";

defineOptions({ name: "DiscountOfferRates" });

const props = defineProps({
	reasons: { type: Array, default: () => [] },
});

const __ = window.__ || ((text) => text);

const offered = computed(() => (props.reasons || []).filter((reason) => reason && reason.name));
const rated = computed(() => offered.value.filter((reason) => reasonOfferRate(reason) !== null));
const unrated = computed(() => offered.value.filter((reason) => reasonOfferRate(reason) === null));
</script>

<style scoped>
.posa-offer-rates__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 1px;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: inherit;
	cursor: pointer;
	flex: 0 0 auto;
}

.posa-offer-rates__button:hover,
.posa-offer-rates__button:focus-visible {
	background: rgba(var(--v-theme-on-surface), 0.08);
	outline: none;
}

.posa-offer-rates {
	padding: 12px 14px;
	max-width: min(360px, calc(100vw - 32px));
}

.posa-offer-rates__title {
	font-weight: 600;
	margin-bottom: 6px;
}

.posa-offer-rates__list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.posa-offer-rates__row {
	display: flex;
	gap: 6px;
	padding: 3px 0;
	font-size: 0.92rem;
}

.posa-offer-rates__name {
	flex: 1 1 auto;
	min-width: 0;
	overflow-wrap: anywhere;
}

.posa-offer-rates__rate {
	font-weight: 600;
	white-space: nowrap;
}

.posa-offer-rates__unrated {
	margin-top: 8px;
	font-size: 0.82rem;
	opacity: 0.75;
}
</style>
