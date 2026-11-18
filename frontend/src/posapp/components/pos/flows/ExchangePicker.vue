<template>
	<v-dialog
		:model-value="exchange.pickerOpen"
		max-width="760"
		scrollable
		@update:model-value="(open) => !open && back()"
		@after-enter="focusScan"
	>
		<v-card class="exchange-picker" data-testid="exchange-picker">
			<div class="exchange-picker__head">
				<div class="exchange-picker__title-copy">
					<span class="text-h6">{{ __("Items on receipt") }}</span>
					<span class="exchange-picker__subtitle">{{ subtitle }}</span>
					<span v-if="returnableUntil" class="exchange-picker__until" data-testid="exchange-picker-until">
						{{ __("returnable until {0}", [returnableUntil]) }}
					</span>
				</div>
				<v-btn icon="mdi-close" variant="text" :aria-label="__('Back')" @click="back" />
			</div>
			<v-card-text class="exchange-picker__body">
				<input
					ref="scanInput"
					v-model="scanText"
					class="exchange-picker__scan"
					data-testid="exchange-picker-scan"
					:placeholder="__('Scan an item to tick it')"
					autocomplete="off"
					@keydown.enter.prevent="scan"
				/>
				<p v-if="scanMessage" class="exchange-picker__scan-message" role="alert">{{ scanMessage }}</p>
				<div
					v-for="line in lines"
					:key="line.name"
					class="exchange-picker__row"
					:class="{
						'exchange-picker__row--selected': (draft[line.name] || 0) > 0,
						'exchange-picker__row--blocked': Boolean(blockedReason(line)),
					}"
					:data-testid="`exchange-picker-line-${line.idx}`"
					@click="toggleRow(line)"
				>
					<div class="exchange-picker__tick" @click.stop>
						<v-checkbox-btn
							:model-value="(draft[line.name] || 0) > 0"
							:disabled="Boolean(blockedReason(line))"
							:aria-label="line.item_name || line.item_code"
							@update:model-value="(value) => tick(line, value)"
						/>
					</div>
					<div class="exchange-picker__item">
						<div class="exchange-picker__name">{{ line.item_name || line.item_code }}</div>
						<div class="exchange-picker__meta">
							<span>{{ line.item_code }}</span>
							<span>· {{ __("Sold {0}", [formatQty(line.sold)]) }}</span>
							<span v-if="blockedReason(line)" class="exchange-picker__reason">· {{ blockedReason(line) }}</span>
							<span v-else-if="historyNote(line)">· {{ historyNote(line) }}</span>
							<span v-if="line.discount_percentage" class="exchange-picker__disc">
								· {{ __("Disc {0}%", [formatQty(line.discount_percentage)]) }}
							</span>
						</div>
					</div>
					<div class="exchange-picker__qty" @click.stop>
						<v-btn
							icon="mdi-minus"
							size="x-small"
							variant="tonal"
							:disabled="!(draft[line.name] > 0)"
							:aria-label="__('One less')"
							@click="step(line, -1)"
						/>
						<span class="exchange-picker__qty-value">{{ formatQty(draft[line.name] || 0) }}</span>
						<v-btn
							icon="mdi-plus"
							size="x-small"
							variant="tonal"
							:disabled="Boolean(blockedReason(line)) || (draft[line.name] || 0) >= line.left"
							:aria-label="__('One more')"
							@click="step(line, 1)"
						/>
					</div>
					<div class="exchange-picker__price">{{ money(line.rate) }}</div>
				</div>
			</v-card-text>
			<v-card-actions class="exchange-picker__actions">
				<span class="exchange-picker__summary">{{ summary }}</span>
				<v-spacer />
				<v-btn variant="text" @click="back">{{ __("Back") }}</v-btn>
				<v-btn color="primary" variant="flat" data-testid="exchange-picker-done" @click="done">
					{{ __("Done") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useExchangeStore } from "../../../stores/exchangeStore";
import { registerExchangePickerScan } from "../../../composables/pos/items/exchangeScanRoute";
import {
	estimateReturned,
	formatQty,
	initialPicks,
	lineBlockedReason,
	lineHistoryNote,
	pickedCount,
	pickedQty,
	setPick,
	tickByScan,
} from "../../../utils/oneScreenExchange";

const props = defineProps({
	formatCurrency: { type: Function, default: (value) => Number(value || 0).toFixed(3) },
	currencySymbol: { type: Function, default: () => "" },
});

const __ = window.__ || ((text, args) => (args || []).reduce((s, a, i) => s.replace(`{${i}}`, a), text));
const exchange = useExchangeStore();
const draft = ref({});
const scanText = ref("");
const scanMessage = ref("");
const scanInput = ref(null);

const lines = computed(() => exchange.receiptLines);
const receipt = computed(() => exchange.receipt || {});

const shortDate = (value) => {
	if (!value) return "";
	const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
	if (Number.isNaN(date.getTime())) return String(value);
	const lang = (window.frappe?.boot?.lang || "en").replace("_", "-");
	// "13 Nov": day first, whatever the language's own order.
	let month;
	try {
		month = date.toLocaleDateString(lang, { month: "short" });
	} catch {
		month = date.toDateString().slice(4, 7);
	}
	return `${date.getDate()} ${month}`;
};
const userDate = (value) =>
	value && window.frappe?.datetime?.str_to_user ? window.frappe.datetime.str_to_user(value) : value || "";

const subtitle = computed(() =>
	[receipt.value.name, receipt.value.customer_name || receipt.value.customer, userDate(receipt.value.posting_date)]
		.filter(Boolean)
		.join(" · "),
);
const returnableUntil = computed(() => userDate(receipt.value.returnable_until));
const blockedReason = (line) => lineBlockedReason(line, shortDate, __);
const historyNote = (line) => lineHistoryNote(line, shortDate, __);
const money = (value) => `${props.currencySymbol(receipt.value.currency)} ${props.formatCurrency(value)}`;

const summary = computed(() => {
	const count = pickedCount(draft.value);
	if (!count) return __("Nothing ticked");
	return __("{0} back · {1}", [
		formatQty(pickedQty(draft.value)),
		money(-estimateReturned(lines.value, draft.value)),
	]);
});

// While open, scans tick lines here and never reach the cart.
let unregisterScan = null;
let lastScan = { code: "", at: 0 };
watch(
	() => exchange.pickerOpen,
	(open) => {
		unregisterScan?.();
		unregisterScan = null;
		if (!open) return;
		unregisterScan = registerExchangePickerScan((code) => scanCode(code));
		const current = exchange.picks || {};
		draft.value = Object.keys(current).length ? { ...current } : initialPicks(lines.value);
		scanText.value = "";
		scanMessage.value = "";
	},
	{ immediate: true },
);

const focusScan = () => nextTick(() => scanInput.value?.focus?.());

const tick = (line, value) => {
	if (blockedReason(line)) return;
	draft.value = setPick(draft.value, line, value ? Math.max(draft.value[line.name] || 0, Math.min(1, line.left)) : 0);
	scanMessage.value = "";
};
// Anywhere on the row ticks or unticks it (−/+ and the box keep their own clicks).
const toggleRow = (line) => {
	if (blockedReason(line)) return;
	tick(line, !(draft.value[line.name] > 0));
};
const step = (line, delta) => {
	draft.value = setPick(draft.value, line, (draft.value[line.name] || 0) + delta);
	scanMessage.value = "";
};

onBeforeUnmount(() => unregisterScan?.());

const scan = () => {
	const code = String(scanText.value || "").trim();
	scanText.value = "";
	scanCode(code);
};

function scanCode(raw) {
	const code = String(raw || "").trim();
	if (!code) return;
	// The same scan can arrive from the box and from the scanner listener.
	const now = Date.now();
	if (lastScan.code === code && now - lastScan.at < 500) return;
	lastScan = { code, at: now };
	if (code === exchange.receipt?.name || exchange.receipt?.name?.endsWith(`-${code}`)) return;
	const result = tickByScan(lines.value, draft.value, code);
	if (result.error === "not_on_receipt") {
		scanMessage.value = __("This item isn't on this receipt");
		window.frappe?.utils?.play_sound?.("error");
		return;
	}
	if (result.error === "nothing_left") {
		scanMessage.value = __("Nothing more of {0} can be returned", [result.line?.item_name || code]);
		window.frappe?.utils?.play_sound?.("error");
		return;
	}
	draft.value = result.picks;
	scanMessage.value = "";
}

const back = () => exchange.closePicker(null);
const done = () => exchange.closePicker(draft.value);
</script>

<style scoped>
.exchange-picker__head {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 16px 12px 4px 20px;
}
.exchange-picker__title-copy {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
}
.exchange-picker__subtitle,
.exchange-picker__until {
	font-size: 0.85rem;
	opacity: 0.8;
	overflow-wrap: anywhere;
}
.exchange-picker__until {
	font-weight: 600;
	opacity: 1;
}
.exchange-picker__scan {
	width: 100%;
	padding: 8px 10px;
	margin-bottom: 6px;
	border: 1px solid rgba(var(--v-border-color), 0.5);
	border-radius: 6px;
	background: transparent;
	color: inherit;
}
.exchange-picker__scan-message {
	margin: 0 0 6px;
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}
.exchange-picker__row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto 90px;
	align-items: center;
	gap: 10px;
	padding: 8px 0;
	border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.exchange-picker__row {
	cursor: pointer;
}
.exchange-picker__row--blocked {
	cursor: default;
}
.exchange-picker__row--selected {
	background: rgba(var(--v-theme-primary), 0.06);
}
.exchange-picker__row--blocked {
	opacity: 0.5;
}
.exchange-picker__tick {
	display: flex;
	align-items: center;
}
.exchange-picker__tick :deep(.v-selection-control) {
	grid-area: auto;
	flex: 0 0 auto;
}
.exchange-picker__item {
	min-width: 0;
	cursor: pointer;
}
.exchange-picker__row--blocked .exchange-picker__item {
	cursor: default;
}
.exchange-picker__name {
	font-weight: 600;
	overflow-wrap: anywhere;
}
.exchange-picker__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	font-size: 0.8rem;
	opacity: 0.8;
}
.exchange-picker__reason {
	font-weight: 600;
}
.exchange-picker__disc {
	color: rgb(var(--v-theme-success));
}
.exchange-picker__qty {
	display: flex;
	align-items: center;
	gap: 6px;
}
.exchange-picker__qty-value {
	min-width: 28px;
	text-align: center;
	font-weight: 600;
}
.exchange-picker__price {
	text-align: right;
	white-space: nowrap;
}
.exchange-picker__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 16px 16px;
}
.exchange-picker__summary {
	font-weight: 600;
}
@media (max-width: 600px) {
	.exchange-picker__row {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}
	.exchange-picker__price {
		display: none;
	}
}
</style>
