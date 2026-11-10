<template>
	<div class="sbc-cal" data-testid="sbc-calendar">
		<div class="sbc-cal__head">
			<div class="sbc-cal__field">
				<span>{{ __("From") }}</span><b data-testid="sbc-cal-from">{{ formatDmy(shown.from) }}</b>
			</div>
			<div class="sbc-cal__field">
				<span>{{ __("To") }}</span><b data-testid="sbc-cal-to">{{ formatDmy(shown.to) }}</b>
			</div>
			<div class="sbc-cal__hint" :class="{ 'sbc-cal__hint--error': error }" data-testid="sbc-cal-hint">
				{{ error || (anchor ? __("Now tap the last day.") : __("Tap the first day, then the last day.")) }}
			</div>
		</div>
		<div class="sbc-cal__months">
			<div class="sbc-cal__nav">
				<button type="button" :aria-label="__('Previous month')" data-testid="sbc-cal-prev" @click="shift(-1)">‹</button>
				<button type="button" :aria-label="__('Next month')" data-testid="sbc-cal-next" @click="shift(1)">›</button>
			</div>
			<div v-for="grid in grids" :key="`${grid.year}-${grid.month}`" class="sbc-cal__month">
				<h4 data-testid="sbc-cal-month">{{ __(MONTHS_LONG[grid.month - 1]) }} {{ grid.year }}</h4>
				<div class="sbc-cal__grid">
					<span v-for="day in grid.weekdays" :key="day" class="sbc-cal__wd">{{ __(day) }}</span>
					<template v-for="(cell, index) in grid.cells" :key="cell || `blank-${index}`">
						<span v-if="!cell"></span>
						<button
							v-else
							type="button"
							class="sbc-cal__day"
							:class="dayClass(cell)"
							:disabled="cell > today"
							:data-day="cell"
							:aria-label="formatDmy(cell)"
							@click="pick(cell)"
							@mouseenter="hover = cell"
						>
							<span>{{ Number(cell.slice(8)) }}</span>
						</button>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
	MAX_PERIOD_DAYS,
	MONTHS_LONG,
	addMonths,
	formatDmy,
	monthGrid,
	rangeDays,
} from "../../../utils/salesByCashierPeriods";

const props = defineProps({
	range: { type: Object, required: true }, // { from, to }
	today: { type: String, required: true },
	months: { type: Number, default: 2 },
	weekStart: { type: Number, default: 0 },
});
const emit = defineEmits(["pick"]);

// The right-hand month shows the end of the range; with two months the left
// one is the month before.
const view = ref(addMonths(props.range.to, props.months > 1 ? -1 : 0));
const anchor = ref("");
const hover = ref("");
const error = ref("");

watch(
	() => [props.range.from, props.range.to, props.months],
	() => {
		view.value = addMonths(props.range.to, props.months > 1 ? -1 : 0);
		anchor.value = "";
		hover.value = "";
	},
);

const grids = computed(() =>
	Array.from({ length: props.months }, (_, i) => monthGrid(addMonths(view.value, i), props.weekStart)),
);

// While picking, show the range from the first tap to the hovered day.
const shown = computed(() => {
	if (!anchor.value) return props.range;
	const other = hover.value || anchor.value;
	return anchor.value <= other ? { from: anchor.value, to: other } : { from: other, to: anchor.value };
});

function dayClass(day) {
	const { from, to } = shown.value;
	return {
		"sbc-cal__day--in": day >= from && day <= to,
		"sbc-cal__day--start": day === from,
		"sbc-cal__day--end": day === to,
		"sbc-cal__day--today": day === props.today,
	};
}

function shift(step) {
	view.value = addMonths(view.value, step);
}

function pick(day) {
	if (day > props.today) return;
	if (!anchor.value) {
		anchor.value = day;
		hover.value = day;
		error.value = "";
		return;
	}
	const range = anchor.value <= day ? { from: anchor.value, to: day } : { from: day, to: anchor.value };
	anchor.value = "";
	hover.value = "";
	if (rangeDays(range) > MAX_PERIOD_DAYS) {
		error.value = __("Choose a period of one year or less.");
		return;
	}
	error.value = "";
	emit("pick", range);
}

defineExpose({ pick, shift });
</script>

<style scoped>
.sbc-cal__head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	margin-bottom: 12px;
}

.sbc-cal__field {
	min-width: 128px;
	padding: 6px 10px;
	border: 1px solid var(--sbc-line);
	border-radius: 10px;
	background: var(--sbc-surface-2);
}

.sbc-cal__field span {
	display: block;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--sbc-muted);
}

.sbc-cal__field b {
	font-size: 15px;
	font-variant-numeric: tabular-nums;
}

.sbc-cal__hint {
	flex: 1 1 100%;
	font-size: 12.5px;
	color: var(--sbc-muted);
}

.sbc-cal__hint--error {
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}

.sbc-cal__months {
	position: relative;
	display: flex;
	gap: 22px;
}

.sbc-cal__nav {
	position: absolute;
	top: -2px;
	left: 0;
	right: 0;
	display: flex;
	justify-content: space-between;
	pointer-events: none;
}

.sbc-cal__nav button {
	width: 30px;
	height: 30px;
	border: 0;
	border-radius: 8px;
	background: var(--sbc-surface-2);
	color: inherit;
	font-size: 16px;
	cursor: pointer;
	pointer-events: auto;
}

.sbc-cal__month h4 {
	margin: 4px 0 10px;
	font-size: 14px;
	text-align: center;
}

.sbc-cal__grid {
	display: grid;
	grid-template-columns: repeat(7, 38px);
	row-gap: 2px;
}

.sbc-cal__wd {
	padding-bottom: 4px;
	font-size: 11.5px;
	font-weight: 700;
	text-align: center;
	color: var(--sbc-faint);
}

.sbc-cal__day {
	height: 36px;
	border: 0;
	background: transparent;
	color: inherit;
	font-size: 14px;
	cursor: pointer;
}

.sbc-cal__day span {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	border-radius: 9px;
}

.sbc-cal__day--in {
	background: var(--sbc-primary-soft);
}

.sbc-cal__day--start {
	border-radius: 9px 0 0 9px;
}

.sbc-cal__day--end {
	border-radius: 0 9px 9px 0;
}

.sbc-cal__day--start.sbc-cal__day--end {
	border-radius: 9px;
}

.sbc-cal__day--start span,
.sbc-cal__day--end span {
	background: rgb(var(--v-theme-primary));
	color: rgb(var(--v-theme-on-primary));
	font-weight: 700;
}

.sbc-cal__day--today span {
	box-shadow: inset 0 0 0 1.5px var(--sbc-primary-ghost);
}

.sbc-cal__day:hover:not(:disabled) span {
	box-shadow: inset 0 0 0 1.5px rgb(var(--v-theme-primary));
}

.sbc-cal__day:disabled {
	color: var(--sbc-faint);
	cursor: default;
}
</style>
