<template>
	<v-chip
		v-if="part === 'badge' && badge"
		size="small"
		:color="badge.color"
		variant="tonal"
		:data-testid="`credit-badge-${badge.kind}`"
	>
		{{ badge.text }}
	</v-chip>
	<div v-else-if="part === 'lines' && lines.length" class="invoice-credit-lines" data-testid="credit-lines">
		<div v-for="line in lines" :key="line.key" class="invoice-credit-lines__line" :data-line="line.key">
			<template v-for="(segment, index) in line.segments" :key="index">
				<a
					v-if="'link' in segment"
					href="#"
					class="invoice-credit-lines__link"
					@click.prevent.stop="$emit('open', segment.link)"
					>{{ segment.link }}</a
				>
				<span v-else>{{ segment.text }}</span>
			</template>
		</div>
	</div>
</template>

<script setup>
// part="badge": the "Exchange" / "Credit note" chip; part="lines": the links
// and credit lines under it (utils/invoiceCreditLabels.ts).
import { computed } from "vue";
import { creditBadge, creditLines } from "../../../utils/invoiceCreditLabels";

const props = defineProps({
	invoice: { type: Object, default: null },
	part: { type: String, default: "badge" },
	detail: { type: Boolean, default: false },
	money: { type: Function, default: (value) => String(value) },
	date: { type: Function, default: (value) => String(value) },
});

defineEmits(["open"]);

const badge = computed(() => creditBadge(props.invoice));
const lines = computed(() =>
	creditLines(props.invoice, { money: props.money, date: props.date }, { detail: props.detail }),
);
</script>

<style scoped>
.invoice-credit-lines {
	font-size: 0.78rem;
	line-height: 1.35;
	color: rgba(var(--v-theme-on-surface), 0.72);
	margin-top: 2px;
}
.invoice-credit-lines__link {
	color: rgb(var(--v-theme-primary));
	text-decoration: underline;
	cursor: pointer;
}
</style>
