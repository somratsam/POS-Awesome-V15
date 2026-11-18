<template>
	<!-- Asked when a scanned credit note voucher belongs to a different
	     customer than the one on the sale (worded like the exchange's "The
	     customer changes to X."). Use credit note makes the voucher's customer
	     the sale's customer; Cancel leaves the sale unchanged. -->
	<v-dialog
		:model-value="modelValue"
		max-width="460"
		persistent
		@keydown.esc.stop.prevent="$emit('cancel')"
	>
		<v-card data-testid="credit-voucher-customer-dialog">
			<v-card-title class="text-h6">{{ __("Use credit note {0}?", [voucher?.voucher || ""]) }}</v-card-title>
			<v-card-text>
				<p>
					{{
						__("The customer changes to {0}.", [
							`${voucher?.customer_name || voucher?.customer || ""}${voucher?.mobile_no ? ` (${voucher.mobile_no})` : ""}`,
						])
					}}
				</p>
			</v-card-text>
			<v-card-actions class="credit-voucher-customer-dialog__actions">
				<v-btn
					color="primary"
					variant="flat"
					data-testid="credit-voucher-switch"
					@click="$emit('confirm')"
				>
					{{ __("Use credit note") }}
				</v-btn>
				<v-btn variant="text" data-testid="credit-voucher-cancel" @click="$emit('cancel')">
					{{ __("Cancel") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
defineProps({
	modelValue: Boolean,
	voucher: { type: Object, default: null },
	currentCustomer: { type: String, default: "" },
});

defineEmits(["confirm", "cancel"]);

const __ = window.__;
</script>

<style scoped>
.credit-voucher-customer-dialog__actions {
	flex-wrap: wrap;
	gap: 8px;
	padding: 0 16px 16px;
}
</style>
