// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

vi.mock("../src/offline/index", () => ({
	initPromise: Promise.resolve(),
	checkDbHealth: vi.fn(),
	getOpeningDialogStorage: vi.fn(() => null),
	setOpeningDialogStorage: vi.fn(),
	setOpeningStorage: vi.fn(),
	getBootstrapSnapshot: vi.fn(() => null),
	setBootstrapSnapshot: vi.fn(),
}));

vi.mock("../src/offline/bootstrapSnapshot", () => ({
	createBootstrapSnapshotFromRegisterData: vi.fn(() => ({})),
}));

import OpeningDialog from "../src/posapp/components/pos/shift/OpeningDialog.vue";
import { amountInputRule } from "../src/posapp/utils/closingAmount";
import { frappeCallResolved } from "./helpers/frappeCallPromise";

const passthrough = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots }) {
			return () => h("div", { "data-stub": name }, slots.default?.());
		},
	});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup(props, { slots, emit, attrs }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-test": attrs["data-test"],
					disabled: props.disabled,
					onClick: (event: Event) => emit("click", event),
				},
				slots.default?.(),
			);
	},
});

// A real <input> standing in for v-text-field, so typing, blur, the
// placeholder and the rules are exercised the way the dialog binds them.
const VTextFieldStub = defineComponent({
	name: "VTextField",
	inheritAttrs: false,
	props: {
		modelValue: { type: [String, Number], default: "" },
		placeholder: String,
		label: String,
		hint: String,
		rules: Array,
	},
	emits: ["update:modelValue", "blur", "focus", "keydown"],
	setup(props, { emit, attrs }) {
		return () =>
			h("input", {
				type: "text",
				"data-test": attrs["data-test"],
				"data-label": props.label,
				"data-hint": props.hint,
				placeholder: props.placeholder,
				value: props.modelValue,
				"data-error": (props.rules || []).some((rule: any) => rule(props.modelValue) !== true) ? "1" : "0",
				onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
				onBlur: (event: FocusEvent) => emit("blur", event),
				onFocus: (event: FocusEvent) => emit("focus", event),
			});
	},
});

const stubs = {
	VDialog: passthrough("VDialog"),
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VRow: passthrough("VRow"),
	VCol: passthrough("VCol"),
	VAutocomplete: passthrough("VAutocomplete"),
	VTextField: VTextFieldStub,
	VIcon: passthrough("VIcon"),
	VSpacer: passthrough("VSpacer"),
	VBtn: VBtnStub,
};

const MODES = [
	{ parent: "Test Pos", mode_of_payment: "Cash", currency: "OMR", type: "Cash" },
	{ parent: "Test Pos", mode_of_payment: "Visa", currency: "OMR", type: "Bank" },
	{ parent: "Test Pos", mode_of_payment: "Master Card", currency: "OMR", type: "Bank" },
	{ parent: "Test Pos", mode_of_payment: "Maal", currency: "OMR", type: "Bank" },
];

const dialogData = (overrides: Record<string, any> = {}) => ({
	companies: [{ name: "Swan" }],
	pos_profiles_data: [{ name: "Test Pos", company: "Swan", posa_decimal_precision: 3 }],
	payments_method: MODES,
	...overrides,
});

let data: ReturnType<typeof dialogData>;
let createVoucher: ReturnType<typeof vi.fn>;

const mountDialog = async () => {
	const wrapper = mount(OpeningDialog, {
		props: { dialog: true },
		global: { components: stubs, mocks: { frappe: (globalThis as any).frappe } },
	});
	await flushPromises();
	return wrapper;
};

const amountBoxes = (wrapper: any) => wrapper.findAll("input[data-test^='opening-amount-']");
const boxLabels = (wrapper: any) => amountBoxes(wrapper).map((box: any) => box.attributes("data-label"));
const openShift = (wrapper: any) => wrapper.find("button[data-test='open-shift']");
const sentBalanceDetails = () => createVoucher.mock.calls[0][1].balance_details;

describe("OpeningDialog cash-only amounts", () => {
	beforeEach(() => {
		data = dialogData();
		createVoucher = vi.fn(() =>
			frappeCallResolved({ message: { pos_profile: { name: "Test Pos" }, pos_opening_shift: { name: "OPEN-1" } } }),
		);
		vi.stubGlobal("__", (text: string, args?: any[]) =>
			args?.length ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text,
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.stubGlobal("frappe", {
			_: (text: string) => text,
			session: { user: "cashier@example.com" },
			defaults: { get_default: () => 2 },
			call: vi.fn((methodOrOpts: any, args?: any) => {
				if (typeof methodOrOpts === "object") {
					methodOrOpts.callback?.({ message: data });
					return frappeCallResolved({ message: data });
				}
				return createVoucher(methodOrOpts, args);
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("shows only Cash, as an empty Opening float box with a faint 0.000", async () => {
		const wrapper = await mountDialog();

		expect(boxLabels(wrapper)).toEqual(["Opening float"]);
		const cash = amountBoxes(wrapper)[0];
		expect(cash.attributes("data-hint")).toBe("Cash in the drawer at the start of the shift.");
		expect(wrapper.text()).toContain("Start your shift");
		expect(cash.element.value).toBe("");
		expect(cash.attributes("placeholder")).toBe("0.000");
		expect(cash.attributes("data-error")).toBe("0");
	});

	it("sends every mode, the empty and hidden ones as 0", async () => {
		const wrapper = await mountDialog();

		await openShift(wrapper).trigger("click");
		await flushPromises();

		expect(sentBalanceDetails()).toEqual([
			{ mode_of_payment: "Cash", amount: 0, currency: "OMR" },
			{ mode_of_payment: "Visa", amount: 0, currency: "OMR" },
			{ mode_of_payment: "Master Card", amount: 0, currency: "OMR" },
			{ mode_of_payment: "Maal", amount: 0, currency: "OMR" },
		]);
	});

	it("sends a typed cash float as a number", async () => {
		const wrapper = await mountDialog();
		const cash = amountBoxes(wrapper)[0];

		await cash.setValue("50.5");
		await openShift(wrapper).trigger("click");
		await flushPromises();

		expect(sentBalanceDetails()[0]).toEqual({ mode_of_payment: "Cash", amount: 50.5, currency: "OMR" });
		expect(sentBalanceDetails().slice(1).every((row: any) => row.amount === 0)).toBe(true);
	});

	it("turns a cleared box back into 0 on blur, and sends 0", async () => {
		const wrapper = await mountDialog();
		const cash = amountBoxes(wrapper)[0];

		await cash.setValue("20");
		await cash.setValue("");
		await cash.trigger("blur");
		expect(cash.element.value).toBe("");

		await openShift(wrapper).trigger("click");
		await flushPromises();
		expect(sentBalanceDetails()[0].amount).toBe(0);
	});

	it("blocks Open Shift on an amount with too many decimals", async () => {
		const wrapper = await mountDialog();
		const cash = amountBoxes(wrapper)[0];

		await cash.setValue("1.2345");

		expect(cash.attributes("data-error")).toBe("1");
		expect(openShift(wrapper).attributes("disabled")).toBeDefined();
		await openShift(wrapper).trigger("click");
		expect(createVoucher).not.toHaveBeenCalled();
	});

	it("shows the profile's own cash mode and any other Cash-type mode", async () => {
		data = dialogData({
			pos_profiles_data: [
				{ name: "Test Pos", company: "Swan", posa_cash_mode_of_payment: "Till Float", posa_decimal_precision: 3 },
			],
			payments_method: [
				{ parent: "Test Pos", mode_of_payment: "Till Float", currency: "OMR", type: "General" },
				{ parent: "Test Pos", mode_of_payment: "Visa", currency: "OMR", type: "Bank" },
				{ parent: "Test Pos", mode_of_payment: "Dollar Cash", currency: "OMR", type: "Cash" },
			],
		});
		const wrapper = await mountDialog();

		expect(boxLabels(wrapper)).toEqual(["Opening float", "Dollar Cash float"]);
	});

	it("shows every mode when the profile has no cash mode at all", async () => {
		data = dialogData({
			payments_method: MODES.filter((mode) => mode.mode_of_payment !== "Cash"),
		});
		const wrapper = await mountDialog();

		expect(boxLabels(wrapper)).toEqual(["Visa", "Master Card", "Maal"]);
		expect(amountBoxes(wrapper)[0].attributes("data-hint")).toBeFalsy();
	});

	it("still finds Cash by name in opening data saved before the mode types were sent", async () => {
		data = dialogData({
			payments_method: MODES.map(({ type: _type, ...mode }) => mode),
		});
		const wrapper = await mountDialog();

		expect(boxLabels(wrapper)).toEqual(["Opening float"]);
	});

	it("shows a summary line for one company and profile, and the pickers when there is a choice", async () => {
		let wrapper = await mountDialog();
		expect(wrapper.find("[data-test='opening-summary']").text()).toContain("Swan");
		expect(wrapper.find("[data-test='opening-summary']").text()).toContain("Test Pos");
		expect(wrapper.findAll("[data-stub='VAutocomplete']")).toHaveLength(0);

		data = dialogData({
			pos_profiles_data: [
				{ name: "Test Pos", company: "Swan" },
				{ name: "Second Pos", company: "Swan" },
			],
		});
		wrapper = await mountDialog();
		expect(wrapper.find("[data-test='opening-summary']").exists()).toBe(false);
		expect(wrapper.findAll("[data-stub='VAutocomplete']")).toHaveLength(2);
	});
});

describe("amountInputRule", () => {
	it("accepts the untouched number 0 that turned the old opening box red", () => {
		expect(amountInputRule(0, 3)).toBe(true);
		expect(amountInputRule("", 3)).toBe(true);
		expect(amountInputRule("12.500", 3)).toBe(true);
	});

	it("rejects text and too many decimals", () => {
		expect(amountInputRule("abc", 3)).toBe("Please enter a valid number");
		expect(amountInputRule("1.2345", 3)).toBe("Maximum of {0} decimal places");
	});
});
