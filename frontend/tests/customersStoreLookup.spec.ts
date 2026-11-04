import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useCustomersStore } from "../src/posapp/stores/customersStore";

const setCustomerStorageMock = vi.fn(async () => undefined);
const customerTableToArrayMock = vi.fn(async () => []);

vi.mock("../src/offline/index", () => ({
	db: {
		isOpen: () => true,
		open: vi.fn(async () => undefined),
		table: vi.fn(() => {
			const collection = {
				where: vi.fn(),
				startsWith: vi.fn(),
				filter: vi.fn(),
				offset: vi.fn(),
				limit: vi.fn(),
				toArray: (...args: any[]) => customerTableToArrayMock(...args),
			};
			collection.where.mockReturnValue(collection);
			collection.startsWith.mockReturnValue(collection);
			collection.filter.mockReturnValue(collection);
			collection.offset.mockReturnValue(collection);
			collection.limit.mockReturnValue(collection);
			return collection;
		}),
	},
	checkDbHealth: vi.fn(async () => undefined),
	setCustomerStorage: (...args: any[]) => setCustomerStorageMock(...args),
	saveStoredValueSnapshot: vi.fn(),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));

describe("customersStore.lookupCustomers (edit-dialog customer picker)", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		setCustomerStorageMock.mockClear();
		customerTableToArrayMock.mockReset();
		customerTableToArrayMock.mockResolvedValue([]);
		(globalThis as any).frappe = { call: vi.fn() };
	});

	it("returns name matches without changing the main customer box's results", async () => {
		const store = useCustomersStore();
		const before = [{ name: "CUST-MAIN", customer_name: "Shown In Main Box" }];
		store.customers = before;
		store.searchTerm = "Shown";
		customerTableToArrayMock.mockResolvedValue([
			{ name: "CUST-001", customer_name: "Fatima Ali", mobile_no: "99111001" },
		]);

		const results = await store.lookupCustomers("Fatima");

		expect(results).toEqual([expect.objectContaining({ name: "CUST-001", mobile_no: "99111001" })]);
		expect(store.customers).toEqual(before);
		expect(store.searchTerm).toBe("Shown");
	});

	it("finds a customer by mobile number", async () => {
		const store = useCustomersStore();
		customerTableToArrayMock.mockResolvedValue([
			{ name: "CUST-002", customer_name: "Fatima Ali", mobile_no: "+968 9911 1002" },
		]);

		const results = await store.lookupCustomers("99111002");

		expect(results).toEqual([expect.objectContaining({ name: "CUST-002" })]);
	});

	it("asks the server for a mobile number that is not cached locally", async () => {
		const store = useCustomersStore();
		store.setPosProfile({ name: "Main POS", company: "Test Co" });
		(globalThis as any).frappe.call = vi.fn((request: any) => {
			if (request.method.endsWith("search_customers")) {
				request.callback?.({
					message: [{ name: "CUST-REMOTE", customer_name: "Remote", mobile_no: "99111003" }],
				});
			}
		});

		const results = await store.lookupCustomers("99111003");

		expect(results).toEqual([expect.objectContaining({ name: "CUST-REMOTE" })]);
		expect(setCustomerStorageMock).toHaveBeenCalledWith([expect.objectContaining({ name: "CUST-REMOTE" })]);
		expect(store.customers).toEqual([]);
	});

	it("caps the number of results", async () => {
		const store = useCustomersStore();
		customerTableToArrayMock.mockResolvedValue(
			Array.from({ length: 30 }, (_, i) => ({ name: `CUST-${i}`, customer_name: `Ali ${i}` })),
		);

		expect(await store.lookupCustomers("Ali", 5)).toHaveLength(5);
	});
});
