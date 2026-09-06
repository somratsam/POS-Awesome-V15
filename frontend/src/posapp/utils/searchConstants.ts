/**
 * Single source of truth for the minimum number of characters a search term
 * must have before item search actually filters by it -- client and server,
 * Limit Search and non-Limit-Search mode alike. Below this length, search
 * must show nothing rather than an unfiltered/wrong result set (a real bug
 * this constant closes: several call sites used to disagree on the exact
 * number, and at least one silently showed the first N catalog items as if
 * they matched instead of showing nothing).
 */
export const MIN_SEARCH_TERM_LENGTH = 3;
