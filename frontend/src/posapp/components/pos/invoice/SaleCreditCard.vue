<template>
	<!-- Credit note voucher(s) on the sale (section 112). Text comes from
	     utils/saleCreditCard.ts; this only lays it out:
	     full     -- large screens, in the Active sale box
	     compact  -- medium/small screens and under 1100 px: two lines
	     counter  -- the Counter Grid summary figure -->
	<div
		class="sale-credit-card"
		:class="[`sale-credit-card--${variant}`, `sale-credit-card--${card.state}`, { 'sale-credit-card--flash': flashing }]"
		data-testid="sale-credit-card"
		:data-state="card.state"
	>
		<template v-if="variant === 'full'">
			<div class="sale-credit-card__head">
				<span class="sale-credit-card__eyebrow">{{ __("Credit note") }}</span>
				<strong class="sale-credit-card__title" dir="ltr">{{ card.title }}</strong>
				<span v-if="card.expiryChip" class="sale-credit-card__chip" data-testid="sale-credit-expiry">
					<v-icon icon="mdi-alert-outline" size="14" />{{ card.expiryChip }}
				</span>
				<v-btn
					class="sale-credit-card__remove"
					data-testid="sale-credit-remove"
					size="small"
					variant="tonal"
					color="error"
					prepend-icon="mdi-close"
					@click="remove"
				>
					{{ __("Remove") }}
				</v-btn>
			</div>
			<div class="sale-credit-card__facts">
				<v-icon icon="mdi-check-circle" size="16" color="success" />
				<span>{{ __("{0} available", [card.available]) }}</span>
				<span v-if="card.validUntil">{{ __("Valid until {0}", [card.validUntil]) }}</span>
				<span v-if="card.store">{{ __("From {0}", [card.store]) }}</span>
			</div>
			<!-- One line, so the card stays three lines in every language: the
			     short result ("Credit used" repeats a figure already shown --
			     the sale total, or the amount available); the full sentence
			     is the tooltip. -->
			<div class="sale-credit-card__result" data-testid="sale-credit-result" :title="card.result">
				<template v-if="card.state === 'scan' || card.state === 'checking'">{{ card.resultShort }}</template>
				<template v-else>
					<span class="sale-credit-card__after">{{ __("After this sale:") }}</span> {{ card.resultShort }}
				</template>
			</div>
		</template>

		<template v-else-if="variant === 'compact'">
			<div class="sale-credit-card__line">
				<v-icon icon="mdi-check-circle" size="15" color="success" />
				<!-- No "Credit note" word here: the box is ~340 px wide on medium
				     screens and the date must fit; the title says it in full. -->
				<span class="sale-credit-card__compact-title" :title="compactTitle">
					{{ card.available }}<template v-if="card.validUntil">
						· {{ __("until {0}", [card.validUntil]) }}</template
					>
				</span>
				<span v-if="card.expiryChip" class="sale-credit-card__chip" data-testid="sale-credit-expiry">{{
					card.expiryChip
				}}</span>
				<v-btn
					class="sale-credit-card__remove-icon"
					data-testid="sale-credit-remove"
					icon="mdi-close"
					size="x-small"
					variant="text"
					color="error"
					:aria-label="__('Remove')"
					@click="remove"
				/>
			</div>
			<div class="sale-credit-card__line sale-credit-card__result" data-testid="sale-credit-result">
				{{ card.resultShort }}
			</div>
		</template>

		<template v-else>
			<!-- Same two-line shape as the other Counter Grid figures (48 px). -->
			<span class="sale-credit-card__counter-label" :title="compactTitle">
				{{ __("Credit note") }}<template v-if="card.resultShort"> · </template
				><span class="sale-credit-card__result" data-testid="sale-credit-result">{{ card.resultShort }}</span>
			</span>
			<strong class="sale-credit-card__counter-amount">
				{{ counterAmount }}
				<span v-if="card.expiryChip" class="sale-credit-card__chip" data-testid="sale-credit-expiry">{{
					card.expiryChip
				}}</span>
			</strong>
			<v-btn
				class="sale-credit-card__counter-remove"
				data-testid="sale-credit-remove"
				icon="mdi-close"
				size="x-small"
				variant="text"
				color="error"
				:aria-label="__('Remove')"
				@click="remove"
			/>
		</template>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSaleCreditStore } from "../../../stores/saleCreditStore";

const props = defineProps({
	/** buildSaleCreditCard(...) */
	card: { type: Object, required: true },
	variant: { type: String, default: "full" },
	/** Counter Grid: "−OMR 9.000" once there are new items, else the amount available. */
	creditUsed: { type: String, default: "" },
});

const saleCredit = useSaleCreditStore();
const remove = () => saleCredit.remove();

const compactTitle = computed(() =>
	[__("Credit note"), props.card.title, props.card.available, props.card.store ? __("From {0}", [props.card.store]) : ""]
		.filter(Boolean)
		.join(" · "),
);

const counterAmount = computed(() =>
	props.card.state === "scan" || props.card.state === "checking" ? props.card.available : props.creditUsed,
);

// A green flash for one second each time a voucher goes on the sale.
const flashing = ref(false);
let flashTimer = null;
const flash = () => {
	flashing.value = false;
	if (flashTimer) clearTimeout(flashTimer);
	// A short timer, not an animation frame: frames can be held back while
	// the window isn't painting, and the flash must not come seconds late.
	flashTimer = setTimeout(() => {
		flashing.value = true;
		flashTimer = setTimeout(() => {
			flashing.value = false;
			flashTimer = null;
		}, 1000);
	}, 20);
};
watch(
	() => saleCredit.appliedCount,
	(now, before) => {
		if (now > (before || 0)) flash();
	},
);
// The first voucher puts the card on the screen: it mounts just after the
// count went up, so it flashes if that was under a second ago.
onMounted(() => {
	if (Date.now() - (Number(saleCredit.appliedAt) || 0) < 1000) flash();
});
onBeforeUnmount(() => {
	if (flashTimer) clearTimeout(flashTimer);
});
</script>

<style scoped>
.sale-credit-card {
	--scc-accent: rgb(var(--v-theme-success));
	border: 1px solid rgba(var(--v-theme-success), 0.45);
	border-inline-start: 4px solid var(--scc-accent);
	border-radius: 12px;
	background: rgba(var(--v-theme-success), 0.07);
	color: var(--pos-text-primary);
	transition:
		background-color 0.25s ease,
		box-shadow 0.25s ease;
	min-width: 0;
}

.sale-credit-card--flash {
	background: rgba(var(--v-theme-success), 0.28);
	box-shadow: 0 0 0 3px rgba(var(--v-theme-success), 0.35);
}

.sale-credit-card--full {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 12px;
	margin-top: 4px;
}

.sale-credit-card__head {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.sale-credit-card__eyebrow {
	font-size: 0.68rem;
	font-weight: 700;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
}

.sale-credit-card__title {
	font-size: 0.95rem;
	letter-spacing: 0.02em;
}

.sale-credit-card__remove {
	margin-inline-start: auto;
}

.sale-credit-card__facts {
	column-gap: 14px !important;
}

/* Full card: three single lines; what doesn't fit ends in "…". */
.sale-credit-card--full .sale-credit-card__head,
.sale-credit-card--full .sale-credit-card__facts {
	flex-wrap: nowrap;
	min-width: 0;
}

.sale-credit-card--full .sale-credit-card__facts > span,
.sale-credit-card--full .sale-credit-card__title,
.sale-credit-card--full .sale-credit-card__result {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.sale-credit-card--full .sale-credit-card__facts > span {
	flex: 0 1 auto;
}

.sale-credit-card__facts,
.sale-credit-card__line {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
	font-size: 0.84rem;
	min-width: 0;
}

.sale-credit-card__result {
	font-size: 0.88rem;
	font-weight: 700;
	color: rgb(var(--v-theme-success));
}

.sale-credit-card--checking .sale-credit-card__result {
	color: var(--pos-text-secondary);
	font-weight: 600;
}

.sale-credit-card__after {
	color: var(--pos-text-secondary);
	font-weight: 600;
}

.sale-credit-card__chip {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 1px 8px;
	border-radius: 999px;
	font-size: 0.74rem;
	font-weight: 700;
	white-space: nowrap;
	color: #7a4b00;
	background: #ffe2a8;
	border: 1px solid #f0b54a;
}

.sale-credit-card--compact {
	display: flex;
	flex-direction: column;
	gap: 1px;
	padding: 3px 8px;
	margin-top: 2px;
}

.sale-credit-card--compact .sale-credit-card__line {
	flex-wrap: nowrap;
	font-size: 0.8rem;
	line-height: 1.3;
}

.sale-credit-card__compact-title {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

.sale-credit-card--compact .sale-credit-card__result {
	font-size: 0.82rem;
	padding-inline-start: 21px;
}

.sale-credit-card__remove-icon {
	margin-inline-start: auto;
	flex: 0 0 auto;
}

.sale-credit-card--counter {
	position: relative;
	display: flex;
	flex-direction: column;
	justify-content: center;
	height: 100%;
	min-width: 0;
	/* The figure's own box draws the frame. */
	border: 0;
	background: transparent;
	padding-inline-end: 22px;
}

.sale-credit-card--counter.sale-credit-card--flash {
	background: rgba(var(--v-theme-success), 0.28);
}

.sale-credit-card__counter-label {
	font-size: 0.68rem;
	color: var(--pos-text-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sale-credit-card--counter .sale-credit-card__result {
	font-size: 0.68rem;
	font-weight: 700;
}

.sale-credit-card__counter-amount {
	display: flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
	font-size: 1rem;
}

.sale-credit-card__counter-remove {
	position: absolute;
	top: -4px;
	inset-inline-end: -6px;
}

@media (prefers-reduced-motion: reduce) {
	.sale-credit-card {
		transition: none;
	}
}
</style>
