<!-- Shown in the new-customer form when the mobile number typed already
     belongs to a customer: one mobile number, one customer. -->
<template>
	<v-alert
		v-if="customer"
		type="error"
		variant="tonal"
		density="compact"
		class="existing-customer-notice"
		data-test="existing-customer-notice"
	>
		<div class="existing-customer-notice__body">
			<span data-test="existing-customer-text">
				{{
					__("Customer already exists: {0}, {1}", [
						customer.customer_name || customer.name,
						customer.mobile_no || "",
					])
				}}
			</span>
			<v-btn
				color="primary"
				variant="flat"
				size="small"
				data-test="select-existing-customer"
				@click="$emit('select', customer)"
			>
				{{ __("Select this customer") }}
			</v-btn>
		</div>
	</v-alert>
</template>

<script setup>
defineProps({
	customer: { type: Object, default: null },
});

defineEmits(["select"]);

const __ = window.__;
</script>

<style scoped>
.existing-customer-notice__body {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
</style>
