<template>
	<!-- One-screen exchange: the big result line (section 109). Orange:
	     the customer pays; green: a credit note is issued; blue: even.
	     While a change is being checked the last result stays, dimmed. -->
	<div
		class="exchange-result"
		:class="[`exchange-result--${result.tone}`, { 'exchange-result--compact': compact, 'exchange-result--checking': result.checking }]"
		data-testid="exchange-result"
		:data-tone="result.tone"
		role="status"
		aria-live="polite"
	>
		<span class="exchange-result__text">{{ result.text }}</span>
		<span v-if="result.checking && result.tone !== 'checking'" class="exchange-result__checking">
			{{ __("Checking…") }}
		</span>
		<template v-if="result.tone === 'error'">
			<span class="exchange-result__error" data-testid="exchange-result-error">{{ result.error }}</span>
			<v-btn
				size="small"
				variant="flat"
				color="error"
				data-testid="exchange-result-retry"
				@click="result.retry && result.retry()"
			>
				{{ __("Retry") }}
			</v-btn>
		</template>
	</div>
</template>

<script setup>
defineProps({
	result: { type: Object, required: true },
	compact: { type: Boolean, default: false },
});
const __ = window.__ || ((text) => text);
</script>

<style scoped>
/* Dark text on a tinted band with a strong coloured edge: readable in light
   and dark themes (orange text on orange tint would not be). */
.exchange-result {
	--tone: var(--v-theme-on-surface);
	container-type: inline-size;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px 10px;
	width: 100%;
	padding: 8px 14px;
	border-radius: 10px;
	box-sizing: border-box;
	border-inline-start: 6px solid rgb(var(--tone));
	background: rgba(var(--tone), 0.16);
	color: rgb(var(--v-theme-on-surface));
	font-weight: 800;
	line-height: 1.15;
	transition: opacity 0.15s ease;
}
.exchange-result__text {
	font-size: clamp(1.3rem, 6.5cqi, 2rem);
	min-width: 0;
}
.exchange-result--compact {
	padding: 4px 10px;
}
.exchange-result--compact .exchange-result__text {
	font-size: clamp(0.95rem, 6cqi, 1.3rem);
}
.exchange-result--pays {
	--tone: var(--v-theme-warning);
}
.exchange-result--credit {
	--tone: var(--v-theme-success);
}
.exchange-result--even {
	--tone: var(--v-theme-info);
}
.exchange-result--error {
	--tone: var(--v-theme-error);
}
.exchange-result__error {
	font-size: 0.8rem;
	font-weight: 600;
}
.exchange-result--checking .exchange-result__text {
	opacity: 0.55;
}
.exchange-result__checking {
	font-size: 0.75rem;
	font-weight: 600;
	opacity: 0.75;
}
</style>
