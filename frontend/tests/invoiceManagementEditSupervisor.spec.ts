// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({ isDark: { value: false } }),
}));

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({ windowWidth: { value: 1400 } }),
}));

vi.mock("../src/offline/index", () => ({
	isOffline: () => false,
}));

vi.mock("../src/posapp/plugins/print", () => ({
	appendDebugPrintParam: (url: string) => url,
	isDebugPrintEnabled: () => false,
	silentPrint: vi.fn(),
	watchPrintWindow: vi.fn(),
}));

vi.mock("../src/posapp/services/qzTray", () => ({
	printDocumentViaQz: vi.fn(),
}));

import InvoiceManagement from "../src/posapp/components/pos/flows/InvoiceManagement.vue";

const SUPERVISOR_REASON = "Only a POS supervisor can edit a submitted invoice.";
const methods = (InvoiceManagement as any).methods;

function context(overrides: Record<string, any> = {}) {
	const ctx: Record<string, any> = {
		toastStore: { show: vi.fn() },
		editScopeArgs: (invoice: any) => ({ doctype: "Sales Invoice", name: invoice.name }),
		cloneForEdit: (doc: any) => ({ ...doc }),
		syncEditPaymentsToCorrectedTotal: vi.fn(),
		seedEditCustomerItems: vi.fn(),
		setDefaultEditKeyboardTarget: vi.fn(),
		scheduleEditPreview: vi.fn(),
		$nextTick: (fn: () => void) => fn(),
		...overrides,
	};
	for (const name of [
		"canEditSubmittedInvoice",
		"showEditInvoiceAction",
		"editInvoiceActionTitle",
		"openEditInvoice",
		"closeEditInvoice",
		"clearScheduledEditPreview",
		"clearEditCustomerSearch",
	]) {
		if (methods[name] && !ctx[name]) ctx[name] = methods[name].bind(ctx);
	}
	return ctx;
}

describe("InvoiceManagement.vue: Edit Invoice is for POS supervisors only", () => {
	beforeEach(() => {
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).frappe = { call: vi.fn() };
	});

	it("shows an active pencil to a supervisor", () => {
		const ctx = context();
		const invoice = { name: "SINV-1", can_edit_submitted_invoice: 1 };
		expect(ctx.showEditInvoiceAction(invoice)).toBe(true);
		expect(ctx.canEditSubmittedInvoice(invoice)).toBe(true);
		expect(ctx.editInvoiceActionTitle(invoice)).toBe("Edit Invoice");
	});

	it("shows a cashier a greyed pencil whose tooltip says a supervisor is needed", () => {
		const ctx = context();
		const invoice = {
			name: "SINV-1",
			can_edit_submitted_invoice: 0,
			edit_requires_supervisor: 1,
			edit_block_reason: SUPERVISOR_REASON,
		};
		expect(ctx.showEditInvoiceAction(invoice)).toBe(true);
		expect(ctx.canEditSubmittedInvoice(invoice)).toBe(false);
		expect(ctx.editInvoiceActionTitle(invoice)).toBe(SUPERVISOR_REASON);
	});

	it("still hides the pencil when the invoice itself can't be edited", () => {
		const ctx = context();
		const invoice = {
			name: "SINV-1",
			can_edit_submitted_invoice: 0,
			edit_requires_supervisor: 0,
			edit_block_reason: "This invoice is outside the 24-hour edit window.",
		};
		expect(ctx.showEditInvoiceAction(invoice)).toBe(false);
	});

	it("asks the server again when a cashier clicks, and shows the supervisor message if refused", async () => {
		const ctx = context();
		(globalThis as any).frappe.call = vi.fn(async () => {
			throw { readyState: 4, status: 403 };
		});
		const invoice = {
			name: "SINV-1",
			can_edit_submitted_invoice: 0,
			edit_requires_supervisor: 1,
			edit_block_reason: SUPERVISOR_REASON,
		};

		await ctx.openEditInvoice(invoice);

		expect((globalThis as any).frappe.call).toHaveBeenCalledWith(
			expect.objectContaining({ method: expect.stringContaining("get_submitted_invoice_for_edit") }),
		);
		expect(ctx.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: SUPERVISOR_REASON, color: "error" }),
		);
		expect(ctx.editDialog).toBe(false);
	});

	it("opens the dialog when the server now allows it (till switched to a supervisor by PIN)", async () => {
		const ctx = context();
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: {
				invoice: { name: "SINV-1", customer: "CUST-1", items: [], payments: [] },
				metadata: { can_edit_submitted_invoice: true, edit_authorized_by: "boss@test.invalid" },
			},
		}));

		await ctx.openEditInvoice({
			name: "SINV-1",
			can_edit_submitted_invoice: 0,
			edit_requires_supervisor: 1,
			edit_block_reason: SUPERVISOR_REASON,
		});

		expect(ctx.editDialog).toBe(true);
		expect(ctx.editInvoiceDoc?.name).toBe("SINV-1");
		expect(ctx.editEligibility?.edit_authorized_by).toBe("boss@test.invalid");
	});

	it("does not call the server for an invoice blocked for other reasons", async () => {
		const ctx = context();
		await ctx.openEditInvoice({
			name: "SINV-1",
			can_edit_submitted_invoice: 0,
			edit_requires_supervisor: 0,
			edit_block_reason: "This invoice already has a submitted return or credit note.",
		});
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
		expect(ctx.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ color: "warning" }),
		);
	});
});
