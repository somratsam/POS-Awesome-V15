/**
 * Keyboard scanner detection and validation utilities.
 */

/**
 * Gets a high-precision timestamp for scan timing.
 */
export const getScanTimestamp = (): number => {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
};

/**
 * Sanitizes text from clipboard. Only trims leading/trailing whitespace
 * (e.g. accidental newlines from a copy-paste) -- it must NOT collapse or
 * strip internal whitespace, since a real registered barcode can contain a
 * meaningful internal space (e.g. Charlotte Wix's "PA4 79SF").
 */
export const sanitizeClipboardText = (text: any): string => {
    return String(text || "").trim();
};

/**
 * Real registered barcode formats across this store's brands use digits,
 * letters (either case), spaces, and "/" -- e.g. Charlotte Wix's
 * "PA4 79SF" and "FE1 10L/XL" (its only format, not an exception), and a
 * handful of GEOX/LIU.JO exceptions like "PYTSETPYTS10" and lowercase
 * "dl0084003392". This charset (not digits-only) is what both the paste
 * path and the keyboard-scan path use to decide "does this look like it
 * could be a barcode" -- see PROGRESS_NOTES.md section 34.
 */
const BARCODE_CANDIDATE_CHAR_RE = /^[A-Za-z0-9 /]$/;
const BARCODE_CANDIDATE_STRING_RE = /^[A-Za-z0-9 /]+$/;

/**
 * Checks if a single character could be part of a barcode (used by the
 * per-keystroke keyboard-scan detector).
 */
export const isBarcodeCandidateChar = (value: string): boolean =>
    BARCODE_CANDIDATE_CHAR_RE.test(value);

/**
 * Checks if a value's characters could all be part of a barcode.
 */
export const isBarcodeCandidateString = (value: string): boolean =>
    BARCODE_CANDIDATE_STRING_RE.test(value);

/**
 * Checks if a value is a valid scan candidate.
 */
export const isScanCandidate = (value: string, minLength: number): boolean => {
    return isBarcodeCandidateString(value) && value.length >= minLength;
};

/**
 * Interface for keyboard scan validation parameters.
 */
export interface ScanValidationParams {
    code: string;
    duration: number;
    minLength: number;
    maxDuration?: number;
    maxInterval: number;
    // Largest single inter-keystroke gap observed while building this
    // sequence. An *average* interval check alone can be fooled by a fast-
    // typed prefix followed by one human-length pause -- the many fast gaps
    // dilute the one slow one below the average threshold, especially for a
    // short sequence (few gaps to average over). A real scanner's gaps are
    // uniformly fast; a human's are not, even when the average happens to
    // look fast. Optional for callers (e.g. the paste path) that have no
    // per-keystroke timing at all.
    maxGapObserved?: number;
}

/**
 * Determines if a code is likely from a keyboard scanner based on timing.
 */
export const isLikelyKeyboardScan = ({
    code,
    duration,
    minLength,
    maxDuration,
    maxInterval,
    maxGapObserved,
}: ScanValidationParams): boolean => {
    if (!code || !isBarcodeCandidateString(code)) {
        return false;
    }

    if (code.length < minLength) {
        return false;
    }

    if (!duration || duration <= 0) {
        return true;
    }

    if (maxDuration && typeof maxDuration === "number" && duration > maxDuration) {
        return false;
    }

    if (typeof maxGapObserved === "number" && maxGapObserved > maxInterval) {
        return false;
    }

    const averageInterval = duration / code.length;
    return averageInterval <= maxInterval;
};

/**
 * Checks if the search field is ready to accept a scan.
 */
export const isSearchFieldPrimedForScan = (value: string): boolean => {
    if (!value) {
        return true;
    }
    return isBarcodeCandidateString(value);
};
