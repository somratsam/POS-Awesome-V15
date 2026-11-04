// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// The edit dialog's own keyboard-navigation helpers, run against a real DOM.
function buildContext() {
	const methods = (InvoiceManagement as any).methods;
	const context: Record<string, any> = {
		editDialog: true,
		editLoading: false,
		editKeyboardTargetKey: "",
		editKeyboardEditing: false,
		editKeyboardGeneratedId: 0,
	};
	for (const name of [
		"editModalElement",
		"editModalFocusRoot",
		"clearEditKeyboardBox",
		"ensureEditNavKey",
		"setEditKeyboardTarget",
		"editFocusableElement",
		"handleEditModalClick",
	]) {
		context[name] = methods[name].bind(context);
	}
	return context;
}

function mountModal() {
	document.body.innerHTML = `
		<div class="invoice-edit-modal-content">
			<div class="invoice-detail-card" tabindex="0">
				<div data-edit-nav="customer"><input type="text" value="CUST-1" /></div>
				<div data-edit-nav="item-0-qty"><input type="number" value="1" /></div>
			</div>
		</div>`;
	return {
		card: document.querySelector(".invoice-detail-card") as HTMLElement,
		customerRoot: document.querySelector('[data-edit-nav="customer"]') as HTMLElement,
		customerInput: document.querySelector('[data-edit-nav="customer"] input') as HTMLInputElement,
		qtyInput: document.querySelector('[data-edit-nav="item-0-qty"] input') as HTMLInputElement,
	};
}

describe("InvoiceManagement.vue edit dialog: clicking a box lets you type in it", () => {
	beforeEach(() => {
		(globalThis as any).__ = (text: string) => text;
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it.each([
		["customer", "customerInput"],
		["qty", "qtyInput"],
	])("keeps the cursor in the clicked %s box instead of moving it to the dialog card", (_label, key) => {
		const { card, ...inputs } = mountModal();
		const input = (inputs as any)[key] as HTMLInputElement;
		const context = buildContext();

		// A real click focuses the input first; the capture-phase handler runs on the same click.
		input.focus();
		context.handleEditModalClick({ target: input });

		expect(document.activeElement).toBe(input);
		expect(document.activeElement).not.toBe(card);
		expect(context.editKeyboardEditing).toBe(true);
		expect(input.closest("[data-edit-nav]")?.classList.contains("edit-keyboard-box")).toBe(true);
	});

	it("still moves focus to the card for keyboard navigation (arrow keys / Tab)", () => {
		const { card, customerRoot } = mountModal();
		const context = buildContext();

		context.setEditKeyboardTarget(customerRoot);

		expect(document.activeElement).toBe(card);
		expect(customerRoot.classList.contains("edit-keyboard-box")).toBe(true);
	});
});

describe("InvoiceManagement.vue edit dialog: customer picker", () => {
	const methods = (InvoiceManagement as any).methods;

	beforeEach(() => {
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).frappe = { utils: { strip_html: (t: string) => t.replace(/<[^>]*>/g, "") } };
	});

	afterEach(() => {
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	function keydownContext(menuOpen: boolean) {
		const context: Record<string, any> = {
			editDialog: true,
			editLoading: false,
			editKeyboardEditing: true,
			editSubmitting: false,
			editCustomerMenu: menuOpen,
			submitEditInvoice: vi.fn(),
			stopEditKeyboardEditing: vi.fn(),
			closeEditInvoice: vi.fn(),
			setEditKeyboardTarget: vi.fn(),
			moveEditKeyboardBox: vi.fn(),
			activateEditKeyboardTarget: vi.fn(),
		};
		context.handleEditModalKeydown = methods.handleEditModalKeydown.bind(context);
		return context;
	}

	function keyEvent(key: string, target: Element) {
		return { key, target, preventDefault: vi.fn(), stopPropagation: vi.fn(), shiftKey: false, ctrlKey: false, metaKey: false };
	}

	it.each(["Enter", "Escape", "ArrowDown", "ArrowUp"])(
		"leaves %s to the open customer list instead of the dialog's navigation",
		(key) => {
			mountModal();
			const input = document.querySelector('[data-edit-nav="customer"] input') as HTMLInputElement;
			const context = keydownContext(true);
			const event = keyEvent(key, input);

			context.handleEditModalKeydown(event);

			expect(event.preventDefault).not.toHaveBeenCalled();
			expect(context.moveEditKeyboardBox).not.toHaveBeenCalled();
			expect(context.closeEditInvoice).not.toHaveBeenCalled();
			expect(context.stopEditKeyboardEditing).not.toHaveBeenCalled();
		},
	);

	it("keeps Enter moving to the next box once the customer list is closed", () => {
		mountModal();
		const input = document.querySelector('[data-edit-nav="customer"] input') as HTMLInputElement;
		input.focus();
		const context = keydownContext(false);
		const event = keyEvent("Enter", input);

		context.handleEditModalKeydown(event);

		expect(event.preventDefault).toHaveBeenCalled();
		expect(context.moveEditKeyboardBox).toHaveBeenCalledWith("ArrowRight");
	});

	it("does not let an open customer list swallow Enter in other boxes", () => {
		mountModal();
		const qty = document.querySelector('[data-edit-nav="item-0-qty"] input') as HTMLInputElement;
		qty.focus();
		const context = keydownContext(true);
		const event = keyEvent("Enter", qty);

		context.handleEditModalKeydown(event);

		expect(context.moveEditKeyboardBox).toHaveBeenCalled();
	});

	function pickerContext(lookupResults: any[]) {
		const context: Record<string, any> = {
			editInvoiceDoc: { name: "SINV-1", customer: "CUST-OLD", customer_name: "Old Buyer" },
			editCustomerItems: [],
			editCustomerSearchSeq: 0,
			editCustomerSearchTimer: null,
			editCustomerSearching: false,
			customersStore: { lookupCustomers: vi.fn(async () => lookupResults) },
		};
		for (const name of ["seedEditCustomerItems", "clearEditCustomerSearch", "onEditCustomerSearch", "runEditCustomerSearch"]) {
			context[name] = methods[name].bind(context);
		}
		return context;
	}

	it("shows the invoice's current customer, then fills in its mobile from the customer list", async () => {
		const context = pickerContext([{ name: "CUST-OLD", customer_name: "Old Buyer", mobile_no: "99000001" }]);

		context.seedEditCustomerItems(context.editInvoiceDoc);
		expect(context.editCustomerItems).toEqual([{ name: "CUST-OLD", customer_name: "Old Buyer" }]);

		await vi.waitFor(() => expect(context.editCustomerItems[0].mobile_no).toBe("99000001"));
		expect(context.customersStore.lookupCustomers).toHaveBeenCalledWith("CUST-OLD", 20);
	});

	it("searches after typing, lists matches first and keeps the current customer last", async () => {
		vi.useFakeTimers();
		const context = pickerContext([
			{ name: "CUST-A", customer_name: "Fatima Ali", mobile_no: "99111001" },
			{ name: "CUST-B", customer_name: "Fatima Ali", mobile_no: "99111002" },
		]);
		context.editCustomerItems = [{ name: "CUST-OLD", customer_name: "Old Buyer" }];

		context.onEditCustomerSearch("Fatima");
		expect(context.customersStore.lookupCustomers).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300);

		expect(context.customersStore.lookupCustomers).toHaveBeenCalledWith("Fatima", 20);
		expect(context.editCustomerItems.map((row: any) => row.name)).toEqual(["CUST-A", "CUST-B", "CUST-OLD"]);
		expect(context.editCustomerSearching).toBe(false);
	});

	it("does not search again when the box just shows the selected customer's name", async () => {
		vi.useFakeTimers();
		const context = pickerContext([]);
		context.editCustomerItems = [{ name: "CUST-OLD", customer_name: "Old Buyer" }];

		context.onEditCustomerSearch("Old Buyer");
		await vi.advanceTimersByTimeAsync(300);

		expect(context.customersStore.lookupCustomers).not.toHaveBeenCalled();
	});

	it("selects the customer box's text on focus so typing replaces the current name", async () => {
		mountModal();
		const input = document.querySelector('[data-edit-nav="customer"] input') as HTMLInputElement;
		input.value = "ccccc";
		input.setSelectionRange(5, 5);
		const context: Record<string, any> = { $nextTick: (fn: () => void) => Promise.resolve().then(fn) };
		context.editModalElement = methods.editModalElement.bind(context);
		const onFocused = methods.onEditCustomerFocused.bind(context);

		onFocused(false);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5]);

		onFocused(true);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
	});

	it("shows the server's own message for a rejected customer instead of a generic error", () => {
		const xhr = {
			readyState: 4,
			responseJSON: {
				_server_messages: JSON.stringify([
					JSON.stringify({ message: "Customer <b>Nobody</b> was not found. Pick a customer from the list." }),
				]),
			},
		};

		expect(methods.editErrorMessage(xhr, "Unable to recalculate invoice")).toBe(
			"Customer Nobody was not found. Pick a customer from the list.",
		);
		expect(methods.editErrorMessage({ readyState: 4 }, "Unable to recalculate invoice")).toBe(
			"Unable to recalculate invoice",
		);
	});
});
