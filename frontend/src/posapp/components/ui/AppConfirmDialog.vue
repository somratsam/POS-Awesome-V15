<template>
	<v-dialog
		:model-value="!!request"
		max-width="440"
		:content-props="{ onKeydownCapture: handleKeydownCapture }"
		@update:model-value="onModelValue"
		@after-enter="focusInitialButton"
	>
		<!-- Key guard on Vuetify's overlay wrapper (content-props), as in
		     DiscountReasonDialog: a barcode scan typed while this is open must
		     not reach the cart behind it. -->
		<v-card v-if="request" class="app-confirm" data-testid="app-confirm-dialog">
			<v-card-title class="app-confirm__title" data-testid="app-confirm-title">
				{{ request.title }}
			</v-card-title>
			<v-card-text class="app-confirm__text" data-testid="app-confirm-message">
				{{ request.message }}
			</v-card-text>
			<v-card-actions class="app-confirm__actions">
				<v-spacer />
				<v-btn
					v-if="request.kind === 'confirm'"
					ref="cancelBtn"
					variant="tonal"
					size="large"
					data-testid="app-confirm-cancel"
					@click="answer(false)"
				>
					{{ request.cancelText }}
				</v-btn>
				<v-btn
					ref="confirmBtn"
					variant="flat"
					size="large"
					:color="request.danger ? 'error' : 'primary'"
					data-testid="app-confirm-ok"
					@click="answer(true)"
				>
					{{ request.confirmText }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
// The shared confirm / notice dialog (services/appDialog.ts). Mounted once in
// DefaultLayout. Esc and click outside answer "cancel"; on a danger confirm
// (cancel / delete) the focus starts on the cancel button so a stray Enter
// doesn't delete anything.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
	answerAppDialog,
	appDialogRequest,
	registerAppDialogHost,
} from "../../services/appDialog";

defineOptions({ name: "AppConfirmDialog" });

// A hardware scanner types its characters then Enter within a few ms; an
// Enter that close to a printable key is the scanner's, not the cashier's.
const SCANNER_ENTER_GUARD_MS = 300;
let lastPrintableAt = 0;

const request = computed(() => appDialogRequest.value);
const cancelBtn = ref(null);
const confirmBtn = ref(null);

let unregister = null;
onMounted(() => {
	unregister = registerAppDialogHost();
});
onBeforeUnmount(() => {
	unregister?.();
});

function answer(value) {
	lastPrintableAt = 0;
	answerAppDialog(value);
}

function onModelValue(open) {
	if (!open && request.value) answer(false);
}

function buttonElement(btn) {
	const el = btn?.$el ?? btn;
	return el instanceof HTMLElement ? el : null;
}

function focusInitialButton() {
	nextTick(() => {
		const current = request.value;
		if (!current) return;
		const target =
			current.kind === "confirm" && current.danger ? cancelBtn.value : confirmBtn.value;
		buttonElement(target)?.focus();
	});
}

function handleKeydownCapture(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	const key = event.key || "";
	if (key.length === 1 && key !== " ") {
		lastPrintableAt = Date.now();
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (key === "Enter" && Date.now() - lastPrintableAt < SCANNER_ENTER_GUARD_MS) {
		event.preventDefault();
		event.stopPropagation();
	}
	// Any other Enter / Space presses the focused button natively.
}

defineExpose({ answer });
</script>

<style scoped>
.app-confirm__title {
	white-space: normal;
	font-weight: 600;
}

.app-confirm__text {
	white-space: pre-line;
	font-size: 1rem;
}

.app-confirm__actions {
	padding: 0 16px 16px;
	gap: 8px;
}
</style>
