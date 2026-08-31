import { describe, expect, it } from "vitest";

import { canShowSystemStatus } from "../src/posapp/utils/systemStatusPermission";

const context = (user: string, roles: string[]) => ({
	session: { user },
	boot: { user: { roles } },
});

describe("system status panel visibility", () => {
	it("hides the panel from guests and ordinary cashiers", () => {
		expect(
			canShowSystemStatus(context("Guest", ["System Manager"])),
		).toBe(false);
		expect(
			canShowSystemStatus(
				context("cashier@example.com", ["POS Awesome User"]),
			),
		).toBe(false);
	});

	it("gives no special treatment to other management-flavored roles", () => {
		for (const role of ["Accounts Manager", "Sales Manager", "Stock Manager", "POS Manager"]) {
			expect(
				canShowSystemStatus(context("manager@example.com", [role])),
			).toBe(false);
		}
	});

	it("shows the panel for System Manager", () => {
		expect(
			canShowSystemStatus(
				context("manager@example.com", ["System Manager"]),
			),
		).toBe(true);
	});

	it("always shows the panel for Administrator, even with no roles listed", () => {
		expect(canShowSystemStatus(context("Administrator", []))).toBe(true);
	});
});
