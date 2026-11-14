<template>
	<!-- Asked before every submit of a return that refunds no money (both
	     footer buttons and every key): submitting can't be undone at the till,
	     and "Exchange" was once read as "go to the next screen". Says what
	     happens; Back is focused so a habit Enter can't submit; Escape is Back.
	     intent set: only that option's submit button. intent null (a print
	     key): both, so habit can't print a credit note for an exchange. -->
	<v-dialog
		:model-value="modelValue"
		max-width="480"
		persistent
		@keydown.esc.stop.prevent="$emit('cancel')"
	>
		<v-card data-testid="return-intent-dialog">
			<v-card-title class="text-h6">{{ __("Submit this return?") }}</v-card-title>
			<v-card-text data-testid="return-intent-text">
				<div>{{ __("Items going back to stock: {0}", [formatQty(itemCount)]) }}</div>
				<div class="mt-1">
					{{ __("{0} becomes store credit for {1}.", [formatCurrency(credit), customer || __("the customer")]) }}
				</div>
				<div class="mt-1 font-weight-bold">{{ __("This can't be undone at the till.") }}</div>
				<div v-if="intent === 'exchange'" class="mt-3" data-testid="return-intent-then">
					{{ __("Then: start the customer's new sale") }}
				</div>
				<div v-else-if="intent === 'credit_note'" class="mt-3" data-testid="return-intent-then">
					{{ __("Then: print the credit note voucher") }}
				</div>
			</v-card-text>
			<v-card-actions class="return-intent-dialog__actions">
				<v-btn
					ref="backButton"
					variant="tonal"
					color="primary"
					data-testid="return-intent-cancel"
					@click="$emit('cancel')"
				>
					{{ __("Back") }}
				</v-btn>
				<v-btn
					v-if="intent !== 'credit_note'"
					color="primary"
					variant="flat"
					data-testid="return-intent-exchange"
					@click="$emit('choose', 'exchange')"
				>
					{{ __("Submit return → Exchange") }}
				</v-btn>
				<v-btn
					v-if="intent !== 'exchange'"
					color="success"
					variant="flat"
					data-testid="return-intent-credit-note"
					@click="$emit('choose', 'credit_note')"
				>
					{{ __("Submit return → Credit note") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
	// "exchange" | "credit_note" | null (both options)
	intent: { type: String, default: null },
	itemCount: { type: Number, default: 0 },
	credit: { type: Number, default: 0 },
	customer: { type: String, default: "" },
	formatCurrency: { type: Function, default: (value) => String(value) },
});

defineEmits(["choose", "cancel"]);

const __ = window.__;
const backButton = ref(null);

const formatQty = (value) => {
	const number = Number(value) || 0;
	return Number.isInteger(number) ? String(number) : number.toFixed(3);
};

watch(
	() => props.modelValue,
	(open) => {
		if (!open) return;
		nextTick(() => {
			setTimeout(() => {
				const el = backButton.value?.$el || backButton.value;
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
