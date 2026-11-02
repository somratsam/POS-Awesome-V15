<template>
	<v-row justify="center">
		<v-dialog v-model="isOpen" persistent max-width="520px" max-height="90vh">
			<v-card elevation="8" class="opening-dialog-card">
				<v-card-title class="opening-dialog-header">
					<div class="header-content">
						<div class="header-icon-wrapper">
							<v-icon class="header-icon">mdi-cash-plus</v-icon>
						</div>
						<div class="header-text">
							<h5 class="header-title">{{ __("Open Shift") }}</h5>
							<p class="header-subtitle">
								{{ __("Start your shift") }}
							</p>
						</div>
					</div>
				</v-card-title>

				<v-card-text class="opening-dialog-content">
					<!-- One company and one profile: nothing to choose, just say which. -->
					<div v-if="!showSelectors" class="opening-summary" data-test="opening-summary">
						<v-icon size="18" class="summary-icon">mdi-store-outline</v-icon>
						<span>{{ company }}</span>
						<span v-if="pos_profile" class="summary-separator">·</span>
						<span>{{ pos_profile }}</span>
					</div>
					<v-row v-else dense class="mb-2">
						<v-col cols="12" sm="6">
							<v-autocomplete
								:items="companies"
								:label="frappe._('Company')"
								v-model="company"
								required
								variant="outlined"
								color="primary"
								density="compact"
								prepend-inner-icon="mdi-domain"
								hide-details
							/>
						</v-col>
						<v-col cols="12" sm="6">
							<v-autocomplete
								:items="pos_profiles"
								:label="frappe._('POS Profile')"
								v-model="pos_profile"
								required
								variant="outlined"
								color="primary"
								density="compact"
								prepend-inner-icon="mdi-point-of-sale"
								hide-details
							/>
						</v-col>
					</v-row>

					<v-text-field
						v-for="(row, index) in visiblePaymentMethods"
						:key="row.mode_of_payment"
						:model-value="amountDisplay(row.amount)"
						@update:model-value="(value) => (row.amount = value)"
						@focus="selectOnFocus"
						@blur="row.amount = normalizeClosingAmount(row.amount)"
						@keydown.enter="submit_dialog"
						:data-test="`opening-amount-${row.mode_of_payment}`"
						:label="amountLabel(row)"
						:hint="showsCashOnly ? __('Cash in the drawer at the start of the shift.') : ''"
						persistent-hint
						:rules="[amountRule]"
						:placeholder="zeroPlaceholder"
						persistent-placeholder
						:autofocus="index === 0"
						type="number"
						variant="outlined"
						color="primary"
						hide-details="auto"
						:prefix="currencySymbol(row.currency)"
						class="opening-amount-input"
					/>
				</v-card-text>

				<v-card-actions class="dialog-actions-container">
					<v-btn
						theme="dark"
						@click="logout"
						class="pos-action-btn logout-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-logout</v-icon>
						<span>{{ __("Logout") }}</span>
					</v-btn>
					<v-spacer />
					<v-btn
						theme="dark"
						@click="go_desk"
						class="pos-action-btn cancel-action-btn"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-close-circle-outline</v-icon>
						<span>{{ __("Close") }}</span>
					</v-btn>
					<v-btn
						theme="dark"
						:disabled="is_loading || hasInvalidAmount"
						:loading="is_loading"
						@click="submit_dialog"
						class="pos-action-btn submit-action-btn"
						data-test="open-shift"
						size="large"
						elevation="2"
					>
						<v-icon start>mdi-check-circle-outline</v-icon>
						<span>{{ __("Open Shift") }}</span>
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
	getOpeningDialogStorage,
	setOpeningDialogStorage,
	setOpeningStorage,
	getBootstrapSnapshot,
	setBootstrapSnapshot,
	initPromise,
	checkDbHealth,
} from "../../../../offline/index";
import { createBootstrapSnapshotFromRegisterData } from "../../../../offline/bootstrapSnapshot";
import authService from "../../../services/authService";
import { goToDesk } from "../../../services/deskNavigation";
import { amountInputRule, normalizeClosingAmount } from "../../../utils/closingAmount";

defineOptions({
	name: "OpeningDialog",
});

const props = defineProps({
	dialog: Boolean,
});

const emit = defineEmits(["close", "register"]);
const __ = window.__ || ((text) => text);
const get_currency_symbol = window.get_currency_symbol;
const BUILD_VERSION = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null;

const isOpen = ref(props.dialog ? props.dialog : false);
const is_loading = ref(false);
const companies = ref([]);
const company = ref("");
const pos_profiles_data = ref([]);
const pos_profiles = ref([]);
const pos_profile = ref("");
const payments_method_data = ref([]);
const payments_methods = ref([]);

const currencySymbol = (currency) => get_currency_symbol?.(currency);

const showSelectors = computed(() => companies.value.length > 1 || pos_profiles.value.length > 1);

const selectedProfile = computed(
	() => pos_profiles_data.value.find((profile) => profile.name === pos_profile.value) || null,
);

// Only the cash float matters at opening. Cash is the profile's cash mode
// (the mode named "Cash" when none is set -- the closing's Expected Cash uses
// the same rule), plus any other mode of type Cash, since the closing checks
// each of those rows against its opening too. A profile with neither shows
// every mode, so there is always a box to fill.
const profileCashMode = computed(() => selectedProfile.value?.posa_cash_mode_of_payment || "Cash");
const isCashRow = (row) =>
	row.mode_of_payment === profileCashMode.value || String(row.type || "").toLowerCase() === "cash";
const cashPaymentMethods = computed(() => payments_methods.value.filter(isCashRow));
const showsCashOnly = computed(() => cashPaymentMethods.value.length > 0);
const visiblePaymentMethods = computed(() =>
	showsCashOnly.value ? cashPaymentMethods.value : payments_methods.value,
);

// The profile's cash mode is the "Opening float"; another Cash-type mode is
// named, e.g. "Dollar Cash float". Without any cash mode, boxes show the mode.
const amountLabel = (row) => {
	if (!showsCashOnly.value) return row.mode_of_payment;
	if (row.mode_of_payment === profileCashMode.value) return __("Opening float");
	return __("{0} float", [row.mode_of_payment]);
};

// Decimal places for an amount: the POS Profile's, else the system currency
// precision -- the same order as the closing screen.
const amountPrecision = computed(() => {
	const profilePrecision = parseInt(selectedProfile.value?.posa_decimal_precision);
	if (!isNaN(profilePrecision)) return profilePrecision;
	const systemPrecision = parseInt(window.frappe?.defaults?.get_default?.("currency_precision"));
	return isNaN(systemPrecision) ? 2 : systemPrecision;
});

// Like the Closing Amount boxes: an amount of 0 shows as an empty box with a
// faint 0 at the currency precision, and an empty box is sent as 0.
const zeroPlaceholder = computed(() => (0).toFixed(amountPrecision.value));
const amountDisplay = (value) => (value === 0 || value === null || value === undefined ? "" : value);
const amountRule = (value) => amountInputRule(value, amountPrecision.value, __);
const hasInvalidAmount = computed(() =>
	visiblePaymentMethods.value.some((row) => amountRule(row.amount) !== true),
);

const selectOnFocus = (event) => {
	const input = event?.target;
	nextTick(() => {
		try {
			input?.select?.();
		} catch {
			// Some input types don't support selection; nothing to do.
		}
	});
};

watch(
	() => props.dialog,
	(val) => {
		isOpen.value = val ? val : false;
	},
);

watch(company, (val) => {
	pos_profiles.value = [];
	pos_profiles_data.value.forEach((element) => {
		if (element.company === val) {
			pos_profiles.value.push(element.name);
		}
		if (pos_profiles.value.length) {
			pos_profile.value = pos_profiles.value[0];
		} else {
			pos_profile.value = "";
		}
	});
});

watch(pos_profile, (val) => {
	payments_methods.value = [];
	payments_method_data.value.forEach((element) => {
		if (element.parent === val) {
			payments_methods.value.push({
				mode_of_payment: element.mode_of_payment,
				amount: 0,
				currency: element.currency,
				type: element.type,
			});
		}
	});
});

async function get_opening_dialog_data() {
	await initPromise;
	await checkDbHealth();
	const currentUser = frappe?.session?.user || "";

	// Load cached data first for offline usage
	const cached = getOpeningDialogStorage();
	if (cached?.user === currentUser) {
		try {
			companies.value = cached.companies.map((c) => c.name);
			pos_profiles_data.value = cached.pos_profiles_data || [];
			payments_method_data.value = cached.payments_method || [];
			company.value = companies.value[0] || "";
		} catch (e) {
			console.error("Failed to parse opening dialog cache", e);
		}
	}

	frappe.call({
		method: "posawesome.posawesome.api.shifts.get_opening_dialog_data",
		args: {},
		callback: function (r) {
			if (r.message) {
				companies.value = r.message.companies.map((element) => element.name);
				pos_profiles_data.value = r.message.pos_profiles_data;
				payments_method_data.value = r.message.payments_method;
				company.value = companies.value[0] || "";
				try {
					setOpeningDialogStorage({
						...r.message,
						user: currentUser,
					});
				} catch (e) {
					console.error("Failed to cache opening dialog data", e);
				}
			}
		},
	});
}

async function submit_dialog() {
	// The disabled button already stops a double click; this also stops any
	// second call while the first is still in flight.
	if (is_loading.value || hasInvalidAmount.value) {
		return;
	}
	if (!payments_methods.value.length || !company.value || !pos_profile.value) {
		return;
	}

	is_loading.value = true;
	try {
		// Every mode is sent, the hidden non-cash ones as 0, so the closing's
		// Payment Reconciliation and Z Report keep a row for each of them.
		const balance_details = payments_methods.value.map((row) => ({
			mode_of_payment: row.mode_of_payment,
			amount: Number(normalizeClosingAmount(row.amount)) || 0,
			currency: row.currency,
		}));
		// frappe.call returns a jQuery promise (no .finally), so await it.
		const r = await frappe.call("posawesome.posawesome.api.shifts.create_opening_voucher", {
			pos_profile: pos_profile.value,
			company: company.value,
			balance_details,
		});
		if (r?.message) {
			emit("register", r.message);
			try {
				setOpeningStorage(r.message);
				setBootstrapSnapshot(
					createBootstrapSnapshotFromRegisterData(r.message, getBootstrapSnapshot(), {
						buildVersion: BUILD_VERSION,
					}),
				);
			} catch (e) {
				console.error("Failed to cache opening data", e);
			}
			// Close handles hiding the dialog, parent handles logic
			emit("close");
		}
	} catch (error) {
		// frappe.call has already shown the server's message (e.g. "already
		// has an open POS shift"); don't raise it again as an unexpected error.
		console.error("Failed to open POS shift", error);
	} finally {
		// Re-enable Submit after a failure too, instead of leaving it stuck
		// until the page is reloaded.
		is_loading.value = false;
	}
}

function go_desk() {
	goToDesk();
}

function logout() {
	authService.logoutToPosLogin();
}

onMounted(() => {
	get_opening_dialog_data();
});
</script>

<style scoped>
.opening-dialog-card {
	border-radius: 16px;
	overflow: hidden;
	border: 1px solid var(--pos-border);
	max-height: 90vh;
	display: flex;
	flex-direction: column;
	animation: slideInFromTop 0.4s ease-out;
}

.opening-dialog-header {
	padding: 16px 24px;
	flex-shrink: 0;
}

.header-content {
	display: flex;
	align-items: center;
	gap: 12px;
}

.header-icon-wrapper {
	background: rgba(25, 118, 210, 0.1);
	border-radius: 50%;
	padding: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
}

.header-icon {
	font-size: 20px;
	color: var(--pos-primary);
}

.header-text {
	flex: 1;
}

.header-title {
	font-size: 1.3rem;
	font-weight: 600;
	margin: 0;
	line-height: 1.2;
	color: var(--pos-primary);
}

.header-subtitle {
	font-size: 0.85rem;
	opacity: 0.8;
	margin: 2px 0 0 0;
	line-height: 1.3;
	color: var(--pos-text-primary);
}

.opening-dialog-content {
	padding: 20px 24px 8px;
	flex: 1;
	overflow-y: auto;
}

.opening-summary {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	margin-bottom: 18px;
	border-radius: 8px;
	background: var(--pos-table-header-bg);
	color: var(--pos-text-primary);
	font-weight: 500;
}

.summary-icon {
	color: var(--pos-primary);
}

.summary-separator {
	opacity: 0.5;
}

.opening-amount-input {
	margin-bottom: 12px;
}

.opening-amount-input :deep(input) {
	font-size: 1.5rem;
	font-weight: 600;
}

.opening-amount-input :deep(.v-text-field__prefix) {
	font-size: 1.1rem;
	font-weight: 600;
	color: var(--pos-primary);
	opacity: 1;
}

@keyframes slideInFromTop {
	from {
		opacity: 0;
		transform: translateY(-20px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* Action buttons */
.dialog-actions-container {
	padding: 16px 24px;
	gap: 12px;
}

.pos-action-btn {
	border-radius: 12px;
	text-transform: none;
	font-weight: 600;
	padding: 12px 20px;
	min-width: 110px;
	transition: all 0.3s ease;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.pos-action-btn,
.pos-action-btn .v-icon,
.pos-action-btn span,
.pos-action-btn :deep(.v-btn__content) {
	color: white !important;
}

.cancel-action-btn {
	background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%) !important;
}

.cancel-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(211, 47, 47, 0.4);
}

.logout-action-btn {
	background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%) !important;
}

.logout-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(21, 101, 192, 0.4);
}

.submit-action-btn {
	background: linear-gradient(135deg, #388e3c 0%, #2e7d32 100%) !important;
}

.submit-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(46, 125, 50, 0.4);
}

.submit-action-btn:disabled {
	opacity: 0.6;
	transform: none;
}

@media (max-width: 480px) {
	.header-content {
		flex-direction: column;
		text-align: center;
		gap: 8px;
	}

	.opening-dialog-content {
		padding: 12px;
	}
}

/* Theme-aware dialog styling */
.opening-dialog-card,
.opening-dialog-header,
.opening-dialog-content,
.dialog-actions-container {
	background: var(--pos-card-bg) !important;
	color: var(--pos-text-primary) !important;
}

.opening-dialog-header {
	border-bottom: 1px solid var(--pos-border);
}

.dialog-actions-container {
	border-top: 1px solid var(--pos-border);
}
</style>
