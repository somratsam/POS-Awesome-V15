<template>
	<section class="shift-closed-panel" data-testid="shift-closed-panel">
		<div class="shift-closed-panel__card">
			<v-icon icon="mdi-check-circle-outline" size="56" color="success" />
			<h2 class="shift-closed-panel__title">{{ __("Shift closed") }}</h2>
			<p class="shift-closed-panel__text">
				{{ __("The Z Report is printing.") }}
			</p>
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
const emit = defineEmits(["close", "open-new-shift", "logout"]);
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
	max-width: 600px;
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

.shift-closed-panel__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 12px;
	margin-top: 12px;
}
</style>
