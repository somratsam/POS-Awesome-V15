import { ref, computed, onMounted, onBeforeUnmount, type Ref } from "vue";
import * as _ from "lodash";

export interface TableHeader {
	title: string;
	key: string;
	required?: boolean;
	sortable?: boolean;
	align?: "start" | "center" | "end";
	width?: string | number;
	minWidth?: string | number;
	[key: string]: any;
}

export const DATA_TABLE_EXPAND_COLUMN: TableHeader = {
	title: "",
	key: "data-table-expand",
	sortable: false,
	align: "center",
	width: 48,
	minWidth: 48,
};

// Optional (non-required) columns are kept in this priority order as width
// allows -- earlier entries survive narrower widths than later ones.
// price_list_rate is selected by default for most POS Profiles (see
// useInvoiceItems.ts's loadColumnPreferences), so it's prioritized over
// uom/posa_is_offer, which are opt-in and used by fewer stores. Any
// optional column not listed here (future additions) falls in after all
// of these.
const OPTIONAL_COLUMN_PRIORITY = ["price_list_rate", "uom", "posa_is_offer"];

// Same 48px the data-table's expand column always renders at
// (DATA_TABLE_EXPAND_COLUMN below) -- included here so the required-only
// floor this graduated logic is based on reflects what the table actually
// needs on screen, not just its data columns.
const EXPAND_COLUMN_WIDTH = 48;

function optionalColumnPriorityIndex(key: string) {
	const index = OPTIONAL_COLUMN_PRIORITY.indexOf(key);
	return index === -1 ? OPTIONAL_COLUMN_PRIORITY.length : index;
}

export function getResponsiveVisibleHeaders(
	headers: TableHeader[],
	width: number,
) {
	const requiredHeaders = headers.filter((header) => header.required);
	const optionalHeaders = headers.filter((header) => !header.required);

	const visibleOptionalKeys = new Set<string>();
	if (width <= 0) {
		// Not measured yet (e.g. before the container's first layout pass)
		// -- show everything selected rather than flashing a hidden state.
		optionalHeaders.forEach((header) => visibleOptionalKeys.add(header.key));
	} else {
		const requiredFloor =
			requiredHeaders.reduce(
				(sum, header) => sum + calculateMinColumnWidth(header),
				0,
			) + EXPAND_COLUMN_WIDTH;

		let remaining = width - requiredFloor;
		const orderedOptional = [...optionalHeaders].sort(
			(a, b) => optionalColumnPriorityIndex(a.key) - optionalColumnPriorityIndex(b.key),
		);
		for (const header of orderedOptional) {
			const columnWidth = calculateMinColumnWidth(header);
			if (remaining < columnWidth) {
				// Stop at the first column that doesn't fit rather than
				// skipping ahead to a lower-priority one that might --
				// keeps the visible set predictable as width changes
				// (the same columns disappear/reappear in a fixed order,
				// not a shuffling combination).
				break;
			}
			visibleOptionalKeys.add(header.key);
			remaining -= columnWidth;
		}
	}

	return headers
		.filter((header) => header.required || visibleOptionalKeys.has(header.key))
		.map((header) => ({
			...header,
			width: calculateColumnWidth(header, width),
			minWidth: calculateMinColumnWidth(header),
		}));
}

export function buildFinalVisibleColumns(
	headers: TableHeader[],
	width: number,
	options: { showExpand?: boolean } = {},
) {
	const visibleHeaders = getResponsiveVisibleHeaders(headers, width);

	if (options.showExpand === false) {
		return visibleHeaders;
	}

	return [...visibleHeaders, DATA_TABLE_EXPAND_COLUMN];
}

// Required-column minimums below (item_name unchanged; qty/rate/amount/
// discount_percentage/discount_amount/actions trimmed) rely on the tighter
// cell padding/font wired in via --cell-padding/--header-font-size
// (items-table-styles.css) and the compact-view qty-input narrowing
// (containerClasses above) actually being in effect -- the two changes
// are a matched pair, not independent: shrinking these floors without the
// CSS compaction would visually clip content in a way it doesn't once both
// land together. See required-column floor math in the fix that added
// this comment for the full breakdown (768px total incl. the 48px expand
// column, down from 848px).
const calculateColumnWidth = (header: TableHeader, width: number) => {
	const baseWidths: Record<string, { min: number; max: number; ratio: number }> = {
		item_name: { min: 200, max: 250, ratio: 0.3 },
		qty: { min: 116, max: 160, ratio: 0.12 },
		rate: { min: 92, max: 130, ratio: 0.12 },
		amount: { min: 88, max: 130, ratio: 0.12 },
		discount_percentage: { min: 82, max: 120, ratio: 0.1 },
		discount_amount: { min: 82, max: 120, ratio: 0.11 },
		price_list_rate: { min: 120, max: 140, ratio: 0.13 },
		// Actions holds exactly one small delete icon button (CartItemRow.vue)
		// -- the old 80/100 floor/max were sized as if it needed the same
		// room as a text column.
		actions: { min: 60, max: 80, ratio: 0.05 },
		posa_is_offer: { min: 70, max: 90, ratio: 0.06 },
	};

	const config = baseWidths[header.key] || {
		min: 80,
		max: 150,
		ratio: 0.1,
	};
	const calculatedWidth = width * config.ratio;
	return Math.max(config.min, Math.min(config.max, calculatedWidth));
};

const calculateMinColumnWidth = (header: TableHeader) => {
	const minWidths: Record<string, number> = {
		item_name: 200,
		qty: 116,
		rate: 92,
		amount: 88,
		discount_percentage: 82,
		discount_amount: 82,
		price_list_rate: 120,
		actions: 60,
		posa_is_offer: 70,
	};
	return minWidths[header.key] || 80;
};

export function useItemsTableResponsive(
	containerRef: Ref<HTMLElement | null>,
	headers: Ref<TableHeader[]>,
) {
	const containerWidth = ref(0);
	const containerHeight = ref(0);
	const breakpoint = ref("xl");
	let resizeObserver: ResizeObserver | null = null;

	const updateBreakpoint = (width: number) => {
		if (width < 500) return "xs";
		if (width < 700) return "sm";
		if (width < 900) return "md";
		if (width < 1200) return "lg";
		return "xl";
	};

	const responsiveHeaders = computed(() => {
		const width = containerWidth.value;
		if (!headers.value || headers.value.length === 0) return [];

		return getResponsiveVisibleHeaders(headers.value, width);
	});

	const isColumnVisible = (key: string) => {
		return responsiveHeaders.value.some((h) => h.key === key);
	};

	const containerStyles = computed(() => ({
		height: "100%",
		maxHeight: "100%",
		minHeight: "0",
		"--container-width": containerWidth.value + "px",
		"--container-height": containerHeight.value + "px",
	}));

	const containerClasses = computed(() => ({
		[`breakpoint-${breakpoint.value}`]: true,
		// Extended from <600 to <900 alongside tableDensity above, so the
		// qty-input narrowing this class already drives (items-table-styles.css)
		// reaches the same 700-900px band the required-columns floor needs it in.
		"compact-view": containerWidth.value < 900,
		"medium-view":
			containerWidth.value >= 600 && containerWidth.value < 900,
		"large-view": containerWidth.value >= 900,
	}));

	const tableClasses = computed(() => ({
		[`container-${breakpoint.value}`]: true,
		"responsive-table": true,
	}));

	const expandedContentClasses = computed(() => ({
		[`expanded-${breakpoint.value}`]: true,
		"compact-expanded": containerWidth.value < 600,
	}));

	const tableDensity = computed(() => {
		// The required-columns floor (see calculateMinColumnWidth below)
		// sits at ~768px including the expand column -- containers in the
		// 700-900px band are exactly where the table needs its tightest
		// row/cell sizing, not the "default"/"comfortable" density a flat
		// <500/<800 split used to give them.
		if (containerWidth.value < 900) return "compact";
		return "comfortable";
	});

	const setupResizeObserver = () => {
		if (typeof ResizeObserver !== "undefined" && containerRef.value) {
			const debouncedResizeHandler = _.debounce(
				(entries: ResizeObserverEntry[]) => {
					for (let entry of entries) {
						const { width, height } = entry.contentRect;
						if (
							containerWidth.value !== width ||
							containerHeight.value !== height
						) {
							containerWidth.value = width;
							containerHeight.value = height;
							breakpoint.value = updateBreakpoint(width);
						}
					}
				},
				100,
			);

			resizeObserver = new ResizeObserver(debouncedResizeHandler);
			resizeObserver.observe(containerRef.value);
			// Initial call
			const rect = containerRef.value.getBoundingClientRect();
			containerWidth.value = rect.width;
			containerHeight.value = rect.height;
			breakpoint.value = updateBreakpoint(rect.width);
		}
	};

	onMounted(() => {
		setupResizeObserver();
	});

	onBeforeUnmount(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	return {
		containerWidth,
		containerHeight,
		breakpoint,
		responsiveHeaders,
		isColumnVisible,
		containerStyles,
		containerClasses,
		tableClasses,
		expandedContentClasses,
		tableDensity,
	};
}
