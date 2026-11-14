<template>
	<v-card flat :class="['cards mb-0 mt-3 pa-0', { compact }]">
		<v-row align="start" no-gutters>
			<!-- A return that refunds no money: the cashier says whether it is an
			     exchange (no slip) or a credit note (printed). The labels say the
			     return is submitted; a confirmation follows (utils/returnIntent). -->
			<template v-if="returnChoice">
				<v-col cols="12" sm="6">
					<v-btn
						block
						size="large"
						color="primary"
						variant="flat"
						class="payment-submit-btn payment-footer-btn"
						data-pos-keyboard-target="payment-submit-exchange"
						data-testid="payment-submit-exchange"
						:aria-keyshortcuts="showKeyboardShortcuts ? 'Control+Enter Meta+Enter' : undefined"
						@click="$emit('submit-exchange')"
						:loading="loading"
						:disabled="loading || validatePayment"
						:class="{ 'submit-highlight': highlightSubmit }"
					>
						<span>{{ __("Submit return → Exchange") }}</span>
						<kbd v-if="showKeyboardShortcuts" class="payment-footer-btn__shortcut">
							Ctrl/⌘+Enter
						</kbd>
					</v-btn>
				</v-col>
				<v-col cols="12" sm="6" class="payment-action-col">
					<v-btn
						block
						size="large"
						color="success"
						variant="flat"
						class="payment-submit-print-btn payment-footer-btn"
						data-pos-keyboard-target="payment-submit-credit-note"
						data-testid="payment-submit-credit-note"
						@click="$emit('submit-credit-note')"
						:loading="loading"
						:disabled="loading || validatePayment"
					>
						<span>{{ __("Submit return → Credit note") }}</span>
					</v-btn>
				</v-col>
			</template>
			<template v-else>
			<v-col cols="12" sm="6">
				<v-btn
					ref="submitButton"
					block
					size="large"
					color="primary"
					variant="flat"
					class="payment-submit-btn payment-footer-btn"
					data-pos-keyboard-target="payment-submit"
					data-testid="payment-submit"
					:aria-keyshortcuts="showKeyboardShortcuts ? 'Control+Enter Meta+Enter' : undefined"
					@click="$emit('submit')"
					:loading="loading"
					:disabled="loading || validatePayment"
					:class="{ 'submit-highlight': highlightSubmit }"
				>
					<span>{{ __("Submit") }}</span>
					<kbd v-if="showKeyboardShortcuts" class="payment-footer-btn__shortcut">
						Ctrl/⌘+Enter
					</kbd>
				</v-btn>
			</v-col>
			<v-col cols="12" sm="6" class="payment-action-col">
				<v-btn
					block
					size="large"
					color="success"
					variant="flat"
					class="payment-submit-print-btn payment-footer-btn"
					data-pos-keyboard-target="payment-submit-print"
					data-testid="payment-submit-print"
					:aria-keyshortcuts="
						showKeyboardShortcuts ? 'Control+Shift+Enter Meta+Shift+Enter' : undefined
					"
					@click="$emit('submit-and-print')"
					:loading="loading"
					:disabled="loading || validatePayment"
				>
					<span>{{ __("Submit & Print") }}</span>
					<kbd v-if="showKeyboardShortcuts" class="payment-footer-btn__shortcut">
						Ctrl/⌘+Shift+Enter
					</kbd>
				</v-btn>
			</v-col>
			</template>
			<v-col cols="12">
				<v-btn
					block
					size="large"
					color="error"
					variant="flat"
					class="mt-2 pa-1 payment-cancel-btn payment-footer-btn"
					data-pos-keyboard-target="payment-cancel"
					data-testid="payment-cancel"
					@click="$emit('cancel')"
				>
					{{ __("Cancel Payment") }}
				</v-btn>
			</v-col>
		</v-row>
	</v-card>
</template>

<script setup>
defineProps({
	loading: Boolean,
	validatePayment: Boolean,
	highlightSubmit: Boolean,
	compact: Boolean,
	showKeyboardShortcuts: Boolean,
	returnChoice: Boolean,
});

defineEmits(["submit", "submit-and-print", "submit-exchange", "submit-credit-note", "cancel"]);

const __ = window.__;
</script>

<style scoped>
.cards {
	background: transparent !important;
}

.compact :deep(.v-btn),
:deep(.compact .v-btn) {
	min-height: 42px;
}

.payment-footer-btn {
	--v-theme-overlay-multiplier: 0 !important;
	transition:
		box-shadow 0.18s ease,
		background-color 0.18s ease,
		transform 0.18s ease !important;
	color: #ffffff !important;
	min-height: 48px !important;
}

.payment-footer-btn__shortcut {
	margin-inline-start: 8px;
	padding: 3px 6px;
	border: 1px solid currentColor;
	border-bottom-width: 2px;
	border-radius: 3px;
	background: rgba(255, 255, 255, 0.12);
	color: inherit;
	font: inherit;
	font-size: 0.68rem;
	font-weight: 800;
	line-height: 1;
}

.payment-submit-btn {
	background-color: #0b5cab !important;
}

.payment-submit-print-btn {
	background-color: #047857 !important;
}

.payment-cancel-btn {
	background-color: #b91c1c !important;
}

.payment-footer-btn:hover,
.payment-footer-btn:focus,
.payment-footer-btn:focus-visible,
.payment-footer-btn:active {
	box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18) !important;
	transform: translateY(-1px);
}

.payment-submit-btn:hover,
.payment-submit-btn:focus,
.payment-submit-btn:focus-visible,
.payment-submit-btn:active {
	background-color: #084d96 !important;
}

.payment-submit-print-btn:hover,
.payment-submit-print-btn:focus,
.payment-submit-print-btn:focus-visible,
.payment-submit-print-btn:active {
	background-color: #065f46 !important;
}

.payment-cancel-btn:hover,
.payment-cancel-btn:focus,
.payment-cancel-btn:focus-visible,
.payment-cancel-btn:active {
	background-color: #991b1b !important;
}

.payment-action-col {
	padding-left: 4px;
}

.payment-footer-btn:active {
	transform: translateY(0);
}

:deep(.payment-footer-btn .v-btn__overlay),
:deep(.payment-footer-btn .v-btn__underlay) {
	opacity: 0 !important;
	background: transparent !important;
}

:deep(.payment-footer-btn .v-btn__content) {
	color: #ffffff !important;
}

@media (max-width: 768px) {
	.cards {
		margin-top: 0 !important;
	}

	.payment-action-col {
		padding-left: 0;
		padding-top: 6px;
	}

	.payment-footer-btn {
		font-size: 0.82rem !important;
	}

	:deep(.payment-footer-btn.v-btn) {
		min-height: 38px !important;
	}

	:deep(.payment-footer-btn .v-btn__content) {
		font-size: 0.82rem !important;
		line-height: 1.15;
	}
}

@media (max-width: 480px) {
	.payment-footer-btn {
		font-size: 0.76rem !important;
	}

	:deep(.payment-footer-btn.v-btn) {
		min-height: 34px !important;
	}

	:deep(.payment-footer-btn .v-btn__content) {
		font-size: 0.76rem !important;
	}
}
</style>
