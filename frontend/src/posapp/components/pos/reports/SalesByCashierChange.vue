<template>
	<span class="sbc-change" :class="`sbc-change--${change.kind}`" data-testid="sbc-change" :data-kind="change.kind">
		{{ text }}
	</span>
</template>

<script setup>
import { computed } from "vue";
import { netChange } from "../../../utils/salesByCashierPeriods";

const props = defineProps({
	period1: { type: Number, default: 0 },
	period2: { type: Number, default: 0 },
});

const change = computed(() => netChange(props.period1, props.period2));

const text = computed(() => {
	const { kind, percent } = change.value;
	if (kind === "new") return __("New");
	if (kind === "none") return "—";
	const value = Number(percent).toFixed(1);
	if (kind === "up") return `▲ ${value}%`;
	if (kind === "down") return `▼ ${value}%`;
	return `${value}%`;
});
</script>

<style scoped>
.sbc-change {
	display: inline-flex;
	align-items: center;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 13px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.sbc-change--up {
	color: rgb(var(--v-theme-success));
	background: rgba(var(--v-theme-success), 0.14);
}

.sbc-change--down {
	color: rgb(var(--v-theme-error));
	background: rgba(var(--v-theme-error), 0.14);
}

.sbc-change--new {
	color: rgb(var(--v-theme-primary));
	background: rgba(var(--v-theme-primary), 0.14);
}

.sbc-change--none,
.sbc-change--same {
	color: rgba(var(--v-theme-on-surface), 0.6);
	background: rgba(var(--v-theme-on-surface), 0.06);
}
</style>
