// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	NOTHING_SELECTED_MESSAGE,
	buildPickedReturnTotal,
	clampReturnQty,
	initialReturnPicks,
	linesWithoutPicking,
	pickedCount,
	pickedReturnLines,
	setPicked,
	setPickedQty,
} from "../src/posapp/utils/returnItemSelection";

const line = (name: string, qty: number, rate = 10, extra: Record<string, any> = {}) => ({
	name,
	item_code: `IT-${name}`,
	qty,
	rate,
	net_rate: rate,
	conversion_factor: 1,
	amount: rate * 5, // the original line's amount, for its full original quantity
	...extra,
});

describe("tick-to-return selection", () => {
	it("starts with nothing selected", () => {
		const picks = initialReturnPicks([line("a", 1), line("b", 2)]);
		expect(picks.map((p) => [p.selected, p.qty, p.max])).toEqual([
			[false, 0, 1],
			[false, 0, 2],
		]);
		expect(pickedCount(picks)).toBe(0);
		expect(pickedReturnLines([line("a", 1), line("b", 2)], picks)).toEqual([]);
	});

	it("a one-line receipt comes ticked at its full returnable quantity", () => {
		expect(initialReturnPicks([line("a", 3)])).toEqual([{ name: "a", selected: true, qty: 3, max: 3 }]);
	});

	it("leaves out lines with nothing left to return", () => {
		expect(initialReturnPicks([line("a", 0), line("b", 2)]).map((p) => p.name)).toEqual(["b"]);
	});

	it("ticking returns 1; unticking returns none", () => {
		const [pick] = initialReturnPicks([line("a", 4), line("b", 1)]);
		const ticked = setPicked(pick, true);
		expect([ticked.selected, ticked.qty]).toEqual([true, 1]);
		expect([setPicked(ticked, false).selected, setPicked(ticked, false).qty]).toEqual([false, 0]);
	});

	it("never more than what is still returnable; 0 unticks", () => {
		const [pick] = initialReturnPicks([line("a", 2), line("b", 1)]);
		expect(setPickedQty(pick, 5).qty).toBe(2);
		expect(setPickedQty(pick, -3)).toMatchObject({ qty: 0, selected: false });
		expect(setPickedQty(pick, 1)).toMatchObject({ qty: 1, selected: true });
		expect(clampReturnQty("abc", 2)).toBe(0);
	});

	it("returns only the ticked lines, with amounts for the chosen quantity and the original price", () => {
		const lines = [line("a", 3, 20, { discount_percentage: 10 }), line("b", 1, 7)];
		const picks = initialReturnPicks(lines).map((p) => (p.name === "a" ? setPickedQty(p, 2) : p));
		const picked = pickedReturnLines(lines, picks);
		expect(picked).toHaveLength(1);
		expect(picked[0]).toMatchObject({ name: "a", qty: 2, stock_qty: 2, rate: 20, amount: 40, net_amount: 40, discount_percentage: 10 });
	});

	it("a picked quantity above what is returnable is cut back", () => {
		const lines = [line("a", 1), line("b", 1)];
		const picked = pickedReturnLines(lines, [{ name: "a", selected: true, qty: 9, max: 9 }]);
		expect(picked[0].qty).toBe(1);
	});

	it("one line with 1 left skips the step; 2 or more, or several lines, don't", () => {
		expect(linesWithoutPicking([line("a", 1)])?.map((l) => [l.name, l.qty])).toEqual([["a", 1]]);
		expect(linesWithoutPicking([line("a", 2)])).toBeNull();
		expect(linesWithoutPicking([line("a", 1), line("b", 1)])).toBeNull();
		expect(linesWithoutPicking([line("a", 1), line("b", 0)])?.map((l) => l.name)).toEqual(["a"]);
	});

	it("grand total before recalculation is the picked share, tax included", () => {
		expect(buildPickedReturnTotal({ grand_total: 147, total: 140 }, [{ name: "a", amount: 70 }])).toBeCloseTo(73.5, 6);
		expect(buildPickedReturnTotal(null, [{ name: "a", amount: 70 }])).toBe(70);
	});

	it("the refusal message", () => {
		expect(NOTHING_SELECTED_MESSAGE).toBe("Select at least one item to return");
	});
});
