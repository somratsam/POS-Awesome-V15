<template>
	<div class="selection-fields">
		<!-- Sales Person Selection -->
		<v-row class="pb-0 mb-2" align="start">
			<v-col cols="12">
				<p v-if="salesPersons && salesPersons.length > 0" class="mt-1 mb-1 text-subtitle-2">
					{{ salesPersons.length }} {{ $__("sales persons found") }}
				</p>
				<p v-else class="mt-1 mb-1 text-subtitle-2 text-red">{{ $__("No sales persons found") }}</p>
				<v-select
					density="compact"
					clearable
					variant="solo"
					color="primary"
					:label="$frappe._('Sales Person')"
					:model-value="salesPerson"
					:items="salesPersons"
					item-title="title"
					item-value="value"
					class="sleek-field pos-themed-input"
					:no-data-text="$__('Sales Person not found')"
					hide-details
					:disabled="readonly || followsOriginal"
					@update:model-value="$emit('update:sales-person', $event)"
				></v-select>
				<p
					v-if="followsOriginal"
					class="mt-1 mb-0 text-caption text-medium-emphasis"
					data-testid="sales-person-follows-original"
				>
					{{ $__("A return keeps the original sale's Sales Person.") }}
				</p>
			</v-col>
		</v-row>
		<!-- Print Format Selection -->
		<v-row v-if="showPrintFormat" class="pb-0 mb-2" align="start">
			<v-col cols="12">
				<v-select
					density="compact"
					clearable
					variant="solo"
					color="primary"
					:label="$frappe._('Print Format')"
					:model-value="printFormat"
					:items="printFormats"
					class="sleek-field pos-themed-input"
					:no-data-text="$__('No Print Formats Found')"
					hide-details
					@update:model-value="$emit('update:print-format', $event)"
				></v-select>
			</v-col>
		</v-row>
	</div>
</template>

<script setup>
import { inject } from "vue";

defineProps({
	salesPersons: {
		type: Array,
		default: () => [],
	},
	salesPerson: {
		type: String,
		default: "",
	},
	readonly: {
		type: Boolean,
		default: false,
	},
	// A return against a sale: the server gives it the original's Sales Team.
	followsOriginal: {
		type: Boolean,
		default: false,
	},
	printFormats: {
		type: Array,
		default: () => [],
	},
	printFormat: {
		type: String,
		default: "",
	},
	showPrintFormat: {
		type: Boolean,
		default: true,
	},
});

defineEmits(["update:sales-person", "update:print-format"]);

const $frappe = inject("frappe", window.frappe);
const $__ = inject("__", window.__);
</script>

<style scoped>
.pos-themed-input :deep(.v-field__input) {
	font-weight: 500;
}
</style>
