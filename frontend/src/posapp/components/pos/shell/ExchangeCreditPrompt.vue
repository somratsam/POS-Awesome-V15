<template>
	<!-- Safety net for an exchange whose new sale never happens (the return
	     is already submitted, its credit unused): another customer was chosen,
	     the sale was cancelled, the POS left for the Desk, or a sale was
	     submitted without the credit. Offers the credit note voucher so the
	     customer leaves with it (customersStore.exchangePrompt). Print is
	     focused; Escape is "Not now". -->
	<v-dialog
		:model-value="Boolean(prompt)"
		max-width="460"
		persistent
		@keydown.esc.stop.prevent="notNow"
	>
		<v-card v-if="prompt" data-testid="exchange-credit-prompt">
			<v-card-title class="text-h6">{{ __("Print the credit note voucher?") }}</v-card-title>
			<v-card-text data-testid="exchange-credit-prompt-text">
				<div>
					{{
						__("Return {0} is submitted. {1} has {2} store credit from it that has not been used.", [
							prompt.returnName,
							prompt.customerName || prompt.customer,
							formatAmount(prompt.credit),
						])
					}}
				</div>
				<div class="mt-2">{{ __("Print it now so the customer can use it later.") }}</div>
			</v-card-text>
			<v-card-actions class="exchange-credit-prompt__actions">
				<v-btn variant="text" :disabled="printing" data-testid="exchange-credit-prompt-later" @click="notNow">
					{{ __("Not now") }}
				</v-btn>
				<v-btn
					ref="printButton"
					color="success"
					variant="flat"
					:loading="printing"
					data-testid="exchange-credit-prompt-print"
					@click="printVoucher"
				>
					{{ __("Print credit note voucher") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useCustomersStore } from "../../../stores/customersStore";
import { useUIStore } from "../../../stores/uiStore";
import { useToastStore } from "../../../stores/toastStore";
import { usePaymentPrinting } from "../../../composables/pos/payments/usePaymentPrinting";

const __ = window.__;
const customersStore = useCustomersStore();
const uiStore = useUIStore();
const toastStore = useToastStore();

const prompt = computed(() => customersStore.exchangePrompt);
const printing = ref(false);
const printButton = ref(null);

// The voucher's first print (the exchange printed nothing), the same path
// "Submit return → Credit note" prints through.
const { loadPrintPage } = usePaymentPrinting({
	invoiceDoc: ref(null),
	posProfile: computed(() => uiStore.posProfile || {}),
	invoiceType: ref("Invoice"),
});

const formatAmount = (value) => {
	const precision = Number(uiStore.posProfile?.posa_decimal_precision) || 3;
	const currency = uiStore.posProfile?.currency || "";
	return `${currency ? currency + " " : ""}${(Number(value) || 0).toFixed(precision)}`;
};

const notNow = () => {
	if (printing.value) return;
	customersStore.closeExchangePrompt();
};

const printVoucher = async () => {
	const current = prompt.value;
	if (!current || printing.value) return;
	printing.value = true;
	try {
		await loadPrintPage({ name: current.returnName, doctype: current.doctype || "Sales Invoice" });
	} catch (error) {
		console.warn("Credit note voucher print failed", error);
		toastStore.show({
			title: __("The credit note voucher couldn't be printed. Reprint it from Invoice Management."),
			color: "error",
		});
	} finally {
		printing.value = false;
		customersStore.closeExchangePrompt();
	}
};

watch(prompt, (open) => {
	if (!open) return;
	nextTick(() => {
		setTimeout(() => {
			const el = printButton.value?.$el || printButton.value;
			el?.focus?.();
		}, 50);
	});
});
</script>

<style scoped>
.exchange-credit-prompt__actions {
	justify-content: flex-end;
	gap: 8px;
	padding: 0 16px 16px;
}
</style>
