import { ref, computed, onMounted, onBeforeUnmount } from "vue";

// Below this window width, Pos.vue stacks the item-selector and invoice
// panels to full width (one shown at a time via the mobile dock) instead
// of splitting them side by side. Split view needs the invoice panel's
// share of the window to clear the Invoice Items table's required-column
// floor (~848px -- Discount %/Amount can never hide, see
// useItemsTableResponsive.ts) at the 8/12 split ratio used from this
// breakpoint up; 1300px leaves real margin above the bare 1272px minimum
// so table borders/scrollbar-gutter don't reopen the gap.
//
// This is deliberately its own constant, not reused by isCompact/isTablet/
// isDesktop below (which stay at 1100 for their own, unrelated consumers)
// -- it exists specifically so every place that needs to know "is the
// selector/invoice split layout viable" reads the same number. All of
// Pos.vue's useCompactPosSwitcher/showBottomDock,
// InvoiceSummary.vue's useCompactSaleDock, and ItemsSelector.vue's
// reserve-bottom-dock-space check must move together if this ever changes
// -- they're independent expressions of the same "is the layout stacked"
// state, and forgetting one leaves the mobile dock hidden while the
// layout is already stacked (or vice versa).
export const POS_COMPACT_LAYOUT_BREAKPOINT = 1300;

export function useResponsive() {
	const windowWidth = ref(window.innerWidth);
	const windowHeight = ref(window.innerHeight);
	const baseWidth = ref(1440);
	const baseHeight = ref(900);

	const isPhone = computed(() => windowWidth.value < 768);
	const isTablet = computed(
		() => windowWidth.value >= 768 && windowWidth.value < 1100,
	);
	const isDesktop = computed(() => windowWidth.value >= 1100);
	const isCompact = computed(() => windowWidth.value < 1100);
	const isShortViewport = computed(() => windowHeight.value < 760);

	const widthScale = computed(() => windowWidth.value / baseWidth.value);
	const heightScale = computed(() => windowHeight.value / baseHeight.value);
	const averageScale = computed(
		() => (widthScale.value + heightScale.value) / 2,
	);

	const dynamicSpacing = computed(() => {
		const baseSpacing = {
			xs: 4,
			sm: 8,
			md: 16,
			lg: 24,
			xl: 32,
		};

		return {
			xs: Math.max(2, Math.round(baseSpacing.xs * averageScale.value)),
			sm: Math.max(4, Math.round(baseSpacing.sm * averageScale.value)),
			md: Math.max(8, Math.round(baseSpacing.md * averageScale.value)),
			lg: Math.max(12, Math.round(baseSpacing.lg * averageScale.value)),
			xl: Math.max(16, Math.round(baseSpacing.xl * averageScale.value)),
		};
	});

	const responsiveStyles = computed(() => {
		let cardHeightVh;
		if (isPhone.value) {
			cardHeightVh = isShortViewport.value ? 56 : 62;
		} else if (isTablet.value) {
			cardHeightVh = isShortViewport.value ? 58 : 64;
		} else {
			cardHeightVh = Math.round(60 * heightScale.value);
		}

		cardHeightVh = Math.max(42, Math.min(cardHeightVh, 72));
		let containerHeightVh = 70;
		if (isPhone.value) {
			containerHeightVh = isShortViewport.value ? 66 : 74;
		} else if (isTablet.value) {
			containerHeightVh = isShortViewport.value ? 64 : 72;
		} else if (windowHeight.value <= 800) {
			containerHeightVh = 58;
		} else if (windowHeight.value <= 960) {
			containerHeightVh = 64;
		}

		let bottomSafeSpace = 24;
		if (windowWidth.value < 600) {
			bottomSafeSpace = isShortViewport.value ? 176 : 196;
		} else if (windowWidth.value < 1100) {
			bottomSafeSpace = isShortViewport.value ? 112 : 132;
		}

		return {
			"--dynamic-xs": `${dynamicSpacing.value.xs}px`,
			"--dynamic-sm": `${dynamicSpacing.value.sm}px`,
			"--dynamic-md": `${dynamicSpacing.value.md}px`,
			"--dynamic-lg": `${dynamicSpacing.value.lg}px`,
			"--dynamic-xl": `${dynamicSpacing.value.xl}px`,
			"--container-height": `${containerHeightVh}vh`,
			"--card-height": `${cardHeightVh}vh`,
			"--bottom-safe-space": `${bottomSafeSpace}px`,
			"--viewport-height": `${windowHeight.value}px`,
			"--font-scale": averageScale.value.toFixed(2),
		};
	});

	let resizeRafId: number | null = null;

	const handleResize = () => {
		// Debounce with requestAnimationFrame for better performance
		if (resizeRafId) {
			cancelAnimationFrame(resizeRafId);
		}

		resizeRafId = requestAnimationFrame(() => {
			windowWidth.value = window.innerWidth;
			windowHeight.value = window.innerHeight;
			resizeRafId = null;
		});
	};

	onMounted(() => {
		handleResize();
		window.addEventListener("resize", handleResize);
	});

	onBeforeUnmount(() => {
		window.removeEventListener("resize", handleResize);
		if (resizeRafId) {
			cancelAnimationFrame(resizeRafId);
			resizeRafId = null;
		}
	});

	return {
		windowWidth,
		windowHeight,
		baseWidth,
		baseHeight,
		isPhone,
		isTablet,
		isDesktop,
		isCompact,
		isShortViewport,
		widthScale,
		heightScale,
		averageScale,
		dynamicSpacing,
		responsiveStyles,
	};
}
