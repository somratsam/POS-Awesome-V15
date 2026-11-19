/**
 * Utility functions for scale barcode manipulation and settings.
 */

/**
 * Interface for normalized scale barcode settings.
 */
export interface ScaleBarcodeSettings {
    prefix: string;
    prefix_included_or_not: number;
    no_of_prefix_characters: number;
    // Where the item code sits in a scale barcode. The server parses a code
    // as a scale barcode only when both are set (barcode.py
    // _parse_scale_barcode_data), so the till needs them too.
    item_code_starting_digit: number;
    item_code_total_digits: number;
}

/**
 * Normalizes raw scale barcode settings.
 * @param rawSettings Raw settings object
 * @returns Normalized ScaleBarcodeSettings
 */
export const normalizeScaleBarcodeSettings = (rawSettings: any = {}): ScaleBarcodeSettings => {
    const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const prefix = String(settings.prefix || "").trim();
    const prefixIncludedRaw = Number(settings.prefix_included_or_not);
    const prefixLengthRaw = Number(settings.no_of_prefix_characters);

    const prefixIncluded = Number.isFinite(prefixIncludedRaw) ? prefixIncludedRaw : 0;
    const prefixLength = Number.isFinite(prefixLengthRaw) ? prefixLengthRaw : 0;
    const whole = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
        prefix,
        prefix_included_or_not: prefixIncluded,
        no_of_prefix_characters: prefixLength,
        item_code_starting_digit: whole(settings.item_code_starting_digit),
        item_code_total_digits: whole(settings.item_code_total_digits),
    };
};

/**
 * Parses the backend response for scale barcode settings.
 * @param response Raw backend response
 * @returns ScaleBarcodeSettings or null
 */
export const parseScaleBarcodeSettingsResponse = (response: any): ScaleBarcodeSettings | null => {
    const message = response && response.message ? response.message : null;
    if (!message) {
        return null;
    }

    if (message.settings) {
        return message.settings as ScaleBarcodeSettings;
    }

    if (typeof message === "object") {
        const hasKey = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
        if (
            hasKey(message, "prefix") ||
            hasKey(message, "prefix_included_or_not") ||
            hasKey(message, "no_of_prefix_characters")
        ) {
            return message as ScaleBarcodeSettings;
        }
    }

    return null;
};

/**
 * Gets the scale barcode prefix from settings.
 * @param settings Scale barcode settings
 * @returns Prefix string
 */
export const getScaleBarcodePrefix = (settings: Partial<ScaleBarcodeSettings> = {}): string => {
    const prefix = settings?.prefix;
    return typeof prefix === "string" ? prefix.trim() : "";
};

/**
 * Checks if a value matches the scale barcode prefix.
 * @param settings Scale barcode settings
 * @param value Barcode value to check
 * @returns boolean
 */
export const scaleBarcodeMatches = (settings: Partial<ScaleBarcodeSettings> = {}, value: string | null | undefined): boolean => {
    const prefix = getScaleBarcodePrefix(settings);
    if (!prefix) {
        return false;
    }
    return String(value || "").startsWith(prefix);
};

/**
 * Could the server read this code as a scale barcode? Same rule as
 * barcode.py _parse_scale_barcode_data: the item-code position must be set,
 * and when a prefix is set the code must start with it. False means asking
 * the server (parse_scale_barcode) can only come back empty, so a scan can
 * skip that round trip. Only use it once the settings have actually been
 * loaded from the server; until then the caller must still ask.
 */
export const mayBeScaleBarcode = (
    settings: Partial<ScaleBarcodeSettings> = {},
    value: string | null | undefined,
): boolean => {
    const code = String(value || "").trim();
    if (!code) return false;
    if (!(Number(settings?.item_code_starting_digit) > 0 && Number(settings?.item_code_total_digits) > 0)) {
        return false;
    }
    const prefix = getScaleBarcodePrefix(settings);
    return !prefix || code.startsWith(prefix);
};
