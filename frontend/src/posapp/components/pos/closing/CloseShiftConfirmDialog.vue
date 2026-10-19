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
import { nextTick, ref, watch } from "vue";

defineOptions({ name: "CloseShiftConfirmDialog" });

const props = defineProps({
	modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["go-back", "confirm"]);
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

/* Same green as the Close Shift dialog's Submit button. */
.close-shift-confirm__close {
	background: linear-gradient(135deg, #388e3c 0%, #2e7d32 100%) !important;
	color: white !important;
}
</style>
