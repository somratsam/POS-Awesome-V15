import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("POS Sales Person on a return: wiring", () => {
	it("Payments tells the Sales Person field when a return follows the original sale", () => {
		const source = readFileSync(resolve(process.cwd(), "src/posapp/components/pos/Payments.vue"), "utf8");
		const block = source.slice(source.indexOf("<PaymentSelectionFields"), source.indexOf("/>", source.indexOf("<PaymentSelectionFields")));
		expect(block).toContain(':follows-original="!!(invoice_doc?.is_return && invoice_doc?.return_against)"');
	});
});
