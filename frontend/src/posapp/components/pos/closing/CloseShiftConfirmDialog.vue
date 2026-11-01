<template>
	<v-dialog
		:model-value="modelValue"
		max-width="440"
		@update:model-value="onModelValue"
	>
		<v-card class="close-shift-confirm" data-testid="close-shift-confirm">
			<v-card-title class="close-shift-confirm__title">
				{{ __("Close your shift?") }}
			</v-card-title>
			<v-card-text class="close-shift-confirm__text">
				{{
					__(
						"This will end your shift and print the Z Report. You won't be able to sell until you open a new shift.",
					)
				}}
				<div
					v-if="variances.length"
					class="close-shift-confirm__variance"
					data-testid="close-shift-variance"
				>
					<p class="close-shift-confirm__variance-title">
						{{
							__("These amounts differ from the expected amounts by more than {0}:", [
								formatAmount(tolerance),
							])
						}}
					</p>
					<ul class="close-shift-confirm__variance-list">
						<li
							v-for="row in variances"
							:key="row.mode_of_payment"
							:data-testid="`close-shift-variance-${row.mode_of_payment}`"
						>
							{{ varianceLine(row) }}
						</li>
					</ul>
					<v-textarea
						:model-value="reason"
						:label="__('Reason (required)')"
						rows="2"
						auto-grow
						hide-details
						variant="outlined"
						data-testid="close-shift-variance-reason"
						@update:model-value="emit('update:reason', $event)"
					/>
					<p
						v-if="needsSupervisor"
						:class="[
							'close-shift-confirm__supervisor',
							{ 'close-shift-confirm__supervisor--missing': !canApprove },
						]"
						data-testid="close-shift-variance-supervisor"
					>
						{{
							canApprove
								? __("Your POS supervisor approval is recorded with this closing.")
								: __(
										"A POS supervisor must approve this closing. Switch to a POS supervisor, then press Close Shift.",
									)
						}}
					</p>
				</div>
			</v-card-text>
			<v-card-actions class="close-shift-confirm__actions">
				<v-spacer />
				<v-btn
					ref="goBackBtn"
					variant="tonal"
					size="large"
					data-testid="close-shift-confirm-go-back"
					@click="emit('go-back')"
				>
					{{ __("Go Back") }}
				</v-btn>
				<v-btn
					theme="dark"
					size="large"
					class="close-shift-confirm__close"
					data-testid="close-shift-confirm-close"
					:disabled="!canConfirm"
					@click="emit('confirm')"
				>
					{{ __("Close Shift") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
// Asked after Submit in the Close Shift dialog, before anything is sent to
// the server. Go Back has the focus so a stray Enter doesn't close the shift.
import { computed, nextTick, ref, watch } from "vue";

defineOptions({ name: "CloseShiftConfirmDialog" });

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	// Payment methods off by more than the tolerance (getClosingVariances()).
	variances: { type: Array, default: () => [] },
	tolerance: { type: Number, default: 0.5 },
	// The POS Profile's "Hide Expected Amount" (blind count): name the methods
	// that are off, but not by how much, which would give the expected away.
	hideAmounts: { type: Boolean, default: false },
	needsSupervisor: { type: Boolean, default: false },
	canApprove: { type: Boolean, default: false },
	reason: { type: String, default: "" },
	formatAmount: { type: Function, default: (value) => Number(value || 0).toFixed(3) },
});
const emit = defineEmits(["go-back", "confirm", "update:reason"]);

// "Cash: short 2.350", or just "Cash" on a blind-count profile.
const varianceLine = (row) =>
	props.hideAmounts
		? row.mode_of_payment
		: `${row.mode_of_payment}: ${row.direction === "short" ? __("short") : __("over")} ${props.formatAmount(
				Math.abs(row.difference),
			)}`;

// Over tolerance: a reason, and a supervisor when the profile asks for one.
// The server enforces the same rule; this just saves a refused round trip.
const canConfirm = computed(
	() =>
		!props.variances.length ||
		(Boolean(String(props.reason || "").trim()) && (!props.needsSupervisor || props.canApprove)),
);
const __ = window.__ || ((text) => text);
const goBackBtn = ref(null);

// Esc or a click outside counts as Go Back.
function onModelValue(open) {
	if (!open) {
		emit("go-back");
	}
}

watch(
	() => props.modelValue,
	(open) => {
		if (open) {
			nextTick(() => {
				setTimeout(() => {
					goBackBtn.value?.$el?.focus?.();
				}, 100);
			});
		}
	},
);
</script>

<style scoped>
.close-shift-confirm {
	background: var(--pos-card-bg);
	color: var(--pos-text-primary);
}

.close-shift-confirm__title {
	font-size: 1.25rem;
	font-weight: 600;
	white-space: normal;
	padding-top: 20px;
}

.close-shift-confirm__text {
	color: var(--pos-text-secondary);
	font-size: 1rem;
	line-height: 1.5;
}

.close-shift-confirm__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 0 16px 16px;
}

.close-shift-confirm__variance {
	margin-top: 12px;
	padding: 12px;
	border-radius: 8px;
	border: 1px solid rgba(var(--v-theme-error), 0.4);
	background: rgba(var(--v-theme-error), 0.06);
	color: var(--pos-text-primary);
}

.close-shift-confirm__variance-title {
	margin: 0 0 4px;
	font-weight: 600;
}

.close-shift-confirm__variance-list {
	margin: 0 0 10px;
	padding-inline-start: 20px;
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}

.close-shift-confirm__supervisor {
	margin: 8px 0 0;
	font-size: 0.9rem;
}

.close-shift-confirm__supervisor--missing {
	color: rgb(var(--v-theme-error));
	font-weight: 600;
}

/* Same green as the Close Shift dialog's Submit button. */
.close-shift-confirm__close {
	background: linear-gradient(135deg, #388e3c 0%, #2e7d32 100%) !important;
	color: white !important;
}
</style>
