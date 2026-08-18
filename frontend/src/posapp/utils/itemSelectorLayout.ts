/**
 * Utility functions for responsive item card layout.
 */

// These thresholds are calibrated against the item selector panel's own
// measured container width (see useItemSelectorLayout.ts's cardContainerWidth),
// not the full browser window. The panel is only ever a fraction of the
// window -- 4/12 of it at the md/lg breakpoints, 5/12 at xl and above (see
// Pos.vue's split ratio), or the full width when useCompactPosSwitcher
// stacks the layout below POS_COMPACT_LAYOUT_BREAKPOINT (see
// useResponsive.ts) -- so a container-width threshold can't reuse the old
// window-width cutoffs (768/1200) directly.
//
// Anchored against two real cases:
// - A 1366px window (lg tier, 4/12 split) measures a ~455px container.
//   That's genuinely cramped for more than one column, so LOW_THRESHOLD
//   sits comfortably above it (with margin for real-world gutter/scrollbar
//   variance) to keep this at 1 column.
// - A 1920px window (xl tier, 5/12 split) measures a ~800px container.
//   HIGH_THRESHOLD sits comfortably below it so this reliably lands back
//   at 3 columns, matching the column count screens this size showed
//   before the container-width fix.
const LOW_THRESHOLD = 500;
const HIGH_THRESHOLD = 720;

/**
 * Calculates the number of columns based on container width.
 */
export const getCardColumns = (width: number): number => {
    if (width <= LOW_THRESHOLD) {
        return 1;
    }
    if (width <= HIGH_THRESHOLD) {
        return 2;
    }
    return 3;
};

/**
 * Calculates the gap between cards based on container width.
 */
export const getCardGap = (width: number): number => {
    if (width <= LOW_THRESHOLD) {
        return 10;
    }
    if (width <= HIGH_THRESHOLD) {
        return 12;
    }
    return 16;
};

/**
 * Calculates the padding for the card container based on container width.
 */
export const getCardPadding = (width: number): number => {
    if (width <= LOW_THRESHOLD) {
        return 10;
    }
    if (width <= HIGH_THRESHOLD) {
        return 12;
    }
    return 16;
};
