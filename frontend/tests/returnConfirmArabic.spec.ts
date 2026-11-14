// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Return confirmation and voucher prompt: Arabic", () => {
	it("has a translation for every new string", () => {
		const arabic = readFileSync(resolve(process.cwd(), "../posawesome/translations/ar.csv"), "utf8");
		for (const text of [
			"Submit this return?",
			"Items going back to stock: {0}",
			"{0} becomes store credit for {1}.",
			"the customer",
			"This can't be undone at the till.",
			"Then: start the customer's new sale",
			"Then: print the credit note voucher",
			"Submit return → Exchange",
			"Submit return → Credit note",
			"Print the credit note voucher?",
			"Return {0} is submitted. {1} has {2} store credit from it that has not been used.",
			"Print it now so the customer can use it later.",
			"Not now",
			"Print credit note voucher",
			"The credit note voucher couldn't be printed. Reprint it from Invoice Management.",
		]) {
			expect(arabic, text).toContain(`\n${text},`);
		}
	});
});
