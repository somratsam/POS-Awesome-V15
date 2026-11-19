// Counting what clearing the till's saved data would lose.
import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = vi.hoisted(() => ({
	initPromise: Promise.resolve(),
	getPendingOfflineInvoiceCount: vi.fn(() => 0),
	getPendingInvoiceOutboxCount: vi.fn(async () => 0),
	getPendingOfflineCustomerCount: vi.fn(() => 0),
	getPendingOfflinePaymentCount: vi.fn(() => 0),
	getPendingOfflineCashMovementCount: vi.fn(() => 0),
}));
vi.mock("../src/offline/index", () => offline);

import { countUnsentOfflineWork } from "../src/utils/unsentOfflineWork";

beforeEach(() => {
	offline.getPendingOfflineInvoiceCount.mockReturnValue(0);
	offline.getPendingInvoiceOutboxCount.mockResolvedValue(0);
	offline.getPendingOfflineCustomerCount.mockReturnValue(0);
	offline.getPendingOfflinePaymentCount.mockReturnValue(0);
	offline.getPendingOfflineCashMovementCount.mockReturnValue(0);
});

describe("countUnsentOfflineWork", () => {
	it("is 0 / 0 when nothing waits", async () => {
		await expect(countUnsentOfflineWork()).resolves.toEqual({ sales: 0, other: 0 });
	});

	it("counts sales waiting in the legacy queue only", async () => {
		offline.getPendingOfflineInvoiceCount.mockReturnValue(2);
		await expect(countUnsentOfflineWork()).resolves.toEqual({ sales: 2, other: 0 });
	});

	it("counts sales waiting in the outbox only", async () => {
		offline.getPendingInvoiceOutboxCount.mockResolvedValue(4);
		await expect(countUnsentOfflineWork()).resolves.toEqual({ sales: 4, other: 0 });
	});

	it("takes the larger of the two, not the sum (a sale can sit in both)", async () => {
		offline.getPendingOfflineInvoiceCount.mockReturnValue(3);
		offline.getPendingInvoiceOutboxCount.mockResolvedValue(3);
		await expect(countUnsentOfflineWork()).resolves.toEqual({ sales: 3, other: 0 });
	});

	it("adds customers, payments and cash movements as other records", async () => {
		offline.getPendingOfflineCustomerCount.mockReturnValue(1);
		offline.getPendingOfflinePaymentCount.mockReturnValue(2);
		offline.getPendingOfflineCashMovementCount.mockReturnValue(3);
		await expect(countUnsentOfflineWork()).resolves.toEqual({ sales: 0, other: 6 });
	});
});
