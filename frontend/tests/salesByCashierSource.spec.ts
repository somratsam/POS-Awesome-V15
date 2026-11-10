import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../src/posapp/${path}`, import.meta.url), "utf8");

// The menu item only works if its one caller forwards the event and Pos
// actually mounts the dialog (a prop/event declared correctly in isolation
// proves nothing about the callers).
describe("Sales by Cashier callers", () => {
	it("Navbar forwards open-sales-by-cashier to the store", () => {
		expect(source("components/Navbar.vue")).toMatch(
			/<NavbarMenu[\s\S]*?@open-sales-by-cashier="uiStore\.openSalesByCashier\(\)"[\s\S]*?\/>/,
		);
	});

	it("Pos imports, registers and mounts the dialog", () => {
		const pos = source("components/pos/shell/Pos.vue");
		expect(pos).toContain("<SalesByCashierDialog></SalesByCashierDialog>");
		expect(pos).toContain('import SalesByCashierDialog from "../reports/SalesByCashierDialog.vue";');
		expect(pos).toMatch(/components:\s*{[\s\S]*SalesByCashierDialog,[\s\S]*}/);
	});
});
