import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import type {
	CustomerInfo,
	CustomerSummary,
	StoredCustomer,
} from "../src/posapp/types/models";

const setCustomerStorageMock = vi.fn(async () => undefined);
const saveStoredValueSnapshotMock = vi.fn();
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
	saveStoredValueSnapshot: (...args: any[]) =>
		saveStoredValueSnapshotMock(...args),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));

describe("customersStore profile and customer dto handling", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		setCustomerStorageMock.mockClear();
		saveStoredValueSnapshotMock.mockClear();
		customerTableToArrayMock.mockClear();
		customerTableToArrayMock.mockResolvedValue([]);
		(globalThis as any).frappe = {
			call: vi.fn(),
		};
	});

	it("normalizes a wrapped pos_profile string into a profile name", () => {
		const store = useCustomersStore();

		store.setPosProfile({ pos_profile: "Main POS" });

		expect(store.posProfile?.name).toBe("Main POS");
	});

	it("accepts additive customer summary and info shapes through public store APIs", async () => {
		const store = useCustomersStore();
		store.setPosProfile({ name: "Main POS", company: "Test Co" });

		const customer: StoredCustomer = {
			name: "CUST-001",
			customer_name: "Customer One",
		};
		const info: CustomerInfo = {
			name: "CUST-001",
			stored_value_balance: 0,
			loyalty_points: 15,
		};

		await store.addOrUpdateCustomer(customer);
		store.setCustomerInfo(info);

		expect(store.customers).toEqual([
			expect.objectContaining({
				...customer,
				loyalty_points: 15,
				stored_value_balance: 0,
			}),
		]);
		expect(store.customerInfo).toEqual(info);
		expectTypeOf(store.customers).toEqualTypeOf<CustomerSummary[]>();
		expect(setCustomerStorageMock).toHaveBeenCalledWith([customer]);
	});

	it("adds fetched customer info to the visible selector list", () => {
		const store = useCustomersStore();
		const info: CustomerInfo = {
			name: "CUST-QUOTE",
			customer_name: "Quotation Customer",
			email_id: "quote@example.com",
		};

		store.setCustomerInfo(info);

		expect(store.customers).toContainEqual({
			name: "CUST-QUOTE",
			customer_name: "Quotation Customer",
			email_id: "quote@example.com",
		});
	});

	it("marks customer info fresh for the exact customer setCustomerInfo() was just called with", () => {
		const store = useCustomersStore();

		expect(store.isCustomerInfoFresh("CUST-001", 30000)).toBe(false);

		store.setCustomerInfo({ name: "CUST-001", customer_name: "Customer One" });

		expect(store.isCustomerInfoFresh("CUST-001", 30000)).toBe(true);
		// A different customer's info was never fetched -- not fresh.
		expect(store.isCustomerInfoFresh("CUST-002", 30000)).toBe(false);
	});

	it("treats customer info as stale once the freshness window elapses", () => {
		vi.useFakeTimers();
		try {
			const store = useCustomersStore();
			store.setCustomerInfo({ name: "CUST-001", customer_name: "Customer One" });

			expect(store.isCustomerInfoFresh("CUST-001", 30000)).toBe(true);

			vi.advanceTimersByTime(30001);

			expect(store.isCustomerInfoFresh("CUST-001", 30000)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("re-stamps freshness for the newly-fetched customer when the customer changes", () => {
		const store = useCustomersStore();
		store.setCustomerInfo({ name: "CUST-001", customer_name: "Customer One" });
		store.setCustomerInfo({ name: "CUST-002", customer_name: "Customer Two" });

		expect(store.isCustomerInfoFresh("CUST-002", 30000)).toBe(true);
		expect(store.isCustomerInfoFresh("CUST-001", 30000)).toBe(false);
	});

	it("executes customer searches while the background sync is running", async () => {
		const store = useCustomersStore();
		store.isCustomerBackgroundLoading = true;
		customerTableToArrayMock.mockResolvedValue([
			{ name: "CUST-001", customer_name: "Jane Doe" },
		]);

		await store.queueSearch("Jane");

		expect(customerTableToArrayMock).toHaveBeenCalledOnce();
		expect(store.customers).toEqual([
			{ name: "CUST-001", customer_name: "Jane Doe" },
		]);
	});

	it("uses normalized indexed mobile search while background sync is running", async () => {
		const store = useCustomersStore();
		store.isCustomerBackgroundLoading = true;
		customerTableToArrayMock.mockResolvedValue([
			{
				name: "CUST-001",
				customer_name: "Jane Doe",
				mobile_no: "+92 300-1234567",
			},
		]);

		await store.queueSearch("03001234567");

		expect(store.customers).toEqual([
			expect.objectContaining({ name: "CUST-001" }),
		]);
	});

	it("falls back to the server when a mobile match is not in the local cache", async () => {
		const store = useCustomersStore();
		store.setPosProfile({ name: "Main POS", company: "Test Co" });
		customerTableToArrayMock.mockResolvedValue([]);
		(globalThis as any).frappe.call = vi.fn((request: any) => {
			if (request.method.endsWith("search_customers")) {
				request.callback?.({
					message: [
						{
							name: "CUST-REMOTE",
							customer_name: "Remote Customer",
							mobile_no: "+92 300-1234567",
						},
					],
				});
			}
		});

		await store.queueSearch("03001234567");

		expect(store.customers).toEqual([
			expect.objectContaining({ name: "CUST-REMOTE" }),
		]);
		expect(setCustomerStorageMock).toHaveBeenCalledWith([
			expect.objectContaining({ name: "CUST-REMOTE" }),
		]);
	});

	it("loads customers in five parallel 200-row pages with smooth progress", async () => {
		const store = useCustomersStore();
		store.setPosProfile({ name: "Main POS", company: "Test Co" });
		const catalog = Array.from({ length: 450 }, (_, index) => ({
			name: `CUST-${String(index + 1).padStart(4, "0")}`,
			customer_name: `Customer ${index + 1}`,
		}));
		const observedCounts: number[] = [];
		const stopWatching = watch(
			() => store.loadedCustomerCount,
			(value) => observedCounts.push(value),
			{ flush: "sync" },
		);

		(globalThis as any).frappe.call = vi.fn(async (request: any) => {
			if (
				request.method ===
				"posawesome.posawesome.api.customers.get_customers_count"
			) {
				return { message: catalog.length };
			}
			const { offset = 0, limit = 200 } = request.args;
			const response = {
				message: catalog.slice(offset, offset + limit),
			};
			request.callback?.(response);
			return response;
		});

		await store.get_customer_names();
		await vi.waitFor(() => {
			expect(store.loadProgress).toBe(100);
		});
		stopWatching();

		const customerCalls = (globalThis as any).frappe.call.mock.calls
			.map(([request]: any[]) => request)
			.filter((request: any) =>
				request.method.endsWith("get_customer_names"),
			);
		expect(
			customerCalls
				.slice(0, 6)
				.map((request: any) => request.args.offset),
		).toEqual([null, 200, 400, 600, 800, 1000]);
		expect(store.loadedCustomerCount).toBe(450);
		expect(observedCounts).toContain(201);
		expect(observedCounts).toContain(449);
	});
});

describe("customersStore exchange credit after a return", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("stays on for every Payments opening of that customer's sale, not used up", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-A");
		store.armExchangeCredit("CUST-A");

		expect(store.isCreditOn("CUST-B")).toBe(false);
		expect(store.isCreditOn("CUST-A")).toBe(true);
		// Payments opened again (back to the cart, "Go back"...): still on.
		expect(store.isCreditOn("CUST-A")).toBe(true);
	});

	it("is cleared when a different customer is selected", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-A");
		store.armExchangeCredit("CUST-A");

		store.setSelectedCustomer("CUST-B");
		store.setSelectedCustomer("CUST-A");

		expect(store.isCreditOn("CUST-A")).toBe(false);
	});

	it("survives re-selecting the same customer", () => {
		const store = useCustomersStore();
		store.armExchangeCredit("CUST-A");
		store.setSelectedCustomer("CUST-A");

		expect(store.isCreditOn("CUST-A")).toBe(true);
	});

	it("follows the cashier's switch: on remembers it, off clears it, a sale ends it", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-A");
		store.setCreditOn("CUST-A", true);
		expect(store.isCreditOn("CUST-A")).toBe(true);
		store.setCreditOn("CUST-A", false);
		expect(store.isCreditOn("CUST-A")).toBe(false);

		store.armExchangeCredit("CUST-A");
		// Switching off for another customer doesn't touch it.
		store.setCreditOn("CUST-B", false);
		expect(store.isCreditOn("CUST-A")).toBe(true);
		// Sale submitted.
		store.setCreditOn(null, false);
		expect(store.isCreditOn("CUST-A")).toBe(false);
	});
});

describe("customersStore credit note vouchers", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	const voucher = (origin: string, customer: string) => ({
		credit_origin: origin,
		customer,
		code: `C26${origin}ABCD`,
		voucher: origin,
		amount: 10,
	});

	it("keeps the vouchers of the customer the sale is switched to", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-A");
		store.addCreditVoucher(voucher("CN-1", "CUST-B"));
		// the sale is switched to the voucher's customer
		store.setSelectedCustomer("CUST-B");
		expect(Object.keys(store.creditVouchers)).toEqual(["CN-1"]);
	});

	it("drops them when the sale moves to another customer or is cleared", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-B");
		store.addCreditVoucher(voucher("CN-1", "CUST-B"));
		store.setSelectedCustomer("CUST-C");
		expect(store.creditVouchers).toEqual({});
		store.setSelectedCustomer("CUST-B");
		store.addCreditVoucher(voucher("CN-2", "CUST-B"));
		store.setSelectedCustomer(null);
		expect(store.creditVouchers).toEqual({});
	});
});

describe("customersStore bearer vouchers and shared customers", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	const voucher = (origin: string, customer: string, bearer = 0) => ({
		credit_origin: origin,
		customer,
		code: `C26${origin}ABCD`,
		voucher: origin,
		amount: 10,
		bearer,
	});

	it("drops only bearer vouchers; a named customer's vouchers stay", () => {
		const store = useCustomersStore();
		store.addCreditVoucher(voucher("CN-1", "Anonymous", 1));
		store.addCreditVoucher(voucher("CN-2", "CUST-B", 0));
		expect(store.hasBearerVoucherFor("Anonymous")).toBe(true);
		expect(store.hasBearerVoucherFor("CUST-B")).toBe(false);
		store.dropBearerVouchers();
		expect(Object.keys(store.creditVouchers)).toEqual(["CN-2"]);
		expect(store.hasBearerVoucherFor("Anonymous")).toBe(false);
	});

	it("knows shared customers from customer info and from being marked", () => {
		const store = useCustomersStore();
		expect(store.isSharedCustomer("Anonymous")).toBe(false);
		store.setCustomerInfo({ name: "Anonymous", customer_name: "Anonymous", posa_is_generic_customer: 1 } as any);
		expect(store.isSharedCustomer("Anonymous")).toBe(true);
		store.setCustomerInfo({ name: "CUST-B", customer_name: "B", posa_is_generic_customer: 0 } as any);
		expect(store.isSharedCustomer("CUST-B")).toBe(false);
		store.markSharedCustomer("anno");
		expect(store.isSharedCustomer("anno")).toBe(true);
		expect(store.isSharedCustomer(null)).toBe(false);
	});
});
