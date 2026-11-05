<template>
	<!-- Asked when a print key is used on a return that refunds no money, so a
	     habit key can't print a credit note for an exchange. Exchange is the
	     default (focused); Escape or outside click cancels without submitting. -->
	<v-dialog
		:model-value="modelValue"
		max-width="460"
		persistent
		@keydown.esc.stop.prevent="$emit('cancel')"
	>
		<v-card data-testid="return-intent-dialog">
			<v-card-title class="text-h6">{{ __("Exchange or Credit note issue?") }}</v-card-title>
			<v-card-text>
				{{
					__(
						"An exchange needs no receipt: the customer gets the receipt of the new sale. Print a credit note only if the customer takes the credit away.",
					)
				}}
			</v-card-text>
			<v-card-actions class="return-intent-dialog__actions">
				<v-btn
					ref="exchangeButton"
					color="primary"
					variant="flat"
					data-testid="return-intent-exchange"
					@click="$emit('choose', 'exchange')"
				>
					{{ __("Exchange: continue to new sale") }}
				</v-btn>
				<v-btn
					color="success"
					variant="flat"
					data-testid="return-intent-credit-note"
					@click="$emit('choose', 'credit_note')"
				>
					{{ __("Credit note issue") }}
				</v-btn>
				<v-btn variant="text" data-testid="return-intent-cancel" @click="$emit('cancel')">
					{{ __("Cancel") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
});

defineEmits(["choose", "cancel"]);

const __ = window.__;
const exchangeButton = ref(null);

watch(
	() => props.modelValue,
	(open) => {
		if (!open) return;
		nextTick(() => {
			setTimeout(() => {
				const el = exchangeButton.value?.$el || exchangeButton.value;
				el?.focus?.();
			}, 50);
		});
	},
);
</script>

<style scoped>
.return-intent-dialog__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 0 16px 16px;
}
</style>
