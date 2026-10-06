<template>
	<v-dialog
		v-model="dialogVisible"
		max-width="920px"
		scrollable
		@after-leave="returnFocusToItemSearch"
	>
		<v-card
			class="stock-lookup"
			data-testid="stock-lookup-dialog"
			min-height="500px"
			@keydown.capture="handleDialogKeydownCapture"
		>
			<div class="stock-lookup__header">
				<v-icon icon="mdi-tag-search-outline" size="28" class="mr-3" />
				<div class="stock-lookup__heading">
					<div class="text-h6">{{ __("Check Stock") }}</div>
					<div class="text-caption">
						{{ __("Scan a tag — nothing is added to the cart") }}
						<template v-if="warehouse">
							· {{ __("Stock at: {0}", [warehouse]) }}
						</template>
					</div>
				</div>
				<v-spacer />
				<v-btn
					color="error"
					theme="dark"
					data-testid="stock-lookup-close"
					@click="closeDialog"
				>
					{{ __("Close") }}
				</v-btn>
			</div>

			<div class="stock-lookup__entry">
				<v-text-field
					ref="codeField"
					v-model="codeInput"
					density="compact"
					variant="outlined"
					hide-details
					autofocus
					prepend-inner-icon="mdi-barcode-scan"
					:label="__('Barcode or item code')"
					data-testid="stock-lookup-input"
					@keydown.enter.prevent="submitTypedCode"
				/>
				<v-btn
					color="primary"
					variant="flat"
					:loading="loading"
					:disabled="!codeInput.trim()"
					data-testid="stock-lookup-submit"
					@click="submitTypedCode"
				>
					{{ __("Look up") }}
				</v-btn>
			</div>

			<v-progress-linear v-if="loading" indeterminate color="info" height="2" />

			<v-card-text class="stock-lookup__body">
				<v-alert
					v-if="statusMessage"
					:type="statusType"
					variant="tonal"
					density="compact"
					class="mb-3"
					data-testid="stock-lookup-status"
				>
					{{ statusMessage }}
				</v-alert>

				<div
					v-if="!result && !statusMessage && !loading"
					class="stock-lookup__empty"
					data-testid="stock-lookup-empty"
				>
					<v-icon icon="mdi-barcode-scan" size="48" class="mb-2" />
					<div>{{ __("Scan a tag to see its sizes, colours and stock") }}</div>
				</div>

				<template v-if="result">
					<div class="stock-lookup__summary" data-testid="stock-lookup-summary">
						<strong>{{ familyTitle }}</strong>
						<span v-if="isFamily">
							· {{ __("{0} variants", [result.items.length]) }}
						</span>
						<span v-if="totalInStock !== null">
							· {{ __("{0} in stock", [formatQty(totalInStock)]) }}
						</span>
					</div>

					<div
						v-for="attr in attributeFilters"
						:key="attr.attribute"
						class="stock-lookup__filter"
					>
						<span class="stock-lookup__filter-label">{{ attr.attribute }}:</span>
						<v-chip
							v-for="value in attr.values"
							:key="value"
							size="small"
							label
							class="ma-1"
							:variant="filters[attr.attribute] === value ? 'flat' : 'outlined'"
							:color="filters[attr.attribute] === value ? 'primary' : undefined"
							@click="toggleFilter(attr.attribute, value)"
						>
							{{ value }}
						</v-chip>
						<v-chip
							v-if="filters[attr.attribute]"
							size="small"
							variant="text"
							color="primary"
							class="ma-1"
							@click="toggleFilter(attr.attribute, filters[attr.attribute])"
						>
							{{ __("Clear") }}
						</v-chip>
					</div>

					<v-row density="default" class="mt-1">
						<v-col
							v-for="item in visibleItems"
							:key="item.item_code"
							cols="12"
							sm="6"
							md="4"
						>
							<v-card
								class="stock-lookup__card"
								:class="{
									'stock-lookup__card--scanned': isScanned(item),
									'stock-lookup__card--out': isOutOfStock(item),
								}"
								variant="outlined"
								:data-testid="`stock-lookup-card-${item.item_code}`"
							>
								<v-img
									:src="item.image || placeholderImage"
									height="110px"
									cover
									class="stock-lookup__image"
								>
									<div class="stock-lookup__badges">
										<v-chip
											v-if="isScanned(item)"
											size="x-small"
											color="primary"
											variant="flat"
										>
											{{ __("Scanned") }}
										</v-chip>
										<v-chip
											v-if="isOutOfStock(item)"
											size="x-small"
											color="error"
											variant="flat"
										>
											{{ __("Out of Stock") }}
										</v-chip>
									</div>
								</v-img>
								<v-card-text class="pa-2">
									<div class="stock-lookup__name" :title="item.item_name">
										{{ variantLabel(item) }}
									</div>
									<div class="stock-lookup__price">{{ formatPrice(item) }}</div>
									<div class="stock-lookup__meta">
										<v-icon size="x-small">mdi-barcode</v-icon>
										<span class="stock-lookup__barcode" :title="barcodeOf(item) || ''">
											{{ barcodeOf(item) || "—" }}
										</span>
									</div>
									<div class="stock-lookup__meta" :data-testid="`stock-lookup-qty-${item.item_code}`">
										<v-icon size="x-small">mdi-package-variant-closed</v-icon>
										<span>
											{{ formatQty(availableQtyOf(item)) }}
											{{ availableQtyOf(item) === null ? "" : item.stock_uom || "" }}
										</span>
									</div>
								</v-card-text>
								<v-card-actions v-if="canAddToCart" class="pa-2 pt-0">
									<v-btn
										block
										variant="tonal"
										color="primary"
										prepend-icon="mdi-cart-plus"
										:disabled="isUnavailable(item) || adding"
										:loading="addingItemCode === item.item_code"
										:data-testid="`stock-lookup-add-${item.item_code}`"
										@click="addToCart(item)"
									>
										{{ __("Add") }}
									</v-btn>
								</v-card-actions>
							</v-card>
						</v-col>
					</v-row>
					<div v-if="filteredItems.length > visibleItems.length" class="text-center mt-2">
						<v-btn variant="text" color="primary" @click="displayCount += 60">
							{{ __("Show more") }}
						</v-btn>
					</div>
				</template>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onErrorCaptured, ref, watch } from "vue";
import { useUIStore } from "../../../stores/uiStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useToastStore } from "../../../stores/toastStore";
import { isOffline } from "../../../../offline/index";
import { registerStockLookupScanHandler } from "../../../composables/pos/items/stockLookupScanRoute";
import {
	getVariantCardAvailableQty,
	getVariantCardBarcode,
	isVariantCardUnavailable,
} from "../../../utils/variantCard";
import placeholderImage from "../placeholder-image.png";

defineOptions({
	name: "StockLookupDialog",
});

const __ = window.__ || ((text) => text);

// Same minimum as the main search's scan detection (useScannerInput.ts's
// keyboardScanMinLength): the shortest real barcode in this catalog. Used
// only to auto-look-up a code typed by a scanner that sends no Enter.
const AUTO_LOOKUP_MIN_LENGTH = 7;
const AUTO_LOOKUP_IDLE_MS = 300;
// Same keys the main screen's type-to-search treats as "typing a code".
const CODE_KEY_PATTERN = /^[\p{L}\p{N}\-._/\\]$/u;

const uiStore = useUIStore();
const invoiceStore = useInvoiceStore();
const toastStore = useToastStore();
const eventBus = inject("eventBus", null);

const codeField = ref(null);
const codeInput = ref("");
const loading = ref(false);
const result = ref(null);
const statusMessage = ref("");
const statusType = ref("info");
const filters = ref({});
const displayCount = ref(60);
const adding = ref(false);
const addingItemCode = ref("");

let lookupSeq = 0;
let autoLookupTimer = null;
let suppressAutoLookup = false;
let lastRedirectAt = 0;
let pendingCode = "";
let unregisterScanRoute = null;

const posProfile = computed(() => uiStore.posProfile || {});
const warehouse = computed(() => result.value?.warehouse || posProfile.value?.warehouse || "");
const canAddToCart = computed(() => !invoiceStore.invoiceDoc?.is_return);
const isFamily = computed(() => Boolean(result.value?.template_item_code));
const familyTitle = computed(() => {
	if (!result.value) return "";
	if (isFamily.value) {
		return result.value.template_item_name || result.value.template_item_code;
	}
	const only = result.value.items?.[0];
	return only?.item_name || only?.item_code || result.value.scanned_item_code;
});

// --- Scan routing ---------------------------------------------------------
// The scan route is live exactly while the dialog is open: activate() on
// open, deactivate() on every close path (v-model, Close button, Esc,
// outside click, failure) and on unmount. flush: "sync" so there is no tick
// in which the store says closed but scans are still routed here.

const deactivate = () => {
	if (unregisterScanRoute) {
		unregisterScanRoute();
		unregisterScanRoute = null;
	}
	clearAutoLookupTimer();
	lookupSeq += 1; // discard any lookup still in flight
	pendingCode = "";
	loading.value = false;
	adding.value = false;
	addingItemCode.value = "";
};

const handleRouteFailure = () => {
	if (uiStore.stockLookupDialog) uiStore.closeStockLookup();
	deactivate();
	toastStore.show({
		title: __("Check Stock closed after an error — scanning is back to normal selling"),
		color: "error",
		key: "stock-lookup-failure",
	});
};

const activate = () => {
	deactivate();
	codeInput.value = "";
	result.value = null;
	statusMessage.value = "";
	filters.value = {};
	displayCount.value = 60;
	unregisterScanRoute = registerStockLookupScanHandler(
		(code) => runLookup(code, "scan"),
		handleRouteFailure,
	);
	focusCodeField();
};

watch(
	() => uiStore.stockLookupDialog,
	(open) => {
		if (open) activate();
		else {
			deactivate();
			returnFocusToItemSearch();
		}
	},
	{ flush: "sync" },
);
if (uiStore.stockLookupDialog) activate();

const dialogVisible = computed({
	get: () => uiStore.stockLookupDialog,
	set: (value) => {
		if (!value) closeDialog();
	},
});

const closeDialog = () => {
	deactivate();
	if (uiStore.stockLookupDialog) uiStore.closeStockLookup();
};

onBeforeUnmount(() => {
	deactivate();
	if (uiStore.stockLookupDialog) uiStore.closeStockLookup();
});

// Anything thrown while rendering the dialog's contents closes it, so a
// broken dialog can never sit open swallowing scans.
onErrorCaptured((error) => {
	console.error("Check Stock dialog error", error);
	handleRouteFailure();
	return false;
});

function returnFocusToItemSearch() {
	nextTick(() => uiStore.triggerItemSearchFocus());
}

// --- Input & focus --------------------------------------------------------

function focusCodeField({ select = false } = {}) {
	nextTick(() => {
		const input = codeField.value?.$el?.querySelector?.("input");
		if (!input) return;
		input.focus();
		if (select) input.select();
	});
}

function clearAutoLookupTimer() {
	if (autoLookupTimer) {
		clearTimeout(autoLookupTimer);
		autoLookupTimer = null;
	}
}

const isCodeFieldTarget = (target) => {
	const fieldEl = codeField.value?.$el;
	return Boolean(fieldEl && target instanceof Node && fieldEl.contains(target));
};

// A scanner types wherever focus is. If staff tapped a chip or a card, the
// next scan would land on that button (and its Enter would press it), so
// pull code keystrokes back into the code field instead.
function handleDialogKeydownCapture(event) {
	if (!uiStore.stockLookupDialog || isCodeFieldTarget(event.target)) return;
	if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

	if (CODE_KEY_PATTERN.test(event.key || "")) {
		event.preventDefault();
		event.stopPropagation();
		lastRedirectAt = Date.now();
		suppressAutoLookup = false;
		codeInput.value = event.key;
		focusCodeField();
		return;
	}

	if (event.key === "Enter" && Date.now() - lastRedirectAt < 1000) {
		event.preventDefault();
		event.stopPropagation();
		submitTypedCode();
	}
}

watch(codeInput, (value) => {
	clearAutoLookupTimer();
	if (suppressAutoLookup) {
		suppressAutoLookup = false;
		return;
	}
	const code = String(value || "").trim();
	if (code.length < AUTO_LOOKUP_MIN_LENGTH || !uiStore.stockLookupDialog) return;
	autoLookupTimer = setTimeout(() => {
		autoLookupTimer = null;
		if (String(codeInput.value || "").trim() === code) {
			runLookup(code, "idle");
		}
	}, AUTO_LOOKUP_IDLE_MS);
});

function submitTypedCode() {
	clearAutoLookupTimer();
	const code = String(codeInput.value || "").trim();
	if (code) runLookup(code, "enter");
}

const playTone = (type) => {
	try {
		window.frappe?.utils?.play_sound?.(type === "error" ? "error" : "submit");
	} catch {
		// Sound is a nicety; never let it break a lookup.
	}
};

// --- Lookup ---------------------------------------------------------------

async function runLookup(rawCode, source) {
	const code = String(rawCode || "").trim();
	if (!code || !uiStore.stockLookupDialog) return;
	// A scanner that sends Enter can also trip the idle auto-lookup for the
	// same value; one request per code is enough.
	if (loading.value && pendingCode === code) return;

	clearAutoLookupTimer();
	const seq = ++lookupSeq;
	if (source === "scan" && codeInput.value !== code) {
		suppressAutoLookup = true;
		codeInput.value = code;
	}

	if (isOffline()) {
		statusType.value = "warning";
		statusMessage.value = __("Check Stock needs a connection to the server.");
		return;
	}

	loading.value = true;
	pendingCode = code;
	statusMessage.value = "";
	let message = null;
	try {
		const res = await window.frappe.call({
			method: "posawesome.posawesome.api.items.lookup_item_stock",
			args: {
				pos_profile: posProfile.value?.name,
				code,
				price_list: uiStore.stockLookupContext?.priceList || null,
				customer: uiStore.stockLookupContext?.customer || null,
			},
		});
		message = res?.message || null;
	} catch (error) {
		if (seq !== lookupSeq) return;
		console.error("Check Stock lookup request failed", error);
		loading.value = false;
		pendingCode = "";
		statusType.value = "error";
		statusMessage.value = __("Couldn't check stock right now. Please try again.");
		playTone("error");
		focusCodeField({ select: true });
		return;
	}
	if (seq !== lookupSeq) return;
	loading.value = false;
	pendingCode = "";

	if (!message?.found) {
		// A code typed by hand can pause mid-way and trigger an idle lookup
		// on a partial value -- keep that miss quiet, like the main search.
		statusType.value = source === "idle" ? "info" : "error";
		statusMessage.value = __("No item found for {0}", [code]);
		if (source !== "idle") playTone("error");
		focusCodeField({ select: true });
		return;
	}

	result.value = {
		...message,
		items: Array.isArray(message.items) ? message.items : [],
	};
	filters.value = {};
	displayCount.value = 60;
	playTone("success");
	focusCodeField({ select: true });
}

// --- Cards ----------------------------------------------------------------

const attributeFilters = computed(() => {
	const meta = result.value?.attributes_meta || {};
	return Object.keys(meta).map((attribute) => ({
		attribute,
		values: Array.isArray(meta[attribute]) ? meta[attribute] : [],
	}));
});

const attributesOf = (item) => (Array.isArray(item?.item_attributes) ? item.item_attributes : []);

const filteredItems = computed(() => {
	const items = result.value?.items || [];
	const active = Object.entries(filters.value).filter(([, value]) => value);
	const matching = active.length
		? items.filter((item) =>
				active.every(([attribute, value]) =>
					attributesOf(item).some(
						(attr) => attr.attribute === attribute && String(attr.attribute_value) === String(value),
					),
				),
			)
		: items.slice();
	const scannedCode = result.value?.scanned_item_code;
	return matching.sort((a, b) => (a.item_code === scannedCode ? -1 : b.item_code === scannedCode ? 1 : 0));
});

const visibleItems = computed(() => filteredItems.value.slice(0, displayCount.value));

const totalInStock = computed(() => {
	const items = result.value?.items || [];
	let total = 0;
	let any = false;
	for (const item of items) {
		const qty = getVariantCardAvailableQty(item);
		if (qty === null) continue;
		any = true;
		if (qty > 0) total += qty;
	}
	return any ? total : null;
});

function toggleFilter(attribute, value) {
	filters.value = {
		...filters.value,
		[attribute]: filters.value[attribute] === value ? null : value,
	};
	displayCount.value = 60;
}

const isScanned = (item) => item?.item_code === result.value?.scanned_item_code;
const availableQtyOf = (item) => getVariantCardAvailableQty(item);
const barcodeOf = (item) => getVariantCardBarcode(item);
const isOutOfStock = (item) => {
	const qty = availableQtyOf(item);
	return qty !== null && qty <= 0;
};
const isUnavailable = (item) => isVariantCardUnavailable(item, posProfile.value, uiStore.stockSettings);

function variantLabel(item) {
	// Same attribute order as the filter rows, so every card reads alike
	// (variant attribute rows come back from the server unordered).
	const order = attributeFilters.value.map((filter) => filter.attribute);
	const rank = (attr) => {
		const index = order.indexOf(attr.attribute);
		return index === -1 ? order.length : index;
	};
	const values = attributesOf(item)
		.slice()
		.sort((a, b) => rank(a) - rank(b))
		.map((attr) => attr.attribute_value)
		.filter(Boolean);
	return values.length ? values.join(" / ") : item.item_name || item.item_code;
}

function formatQty(value) {
	if (value === null || value === undefined) return "—";
	return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function formatPrice(item) {
	const value = Number(item?.price_list_rate ?? item?.rate ?? 0) || 0;
	const currency = item?.currency || posProfile.value?.currency || "";
	if (typeof window.format_currency === "function" && currency) {
		try {
			return window.format_currency(value, currency);
		} catch {
			// fall through to the plain format below
		}
	}
	const amount = new Intl.NumberFormat(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 3,
	}).format(value);
	return currency ? `${amount} ${currency}` : amount;
}

// --- Add to cart ----------------------------------------------------------
// Deliberately the same steps as the VIEW dialog's add (Variants.vue's
// fetchVariantRate + applyCurrencyConversionToItem + add_item), so an item
// added from here lands in the cart priced exactly as it would from there.

async function prepareItemForCart(source) {
	const item = { ...source };
	const profile = posProfile.value || {};
	try {
		const res = await window.frappe.call({
			method: "posawesome.posawesome.api.items.get_item_detail",
			args: {
				warehouse: item.warehouse || profile.warehouse,
				price_list: profile.selling_price_list,
				company: profile.company,
				item: JSON.stringify({
					item_code: item.item_code,
					pos_profile: profile.name,
					qty: item.qty || 1,
					uom: item.uom || item.stock_uom,
					doctype: profile.create_pos_invoice_instead_of_sales_invoice
						? "POS Invoice"
						: "Sales Invoice",
				}),
			},
		});
		const data = res?.message;
		if (data) {
			item.rate = data.price_list_rate;
			item.price_list_rate = data.price_list_rate;
			item.base_rate = data.price_list_rate;
			item.base_price_list_rate = data.price_list_rate;
			item.currency = data.currency || data.price_list_currency || profile.currency;
		}
	} catch (error) {
		console.error("Failed to fetch variant rate", error);
	}
	if (!item.original_rate) {
		item.original_rate = item.price_list_rate ?? item.rate ?? 0;
		item.original_currency = item.currency || profile.currency;
	}
	item.base_price_list_rate = item.price_list_rate ?? item.original_rate ?? 0;
	item.base_rate = item.base_rate || item.base_price_list_rate;
	item.rate = item.price_list_rate ?? item.rate ?? 0;
	item.currency = item.currency || profile.currency;
	return item;
}

async function addToCart(source) {
	if (!canAddToCart.value || adding.value || isUnavailable(source)) return;
	adding.value = true;
	addingItemCode.value = source.item_code;
	const seq = lookupSeq;
	try {
		const item = await prepareItemForCart(source);
		// Dialog closed (or another lookup started) while the rate loaded:
		// staff have moved on, so don't add behind their back.
		if (seq !== lookupSeq || !uiStore.stockLookupDialog) return;
		const payload = { ...item, code: item.item_code };
		if (eventBus) {
			eventBus.emit("add_item", payload);
		} else {
			invoiceStore.addItem(payload);
		}
		closeDialog();
	} finally {
		adding.value = false;
		addingItemCode.value = "";
	}
}

defineExpose({ runLookup, closeDialog });
</script>

<style scoped>
.stock-lookup__header {
	display: flex;
	align-items: center;
	padding: 12px 16px;
	background: rgba(var(--v-theme-info), 0.12);
	border-bottom: 2px solid rgb(var(--v-theme-info));
}

.stock-lookup__heading {
	min-width: 0;
}

.stock-lookup__entry {
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 12px 16px 8px;
}

.stock-lookup__body {
	min-height: 320px;
}

.stock-lookup__empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 260px;
	opacity: 0.7;
	text-align: center;
}

.stock-lookup__summary {
	margin-bottom: 6px;
}

.stock-lookup__filter {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
}

.stock-lookup__filter-label {
	font-size: 0.85rem;
	font-weight: 600;
	margin-right: 4px;
}

.stock-lookup__card {
	height: 100%;
	display: flex;
	flex-direction: column;
}

.stock-lookup__card .v-card-text {
	flex: 1 1 auto;
}

.stock-lookup__card--scanned {
	border: 2px solid rgb(var(--v-theme-primary));
}

.stock-lookup__card--out .stock-lookup__image {
	opacity: 0.5;
}

.stock-lookup__badges {
	display: flex;
	gap: 4px;
	padding: 6px;
}

.stock-lookup__name {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.stock-lookup__price {
	font-size: 0.85rem;
	color: rgb(var(--v-theme-primary));
}

.stock-lookup__meta {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 0.8rem;
	min-width: 0;
}

.stock-lookup__barcode {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
