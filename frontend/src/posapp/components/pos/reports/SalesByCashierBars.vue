<template>
	<TransitionGroup
		name="sbc-rank"
		tag="div"
		class="sbc-bars"
		:class="{
			'sbc-bars--compare': compare,
			'sbc-bars--phone': layout === 'phone',
			'sbc-bars--still': still,
		}"
		data-testid="sbc-bars"
	>
		<button
			v-for="(row, index) in rows"
			:key="row.key"
			type="button"
			class="sbc-row"
			:class="{
				'sbc-row--lead': row.lead,
				'sbc-row--muted': row.kind !== 'cashier',
				'sbc-row--first-special': index === firstSpecial && index > 0,
			}"
			:aria-pressed="selectedKey === row.key ? 'true' : 'false'"
			:aria-label="`${row.label}: ${formatMoney(row.values[0].net)}`"
			data-testid="sbc-bar-row"
			:data-kind="row.kind"
			:data-key="row.key"
			@click="emit('select', row.key)"
		>
			<span class="sbc-row__avatar" data-testid="sbc-avatar">{{ row.initials }}</span>
			<span class="sbc-row__name">
				<span data-testid="sbc-bar-name">{{ row.label }}</span>
				<small v-if="row.sub && layout !== 'phone'">{{ row.sub }}</small>
			</span>
			<span class="sbc-row__track">
				<span class="sbc-row__barbox">
					<span
						class="sbc-row__bar"
						:class="{ 'sbc-row__bar--negative': row.values[0].net < 0 }"
						:style="barStyle(ratio(row, 0), index)"
						data-testid="sbc-bar"
						:data-ratio="ratio(row, 0).toFixed(4)"
					></span>
					<span
						v-if="compare"
						class="sbc-row__markerwrap"
						:style="moveStyle(ratio(row, 1), index)"
						data-testid="sbc-marker"
						:data-ratio="ratio(row, 1).toFixed(4)"
						><span class="sbc-row__marker"></span
					></span>
					<span v-else class="sbc-row__valwrap" :style="moveStyle(ratio(row, 0), index)">
						<span
							class="sbc-row__val"
							:class="{ 'sbc-row__val--negative': row.values[0].net < 0 }"
							data-testid="sbc-bar-value"
							>{{ formatMoney(row.values[0].net) }}</span
						>
					</span>
				</span>
			</span>
			<span v-if="compare" class="sbc-row__cval">
				<b :class="{ 'sbc-row__val--negative': row.values[0].net < 0 }" data-testid="sbc-bar-value">{{
					formatMoney(row.values[0].net)
				}}</b>
				<span data-testid="sbc-bar-p2">{{ __("P2 {0}", [formatMoney(row.values[1].net)]) }}</span>
			</span>
			<span class="sbc-row__end" data-testid="sbc-bar-end">
				<SalesByCashierChange v-if="compare" :period1="row.values[0].net" :period2="row.values[1].net" />
				<template v-else>{{ share(row) }}</template>
			</span>
		</button>
	</TransitionGroup>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import SalesByCashierChange from "./SalesByCashierChange.vue";

const props = defineProps({
	rows: { type: Array, default: () => [] },
	periodCount: { type: Number, default: 1 },
	storeNet: { type: Number, default: 0 },
	selectedKey: { type: String, default: "" },
	layout: { type: String, default: "wide" },
	still: { type: Boolean, default: false },
	formatMoney: { type: Function, required: true },
});
const emit = defineEmits(["select"]);

const compare = computed(() => props.periodCount > 1);
const firstSpecial = computed(() => props.rows.findIndex((row) => row.kind !== "cashier"));

const largest = computed(() => {
	let max = 0;
	for (const row of props.rows) {
		for (const values of row.values.slice(0, props.periodCount)) {
			max = Math.max(max, Math.abs(Number(values.net) || 0));
		}
	}
	return max;
});

function ratio(row, period) {
	const value = Math.abs(Number(row.values[period]?.net) || 0);
	return largest.value ? value / largest.value : 0;
}

// Bars grow from zero when the view opens (rows one after another), then
// change length smoothly; nothing moves with reduced motion.
const grown = ref(props.still);
const growing = ref(!props.still);
let frame = 0;
let timer = 0;
const nextFrame = (callback) =>
	typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(callback) : setTimeout(callback, 16);
const cancelFrame = (id) =>
	typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : clearTimeout(id);
onMounted(() => {
	if (props.still) return;
	frame = nextFrame(() => {
		frame = nextFrame(() => {
			grown.value = true;
			timer = setTimeout(() => (growing.value = false), 1400);
		});
	});
});
onBeforeUnmount(() => {
	cancelFrame(frame);
	clearTimeout(timer);
});

const delay = (index) => (growing.value && !props.still ? `${index * 55}ms` : "0ms");
const shown = (value) => (grown.value ? value : 0);

function barStyle(value, index) {
	const hidden = ((1 - shown(value)) * 100).toFixed(3);
	return { clipPath: `inset(0 ${hidden}% 0 0 round 9px)`, transitionDelay: delay(index) };
}

function moveStyle(value, index) {
	return { transform: `translateX(${(shown(value) * 100).toFixed(3)}%)`, transitionDelay: delay(index) };
}

function share(row) {
	if (!(props.storeNet > 0.0005)) return "—";
	return `${Math.round((Number(row.values[0].net) / props.storeNet) * 100)}%`;
}
</script>

<style scoped>
.sbc-bars {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding-top: 4px;
}

.sbc-row {
	position: relative;
	display: grid;
	grid-template-columns: 40px minmax(8rem, 13rem) minmax(0, 1fr) 5.6rem;
	align-items: center;
	column-gap: 14px;
	width: calc(100% + 20px);
	margin: 0 -10px;
	padding: 8px 10px;
	border: 0;
	border-radius: 12px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: start;
	cursor: pointer;
	transition: background-color 0.2s, box-shadow 0.2s;
}

.sbc-row:hover {
	background: var(--sbc-track);
}

.sbc-row[aria-pressed="true"] {
	background: var(--sbc-primary-soft);
	box-shadow: inset 0 0 0 1.5px var(--sbc-primary-ghost);
}

.sbc-row--first-special {
	margin-top: 14px;
}

.sbc-row--first-special::before {
	content: "";
	position: absolute;
	top: -9px;
	left: 10px;
	right: 10px;
	border-top: 1px dashed var(--sbc-line-strong);
}

.sbc-bars--compare .sbc-row {
	grid-template-columns: 40px minmax(8rem, 13rem) minmax(0, 1fr) 7.6rem 5.6rem;
}

.sbc-row__avatar {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: 50%;
	background: var(--sbc-primary-soft);
	color: rgb(var(--v-theme-primary));
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.02em;
}

.sbc-row--lead .sbc-row__avatar {
	background: rgb(var(--v-theme-primary));
	color: rgb(var(--v-theme-on-primary));
}

.sbc-row--muted .sbc-row__avatar {
	background: var(--sbc-surface-2);
	color: var(--sbc-muted);
}

.sbc-row__name {
	min-width: 0;
	font-size: 16px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sbc-row__name small {
	display: block;
	font-size: 12px;
	font-weight: 500;
	color: var(--sbc-muted);
}

.sbc-row--muted .sbc-row__name {
	color: var(--sbc-muted);
}

.sbc-row__track {
	position: relative;
	height: 32px;
}

.sbc-row__barbox {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	width: calc(100% - 7.8rem);
}

.sbc-bars--compare .sbc-row__track {
	height: 30px;
}

.sbc-bars--compare .sbc-row__barbox {
	width: 100%;
}

.sbc-row__bar {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	border-radius: 9px;
	background: rgb(var(--v-theme-primary));
	transition: clip-path 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sbc-row--lead .sbc-row__bar {
	background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.3)), rgb(var(--v-theme-primary));
	box-shadow: 0 0 22px var(--sbc-primary-ghost);
}

.sbc-row--muted .sbc-row__bar {
	background: repeating-linear-gradient(135deg, var(--sbc-muted-bar) 0 7px, transparent 7px 12px), var(--sbc-track);
	box-shadow: none;
}

.sbc-row .sbc-row__bar--negative {
	background: rgb(var(--v-theme-error));
	box-shadow: none;
}

.sbc-row__valwrap,
.sbc-row__markerwrap {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	pointer-events: none;
	transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sbc-row__val {
	position: absolute;
	top: 50%;
	left: 10px;
	transform: translateY(-50%);
	font-size: 17px;
	font-weight: 700;
	white-space: nowrap;
}

.sbc-row__val--negative {
	color: rgb(var(--v-theme-error));
}

.sbc-row__marker {
	position: absolute;
	top: -4px;
	bottom: -4px;
	left: -1.5px;
	width: 3px;
	border-radius: 2px;
	background: rgb(var(--v-theme-on-surface));
	opacity: 0.85;
}

.sbc-row__cval {
	text-align: end;
	white-space: nowrap;
}

.sbc-row__cval b {
	display: block;
	font-size: 17px;
	font-weight: 700;
}

.sbc-row__cval span {
	display: block;
	margin-top: 1px;
	font-size: 12.5px;
	color: var(--sbc-muted);
}

.sbc-row__end {
	text-align: end;
	font-size: 14px;
	font-weight: 600;
	color: var(--sbc-muted);
	white-space: nowrap;
}

/* Rows slide to their new rank. */
.sbc-rank-move {
	transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sbc-rank-enter-active,
.sbc-rank-leave-active {
	transition: opacity 0.25s ease;
}

.sbc-rank-enter-from,
.sbc-rank-leave-to {
	opacity: 0;
}

.sbc-rank-leave-active {
	position: absolute;
	visibility: hidden;
}

/* Phone: the name sits above its bar. */
.sbc-bars--phone .sbc-row {
	grid-template-columns: 34px minmax(0, 1fr) auto;
	grid-template-areas: "av nm en" "tr tr tr";
	row-gap: 8px;
	width: calc(100% + 16px);
	margin: 0 -8px;
	padding: 8px;
}

.sbc-bars--phone.sbc-bars--compare .sbc-row {
	grid-template-areas: "av nm en" "tr tr cv";
}

.sbc-bars--phone .sbc-row--first-special {
	margin-top: 14px;
}

.sbc-bars--phone .sbc-row__avatar {
	grid-area: av;
	width: 32px;
	height: 32px;
	font-size: 12px;
}

.sbc-bars--phone .sbc-row__name {
	grid-area: nm;
	font-size: 15px;
}

.sbc-bars--phone .sbc-row__track {
	grid-area: tr;
	height: 26px;
}

.sbc-bars--phone .sbc-row__cval {
	grid-area: cv;
}

.sbc-bars--phone .sbc-row__cval b,
.sbc-bars--phone .sbc-row__val {
	font-size: 15px;
}

.sbc-bars--phone .sbc-row__end {
	grid-area: en;
}

.sbc-bars--phone .sbc-row__barbox {
	width: calc(100% - 6.6rem);
}

.sbc-bars--phone.sbc-bars--compare .sbc-row__barbox {
	width: 100%;
}

.sbc-bars--still .sbc-row,
.sbc-bars--still .sbc-row__bar,
.sbc-bars--still .sbc-row__valwrap,
.sbc-bars--still .sbc-row__markerwrap,
.sbc-bars--still.sbc-rank-move,
.sbc-bars--still .sbc-rank-move {
	transition: none !important;
}

@media (prefers-reduced-motion: reduce) {
	.sbc-row,
	.sbc-row__bar,
	.sbc-row__valwrap,
	.sbc-row__markerwrap,
	.sbc-rank-move {
		transition: none !important;
	}
}
</style>
