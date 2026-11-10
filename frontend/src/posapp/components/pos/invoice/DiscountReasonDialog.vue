<template>
	<v-dialog
		:model-value="!!request"
		max-width="520px"
		persistent
		scrollable
		:content-props="{ onKeydownCapture: handleKeydownCapture }"
		@after-enter="focusInitialControl"
	>
		<!-- The key guard sits on Vuetify's overlay wrapper (content-props),
		     not the card: the dialog can hold focus on that wrapper, outside
		     the card, and a scan must still be caught there. -->
		<v-card v-if="request" class="discount-reason" data-testid="discount-reason-dialog">
			<v-card-title class="discount-reason__title">
				<v-icon icon="mdi-sale-outline" size="22" class="mr-2" />
				{{ __("Discount reason") }}
			</v-card-title>
			<v-card-subtitle class="discount-reason__subtitle">
				<template v-if="request.mode === 'line' && request.lines.length === 1">
					{{ lineLabel(request.lines[0]) }}
				</template>
				<template v-else>
					{{ __("Choose a reason for these discounted lines before payment:") }}
				</template>
			</v-card-subtitle>

			<v-card-text>
				<ul
					v-if="request.mode === 'pay' || request.lines.length > 1"
					class="discount-reason__lines"
					data-testid="discount-reason-lines"
				>
					<li v-for="line in request.lines" :key="line.posa_row_id || line.item_code">
						{{ lineLabel(line) }}
					</li>
				</ul>

				<div
					v-if="reasons.length"
					class="discount-reason__options"
					role="radiogroup"
					:aria-label="__('Discount reason')"
				>
					<v-btn
						v-for="reason in orderedReasons"
						:key="reason.name"
						:variant="selected === reason.name ? 'flat' : 'outlined'"
						:color="selected === reason.name ? 'primary' : undefined"
						class="discount-reason__option"
						:class="{
							'discount-reason__option--selected': selected === reason.name,
							'discount-reason__option--dim': isDimmed(reason),
						}"
						role="radio"
						:aria-checked="selected === reason.name ? 'true' : 'false'"
						:aria-label="optionLabel(reason)"
						:data-reason="reason.name"
						:data-match="isMatch(reason) ? 'true' : undefined"
						:data-dim="isDimmed(reason) ? 'true' : undefined"
						:data-testid="`discount-reason-option-${reason.name}`"
						@click="select(reason)"
					>
						<span class="discount-reason__option-body">
							<span class="discount-reason__option-name">
								<!-- ✓ only on the selected reason, never on a rate match. -->
								<span
									v-if="selected === reason.name"
									class="discount-reason__selected-mark"
									aria-hidden="true"
									data-testid="discount-reason-selected-mark"
									>✓
								</span>{{ reason.name }}
							</span>
							<!-- The reason's usual offer rate: a reminder only. -->
							<span
								v-if="rateOf(reason) !== null"
								class="discount-reason__rate"
								:class="{ 'discount-reason__rate--match': isMatch(reason) }"
								:data-testid="`discount-reason-rate-${reason.name}`"
							>
								{{ formatOfferRate(rateOf(reason)) }}
							</span>
						</span>
					</v-btn>
				</div>
				<v-alert v-else type="warning" variant="tonal" density="compact">
					{{ __("No discount reasons are set up. Ask a manager to add them in POS Discount Reason.") }}
				</v-alert>

				<!-- The selected reason's usual rate differs from the line's Disc %.
				     Shown as soon as it is selected; never blocks: Keep records
				     the reason as it is. -->
				<div
					v-if="rateWarning"
					class="discount-reason__rate-warning"
					role="alert"
					data-testid="discount-reason-rate-warning"
				>
					<div class="discount-reason__rate-warning-text">{{ rateWarning }}</div>
					<div class="discount-reason__rate-warning-actions">
						<v-btn
							variant="flat"
							color="warning"
							data-testid="discount-reason-change-percent"
							@click="changePercent"
						>
							{{ __("Change %") }}
						</v-btn>
						<v-btn variant="outlined" data-testid="discount-reason-keep" @click="keep">
							{{ __("Keep") }}
						</v-btn>
					</div>
				</div>

				<v-checkbox
					v-if="request.mode === 'line' && request.otherMissingCount > 0"
					v-model="applyToOthers"
					density="compact"
					hide-details
					class="mt-2"
					data-testid="discount-reason-apply-others"
					:label="
						__('Also use for {0} other discounted line(s) without a reason', [request.otherMissingCount])
					"
				/>
			</v-card-text>

			<v-card-actions>
				<v-spacer />
				<!-- No "Later": a line discount needs a reason. Only the Pay check can
				     be left (back to the cart, payment stays blocked) -- or, if no
				     reasons are set up at all, the prompt, so the till isn't stuck. -->
				<v-btn
					v-if="canLeave"
					variant="text"
					data-testid="discount-reason-back"
					@click="backToCart"
				>
					{{ request.mode === "pay" ? __("Back to cart") : __("Close") }}
				</v-btn>
				<v-btn
					color="primary"
					variant="flat"
					:disabled="!selectedReason || !!rateWarning"
					class="discount-reason__confirm"
					data-testid="discount-reason-confirm"
					@click="confirm"
				>
					{{ confirmLabel }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useUIStore } from "../../../stores/uiStore";
import {
	formatOfferRate,
	lineDiscountPercent,
	linesOffReasonRate,
	reasonMatchesPercent,
	reasonOfferRate,
	sortReasonsForLines,
} from "../../../utils/discountReasons";

defineOptions({
	name: "DiscountReasonDialog",
});

const __ = window.__ || ((text) => text);

// A barcode scanner typing while this dialog is open must not pick or
// confirm a reason: every printable key is swallowed (Space would otherwise
// press the focused reason button -- there is nothing to type here), and an
// Enter arriving within this window after one is ignored (the scanner's
// suffix).
const SCANNER_ENTER_GUARD_MS = 300;

const uiStore = useUIStore();
const request = computed(() => uiStore.discountReasonRequest);
const reasons = computed(() =>
	(uiStore.discountReasons || []).filter((reason) => reason && reason.name),
);

// Reasons whose offer rate matches a line's Disc % come first.
const orderedReasons = computed(() => sortReasonsForLines(reasons.value, request.value?.lines));
const typedPercents = computed(() =>
	(request.value?.lines || []).map(lineDiscountPercent).filter((percent) => percent !== null),
);

// Two steps: a tap only selects (strong highlight + ✓); Confirm records.
const selected = ref(null);
const applyToOthers = ref(false);
let lastPrintableAt = 0;
let focusBeforeOpen = null;

const selectedReason = computed(() => reasons.value.find((reason) => reason.name === selected.value) || null);
const canLeave = computed(() => request.value?.mode === "pay" || !reasons.value.length);

watch(
	request,
	(current, previous) => {
		if (current && current !== previous) {
			focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			const preselect = current.preselect;
			selected.value = reasons.value.some((reason) => reason.name === preselect) ? preselect : null;
			applyToOthers.value = false;
			lastPrintableAt = 0;
			focusInitialControl();
		} else if (!current && previous) {
			const target = focusBeforeOpen;
			focusBeforeOpen = null;
			nextTick(() => {
				// Only if nobody else (e.g. the cart's stay-put) took focus.
				const active = document.activeElement;
				const unclaimed =
					!active || active === document.body || Boolean(active.closest?.(".v-overlay__content"));
				if (unclaimed && target && target.isConnected) target.focus();
			});
		}
	},
	{ flush: "post" },
);

// Focus the preselected reason (else the first), so Enter takes it. Also
// re-run after the open transition, when Vuetify moves focus to its own
// wrapper. Matches names directly: no CSS selector escaping to get wrong.
function focusInitialControl() {
	nextTick(() => {
		const root = document.querySelector('[data-testid="discount-reason-dialog"]');
		if (!root) return;
		const buttons = [...root.querySelectorAll("[data-reason]")];
		const target =
			(selected.value && buttons.find((button) => button.dataset.reason === selected.value)) || buttons[0];
		if (target && document.activeElement !== target) target.focus();
	});
}

function lineLabel(line) {
	const name = line?.item_name || line?.item_code || "";
	const percent = Number(line?.discount_percentage || 0);
	return percent > 0 ? __("{0} — {1}% off", [name, Number(percent.toFixed(2))]) : name;
}

const rateOf = (reason) => reasonOfferRate(reason);
const isMatch = (reason) => typedPercents.value.some((percent) => reasonMatchesPercent(reason, percent));
// When some reasons match the typed %, the others are dimmed (still tappable).
const anyMatch = computed(() => reasons.value.some(isMatch));
const isDimmed = (reason) => anyMatch.value && !isMatch(reason) && selected.value !== reason.name;

const reasonText = (reason) => {
	const rate = rateOf(reason);
	return rate === null ? reason.name : `${reason.name} · ${formatOfferRate(rate)}`;
};
const confirmLabel = computed(() =>
	selectedReason.value ? __("Confirm: {0}", [reasonText(selectedReason.value)]) : __("Confirm"),
);
const percentText = (percent) => formatOfferRate(percent);

function optionLabel(reason) {
	const rate = rateOf(reason);
	if (rate === null) return reason.name;
	return isMatch(reason)
		? __("{0}, usually {1}, matches this discount", [reason.name, formatOfferRate(rate)])
		: __("{0}, usually {1}", [reason.name, formatOfferRate(rate)]);
}

const applyingToOthers = computed(() => request.value?.mode === "line" && applyToOthers.value);
const targetLines = computed(() => [
	...(request.value?.lines || []),
	...(applyingToOthers.value ? request.value?.otherLines || [] : []),
]);
const offRateLines = (reason) => linesOffReasonRate(reason, targetLines.value);

const rateWarning = computed(() => {
	const reason = selectedReason.value;
	if (!reason) return "";
	const off = offRateLines(reason);
	if (!off.length) return "";
	const usual = formatOfferRate(rateOf(reason));
	if (targetLines.value.length === 1) {
		return __("{0} is usually {1}; this line has {2}.", [
			reason.name,
			usual,
			percentText(lineDiscountPercent(off[0])),
		]);
	}
	const others = [...new Set(off.map((line) => percentText(lineDiscountPercent(line))))].join(", ");
	if (off.length === 1) {
		return __("{0} is usually {1}; one of these lines has {2}.", [reason.name, usual, others]);
	}
	return __("{0} is usually {1}; {2} of these lines have {3}.", [reason.name, usual, off.length, others]);
});

// A tap only selects; another tap changes the selection. A reason whose
// usual rate differs from the Disc % shows the orange warning right away.
function select(reason) {
	selected.value = reason.name;
	if (rateWarning.value) focusWarning();
}

// Confirm (button or Enter) records the selection. With the orange warning
// showing, the answer is Change % or Keep instead.
function confirm() {
	if (!request.value || !selectedReason.value) return;
	if (rateWarning.value) {
		focusWarning();
		return;
	}
	resolve();
}

function resolve() {
	uiStore.resolveDiscountReason({
		reason: selectedReason.value.name,
		applyToOthers: applyingToOthers.value,
	});
}

// Records the reason with the line's Disc % as it is. Never blocked.
function keep() {
	if (!request.value || !selectedReason.value) return;
	resolve();
}

// Back to the line's Disc % without recording the reason; the line prompt
// remembers the pick for next time. From the Pay check: back to the cart.
function changePercent() {
	if (!request.value || !selectedReason.value) return;
	if (request.value.mode !== "line") {
		uiStore.resolveDiscountReason(null);
		return;
	}
	uiStore.resolveDiscountReason({
		reason: selectedReason.value.name,
		applyToOthers: false,
		changePercent: true,
	});
}

function focusWarning() {
	nextTick(() => {
		const button = document.querySelector('[data-testid="discount-reason-change-percent"]');
		if (button instanceof HTMLElement) button.focus();
	});
}

function backToCart() {
	if (canLeave.value) uiStore.resolveDiscountReason(null);
}

function handleKeydownCapture(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	const key = event.key || "";
	if (key.length === 1) {
		lastPrintableAt = Date.now();
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (key !== "Enter") return;
	if (Date.now() - lastPrintableAt < SCANNER_ENTER_GUARD_MS) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	const target = event.target instanceof Element ? event.target : null;
	// Enter on a warning or footer button presses that button (native click).
	if (target?.closest(".discount-reason__rate-warning button, .v-card-actions button")) return;
	// Enter on a reason: selects it if it isn't selected yet, otherwise confirms.
	const option = target?.closest("[data-reason]");
	if (option instanceof HTMLElement && option.dataset.reason !== selected.value) {
		event.preventDefault();
		event.stopPropagation();
		const reason = reasons.value.find((candidate) => candidate.name === option.dataset.reason);
		if (reason) select(reason);
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	confirm();
}

defineExpose({ confirm, backToCart, keep, changePercent, select });
</script>

<style scoped>
.discount-reason__title {
	display: flex;
	align-items: center;
}

.discount-reason__subtitle {
	white-space: normal;
}

.discount-reason__lines {
	margin: 0 0 12px 18px;
	font-size: 0.9rem;
}

.discount-reason__options {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	/* Rows size to their tallest button; stretch makes the rest match it. */
	align-items: stretch;
	gap: 8px;
}

/* Long reason names wrap inside the button (never cut off or shrunk):
   Vuetify gives v-btn a fixed height and single-line, nowrap content. */
.discount-reason__option {
	height: auto !important;
	min-height: 48px;
	max-width: 100%;
	min-width: 0;
	padding-block: 6px;
	text-transform: none;
	letter-spacing: normal;
	font-size: 1rem;
	line-height: 1.25;
	white-space: normal;
}

/* Narrow screens: one column, so long names still wrap to two lines at
   full size instead of four. */
@media (max-width: 480px) {
	.discount-reason__options {
		grid-template-columns: minmax(0, 1fr);
	}
}

.discount-reason__option-body {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	min-width: 0;
}

/* The reason's usual offer rate: a small chip under the name. */
.discount-reason__rate {
	display: inline-block;
	padding: 1px 8px;
	border-radius: 999px;
	font-size: 0.78rem;
	font-weight: 600;
	line-height: 1.4;
	border: 1px solid currentColor;
	opacity: 0.85;
}

.discount-reason__rate--match {
	background: rgb(var(--v-theme-success));
	border-color: rgb(var(--v-theme-success));
	color: rgb(var(--v-theme-on-success));
	opacity: 1;
}

/* The one selected reason: strong highlight (flat primary) plus a ring. */
.discount-reason__option--selected {
	box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.45);
	font-weight: 700;
}

.discount-reason__selected-mark {
	font-weight: 700;
}

/* Reasons not matching the typed % while some do: dimmed, still tappable. */
.discount-reason__option--dim {
	opacity: 0.55;
}

.discount-reason__option--dim:hover,
.discount-reason__option--dim:focus-visible {
	opacity: 0.85;
}

/* "Confirm: Bank Muscat Oman Air Platinum · 10%" wraps instead of clipping. */
.discount-reason__confirm {
	height: auto !important;
	min-height: 36px;
	padding-block: 6px;
	text-transform: none;
	letter-spacing: normal;
	max-width: 100%;
}

.discount-reason__confirm :deep(.v-btn__content) {
	white-space: normal;
	overflow-wrap: anywhere;
}

.discount-reason__rate-warning {
	margin-top: 12px;
	padding: 10px 12px;
	border-radius: 6px;
	border-left: 4px solid rgb(var(--v-theme-warning));
	background: rgba(var(--v-theme-warning), 0.14);
	color: rgb(var(--v-theme-on-surface));
}

.discount-reason__rate-warning-text {
	font-weight: 600;
	margin-bottom: 8px;
}

.discount-reason__rate-warning-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.discount-reason__rate-warning-actions :deep(.v-btn) {
	text-transform: none;
	letter-spacing: normal;
}

.discount-reason__option :deep(.v-btn__content) {
	flex: 1 1 auto;
	min-width: 0;
	white-space: normal;
	overflow-wrap: anywhere;
	text-align: center;
	justify-content: center;
}
</style>
