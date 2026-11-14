// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (rel: string) => readFileSync(resolve(__dirname, "../src/posapp/components/pos/flows", rel), "utf8");

describe("tick-to-return wiring", () => {
	for (const [file, open, load] of [
		["Returns.vue", "this.pickerOpen = true", "load_picked_return"],
		["InvoiceManagement.vue", "this.returnPickerOpen = true", "loadPickedReturn"],
	]) {
		it(`${file} picks lines before loading the return, skipping it for one line with 1 left`, () => {
			const s = src(file);
			expect(s).toMatch(/<ReturnItemsPicker[\s\S]*?@confirm="(load_picked_return|loadPickedReturn)"/);
			expect(s).toContain(open);
			expect(s).toContain("linesWithoutPicking(");
			// The return is built from the picked lines, not every line of the receipt.
			expect(s).toMatch(new RegExp(`${load}\\(lines\\) \\{[\\s\\S]*?lines\\.(forEach|map)\\(`));
		});
	}

	it("the picker refuses an empty selection and starts from initialReturnPicks", () => {
		const s = src("ReturnItemsPicker.vue");
		expect(s).toContain("initialReturnPicks(returnableLines.value)");
		expect(s).toContain("error.value = __(NOTHING_SELECTED_MESSAGE)");
		expect(s).toContain('emit("confirm", lines)');
	});
});
