// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = vi.hoisted(() => ({ value: false }));
vi.mock("../src/offline/index", () => ({
	isOffline: () => offline.value,
	saveStoredValueSnapshot: vi.fn(),
}));

import { normalizeVoucherInput, selectAuthorizedCredit } from "../src/posapp/utils/creditAuthorization";
import { useRedemptionLogic } from "../src/posapp/composables/pos/payments/useRedemptionLogic";
import PaymentOptions from "../src/posapp/components/pos/payments/PaymentOptions.vue";
import CreditVoucherCustomerDialog from "../src/posapp/components/pos/payments/CreditVoucherCustomerDialog.vue";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import navbarSource from "../src/posapp/components/Navbar.vue?raw";
import {
	callWithoutDialog,
	serverMessageOf,
	voucherErrorToast,
	voucherSuccessToast,
	voucherInfoToast,
	creditRemainderMessage,
	VOUCHER_MESSAGE_KEY,
} from "../src/posapp/utils/voucherMessages";
import CreditRemainderDialog from "../src/posapp/components/pos/payments/CreditRemainderDialog.vue";

const sameShift = { type: "Invoice", credit_origin: "CN-TODAY", total_credit: 40, pos_opening_shift: "SHIFT-1" };
const oldNote = { type: "Invoice", credit_origin: "CN-OLD", total_credit: 25, pos_opening_shift: "SHIFT-0" };
const advance = { type: "Advance", credit_origin: "ACC-PAY-1", total_credit: 5 };
const voucher = {
	credit_origin: "CN-OLD",
	code: "C2600100ABCD",
	voucher: "C26-00100-ABCD",
	customer: "CUST-1",
	amount: 25,
};

describe("selectAuthorizedCredit", () => {
	it("uses a same-shift return without a voucher", () => {
		const { authorized, needVoucher } = selectAuthorizedCredit([sameShift, oldNote], { shift: "SHIFT-1" });
		expect(authorized.map((r) => r.credit_origin)).toEqual(["CN-TODAY"]);
		expect(needVoucher.map((r) => r.credit_origin)).toEqual(["CN-OLD"]);
	});

	it("needs a voucher for an earlier shift's credit, and attaches its code", () => {
		const { authorized, needVoucher } = selectAuthorizedCredit([oldNote], {
			shift: "SHIFT-1",
			vouchers: { "CN-OLD": voucher },
		});
		expect(needVoucher).toEqual([]);
		expect(authorized[0].voucher_code).toBe("C2600100ABCD");
	});

	it("a sale with no shift has no same-shift credit", () => {
		expect(selectAuthorizedCredit([{ ...sameShift, pos_opening_shift: null }], { shift: null }).authorized).toEqual([]);
	});

	it("a supervisor on the till covers every row, advances too", () => {
		const { authorized, needVoucher } = selectAuthorizedCredit([sameShift, oldNote, advance], {
			shift: "SHIFT-1",
			supervisor: true,
		});
		expect(authorized).toHaveLength(3);
		expect(needVoucher).toEqual([]);
	});

	it("once a credit note is picked, a supervisor's 'all credit' no longer applies", () => {
		const { authorized, needVoucher } = selectAuthorizedCredit([sameShift, oldNote, advance, { ...oldNote, credit_origin: "CN-OLDER" }], {
			shift: "SHIFT-1",
			supervisor: true,
			vouchers: { "CN-OLD": { ...voucher, code: "" } },
		});
		expect(authorized.map((r) => r.credit_origin)).toEqual(["CN-TODAY", "CN-OLD"]);
		expect(needVoucher.map((r) => r.credit_origin)).toEqual(["ACC-PAY-1", "CN-OLDER"]);
	});

	it("advances are never covered by a voucher or the shift", () => {
		expect(selectAuthorizedCredit([advance], { shift: "SHIFT-1" }).needVoucher).toEqual([advance]);
	});

	it("normalizes typed codes", () => {
		expect(normalizeVoucherInput(" c26-00100-abcd ")).toBe("C2600100ABCD");
	});
});

const flush = async () => {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
	await nextTick();
	await nextTick();
};

describe("useRedemptionLogic with authorization", () => {
	let toast: ReturnType<typeof vi.fn>;
	let onMessage: ReturnType<typeof vi.fn>;

	const setup = (message: any, { shift = "SHIFT-1", supervisor = false } = {}) => {
		(globalThis as any).frappe = { call: vi.fn(() => Promise.resolve({ message })) };
		toast = vi.fn();
		onMessage = vi.fn();
		return useRedemptionLogic({
			invoiceDoc: ref({ customer: "CUST-1", rounded_total: 200, grand_total: 200 }),
			posProfile: ref({ company: "Swan", currency: "OMR" }),
			customerInfo: ref({}),
			currencyPrecision: ref(3),
			formatFloat: (value: any) => Number(value || 0),
			stores: { toastStore: { show: toast } },
			getAuthorizationContext: () => ({ shift, supervisor }),
			onCreditMessage: onMessage,
		});
	};

	beforeEach(() => {
		offline.value = false;
		(globalThis as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
	});

	it("applies the same-shift credit and leaves the rest quietly on the account", async () => {
		const logic = setup({ credit: [sameShift, oldNote], expired: [] });
		logic.get_available_credit(true);
		await flush();
		expect(logic.customer_credit_dict.value.map((r: any) => r.credit_origin)).toEqual(["CN-TODAY"]);
		expect(logic.redeemed_customer_credit.value).toBe(40);
		expect(toast).not.toHaveBeenCalled();
	});

	it("says what needs a voucher only when nothing could be used", async () => {
		const logic = setup({ credit: [oldNote], expired: [] });
		logic.get_available_credit(true);
		await flush();
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({ key: "credit-voucher-message", color: "red-darken-3", timeout: 8000 }),
		);
		expect(toast.mock.calls[0][0].title).toContain("25.000 OMR");
		expect(toast.mock.calls[0][0].title).toContain("type the return number");
		expect(onMessage).toHaveBeenLastCalledWith(toast.mock.calls[0][0].title);
	});

	it("expired credit: red with the rest when nothing could be used, an orange note when credit was applied", async () => {
		const expiredRow = { type: "Invoice", credit_origin: "CN-EXP", total_credit: 9, expires_on: "2026-09-01" };
		let logic = setup({ credit: [oldNote], expired: [expiredRow] });
		logic.get_available_credit(true);
		await flush();
		expect(toast).toHaveBeenCalledTimes(1);
		expect(toast.mock.calls[0][0]).toMatchObject({ key: "credit-voucher-message", color: "red-darken-3" });
		expect(toast.mock.calls[0][0].title).toContain("9.000 OMR has expired");
		expect(toast.mock.calls[0][0].title).toContain("needs their credit note voucher");

		logic = setup({ credit: [sameShift], expired: [expiredRow] });
		logic.get_available_credit(true);
		await flush();
		expect(logic.redeemed_customer_credit.value).toBe(40);
		expect(toast).toHaveBeenCalledTimes(1);
		expect(toast.mock.calls[0][0]).toMatchObject({ key: "customer-credit-expired", color: "warning" });
	});

	it("a scanned voucher adds that credit note, with its code for the server", async () => {
		const logic = setup({ credit: [sameShift, oldNote], expired: [] });
		logic.addCreditVoucher(voucher);
		logic.get_available_credit(true);
		await flush();
		const rows = logic.customer_credit_dict.value;
		expect(rows.map((r: any) => r.credit_origin)).toEqual(["CN-TODAY", "CN-OLD"]);
		expect(rows[1].voucher_code).toBe("C2600100ABCD");
		expect(logic.redeemed_customer_credit.value).toBe(65);
		expect(toast).not.toHaveBeenCalled();
		logic.addCreditVoucher({ ...voucher, credit_origin: "CN-X", customer: "CUST-2" });
		logic.clearCreditVouchers("CUST-2");
		expect(Object.keys(logic.credit_vouchers.value)).toEqual(["CN-X"]);
		logic.clearCreditVouchers();
		expect(logic.credit_vouchers.value).toEqual({});
	});

	it("nothing usable: nothing applied", async () => {
		const logic = setup({ credit: [oldNote], expired: [] });
		logic.get_available_credit(true);
		await flush();
		expect(logic.customer_credit_dict.value).toEqual([]);
		expect(logic.redeemed_customer_credit.value).toBe(0);
	});

	it("a shared customer's credit is never applied", async () => {
		const logic = setup({ credit: [sameShift], expired: [], generic_customer: true }, { supervisor: true });
		logic.get_available_credit(true);
		await flush();
		expect(logic.customer_credit_dict.value).toEqual([]);
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({ key: "credit-voucher-message", color: "red-darken-3", timeout: 8000 }));
		expect(toast.mock.calls[0][0].title).toContain("shared customer account");
	});

	it("offline: no credit, and the cashier is told why", async () => {
		offline.value = true;
		const logic = setup({ credit: [sameShift], expired: [] }, { supervisor: true });
		logic.get_available_credit(true);
		await flush();
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
		expect(logic.customer_credit_dict.value).toEqual([]);
		expect(toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Store credit can only be used while the POS is online.",
				color: "red-darken-3",
				timeout: 8000,
			}),
		);
	});
});

const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const InputStub = defineComponent({
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	inheritAttrs: false,
	setup(props, { emit, attrs, slots }) {
		return () =>
			h("div", [
				h("input", {
					"data-testid": attrs["data-testid"],
					value: props.modelValue,
					onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
					onKeydown: attrs.onKeydown,
				}),
				slots["append-inner"]?.(),
			]);
	},
});
const BtnStub = defineComponent({
	inheritAttrs: false,
	setup(_, { slots, attrs }) {
		return () => h("button", { "data-testid": attrs["data-testid"], onClick: attrs.onClick }, slots.default?.());
	},
});

describe("PaymentOptions voucher box", () => {
	beforeEach(() => {
		(window as any).frappe = { _: (value: string) => value };
		(globalThis as any).frappe = { _: (value: string) => value };
	});

	const mountOptions = (props: Record<string, any> = {}) =>
		mount(PaymentOptions, {
			props: {
				invoiceDoc: { is_return: 0 },
				posProfile: { use_customer_credit: 1 },
				formatCurrency: (v: number) => `OMR ${v}`,
				...props,
			},
			global: {
				components: {
					VRow: Box,
					VCol: Box,
					VSwitch: Box,
					VAlert: Box,
					VIcon: Box,
					VChip: Box,
					VTextField: InputStub,
					VBtn: BtnStub,
					VueDatePicker: Box,
				},
			},
		});

	it("sends the typed number on Enter and on Use, then clears the box", async () => {
		const onRedeemVoucher = vi.fn();
		const wrapper = mountOptions({ onRedeemVoucher });
		const input = wrapper.find('[data-testid="credit-voucher-input"]');
		await input.setValue("C26-00100-ABCD");
		await input.trigger("keydown", { key: "Enter" });
		expect(onRedeemVoucher).toHaveBeenCalledWith("C26-00100-ABCD");
		expect((input.element as HTMLInputElement).value).toBe("");
		await input.setValue("C2600101WXYZ");
		await wrapper.find('[data-testid="credit-voucher-apply"]').trigger("click");
		expect(onRedeemVoucher).toHaveBeenLastCalledWith("C2600101WXYZ");
	});

	it("lists vouchers already applied", () => {
		const wrapper = mountOptions({ creditVouchers: [voucher] });
		expect(wrapper.find('[data-testid="credit-voucher-applied"]').text()).toContain("C26-00100-ABCD");
		expect(wrapper.find('[data-testid="credit-voucher-applied"]').text()).toContain("OMR 25");
	});

	it("shows the last voucher problem as a red line, and typing again clears it", async () => {
		const onClearVoucherError = vi.fn();
		const wrapper = mountOptions({ voucherError: "Voucher C26-00100-ABCD has already been used.", onClearVoucherError });
		const line = wrapper.find('[data-testid="credit-voucher-error"]');
		expect(line.text()).toContain("Voucher C26-00100-ABCD has already been used.");
		expect(line.attributes("role")).toBe("alert");
		await wrapper.find('[data-testid="credit-voucher-input"]').setValue("C");
		expect(onClearVoucherError).toHaveBeenCalled();
		expect(mountOptions().find('[data-testid="credit-voucher-error"]').exists()).toBe(false);
	});

	it("is not shown on a return", () => {
		const wrapper = mountOptions({ invoiceDoc: { is_return: 1 } });
		expect(wrapper.find('[data-testid="credit-voucher-field"]').exists()).toBe(false);
	});
});

describe("CreditVoucherCustomerDialog", () => {
	it("names the voucher's customer and reports the choice", async () => {
		(window as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const DialogStub = defineComponent({
			props: { modelValue: Boolean },
			setup: (props, { slots }) => () => (props.modelValue ? h("div", slots.default?.()) : null),
		});
		const wrapper = mount(CreditVoucherCustomerDialog, {
			props: {
				modelValue: true,
				voucher: { ...voucher, customer_name: "Sanju", mobile_no: "99887766" },
				currentCustomer: "Aziz",
				onConfirm,
				onCancel,
			},
			global: {
				components: { VDialog: DialogStub, VCard: Box, VCardTitle: Box, VCardText: Box, VCardActions: Box, VBtn: BtnStub },
			},
		});
		expect(wrapper.text()).toContain("Voucher C26-00100-ABCD belongs to Sanju (99887766).");
		expect(wrapper.text()).toContain("This sale is for Aziz.");
		await wrapper.find('[data-testid="credit-voucher-switch"]').trigger("click");
		await wrapper.find('[data-testid="credit-voucher-cancel"]').trigger("click");
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});

// Payments.vue can't be mounted here (Vitest's bundled Vite can't resolve its
// ".js" store imports); check its wiring instead.
describe("Payments.vue voucher wiring", () => {
	const script = paymentsSource.slice(paymentsSource.indexOf("<script"));

	it("tells the redemption logic the sale's shift and whether a supervisor is on the till", () => {
		expect(script).toMatch(
			/getAuthorizationContext: \(\) => \(\{\s*shift: invoiceStore\.invoiceDoc\?\.posa_pos_opening_shift \|\| null,\s*supervisor: Boolean\(currentCashier\.value\?\.is_supervisor\),/,
		);
	});

	it("checks the voucher with the server, asks before replacing a named customer, then applies it", () => {
		const fn = script.slice(script.indexOf("const redeemCreditVoucher"), script.indexOf("addCreditVoucher(voucher);") + 200);
		// No Frappe message box (it would open behind Payments): every problem
		// becomes a red toast and the red line under the box.
		expect(fn).toMatch(/voucher = await callWithoutDialog\(CREDIT_VOUCHER_LOOKUP, \{/);
		expect(fn).not.toContain("frappe.call(");
		expect(fn).toMatch(/catch \(error\) \{[\s\S]*?showVoucherError\(error\?\.message/);
		expect(fn).toMatch(/if \(isOffline\(\)\) \{\s*showVoucherError\(/);
		expect(script).toMatch(/const showVoucherError = \(message\) => \{\s*voucherError\.value = message;\s*toastStore\.show\(voucherErrorToast\(message\)\);/);
		expect(paymentsSource).toContain(':voucher-error="voucherError"');
		expect(script).toContain('"posawesome.posawesome.api.credit_voucher.lookup_credit_voucher"');
		expect(fn).toMatch(/if \(!isDefaultCustomer && !\(await askVoucherCustomer\(voucher\)\)\) return;/);
		expect(fn.indexOf("customersStore.setSelectedCustomer(voucher.customer)")).toBeLessThan(fn.indexOf("addCreditVoucher(voucher)"));
		expect(fn).toContain("get_available_credit(true)");
		expect(paymentsSource).toContain('@redeem-voucher="redeemCreditVoucher"');
	});

	it("keeps scanned vouchers in the customers store, which outlives Payments", () => {
		expect(script).toContain("creditVouchers: storeToRefs(customersStore).creditVouchers,");
	});

	it("applies this customer's scanned vouchers again when Payments reopens", () => {
		const handler = script.slice(script.indexOf('eventBus.on("send_invoice_doc_payment"'), script.indexOf('eventBus.on("register_pos_profile"'));
		expect(handler).toMatch(/Object\.values\(credit_vouchers\.value\)\.some\(\(v\) => v\.customer === doc\.customer\)/);
		expect(handler).toMatch(/if \(exchange \|\| vouchers\) \{\s*redeem_customer_credit\.value = true;\s*get_available_credit\(true\);/);
	});

	it("forgets vouchers when the customer changes and after the sale", () => {
		const watcher = script.slice(script.indexOf("watch(selectedCustomer"), script.indexOf("watch(selectedCustomer") + 300);
		expect(watcher).toContain("clearCreditVouchers(newCustomer);");
		expect(script).toMatch(/onSuccess: \(\) => \{[^}]*?customer_credit_dict\.value = \[\];\s*clearCreditVouchers\(\);/);
	});
});


describe("voucherMessages", () => {
	const frappeBody = (message: string) => ({
		_server_messages: JSON.stringify([JSON.stringify({ message, title: "Message" })]),
		exc_type: "ValidationError",
	});

	beforeEach(() => {
		(globalThis as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
		(globalThis as any).frappe = { csrf_token: "tok" };
	});

	it("reads the server's reason as plain text", () => {
		expect(serverMessageOf(frappeBody("Voucher <b>C26-1</b> has already been used."))).toBe(
			"Voucher C26-1 has already been used.",
		);
		expect(serverMessageOf({ exception: "frappe.exceptions.PermissionError: Too many wrong voucher numbers." })).toBe(
			"Too many wrong voucher numbers.",
		);
		expect(serverMessageOf({})).toBe("");
	});

	it("callWithoutDialog returns the result, or throws the server's reason", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ message: { a: 1 } }) }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(callWithoutDialog("m.x", { b: 2 })).resolves.toEqual({ a: 1 });
		const [url, init] = fetchMock.mock.calls[0] as any[];
		expect(url).toBe("/api/method/m.x");
		expect(init.headers["X-Frappe-CSRF-Token"]).toBe("tok");
		expect(JSON.parse(init.body)).toEqual({ b: 2 });

		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 417, json: async () => frappeBody("This is not a valid credit note voucher number.") })));
		await expect(callWithoutDialog("m.x")).rejects.toThrow("This is not a valid credit note voucher number.");

		vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
		await expect(callWithoutDialog("m.x")).rejects.toThrow("Can't reach the server");
		vi.unstubAllGlobals();
	});

	it("voucher problems are red, 8 seconds, and replace each other instead of queueing", () => {
		expect(voucherErrorToast("x")).toEqual({ title: "x", color: "red-darken-3", timeout: 8000, key: "credit-voucher-message" });
		expect(voucherSuccessToast("y").key).toBe("credit-voucher-message");
	});
});

describe("toasts sit above dialogs", () => {
	it("the app's snackbar has a z-index above every Vuetify dialog", () => {
		const snackbar = navbarSource.slice(navbarSource.indexOf("<v-snackbar"), navbarSource.indexOf("</v-snackbar>"));
		expect(snackbar).toContain('class="posa-toast"');
		expect(navbarSource).toMatch(/<style>\s*[\s\S]*?\.v-overlay\.v-snackbar\.posa-toast \{\s*z-index: 10000 !important;/);
	});
});

// A voucher is used in full: on a sale worth less than the voucher it is
// refused up front in red, never announced in green and then not applied.
describe("credit worth more than the sale", () => {
	const fmt = (value: number) => `${value.toFixed(3)} OMR`;
	beforeEach(() => {
		(globalThis as any).__ = (text: string, args: any[] = []) =>
			text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
		(window as any).__ = (globalThis as any).__;
		(window as any).frappe = { _: (value: string) => value };
	});

	it("says a credit note is issued for the rest, in blue, replacing the voucher message", () => {
		expect(creditRemainderMessage("5.000 OMR")).toBe(
			"A credit note for 5.000 OMR will be issued for the remaining credit.",
		);
		const toast = voucherInfoToast("x");
		expect(toast.color).toBe("info");
		expect(toast.key).toBe(VOUCHER_MESSAGE_KEY);
	});

	it("a voucher bigger than the sale is no longer refused: Payments applies it and shows one blue message", () => {
		const script = paymentsSource.slice(paymentsSource.indexOf("<script"));
		const fn = script.slice(script.indexOf("const redeemCreditVoucher"), script.indexOf("let announcedRemainder"));
		expect(fn).not.toContain("voucherTooBigForSale");
		expect(fn).not.toContain("showVoucherError(tooBig)");
		expect(fn).toContain("addCreditVoucher(voucher)");
		expect(fn).toMatch(/voucherInfoToast\(`\$\{text\} \$\{creditRemainderMessage\(formatCurrency\(rest\)\)\}`\)/);
	});

	it("shows the figures as a blue line under the voucher box", () => {
		const wrapper = mount(PaymentOptions, {
			props: {
				invoiceDoc: { is_return: 0 },
				posProfile: { use_customer_credit: 1 },
				formatCurrency: (v: number) => `OMR ${v}`,
				voucherInfo: "Credit 50.000 · Sale 45.000 · Credit note for 5.000",
			},
			global: { components: { VRow: Box, VCol: Box, VSwitch: Box, VAlert: Box, VIcon: Box, VChip: Box, VTextField: InputStub, VBtn: BtnStub, VueDatePicker: Box } },
		});
		const line = wrapper.find('[data-testid="credit-voucher-info"]');
		expect(line.exists()).toBe(true);
		expect(line.text()).toContain("Credit note for 5.000");
		// A voucher problem (red) takes the place of the information line.
		const withError = mount(PaymentOptions, {
			props: {
				invoiceDoc: { is_return: 0 },
				posProfile: { use_customer_credit: 1 },
				formatCurrency: (v: number) => `OMR ${v}`,
				voucherInfo: "Credit note for 5.000",
				voucherError: "Wrong number",
			},
			global: { components: { VRow: Box, VCol: Box, VSwitch: Box, VAlert: Box, VIcon: Box, VChip: Box, VTextField: InputStub, VBtn: BtnStub, VueDatePicker: Box } },
		});
		expect(withError.find('[data-testid="credit-voucher-info"]').exists()).toBe(false);
		expect(withError.find('[data-testid="credit-voucher-error"]').exists()).toBe(true);
	});

	it("the confirmation: a cross to close, Add more items, and Issue credit note and submit as the only submit", async () => {
		const onConfirm = vi.fn();
		const onBack = vi.fn();
		const onClose = vi.fn();
		const wrapper = mount(CreditRemainderDialog, {
			props: { modelValue: true, credit: 50, sale: 45, remainder: 5, vouchers: "C26-00316-63TA", formatCurrency: fmt, onConfirm, onBack, onClose },
			global: {
				components: {
					VDialog: { props: ["modelValue"], template: "<div class='dlg'><slot /></div>" },
					VCard: Box,
					VCardTitle: Box,
					VCardText: Box,
					VCardActions: Box,
					VBtn: BtnStub,
				},
			},
		});
		expect(wrapper.text()).toContain("Issue a credit note for 5.000 OMR and submit?");
		expect(wrapper.find('[data-testid="credit-remainder-figures"]').text()).toBe("Credit 50.000 OMR · Sale 45.000 OMR");
		expect(wrapper.find('[data-testid="credit-remainder-text"]').text()).toContain("C26-00316-63TA");
		expect(wrapper.find('[data-testid="credit-remainder-back"]').text()).toBe("Add more items");
		expect(wrapper.text()).not.toContain("Go back");
		expect(wrapper.find('[data-testid="credit-remainder-submit"]').text()).toBe("Issue credit note and submit");

		await wrapper.find('[data-testid="credit-remainder-close"]').trigger("click");
		await wrapper.find('[data-testid="credit-remainder-back"]').trigger("click");
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(onConfirm).not.toHaveBeenCalled();
		await wrapper.find('[data-testid="credit-remainder-submit"]').trigger("click");
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("Escape closes the box (stays on Payments); Add more items has the focus, so Enter never submits", async () => {
		const source = (await import("../src/posapp/components/pos/payments/CreditRemainderDialog.vue?raw")).default as string;
		expect(source).toContain(`@keydown.esc.stop.prevent="$emit('close')"`);
		expect(source).toMatch(/ref="backButton"[\s\S]*?data-testid="credit-remainder-back"/);
		expect(source).toMatch(/const el = backButton\.value\?\.\$el \|\| backButton\.value;\s*el\?\.focus\?\.\(\);/);
		expect(source).toMatch(/icon="mdi-close"[\s\S]*?data-testid="credit-remainder-close"\s*@click="\$emit\('close'\)"/);
	});

	it("Payments applies the credit again every time it opens, and remembers the cashier's switch", () => {
		const script = paymentsSource.slice(paymentsSource.indexOf("<script"));
		// Not used up on the first opening (that lost the credit after "Go back").
		expect(script).not.toContain("takeExchangeCredit");
		expect(script).toMatch(/const exchange =\s*!doc\.is_return &&\s*pos_profile\.value\?\.use_customer_credit &&\s*customersStore\.isCreditOn\(doc\.customer\);/);
		expect(paymentsSource).toContain('@update:redeem-customer-credit="setRedeemCustomerCredit"');
		expect(script).toMatch(/customersStore\.setCreditOn\(invoice_doc\.value\?\.customer \|\| null, Boolean\(value\)\)/);
		// A submitted sale ends it; a submitted return leaves the exchange on.
		expect(script).toMatch(/if \(!submittedReturn\) customersStore\.setCreditOn\(null, false\);/);
	});

	it("Payments asks on every submit route, goes back to the cart on Go back, and prints the balance voucher after the sale", () => {
		const script = paymentsSource.slice(paymentsSource.indexOf("<script"));
		const wrapper = script.slice(script.indexOf("const submitInvoiceWrapper"), script.indexOf("// Keyboard Shortcuts"));
		const ask = wrapper.indexOf("await askCreditRemainder()");
		expect(ask).toBeGreaterThan(0);
		expect(ask).toBeLessThan(wrapper.indexOf("await submitInvoice(print"));
		// Add more items -> cart; cross / Escape -> stay; only "submit" goes on.
		expect(wrapper).toMatch(/const choice = await askCreditRemainder\(\);\s*if \(choice === "back"\) \{\s*back_to_invoice\(\);\s*return;\s*\}\s*if \(choice !== "submit"\) return;/);
		expect(paymentsSource).toContain(`@confirm="settleCreditRemainder('submit')"`);
		expect(paymentsSource).toContain(`@back="settleCreditRemainder('back')"`);
		expect(paymentsSource).toContain(`@close="settleCreditRemainder('close')"`);
		expect(script).toMatch(/resolve\?\.\(choice \|\| "close"\);/);
		expect(wrapper).toMatch(/onSubmitted: \(info\) => \{\s*void printBalanceVouchers\(remainderSlips, info\);/);
		// Returns never ask.
		expect(wrapper).toMatch(/const submittedReturn = Boolean\(invoice_doc\.value\?\.is_return\);\s*const remainderSlips = submittedReturn\s*\? \[\]/);
		// The slip prints whether or not the receipt prints, after the receipt.
		const printer = script.slice(script.indexOf("const printBalanceVouchers"), script.indexOf("// Credit worth more", script.indexOf("const printBalanceVouchers")) > 0 ? script.indexOf("// Credit worth more", script.indexOf("const printBalanceVouchers")) : undefined);
		expect(printer).toContain("if (receiptPrintPromise) await receiptPrintPromise;");
		expect(printer).toContain("recordBalanceVoucherPrint(");
		expect(printer).toContain("balanceVoucherSettings(name)");
	});
});
