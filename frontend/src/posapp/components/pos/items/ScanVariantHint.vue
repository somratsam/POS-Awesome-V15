<template>
	<v-snackbar
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		:timeout="-1"
		location="bottom"
		content-class="scan-variant-hint"
		color="surface"
		elevation="6"
	>
		<div class="scan-variant-hint__body">
			<v-icon color="primary" size="20" class="mr-2">mdi-tshirt-crew-outline</v-icon>
			<span class="scan-variant-hint__text">
				{{ __("Other sizes/colors of {0} may be available", [itemName]) }}
			</span>
		</div>
		<template v-slot:actions>
			<v-btn variant="text" color="primary" @click="$emit('view')">
				{{ __("View") }}
			</v-btn>
			<v-btn variant="text" icon="mdi-close" size="small" :aria-label="__('Dismiss')" @click="$emit('dismiss')" />
		</template>
	</v-snackbar>
</template>

<script setup>
defineOptions({
	name: "ScanVariantHint",
});

defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	itemName: {
		type: String,
		default: "",
	},
});

defineEmits(["update:modelValue", "view", "dismiss"]);

const __ = window.__ || ((text) => text);
</script>

<style scoped>
.scan-variant-hint__body {
	display: flex;
	align-items: center;
}

.scan-variant-hint__text {
	font-size: 0.9rem;
}
</style>
