<template>
	<ExchangePicker :format-currency="formatMoney" :currency-symbol="currencySymbol" />
	<v-dialog
		:model-value="Boolean(prompt)"
		max-width="480"
		persistent
		@keydown.esc.stop.prevent="answer(false)"
		@after-enter="focusBack"
	>
		<v-card v-if="prompt" class="exchange-prompt" :data-testid="`exchange-prompt-${prompt.type}`">
			<v-card-title class="exchange-prompt__title">{{ title }}</v-card-title>
			<v-card-text>
				<p v-for="(line, index) in body" :key="index" class="exchange-prompt__line">{{ line }}</p>
			</v-card-text>
			<v-card-actions class="exchange-prompt__actions">
				<v-spacer />
				<v-btn
					ref="backButton"
					variant="tonal"
					data-testid="exchange-prompt-back"
					@click="answer(false)"
				>
					{{ __("Back") }}
				</v-btn>
				<v-btn
					:color="prompt.type === 'discard' ? 'error' : 'primary'"
					variant="flat"
					data-testid="exchange-prompt-ok"
					@click="answer(true)"
				>
					{{ okLabel }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { storeToRefs } from "pinia";
import ExchangePicker from "./ExchangePicker.vue";
import { useExchangeStore } from "../../../stores/exchangeStore";
import { useUIStore } from "../../../stores/uiStore";
import { exchangeConfirmText } from "../../../utils/oneScreenExchangeText";
import { joinMoney } from "../../../format";

const __ = window.__ || ((text, args) => (args || []).reduce((s, a, i) => s.replace(`{${i}}`, a), text));
const exchange = useExchangeStore();
const { prompt } = storeToRefs(exchange);
const backButton = ref(null);

const precision = computed(() => Number(useUIStore().posProfile?.currency_precision) || 3);
const formatMoney = (value) => Number(value || 0).toFixed(precision.value);
const currencySymbol = (currency) => {
	const code = currency || useUIStore().posProfile?.currency;
	return window.get_currency_symbol ? window.get_currency_symbol(code) : "";
};
const money = (value) => joinMoney(currencySymbol(), formatMoney(value));

const text = computed(() => (prompt.value ? exchangeConfirmText(prompt.value, money, __) : null));
const title = computed(() => text.value?.title || "");
const body = computed(() => text.value?.body || []);
const okLabel = computed(() => text.value?.ok || __("OK"));

const focusBack = () => nextTick(() => backButton.value?.$el?.focus?.());
const answer = (value) => exchange.settlePrompt(value);
</script>

<style scoped>
.exchange-prompt__title {
	white-space: normal;
}
.exchange-prompt__line {
	margin: 0 0 6px;
}
.exchange-prompt__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 16px 16px;
}
</style>
