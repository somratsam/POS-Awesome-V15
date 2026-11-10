import { describe, expect, it } from "vitest";

import {
	addMonths,
	compareRange,
	formatDmy,
	initials,
	monthGrid,
	rangeLabel,
	isIsoDate,
	netChange,
	presetRange,
	rangeDays,
	rangeProblem,
	weekStartIndex,
} from "../src/posapp/utils/salesByCashierPeriods";

describe("Sales by Cashier periods", () => {
	const today = "2026-11-10"; // a Tuesday

	it("builds each preset from the system's today", () => {
		expect(presetRange("today", today)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
		expect(presetRange("yesterday", today)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
		expect(presetRange("this_month", today)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
		expect(presetRange("last_month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(presetRange("custom", today)).toBeNull();
	});

	it("starts the week on the system's first day (Sunday here)", () => {
		expect(weekStartIndex("Sunday")).toBe(0);
		expect(weekStartIndex("Monday")).toBe(1);
		expect(weekStartIndex(undefined)).toBe(0);
		expect(presetRange("this_week", today, 0)).toEqual({ from: "2026-11-08", to: "2026-11-10" });
		expect(presetRange("this_week", today, 1)).toEqual({ from: "2026-11-09", to: "2026-11-10" });
		expect(presetRange("this_week", "2026-11-08", 0)).toEqual({ from: "2026-11-08", to: "2026-11-08" });
	});

	it("crosses year ends", () => {
		expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
		expect(presetRange("yesterday", "2026-01-01")).toEqual({ from: "2025-12-31", to: "2025-12-31" });
	});

	it("Previous period: same days of last month, whole months, or the same length just before", () => {
		const thisMonth = presetRange("this_month", today)!;
		expect(compareRange("previous", thisMonth, "this_month")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
		// 31 Oct this month -> last month has only 30 days.
		expect(compareRange("previous", { from: "2026-10-01", to: "2026-10-31" }, "this_month")).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(compareRange("previous", { from: "2026-03-01", to: "2026-03-30" }, "this_month")).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
		expect(compareRange("previous", { from: "2026-10-01", to: "2026-10-31" }, "last_month")).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(compareRange("previous", { from: "2026-11-10", to: "2026-11-10" }, "today")).toEqual({
			from: "2026-11-09",
			to: "2026-11-09",
		});
		expect(compareRange("previous", { from: "2026-11-08", to: "2026-11-10" }, "this_week")).toEqual({
			from: "2026-11-05",
			to: "2026-11-07",
		});
	});

	it("Same period last year, with 29 February", () => {
		expect(compareRange("last_year", { from: "2026-11-01", to: "2026-11-10" }, "this_month")).toEqual({
			from: "2025-11-01",
			to: "2025-11-10",
		});
		expect(compareRange("last_year", { from: "2028-02-01", to: "2028-02-29" }, "custom")).toEqual({
			from: "2027-02-01",
			to: "2027-02-28",
		});
		expect(compareRange("custom", { from: "2026-11-01", to: "2026-11-10" }, "this_month")).toBeNull();
	});

	it("checks ranges like the server does", () => {
		expect(rangeProblem({ from: "2026-11-01", to: "2026-11-10" })).toBe("");
		expect(rangeProblem({ from: "2026-11-10", to: "2026-11-01" })).toBe("order");
		expect(rangeProblem({ from: "2025-11-01", to: "2026-11-01" })).toBe(""); // 366 days
		expect(rangeProblem({ from: "2025-10-31", to: "2026-11-01" })).toBe("too_long");
		expect(rangeProblem({ from: "", to: "2026-11-01" })).toBe("missing");
		expect(rangeProblem({ from: "2026-02-30", to: "2026-03-01" })).toBe("missing");
		expect(isIsoDate("2028-02-29")).toBe(true);
		expect(rangeDays({ from: "2026-11-01", to: "2026-11-10" })).toBe(10);
	});

	it("change against Period 2", () => {
		expect(netChange(1940.92, 1720.4)).toEqual({ kind: "up", percent: 12.8 });
		expect(netChange(1052.56, 1180)).toEqual({ kind: "down", percent: 10.8 });
		expect(netChange(397.94, 0)).toEqual({ kind: "new", percent: null });
		expect(netChange(0, 0)).toEqual({ kind: "none", percent: null });
		expect(netChange(50, 50)).toEqual({ kind: "same", percent: 0 });
		// A negative Period 2 still gives a sensible direction.
		expect(netChange(10, -20)).toEqual({ kind: "up", percent: 150 });
	});

	it("dates are always dd-mm-yyyy and ranges read naturally", () => {
		expect(formatDmy("2026-11-01")).toBe("01-11-2026");
		expect(rangeLabel({ from: "2026-11-10", to: "2026-11-10" })).toBe("10 Nov 2026");
		expect(rangeLabel({ from: "2026-11-01", to: "2026-11-10" })).toBe("1 – 10 Nov 2026");
		expect(rangeLabel({ from: "2026-10-28", to: "2026-11-03" })).toBe("28 Oct – 3 Nov 2026");
		expect(rangeLabel({ from: "2025-12-28", to: "2026-01-03" })).toBe("28 Dec 2025 – 3 Jan 2026");
	});

	it("month grids start on the week's first day", () => {
		const sunday = monthGrid("2026-11-15", 0);
		expect(sunday.weekdays[0]).toBe("Su");
		expect(sunday.cells.slice(0, 2)).toEqual(["2026-11-01", "2026-11-02"]); // 1 Nov 2026 is a Sunday
		expect(sunday.cells.filter(Boolean)).toHaveLength(30);
		const monday = monthGrid("2026-11-15", 1);
		expect(monday.weekdays[0]).toBe("Mo");
		expect(monday.cells.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
		expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
	});

	it("initials for the avatars", () => {
		expect(initials("Layla Haddad")).toBe("LH");
		expect(initials("Maria Regina lopez")).toBe("ML");
		expect(initials("Fe")).toBe("FE");
		expect(initials("  ")).toBe("?");
	});
});

