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
						v-for="reason in reasons"
						:key="reason.name"
						:variant="selected === reason.name ? 'flat' : 'outlined'"
						:color="selected === reason.name ? 'primary' : undefined"
						class="discount-reason__option"
						role="radio"
						:aria-checked="selected === reason.name ? 'true' : 'false'"
						:data-reason="reason.name"
						:data-testid="`discount-reason-option-${reason.name}`"
						@click="pick(reason)"
					>
						{{ reason.name }}
					</v-btn>
				</div>
				<v-alert v-else type="warning" variant="tonal" density="compact">
					{{ __("No discount reasons are set up. Ask a manager to add them in POS Discount Reason.") }}
				</v-alert>

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
					:disabled="!selectedReason"
					data-testid="discount-reason-confirm"
					@click="confirm"
				>
					{{ __("Confirm") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useUIStore } from "../../../stores/uiStore";

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

// One tap picks and confirms.
function pick(reason) {
	selected.value = reason.name;
	confirm();
}

function confirm() {
	if (!request.value || !selectedReason.value) return;
	uiStore.resolveDiscountReason({
		reason: selectedReason.value.name,
		applyToOthers: request.value.mode === "line" && applyToOthers.value,
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
	// Enter on a reason button presses that button (native click -> pick).
	if (event.target instanceof Element && event.target.closest("[data-reason]")) return;
	event.preventDefault();
	event.stopPropagation();
	confirm();
}

defineExpose({ confirm, backToCart });
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

.discount-reason__option :deep(.v-btn__content) {
	flex: 1 1 auto;
	min-width: 0;
	white-space: normal;
	overflow-wrap: anywhere;
	text-align: center;
	justify-content: center;
}
</style>
