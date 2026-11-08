// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import {
	cleanMobileNumber,
	createMobileDuplicateCheck,
	isCheckableMobile,
} from "../src/posapp/utils/customerMobile";
import {
	customerMatchesSearchTerm,
	getCustomerDuplicateFields,
} from "../src/posapp/stores/customers/customerSearch";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import ExistingCustomerNotice from "../src/posapp/components/pos/dialogs/customer/ExistingCustomerNotice.vue";
import updateCustomerSource from "../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue?raw";
import offlineCustomersSource from "../src/offline/customers.ts?raw";

// One mobile number per customer, in one format (server rule:
// posawesome/posawesome/api/customer_mobile.py, tested in
// test_customer_mobile.py against the database).

const tableQueries: Array<{ index: string; key: string }> = [];
const tableRows = vi.fn(async () => [] as any[]);

vi.mock("../src/offline/index", () => ({
	db: {
		isOpen: () => true,
		open: vi.fn(async () => undefined),
		table: vi.fn(() => {
			let index = "";
			const collection: any = {
				where: vi.fn((name: string) => {
					index = name;
					return collection;
				}),
				equals: vi.fn((key: string) => {
					tableQueries.push({ index, key });
					return collection;
				}),
				startsWith: vi.fn(() => collection),
				filter: vi.fn(() => collection),
				offset: vi.fn(() => collection),
				limit: vi.fn(() => collection),
				toArray: () => tableRows(),
			};
			return collection;
		}),
	},
	checkDbHealth: vi.fn(async () => undefined),
	setCustomerStorage: vi.fn(async () => undefined),
	saveStoredValueSnapshot: vi.fn(),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));

describe("cleanMobileNumber: the same rule as the server", () => {
	it("cleans every format to one number", () => {
		const cases: Record<string, string> = {
			"9123 4567": "91234567",
			"91234567": "91234567",
			"+968 91234567": "91234567",
			"+968 9123-4567": "91234567",
			"00968 9123 4567": "91234567",
			"968 91234567": "91234567",
			"(968) 9123 4567": "91234567",
			"+44 7700 900123": "+447700900123",
			"0044 7700 900123": "+447700900123",
			"447700900123": "+447700900123",
			"923001234567": "+923001234567",
			"+971 50 123 4567": "+971501234567",
			"123456": "123456",
			"": "",
			"n/a": "",
		};
		for (const [raw, expected] of Object.entries(cases)) {
			expect(cleanMobileNumber(raw), raw).toBe(expected);
		}
		expect(cleanMobileNumber(null)).toBe("");
	});

	it("only a whole number is worth checking", () => {
		expect(isCheckableMobile("9123 456")).toBe(false);
		expect(isCheckableMobile("9123 4567")).toBe(true);
		expect(isCheckableMobile("+968 9123")).toBe(false);
	});

	it("the submit-time duplicate rule and the search treat the formats as one number", () => {
		const existing = { name: "C-1", customer_name: "Fatima", mobile_no: "91234567" } as any;
		expect(getCustomerDuplicateFields(existing, { mobile_no: "+968 9123-4567" }, false)).toEqual(["mobile_no"]);
		expect(getCustomerDuplicateFields(existing, { mobile_no: "9123 4568" }, false)).toEqual([]);
		for (const term of ["91234567", "9123 4567", "+968 9123 4567", "0096891234567"]) {
			expect(customerMatchesSearchTerm(existing, term), term).toBe(true);
		}
		const legacy = { name: "C-2", customer_name: "Old", mobile_no: "+968 9123 4567" } as any;
		expect(customerMatchesSearchTerm(legacy, "91234567")).toBe(true);
	});
});

describe("check while typing", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const setup = (local: any, remote: any, offline = false) => {
		const results: any[] = [];
		const findLocal = vi.fn(async () => local);
		const findRemote = vi.fn(async () => remote);
		const check = createMobileDuplicateCheck({
			findLocal,
			findRemote,
			isOffline: () => offline,
			onResult: (existing) => results.push(existing),
			delay: 400,
		});
		return { check, findLocal, findRemote, results };
	};
	const FATIMA = { name: "C-1", customer_name: "Fatima", mobile_no: "91234567" };

	it("waits for a pause, then looks in the till's own list first", async () => {
		const { check, findLocal, findRemote, results } = setup(FATIMA, null);
		check.check("+968 9123 456");
		check.check("+968 9123 4567");
		await vi.advanceTimersByTimeAsync(399);
		expect(findLocal).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(findLocal).toHaveBeenCalledTimes(1);
		expect(findLocal).toHaveBeenCalledWith("91234567", null);
		expect(findRemote).not.toHaveBeenCalled();
		expect(results.at(-1)).toEqual(FATIMA);
	});

	it("asks the server when the till doesn't have it, and not when offline", async () => {
		const online = setup(null, FATIMA);
		online.check.check("91234567");
		await vi.advanceTimersByTimeAsync(400);
		expect(online.findRemote).toHaveBeenCalledWith("91234567", null);
		expect(online.results.at(-1)).toEqual(FATIMA);

		const offline = setup(null, FATIMA, true);
		offline.check.check("91234567");
		await vi.advanceTimersByTimeAsync(400);
		expect(offline.findRemote).not.toHaveBeenCalled();
		expect(offline.results.at(-1)).toBeNull();
	});

	it("a reply for a number no longer in the box is dropped", async () => {
		let release: (value: any) => void = () => {};
		const findRemote = vi.fn(() => new Promise((resolve) => (release = resolve)));
		const results: any[] = [];
		const check = createMobileDuplicateCheck({
			findLocal: async () => null,
			findRemote: findRemote as any,
			isOffline: () => false,
			onResult: (existing) => results.push(existing),
		});
		check.check("91234567");
		await vi.advanceTimersByTimeAsync(400);
		check.check("9123456");
		release(FATIMA);
		await vi.advanceTimersByTimeAsync(0);
		expect(results).toEqual([null]);
	});

	it("Submit runs the check at once", async () => {
		const { check, results } = setup(FATIMA, null);
		await check.now("9123-4567");
		expect(results).toEqual([FATIMA]);
	});
});

describe("the till's own list, by mobile number", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		tableQueries.length = 0;
		tableRows.mockReset();
		(globalThis as any).frappe = { call: vi.fn() };
	});

	it("finds the customer on the mobile index, in any stored format", async () => {
		tableRows.mockResolvedValue([
			{ name: "C-OTHER", customer_name: "Other", mobile_no: "+44 9123 4567" },
			{ name: "C-1", customer_name: "Fatima", mobile_no: "+968 9123 4567" },
		]);
		const store = useCustomersStore();
		const found = await store.findLocalCustomerByMobile("91234567");
		expect(tableQueries).toEqual([{ index: "_mobile_search_keys", key: "91234567" }]);
		expect(found?.name).toBe("C-1");
		expect(await store.findLocalCustomerByMobile("91234567", "C-1")).toBeNull();
	});
});

describe("ExistingCustomerNotice", () => {
	beforeEach(() => {
		(window as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
	});

	it("names the customer and selects it", async () => {
		const onSelect = vi.fn();
		const customer = { name: "C-1", customer_name: "Fatima", mobile_no: "91234567" };
		// Vuetify isn't installed here: <v-alert>/<v-btn> render as plain
		// elements with their content and click handler.
		const wrapper = mount(ExistingCustomerNotice, { props: { customer, onSelect } });
		expect(wrapper.get('[data-test="existing-customer-text"]').text()).toBe(
			"Customer already exists: Fatima, 91234567",
		);
		await wrapper.get('[data-test="select-existing-customer"]').trigger("click");
		expect(onSelect).toHaveBeenCalledWith(customer);
	});

	it("shows nothing without a customer", () => {
		const wrapper = mount(ExistingCustomerNotice, { props: { customer: null } });
		expect(wrapper.find('[data-test="existing-customer-notice"]').exists()).toBe(false);
	});
});

// UpdateCustomer.vue can't be mounted in this suite (see
// updateCustomerSubmitReentrancyWiring.spec.ts), so check its wiring.
describe("UpdateCustomer.vue wiring", () => {
	it("checks while typing, for new customers only", () => {
		expect(updateCustomerSource).toMatch(
			/mobile_no\(value\) \{[\s\S]*?if \(this\.customer_id\) \{[\s\S]*?return;[\s\S]*?this\.mobileCheck\?\.check\(value\);/,
		);
		expect(updateCustomerSource).toContain("this.customersStore.findLocalCustomerByMobile(mobile, exclude)");
		expect(updateCustomerSource).toContain(
			'"posawesome.posawesome.api.customers.find_customer_by_mobile"',
		);
	});

	it("shows the notice under the mobile box, and its button selects and closes", () => {
		expect(updateCustomerSource).toMatch(
			/<ExistingCustomerNotice\s+:customer="existingMobileCustomer"\s+@select="selectExistingCustomer"/,
		);
		expect(updateCustomerSource).toMatch(
			/async selectExistingCustomer\(existing\) \{[\s\S]*?addOrUpdateCustomer\(existing\);[\s\S]*?this\.close_dialog\(\);/,
		);
	});

	it("Submit is blocked on a duplicate mobile, before the other checks and the offline save", () => {
		const block = updateCustomerSource.indexOf("await this.mobileCheck.now(args.mobile_no);");
		expect(block).toBeGreaterThan(0);
		expect(updateCustomerSource.indexOf("findLocalDuplicateCustomers(args)")).toBeGreaterThan(block);
		expect(updateCustomerSource.indexOf("saveOfflineCustomer({ args: apiArgs })")).toBeGreaterThan(block);
		expect(updateCustomerSource.slice(block, block + 400)).toMatch(/if \(this\.existingMobileCustomer\) \{[\s\S]*?return;/);
	});

	it("sends the clean number, and shows a server refusal as a red message", () => {
		expect(updateCustomerSource).toContain("args.mobile_no = cleanMobileNumber(args.mobile_no);");
		expect(updateCustomerSource).toContain("vm.showCustomerError(error?.message");
	});
});

describe("offline customers", () => {
	it("are synced with offline_sync, so a known mobile links to the existing customer", () => {
		expect(offlineCustomersSource).toContain("args: { ...queuedCustomer.args, offline_sync: 1 }");
		expect(offlineCustomersSource).toContain("await updateOfflineInvoicesCustomer(");
	});
});
