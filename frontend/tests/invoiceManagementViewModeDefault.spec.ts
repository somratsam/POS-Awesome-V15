// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/composables/core/useTheme", () => ({
	useTheme: () => ({
		isDark: { value: false },
	}),
}));

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({
		windowWidth: { value: 1400 },
	}),
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

describe("InvoiceManagement view mode hard default", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = {
			call: vi.fn(),
			datetime: {
				get_today: () => "2026-04-05",
			},
		};
	});

	it("defaults viewMode to 'list' in the component's own data", () => {
		const data = (InvoiceManagement as any).data();
		expect(data.viewMode).toBe("list");
	});

	it("resets viewMode to 'list' every time the dialog opens, even if it was left on 'card'", () => {
		const context = {
			viewMode: "card",
			activeTab: "history",
			invoiceManagementTargetTab: "",
			draftSource: "invoice",
			posProfile: null,
			uiStore: { invoiceManagementDraftSource: null },
			initializeSupervisorProfileScope: vi.fn(),
			loadSupervisorPosProfiles: vi.fn(),
			refreshAll: vi.fn(),
			resetPagination: vi.fn(),
		};

		(InvoiceManagement as any).watch.invoiceManagementDialog.call(context, true);

		expect(context.viewMode).toBe("list");
	});

	it("does not touch viewMode when the dialog closes", () => {
		const context = {
			viewMode: "card",
			resetPagination: vi.fn(),
		};

		(InvoiceManagement as any).watch.invoiceManagementDialog.call(context, false);

		expect(context.viewMode).toBe("card");
		expect(context.resetPagination).toHaveBeenCalledOnce();
	});
});
