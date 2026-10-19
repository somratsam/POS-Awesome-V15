<template>
	<section class="shift-closed-panel" data-testid="shift-closed-panel">
		<div class="shift-closed-panel__card">
			<v-icon icon="mdi-check-circle-outline" size="56" color="success" />
			<h2 class="shift-closed-panel__title">{{ __("Shift closed") }}</h2>
			<p
				v-if="printState === 'printing'"
				class="shift-closed-panel__text"
				data-testid="shift-closed-print-status"
			>
				{{ __("Printing the Z Report…") }}
			</p>
			<p
				v-else-if="printState === 'sent'"
				class="shift-closed-panel__text"
				data-testid="shift-closed-print-status"
			>
				{{ __("Z Report sent to the printer. If it didn't print, check the printer and press Reprint.") }}
			</p>
			<v-alert
				v-else
				type="warning"
				variant="tonal"
				density="compact"
				class="shift-closed-panel__alert"
				data-testid="shift-closed-print-status"
			>
				<div>{{ __("The Z Report didn't print.") }}</div>
				<div v-if="printError" class="shift-closed-panel__reason">{{ printError }}</div>
				<div>{{ __("Check QZ Tray and the printer, then press Reprint.") }}</div>
			</v-alert>
			<div class="shift-closed-panel__actions">
				<v-btn
					theme="dark"
					size="large"
					elevation="2"
					prepend-icon="mdi-close-circle-outline"
					class="shift-closed-panel__close"
					data-testid="shift-closed-close"
					@click="emit('close')"
				>
					{{ __("Close") }}
				</v-btn>
				<v-btn
					variant="tonal"
					size="large"
					prepend-icon="mdi-logout"
					data-testid="shift-closed-logout"
					@click="emit('logout')"
				>
					{{ __("Log Out") }}
				</v-btn>
				<v-btn
					variant="tonal"
					:class="{ 'shift-closed-panel__reprint--failed': printState === 'failed' }"
					size="large"
					prepend-icon="mdi-printer"
					:loading="printState === 'printing'"
					:disabled="printState === 'printing'"
					data-testid="shift-closed-reprint"
					@click="emit('reprint')"
				>
					{{ __("Reprint Z Report") }}
				</v-btn>
				<v-btn
					color="primary"
					variant="flat"
					size="large"
					prepend-icon="mdi-store-clock-outline"
					data-testid="shift-closed-open-new"
					@click="emit('open-new-shift')"
				>
					{{ __("Open New Shift") }}
				</v-btn>
			</div>
		</div>
	</section>
</template>

<script setup>
// Shown after a shift is closed, instead of opening the opening-shift dialog
// straight away. A new shift only starts when someone asks for one.
defineProps({
	// "printing" | "sent" | "failed": the latest Z Report print for the shift
	// that was just closed.
	printState: { type: String, default: "printing" },
	printError: { type: String, default: "" },
});
const emit = defineEmits(["close", "open-new-shift", "logout", "reprint"]);
const __ = window.__ || ((text) => text);
</script>

<style scoped>
.shift-closed-panel {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 70vh;
	padding: 16px;
}

.shift-closed-panel__card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	width: 100%;
	max-width: 880px;
	padding: 32px 24px;
	text-align: center;
	background: var(--pos-card-bg);
	color: var(--pos-text-primary);
	border: 1px solid var(--pos-border);
	border-radius: 12px;
}

.shift-closed-panel__title {
	margin: 0;
	font-size: 1.5rem;
	font-weight: 600;
}

.shift-closed-panel__text {
	margin: 0;
	color: var(--pos-text-secondary);
}

/* Same red as the opening dialog's Close button. */
.shift-closed-panel__close {
	background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%) !important;
	color: white !important;
}

.shift-closed-panel__alert {
	width: 100%;
	text-align: start;
}

.shift-closed-panel__reason {
	font-weight: 600;
}

/* After a failed print, make Reprint stand out: white on dark orange
   (about 5.6:1), set explicitly like Close so no theme recolours it. */
.shift-closed-panel__reprint--failed {
	background: #bf360c !important;
	color: white !important;
}

.shift-closed-panel__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 12px;
	margin-top: 12px;
}
</style>
