<template>
	<v-dialog v-model="dialogVisible" max-width="900px" scrollable>
		<v-card>
			<v-card-title class="d-flex align-center justify-space-between">
				<span class="text-h5 text-primary">{{ __("Z Report History") }}</span>
				<v-btn icon="mdi-close" variant="text" :aria-label="__('Close')" @click="close" />
			</v-card-title>

			<v-card-text>
				<v-row class="mb-2" dense>
					<v-col cols="12" sm="4">
						<v-text-field
							v-model="search"
							:label="__('Search shift number')"
							density="compact"
							clearable
							hide-details
							@keyup.enter="fetchShifts"
						/>
					</v-col>
					<v-col cols="6" sm="3">
						<v-text-field
							v-model="fromDate"
							type="date"
							:label="__('From')"
							density="compact"
							hide-details
						/>
					</v-col>
					<v-col cols="6" sm="3">
						<v-text-field
							v-model="toDate"
							type="date"
							:label="__('To')"
							density="compact"
							hide-details
						/>
					</v-col>
					<v-col cols="12" sm="2">
						<v-btn block variant="text" color="primary" :loading="loading" @click="fetchShifts">
							{{ __("Search") }}
						</v-btn>
					</v-col>
				</v-row>

				<v-alert v-if="errorMessage" type="error" density="compact" class="mb-3">
					{{ errorMessage }}
				</v-alert>

				<v-data-table :headers="headers" :items="shifts" item-key="name" :loading="loading">
					<template v-slot:item.grand_total="{ item }">
						{{ formatCurrency(item.grand_total) }}
					</template>
					<template v-slot:item.customer_credit_issued="{ item }">
						{{ formatCurrency(item.customer_credit_issued) }}
					</template>
					<template v-slot:item.customer_credit_redeemed="{ item }">
						{{ formatCurrency(item.customer_credit_redeemed) }}
					</template>
					<template v-slot:item.actions="{ item }">
						<v-btn
							icon="mdi-printer"
							variant="text"
							size="small"
							:loading="printingShift === item.name"
							:disabled="printingShift !== null && printingShift !== item.name"
							:aria-label="__('Print Z Report')"
							@click="printShift(item)"
						/>
					</template>
					<template v-slot:no-data>
						{{ __("No closing shifts found for this range.") }}
					</template>
				</v-data-table>
			</v-card-text>

			<v-card-actions>
				<v-spacer />
				<v-btn variant="tonal" @click="close">{{ __("Close") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useUIStore } from "../../../stores/uiStore.js";
import { useFormat } from "../../../format";
import { printZReport } from "../../../services/documentPrint";

const uiStore = useUIStore();
const { formatCurrency } = useFormat();

const dialogVisible = computed({
	get: () => uiStore.zReportHistoryDialog,
	set: (val) => {
		if (!val) uiStore.closeZReportHistory();
	},
});

const search = ref("");
const fromDate = ref("");
const toDate = ref("");
const shifts = ref([]);
const loading = ref(false);
const errorMessage = ref("");
const printingShift = ref(null);

const headers = [
	{ title: __("Shift"), key: "name", align: "start" },
	{ title: __("Cashier"), key: "user", align: "start" },
	{ title: __("Date"), key: "posting_date", align: "start" },
	{ title: __("Grand Total"), key: "grand_total", align: "end" },
	{ title: __("Credit Issued"), key: "customer_credit_issued", align: "end" },
	{ title: __("Credit Redeemed"), key: "customer_credit_redeemed", align: "end" },
	{ title: __("Print"), key: "actions", align: "center", sortable: false },
];

function defaultFromDate() {
	const d = new Date();
	d.setDate(d.getDate() - 30);
	return d.toISOString().slice(0, 10);
}

async function fetchShifts() {
	loading.value = true;
	errorMessage.value = "";
	try {
		const { message } = await frappe.call({
			method: "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data.list_closing_shifts",
			args: {
				pos_profile: uiStore.posProfile?.name,
				search: search.value || undefined,
				from_date: fromDate.value || undefined,
				to_date: toDate.value || undefined,
			},
		});
		shifts.value = message || [];
	} catch (error) {
		console.error("Failed to load closing shift history", error);
		errorMessage.value = __("Unable to load closing shift history");
		shifts.value = [];
	} finally {
		loading.value = false;
	}
}

async function printShift(item) {
	if (printingShift.value) return;
	printingShift.value = item.name;
	try {
		await printZReport(item.name);
	} finally {
		printingShift.value = null;
	}
}

function close() {
	uiStore.closeZReportHistory();
}

watch(dialogVisible, (visible) => {
	if (visible) {
		search.value = "";
		fromDate.value = defaultFromDate();
		toDate.value = "";
		fetchShifts();
	}
});
</script>
