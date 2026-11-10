// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import SalesByCashierCalendar from "../src/posapp/components/pos/reports/SalesByCashierCalendar.vue";

const T = (id: string) => `[data-testid="${id}"]`;

describe("Sales by Cashier range calendar", () => {
	beforeEach(() => {
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
	});

	const make = (props: Record<string, any> = {}) => {
		const onPick = vi.fn();
		const wrapper = mount(SalesByCashierCalendar, {
			props: { range: { from: "2026-11-01", to: "2026-11-10" }, today: "2026-11-10", months: 2, weekStart: 0, onPick, ...props },
			global: { mocks: { __: (text: string, args?: any[]) => (window as any).__(text, args) } },
		});
		return { wrapper, onPick };
	};

	it("shows two months ending with the range's month, dd-mm-yyyy readouts and the hint", () => {
		const { wrapper } = make();
		expect(wrapper.findAll(T("sbc-cal-month")).map((m) => m.text())).toEqual(["October 2026", "November 2026"]);
		expect(wrapper.get(T("sbc-cal-from")).text()).toBe("01-11-2026");
		expect(wrapper.get(T("sbc-cal-to")).text()).toBe("10-11-2026");
		expect(wrapper.get(T("sbc-cal-hint")).text()).toBe("Tap the first day, then the last day.");
		expect(wrapper.get('[data-day="2026-11-01"]').classes()).toContain("sbc-cal__day--start");
		expect(wrapper.get('[data-day="2026-11-10"]').classes()).toEqual(
			expect.arrayContaining(["sbc-cal__day--end", "sbc-cal__day--today"]),
		);
		expect(wrapper.get('[data-day="2026-11-05"]').classes()).toContain("sbc-cal__day--in");
	});

	it("days after today can't be picked", async () => {
		const { wrapper, onPick } = make();
		expect(wrapper.get('[data-day="2026-11-11"]').attributes("disabled")).toBeDefined();
		expect(wrapper.get('[data-day="2026-11-10"]').attributes("disabled")).toBeUndefined();
		await wrapper.get('[data-day="2026-11-11"]').trigger("click");
		expect(wrapper.get(T("sbc-cal-hint")).text()).toBe("Tap the first day, then the last day.");
		expect(onPick).not.toHaveBeenCalled();
	});

	it("picks in either order, previewing the range on hover", async () => {
		const { wrapper, onPick } = make();
		await wrapper.get('[data-day="2026-10-25"]').trigger("click");
		expect(wrapper.get(T("sbc-cal-hint")).text()).toBe("Now tap the last day.");
		await wrapper.get('[data-day="2026-10-20"]').trigger("mouseenter");
		expect(wrapper.get(T("sbc-cal-from")).text()).toBe("20-10-2026");
		expect(wrapper.get(T("sbc-cal-to")).text()).toBe("25-10-2026");
		await wrapper.get('[data-day="2026-10-12"]').trigger("click");
		expect(onPick).toHaveBeenCalledWith({ from: "2026-10-12", to: "2026-10-25" });
	});

	it("a period longer than one year is refused with a message", async () => {
		const { wrapper, onPick } = make();
		(wrapper.vm as any).pick("2025-01-01");
		(wrapper.vm as any).pick("2026-11-10");
		await wrapper.vm.$nextTick();
		expect(onPick).not.toHaveBeenCalled();
		expect(wrapper.get(T("sbc-cal-hint")).text()).toBe("Choose a period of one year or less.");
		expect(wrapper.get(T("sbc-cal-hint")).classes()).toContain("sbc-cal__hint--error");
		// 366 days is fine.
		(wrapper.vm as any).pick("2025-11-10");
		(wrapper.vm as any).pick("2026-11-10");
		expect(onPick).toHaveBeenCalledWith({ from: "2025-11-10", to: "2026-11-10" });
	});

	it("moves month by month and starts the week on the system's first day", async () => {
		const { wrapper } = make({ months: 1, weekStart: 1 });
		expect(wrapper.findAll(T("sbc-cal-month")).map((m) => m.text())).toEqual(["November 2026"]);
		expect(wrapper.findAll(".sbc-cal__wd").map((d) => d.text())).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
		await wrapper.get(T("sbc-cal-prev")).trigger("click");
		expect(wrapper.get(T("sbc-cal-month")).text()).toBe("October 2026");
		await wrapper.get(T("sbc-cal-next")).trigger("click");
		await wrapper.get(T("sbc-cal-next")).trigger("click");
		expect(wrapper.get(T("sbc-cal-month")).text()).toBe("December 2026");
	});
});
