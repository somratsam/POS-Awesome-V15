// @vitest-environment jsdom
// Safety net for an exchange whose sale never happens: the return is already
// submitted, so its unused credit gets a "Print the credit note voucher?"
// prompt (customersStore.exchangePrompt, ExchangeCreditPrompt.vue) when the
// cashier chooses another customer, cancels the sale, or leaves for the Desk.
// The sale-submit trigger is covered in usePaymentSubmission.spec.ts.

import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPrintPage = vi.fn();
const toastShow = vi.fn();

vi.mock("../src/offline/index", () => ({
	db: { isOpen: () => true, open: vi.fn(async () => undefined), table: vi.fn() },
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
vi.mock("../src/posapp/composables/pos/payments/usePaymentPrinting", () => ({
	usePaymentPrinting: () => ({ loadPrintPage }),
}));
vi.mock("../src/posapp/stores/uiStore", () => ({
	useUIStore: () => ({ posProfile: { name: "Test Pos", currency: "OMR", posa_decimal_precision: 3 } }),
}));
vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastShow }),
}));

import { useCustomersStore } from "../src/posapp/stores/customersStore";
import ExchangeCreditPrompt from "../src/posapp/components/pos/shell/ExchangeCreditPrompt.vue";

import actionsSource from "../src/posapp/components/pos/invoice_utils/actions.ts?raw";
import navbarSource from "../src/posapp/components/Navbar.vue?raw";
import layoutSource from "../src/posapp/layouts/DefaultLayout.vue?raw";

const pending = {
	returnName: "ACC-SINV-2026-01500",
	doctype: "Sales Invoice",
	customer: "Anonymous",
	customerName: "Anonymous",
	credit: 77.28,
};

describe("customersStore pending exchange", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).frappe = { call: vi.fn() };
	});

	it("choosing another customer opens the prompt once", () => {
		const store = useCustomersStore();
		store.setSelectedCustomer("Anonymous");
		store.setPendingExchange(pending);
		store.setSelectedCustomer("Anonymous");
		expect(store.exchangePrompt).toBeNull();
		store.setSelectedCustomer("CUST-OTHER");
		expect(store.exchangePrompt).toMatchObject(pending);
		expect(store.pendingExchange).toBeNull();
		store.closeExchangePrompt();
		store.setSelectedCustomer("CUST-THIRD");
		expect(store.exchangePrompt).toBeNull();
	});

	it("abandon runs onDone when the prompt closes; nothing pending opens nothing", () => {
		const store = useCustomersStore();
		const onDone = vi.fn();
		expect(store.abandonPendingExchange(onDone)).toBe(false);
		store.setPendingExchange(pending);
		expect(store.abandonPendingExchange(onDone)).toBe(true);
		expect(onDone).not.toHaveBeenCalled();
		store.closeExchangePrompt();
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("a sale that used the credit clears it without a prompt", () => {
		const store = useCustomersStore();
		store.setPendingExchange(pending);
		store.clearPendingExchange();
		store.setSelectedCustomer("CUST-OTHER");
		expect(store.exchangePrompt).toBeNull();
	});

	it("ignores an incomplete record", () => {
		const store = useCustomersStore();
		store.setPendingExchange({ ...pending, returnName: "" });
		expect(store.pendingExchange).toBeNull();
	});
});

const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const BtnStub = defineComponent({
	inheritAttrs: false,
	setup(_, { slots, attrs }) {
		return () => h("button", { "data-testid": attrs["data-testid"], onClick: attrs.onClick }, slots.default?.());
	},
});
const DialogStub = defineComponent({
	props: { modelValue: Boolean },
	setup(props, { slots }) {
		return () => (props.modelValue ? h("div", slots.default?.()) : null);
	},
});
const components = {
	VDialog: DialogStub,
	VCard: Box,
	VCardTitle: Box,
	VCardText: Box,
	VCardActions: Box,
	VBtn: BtnStub,
};

describe("ExchangeCreditPrompt", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).frappe = { call: vi.fn() };
		(window as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)]));
		loadPrintPage.mockReset();
		toastShow.mockReset();
	});

	const open = async () => {
		const store = useCustomersStore();
		const onDone = vi.fn();
		store.setPendingExchange(pending);
		store.abandonPendingExchange(onDone);
		const wrapper = mount(ExchangeCreditPrompt, { global: { components } });
		await nextTick();
		return { store, onDone, wrapper };
	};

	it("names the return and its unused credit", async () => {
		const { wrapper } = await open();
		expect(wrapper.text()).toContain("Print the credit note voucher?");
		expect(wrapper.text()).toContain(
			"Return ACC-SINV-2026-01500 is submitted. Anonymous has OMR 77.280 store credit from it that has not been used.",
		);
		wrapper.unmount();
	});

	it("Print prints the voucher (first print, no reprint settings), then closes and carries on", async () => {
		loadPrintPage.mockResolvedValue(undefined);
		const { store, onDone, wrapper } = await open();
		await wrapper.find('[data-testid="exchange-credit-prompt-print"]').trigger("click");
		await Promise.resolve();
		await nextTick();
		expect(loadPrintPage).toHaveBeenCalledWith({ name: "ACC-SINV-2026-01500", doctype: "Sales Invoice" });
		expect(store.exchangePrompt).toBeNull();
		expect(onDone).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("Not now closes without printing", async () => {
		const { store, onDone, wrapper } = await open();
		await wrapper.find('[data-testid="exchange-credit-prompt-later"]').trigger("click");
		expect(loadPrintPage).not.toHaveBeenCalled();
		expect(store.exchangePrompt).toBeNull();
		expect(onDone).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("a failed print says how to get the voucher and still closes", async () => {
		loadPrintPage.mockRejectedValue(new Error("QZ offline"));
		const { store, wrapper } = await open();
		await wrapper.find('[data-testid="exchange-credit-prompt-print"]').trigger("click");
		await Promise.resolve();
		await nextTick();
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "The credit note voucher couldn't be printed. Reprint it from Invoice Management.",
				color: "error",
			}),
		);
		expect(store.exchangePrompt).toBeNull();
		wrapper.unmount();
	});
});

describe("wiring", () => {
	it("cancelling the sale abandons the exchange before the cart and customer are reset", () => {
		const actions = actionsSource;
		const cancel = actions.slice(actions.indexOf("export async function cancel_invoice"));
		const abandon = cancel.indexOf("customersStore?.abandonPendingExchange?.()");
		expect(abandon).toBeGreaterThan(-1);
		expect(abandon).toBeLessThan(cancel.indexOf("clearInvoice(context);"));
		expect(abandon).toBeLessThan(cancel.indexOf("setSelectedCustomer(context.customer"));
	});

	it("Back to Desk asks first, then goes on leaving", () => {
		const navbar = navbarSource;
		const goDesk = navbar.slice(navbar.indexOf("goDesk() {"), navbar.indexOf("leaveToDesk() {"));
		expect(goDesk).toMatch(/if \(useCustomersStore\(\)\.abandonPendingExchange\(\(\) => this\.goDesk\(\)\)\) \{\s*return;/);
		expect(goDesk.indexOf("abandonPendingExchange")).toBeLessThan(goDesk.indexOf("itemsCount"));
	});

	it("the prompt is mounted once in the POS layout", () => {
		const layout = layoutSource;
		expect(layout.match(/<ExchangeCreditPrompt \/>/g)).toHaveLength(1);
	});
});
