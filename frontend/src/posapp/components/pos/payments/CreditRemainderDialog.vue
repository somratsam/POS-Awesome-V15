<template>
	<!-- Asked on every submit route when the customer's credit is worth more
	     than the sale: the rest stays on their credit note and a balance
	     voucher prints. Only "Issue credit note and submit" submits.
	     "Add more items" (focused, so a quick Enter can't submit blindly) goes
	     back to the cart; the cross and Escape just close this box and stay
	     on Payments. The credit stays applied either way. There is
	     deliberately no option that spends the whole credit: the customer
	     would lose the rest. -->
	<v-dialog
		:model-value="modelValue"
		max-width="480"
		persistent
		@keydown.esc.stop.prevent="$emit('close')"
	>
		<v-card data-testid="credit-remainder-dialog">
			<div class="credit-remainder-dialog__head">
				<v-card-title class="text-h6 credit-remainder-dialog__title">
					{{ __("Issue a credit note for {0} and submit?", [formatCurrency(remainder)]) }}
				</v-card-title>
				<v-btn
					icon="mdi-close"
					variant="text"
					size="small"
					class="credit-remainder-dialog__close"
					:aria-label="__('Close')"
					:title="__('Close')"
					data-testid="credit-remainder-close"
					@click="$emit('close')"
				/>
			</div>
			<v-card-text>
				<div data-testid="credit-remainder-figures">
					{{ __("Credit") }} {{ formatCurrency(credit) }} · {{ __("Sale") }} {{ formatCurrency(sale) }}
				</div>
				<div class="mt-2" data-testid="credit-remainder-text">
					{{
						vouchers
							? __(
									"The remaining {0} stays on the customer's voucher {1} and a credit note voucher prints for it.",
									[formatCurrency(remainder), vouchers],
								)
							: __("The remaining {0} stays on the customer's account and a credit note voucher prints for it.", [
									formatCurrency(remainder),
								])
					}}
				</div>
			</v-card-text>
			<v-card-actions class="credit-remainder-dialog__actions">
				<v-btn
					ref="backButton"
					variant="tonal"
					color="primary"
					data-testid="credit-remainder-back"
					@click="$emit('back')"
				>
					{{ __("Add more items") }}
				</v-btn>
				<v-btn
					color="success"
					variant="flat"
					data-testid="credit-remainder-submit"
					@click="$emit('confirm')"
				>
					{{ __("Issue credit note and submit") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
	credit: { type: Number, default: 0 },
	sale: { type: Number, default: 0 },
	remainder: { type: Number, default: 0 },
	// Voucher number(s) the rest stays on ("" when none was scanned).
	vouchers: { type: String, default: "" },
	formatCurrency: { type: Function, default: (value) => String(value) },
});

defineEmits(["confirm", "back", "close"]);

const __ = window.__;
const backButton = ref(null);

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
.credit-remainder-dialog__head {
	display: flex;
	align-items: flex-start;
	gap: 4px;
	padding-right: 8px;
}
.credit-remainder-dialog__head .credit-remainder-dialog__title {
	flex: 1 1 auto;
}
.credit-remainder-dialog__close {
	margin-top: 10px;
	flex: 0 0 auto;
}
.credit-remainder-dialog__title {
	white-space: normal;
	word-break: break-word;
}
.credit-remainder-dialog__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 0 16px 16px;
}
</style>
