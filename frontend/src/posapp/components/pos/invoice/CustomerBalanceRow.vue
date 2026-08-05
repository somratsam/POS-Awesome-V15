<template>
	<v-sheet
		v-if="showBalance"
		class="pos-header-bar px-4 py-3 mb-2"
		rounded="lg"
		elevation="1"
	>
		<div class="balance-container">
			<span class="balance-label">{{ __("Customer Balance") }}</span>

			<v-skeleton-loader
				v-if="balance_loading"
				type="chip"
				width="120"
				class="balance-skeleton"
			/>

			<v-tooltip
				v-else-if="isNegative"
				location="bottom"
				:text="__('Account is overdrawn')"
			>
				<template #activator="{ props: tooltipProps }">
					<v-chip
						v-bind="tooltipProps"
						size="small"
						color="error"
						variant="elevated"
						class="balance-chip font-weight-bold"
					>
						<v-icon start icon="mdi-alert-circle" size="14" />
						<span class="balance-amount">{{ formattedBalance }}</span>
					</v-chip>
				</template>
			</v-tooltip>

			<v-chip
				v-else
				size="small"
				color="success"
				variant="tonal"
				class="balance-chip font-weight-bold"
			>
				<span class="balance-amount">{{ formattedBalance }}</span>
			</v-chip>
		</div>
	</v-sheet>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { POSProfile } from "../../../types/models";

interface Props {
	pos_profile: POSProfile | Record<string, any>;
	customer_balance?: number;
	customer_balance_currency?: string;
	balance_loading?: boolean;
	formatCurrency: (val: number | undefined, currency?: string) => string;
}

const props = defineProps<Props>();

const __ = (str: string) => (window.__ ? window.__(str) : str);

const showBalance = computed(() => !!props.pos_profile?.posa_show_customer_balance);
const isNegative = computed(() => (props.customer_balance ?? 0) < 0);
const formattedBalance = computed(() => {
	return props.formatCurrency(props.customer_balance, props.customer_balance_currency);
});
</script>

<style scoped>
.pos-header-bar {
	background-color: var(--pos-card-bg, #ffffff);
	border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
	transition: box-shadow 0.3s ease;
}

.balance-container {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
	min-width: 0;
	width: 100%;
}

.balance-label {
	font-size: 0.75rem;
	color: rgba(var(--v-theme-on-surface), 0.6);
	white-space: nowrap;
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.balance-skeleton :deep(.v-skeleton-loader__chip) {
	border-radius: 16px;
	height: 28px;
}

.balance-chip {
	flex: 0 0 auto;
	font-variant-numeric: tabular-nums;
	letter-spacing: 0.01em;
}

.balance-amount {
	white-space: nowrap;
	font-size: 1rem;
}

@media (max-width: 599px) {
	.balance-container {
		justify-content: space-between;
	}
}
</style>
