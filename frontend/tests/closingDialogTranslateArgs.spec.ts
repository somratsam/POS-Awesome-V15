import { describe, expect, it } from "vitest";
import closingDialogSource from "../src/posapp/components/pos/shell/ClosingDialog.vue?raw";

describe("ClosingDialog gives the Overview a translate that keeps its arguments", () => {
	it('fills "{0}" (e.g. "of which exchanges ({0})")', () => {
		expect(closingDialogSource).toContain("const translate = (t, args) => window.__(t, args);");
		expect(closingDialogSource).not.toContain("const translate = (t) => window.__(t);");
	});
});
