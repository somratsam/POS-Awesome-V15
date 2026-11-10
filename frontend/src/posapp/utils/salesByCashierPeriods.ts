/**
 * Periods for the Sales by Cashier report.
 *
 * All dates are ISO strings (yyyy-mm-dd); "today" is passed in (the till uses
 * frappe.datetime.get_today(), i.e. the system time zone), so nothing here
 * depends on the browser's clock or time zone.
 */

export type PeriodPreset =
	| "today"
	| "yesterday"
	| "this_week"
	| "this_month"
	| "last_month"
	| "custom";

export type ComparePreset = "previous" | "last_year" | "custom";

export interface DateRange {
	from: string;
	to: string;
}

export const MAX_PERIOD_DAYS = 366;

const DAY_MS = 86_400_000;

const pad = (value: number) => String(value).padStart(2, "0");

function parts(iso: string): [number, number, number] {
	const [y = NaN, m = NaN, d = NaN] = iso.split("-").map(Number);
	return [y, m, d];
}

function toIso(y: number, m: number, d: number): string {
	const date = new Date(Date.UTC(y, m - 1, d));
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dayNumber(iso: string): number {
	const [y, m, d] = parts(iso);
	return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function addDays(iso: string, days: number): string {
	const [y, m, d] = parts(iso);
	return toIso(y, m, d + days);
}

export function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Days in a range, both ends included. */
export function rangeDays(range: DateRange): number {
	return dayNumber(range.to) - dayNumber(range.from) + 1;
}

export function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = parts(value);
	return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** System Settings "First Day of the Week" (a name) as 0 = Sunday ... 6. */
export function weekStartIndex(name: unknown): number {
	const index = WEEKDAYS.indexOf(String(name || "").trim().toLowerCase());
	return index >= 0 ? index : 0;
}

export function presetRange(preset: PeriodPreset, today: string, weekStart = 0): DateRange | null {
	const [y, m] = parts(today);
	switch (preset) {
		case "today":
			return { from: today, to: today };
		case "yesterday": {
			const day = addDays(today, -1);
			return { from: day, to: day };
		}
		case "this_week": {
			const weekday = new Date(dayNumber(today) * DAY_MS).getUTCDay();
			const back = (weekday - weekStart + 7) % 7;
			return { from: addDays(today, -back), to: today };
		}
		case "this_month":
			return { from: toIso(y, m, 1), to: today };
		case "last_month":
			return { from: toIso(y, m - 1, 1), to: toIso(y, m, 0) };
		default:
			return null;
	}
}

function shiftYear(iso: string, years: number): string {
	const [y, m, d] = parts(iso);
	return toIso(y + years, m, Math.min(d, daysInMonth(y + years, m)));
}

/**
 * Period 2 for a comparison.
 * - previous: the same days one step back. This month (1-10 Nov) -> 1-10 Oct;
 *   Last month (October) -> all of September; anything else -> the same
 *   number of days just before Period 1.
 * - last_year: the same dates a year earlier (29 Feb -> 28 Feb).
 */
export function compareRange(
	preset: ComparePreset,
	period1: DateRange,
	period1Preset: PeriodPreset,
): DateRange | null {
	if (preset === "last_year") {
		return { from: shiftYear(period1.from, -1), to: shiftYear(period1.to, -1) };
	}
	if (preset !== "previous") return null;

	const [fy, fm] = parts(period1.from);
	if (period1Preset === "this_month") {
		const [, , td] = parts(period1.to);
		return {
			from: toIso(fy, fm - 1, 1),
			to: toIso(fy, fm - 1, Math.min(td, daysInMonth(fy, fm - 1))),
		};
	}
	if (period1Preset === "last_month") {
		return { from: toIso(fy, fm - 1, 1), to: toIso(fy, fm, 0) };
	}
	const length = rangeDays(period1);
	const to = addDays(period1.from, -1);
	return { from: addDays(to, -(length - 1)), to };
}

/** Why a range can't be asked for, or "" when it is fine. */
export function rangeProblem(range: Partial<DateRange> | null | undefined): "" | "missing" | "order" | "too_long" {
	if (!range || !isIsoDate(range.from) || !isIsoDate(range.to)) return "missing";
	if (range.from > range.to) return "order";
	if (rangeDays(range as DateRange) > MAX_PERIOD_DAYS) return "too_long";
	return "";
}

export type ChangeKind = "up" | "down" | "same" | "new" | "none";

/** Period 1 against Period 2, as a percentage of Period 2. */
export function netChange(period1: number, period2: number): { kind: ChangeKind; percent: number | null } {
	const a = Number(period1) || 0;
	const b = Number(period2) || 0;
	if (Math.abs(b) < 0.0005) {
		return Math.abs(a) < 0.0005 ? { kind: "none", percent: null } : { kind: "new", percent: null };
	}
	const percent = Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
	if (percent > 0) return { kind: "up", percent };
	if (percent < 0) return { kind: "down", percent: -percent };
	return { kind: "same", percent: 0 };
}

// ---------------------------------------------------------------------------
// Display helpers for the full-screen view (always dd-mm-yyyy, whatever the
// browser's language).

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const WEEKDAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** 2026-11-01 -> 01-11-2026 */
export function formatDmy(iso: string): string {
	const [y, m, d] = parts(iso);
	return `${pad(d)}-${pad(m)}-${y}`;
}

/** "10 Nov 2026", "1 – 10 Nov 2026", "28 Oct – 3 Nov 2026", "28 Dec 2025 – 3 Jan 2026" */
export function rangeLabel(range: DateRange, months: string[] = MONTHS_SHORT): string {
	const [fy, fm, fd] = parts(range.from);
	const [ty, tm, td] = parts(range.to);
	if (range.from === range.to) return `${fd} ${months[fm - 1]} ${fy}`;
	if (fy === ty && fm === tm) return `${fd} – ${td} ${months[tm - 1]} ${ty}`;
	if (fy === ty) return `${fd} ${months[fm - 1]} – ${td} ${months[tm - 1]} ${ty}`;
	return `${fd} ${months[fm - 1]} ${fy} – ${td} ${months[tm - 1]} ${ty}`;
}

/** First day of the month n months after the month of iso. */
export function addMonths(iso: string, n: number): string {
	const [y, m] = parts(iso);
	return toIso(y, m + n, 1);
}

export interface MonthGrid {
	year: number;
	month: number; // 1-12
	weekdays: string[];
	cells: Array<string | null>; // leading nulls, then every day of the month
}

/** One calendar month, weeks starting on weekStart (0 = Sunday). */
export function monthGrid(anyDayOfMonth: string, weekStart = 0): MonthGrid {
	const [y, m] = parts(anyDayOfMonth);
	const first = toIso(y, m, 1);
	const firstWeekday = new Date(dayNumber(first) * DAY_MS).getUTCDay();
	const lead = (firstWeekday - weekStart + 7) % 7;
	const cells: Array<string | null> = Array.from({ length: lead }, () => null);
	for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(toIso(y, m, d));
	const weekdays = WEEKDAYS_SHORT.map((_, i) => WEEKDAYS_SHORT[(i + weekStart) % 7] as string);
	return { year: y, month: m, weekdays, cells };
}

/** "Layla Haddad" -> "LH", "Aziz" -> "AZ" */
export function initials(name: string): string {
	const words = String(name || "").trim().split(/\s+/).filter(Boolean);
	if (!words.length) return "?";
	const first = words[0] as string;
	if (words.length === 1) return first.slice(0, 2).toUpperCase();
	const last = words[words.length - 1] as string;
	return (first.charAt(0) + last.charAt(0)).toUpperCase();
}
