// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

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

describe("InvoiceManagement Exchange/Credit Note badge color", () => {
	const exchangeCreditBadgeColor = (InvoiceManagement as any).methods.exchangeCreditBadgeColor;

	it('colors "Exchange" distinctly from "Credit Note"', () => {
		expect(exchangeCreditBadgeColor("Exchange")).toBe("info");
		expect(exchangeCreditBadgeColor("Credit Note")).toBe("warning");
		expect(exchangeCreditBadgeColor("Exchange")).not.toBe(exchangeCreditBadgeColor("Credit Note"));
	});

	it("falls back to a neutral color for an unrecognized/absent badge value rather than throwing", () => {
		expect(exchangeCreditBadgeColor(null)).toBe("secondary");
		expect(exchangeCreditBadgeColor(undefined)).toBe("secondary");
		expect(exchangeCreditBadgeColor("something-unexpected")).toBe("secondary");
	});
});
