<template>
	<div class="sbc-detail" data-testid="sbc-detail">
		<template v-if="!row">
			<h3 data-testid="sbc-detail-title">{{ __("Store") }} · {{ view.periodLabels[0] }}</h3>
			<div class="sbc-detail__big">
				<small>{{ view.currency }}</small>{{ formatMoney(store.net) }}
			</div>
			<div class="sbc-detail__sub">
				<template v-if="view.compare">
					<SalesByCashierChange :period1="store.net" :period2="view.store[1].net" />
					{{ __("vs {0}", [view.periodLabels[1]]) }}
				</template>
				<template v-else>{{ __("Net sales incl. VAT") }}</template>
			</div>
			<div class="sbc-detail__kv">
				<span>{{ __("Top seller") }}</span><b data-testid="sbc-detail-top">{{ view.cashiers[0]?.label || "—" }}</b>
				<span>{{ __("Cashiers shown") }}</span><b>{{ view.cashiers.length }}</b>
				<span>{{ __("Sales") }}</span><b>{{ store.sales }}</b>
				<span>{{ __("Avg basket (before returns)") }}</span><b>{{ basket(store) }}</b>
			</div>
			<p class="sbc-detail__note">{{ __("Tap a bar to see one cashier.") }}</p>
		</template>

		<template v-else>
			<h3 data-testid="sbc-detail-title">{{ row.kind === "cashier" ? __("Cashier") : __("Group") }}</h3>
			<div class="sbc-detail__who">
				<span class="sbc-detail__avatar" :class="{ 'sbc-detail__avatar--muted': row.kind !== 'cashier', 'sbc-detail__avatar--lead': row.lead }">{{
					row.initials
				}}</span>
				<div>
					<b data-testid="sbc-detail-name">{{ row.label }}</b>
					<span data-testid="sbc-detail-rank"
						><template v-if="rank >= 0">{{ __("#{0} of {1}", [rank + 1, view.cashiers.length]) }} · </template
						>{{ view.periodLabels[0] }}</span
					>
				</div>
			</div>
			<div class="sbc-detail__big">
				<small>{{ view.currency }}</small>{{ formatMoney(row.values[0].net) }}
			</div>
			<div class="sbc-detail__sub" data-testid="sbc-detail-share">{{ shareText }}</div>
			<div class="sbc-detail__kv">
				<span>{{ __("Gross") }}</span><b>{{ formatMoney(row.values[0].gross) }}</b>
				<span>{{ __("Returns") }}</span><b>{{ formatMoney(row.values[0].returns) }}</b>
				<span>{{ __("Sales") }}</span><b>{{ row.values[0].sales }}</b>
				<span>{{ __("Avg basket (before returns)") }}</span><b>{{ basket(row.values[0]) }}</b>
				<template v-if="row.kind === 'cashier'">
					<span>{{ __("Rung up by others") }}</span
					><b data-testid="sbc-detail-by-others">{{ byOthersText(row.values[0]) }}</b>
				</template>
				<template v-if="view.compare">
					<i class="sbc-detail__sep"></i>
					<span>{{ __("Net · Period 2") }}</span><b data-testid="sbc-detail-p2">{{ formatMoney(row.values[1].net) }}</b>
					<span>{{ __("Sales · Period 2") }}</span><b>{{ row.values[1].sales }}</b>
					<span>{{ __("Change") }}</span
					><b><SalesByCashierChange :period1="row.values[0].net" :period2="row.values[1].net" /></b>
				</template>
			</div>
			<p v-if="row.kind === 'others'" class="sbc-detail__note">{{ othersNote }}</p>
			<button type="button" class="sbc-detail__link" data-testid="sbc-detail-clear" @click="emit('clear')">
				← {{ __("Store summary") }}
			</button>
		</template>
	</div>
</template>

<script setup>
import { computed } from "vue";
import SalesByCashierChange from "./SalesByCashierChange.vue";

const props = defineProps({
	view: { type: Object, required: true },
	selectedKey: { type: String, default: "" },
	formatMoney: { type: Function, required: true },
	othersNote: { type: String, default: "" },
});
const emit = defineEmits(["clear"]);

const store = computed(() => props.view.store[0]);
const row = computed(() => props.view.rows.find((candidate) => candidate.key === props.selectedKey) || null);
const rank = computed(() => (row.value ? props.view.cashiers.indexOf(row.value) : -1));

const basket = (values) => (values.avg_basket === null || values.avg_basket === undefined ? "—" : props.formatMoney(values.avg_basket));

// Sales credited to this person (as Sales Person) that another PIN cashier rang up.
const byOthersText = (values) => {
	const count = Number(values?.by_others) || 0;
	return count === 1 ? __("1 sale") : __("{0} sales", [count]);
};

const shareText = computed(() => {
	if (!row.value || !(store.value.net > 0.0005)) return "";
	const percent = Math.round((Number(row.value.values[0].net) / store.value.net) * 100);
	return __("{0}% of the store's net sales", [percent]);
});
</script>

<style scoped>
.sbc-detail h3 {
	margin: 0;
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--sbc-muted);
}

.sbc-detail__who {
	display: flex;
	align-items: center;
	gap: 12px;
	margin: 12px 0 14px;
}

.sbc-detail__who b {
	display: block;
	font-size: 18px;
}

.sbc-detail__who span {
	font-size: 13px;
	color: var(--sbc-muted);
}

.sbc-detail__avatar {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	width: 48px;
	height: 48px;
	border-radius: 50%;
	background: var(--sbc-primary-soft);
	color: rgb(var(--v-theme-primary));
	font-size: 16px;
	font-weight: 700;
}

.sbc-detail__avatar--lead {
	background: rgb(var(--v-theme-primary));
	color: rgb(var(--v-theme-on-primary));
}

.sbc-detail__avatar--muted {
	background: var(--sbc-surface-2);
	color: var(--sbc-muted);
}

.sbc-detail__big {
	margin-top: 14px;
	font-size: 32px;
	font-weight: 800;
	letter-spacing: -0.02em;
	font-variant-numeric: tabular-nums;
}

.sbc-detail__who + .sbc-detail__big {
	margin-top: 0;
}

.sbc-detail__big small {
	margin-right: 4px;
	font-size: 15px;
	font-weight: 600;
	letter-spacing: 0;
	color: var(--sbc-muted);
}

.sbc-detail__sub {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin-top: 2px;
	font-size: 14px;
	font-weight: 600;
	color: var(--sbc-muted);
}

.sbc-detail__kv {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 9px 12px;
	margin-top: 16px;
	font-size: 15px;
	font-variant-numeric: tabular-nums;
}

.sbc-detail__kv span {
	color: var(--sbc-muted);
}

.sbc-detail__kv b {
	font-weight: 700;
	text-align: end;
}

.sbc-detail__sep {
	grid-column: 1 / -1;
	margin: 4px 0;
	border-top: 1px solid var(--sbc-line);
}

.sbc-detail__note {
	margin: 16px 0 0;
	font-size: 13px;
	line-height: 1.45;
	color: var(--sbc-muted);
}

.sbc-detail__link {
	margin-top: 14px;
	padding: 0;
	border: 0;
	background: none;
	color: rgb(var(--v-theme-primary));
	font: inherit;
	font-size: 14px;
	font-weight: 700;
	cursor: pointer;
}
</style>
