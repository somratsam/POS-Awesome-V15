<template>
	<!-- Main screen: a credit note voucher of another customer scanned while
	     a named customer is on the sale (saleCreditStore). Same question as
	     the payment screen's: "Use credit note X? The customer changes to Y." -->
	<CreditVoucherCustomerDialog
		:model-value="Boolean(prompt)"
		:voucher="prompt?.voucher || null"
		:current-customer="prompt?.currentCustomer || ''"
		@confirm="store.settlePrompt(true)"
		@cancel="store.settlePrompt(false)"
	/>
</template>

<script setup>
import { storeToRefs } from "pinia";
import CreditVoucherCustomerDialog from "./CreditVoucherCustomerDialog.vue";
import { useSaleCreditStore } from "../../../stores/saleCreditStore";

const store = useSaleCreditStore();
const { prompt } = storeToRefs(store);
</script>
