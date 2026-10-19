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
import { frappeCallPending, frappeCallRejected, frappeCallResolved } from "./helpers/frappeCallPromise";

const passthrough = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots }) {
			return () => h("div", slots.default?.());
		},
	});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup(props, { slots, emit }) {
		return () =>
			h(
				"button",
				{ type: "button", disabled: props.disabled, onClick: (event: Event) => emit("click", event) },
				slots.default?.(),
			);
	},
});

const stubs = {
	VDialog: passthrough("VDialog"),
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VContainer: passthrough("VContainer"),
	VRow: passthrough("VRow"),
	VCol: passthrough("VCol"),
	VAutocomplete: passthrough("VAutocomplete"),
	VDataTable: passthrough("VDataTable"),
	VTextField: passthrough("VTextField"),
	VIcon: passthrough("VIcon"),
	VSpacer: passthrough("VSpacer"),
	VBtn: VBtnStub,
};

const DIALOG_DATA = {
	companies: [{ name: "My Co" }],
	pos_profiles_data: [{ name: "Test Pos", company: "My Co" }],
	payments_method: [{ parent: "Test Pos", mode_of_payment: "Cash", currency: "OMR" }],
};

let createVoucher: ReturnType<typeof vi.fn>;
// Anything a click handler throws or rejects reaches the app's errorHandler,
// which shows "An unexpected error occurred: ..." in the real POS.
let vueErrors: ReturnType<typeof vi.fn>;

const mountDialog = async (handlers: Record<string, unknown> = {}) => {
	const wrapper = mount(OpeningDialog, {
		props: { dialog: true, ...handlers },
		// The template calls frappe._() through the app's globals.
		global: {
			components: stubs,
			mocks: { frappe: (globalThis as any).frappe },
			config: { errorHandler: vueErrors },
		},
	});
	await flushPromises();
	return wrapper;
};

const submitButton = (wrapper: any) =>
	wrapper.findAll("button").find((b: any) => b.text().includes("Submit"));

const OPENED = { message: { pos_profile: { name: "Test Pos" }, pos_opening_shift: { name: "OPEN-1" } } };

describe("OpeningDialog Submit guards", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (text: string) => text);
		createVoucher = vi.fn();
		vueErrors = vi.fn();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.stubGlobal("frappe", {
			_: (text: string) => text,
			session: { user: "cashier@example.com" },
			// Like the real frappe.call: a jQuery promise, not a native one.
			call: vi.fn((methodOrOpts: any, args?: any) => {
				// get_opening_dialog_data uses the callback style.
				if (typeof methodOrOpts === "object") {
					methodOrOpts.callback?.({ message: DIALOG_DATA });
					return frappeCallResolved({ message: DIALOG_DATA });
				}
				return createVoucher(methodOrOpts, args);
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("opens a shift without raising an error, and re-enables Submit", async () => {
		createVoucher.mockImplementation(() => frappeCallResolved(OPENED));
		const onRegister = vi.fn();
		const onClose = vi.fn();
		const wrapper = await mountDialog({ onRegister, onClose });

		await submitButton(wrapper).trigger("click");
		await flushPromises();

		expect(onRegister).toHaveBeenCalledWith(OPENED.message);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(vueErrors).not.toHaveBeenCalled();
		expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();
	});

	it("sends one create request when Submit is pressed twice before the first returns", async () => {
		const pending = frappeCallPending<typeof OPENED>();
		createVoucher.mockImplementation(() => pending.promise);
		const onRegister = vi.fn();
		const onClose = vi.fn();
		const wrapper = await mountDialog({ onRegister, onClose });

		// Two clicks in the same tick: the button hasn't re-rendered as
		// disabled yet, so only submit_dialog's own guard can stop the second.
		const button = submitButton(wrapper);
		await Promise.all([button.trigger("click"), button.trigger("click")]);
		expect(createVoucher).toHaveBeenCalledTimes(1);
		expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

		pending.resolve(OPENED);
		await flushPromises();
		expect(onRegister).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(vueErrors).not.toHaveBeenCalled();
	});

	it("re-enables Submit after a failed create request, without an unexpected-error toast", async () => {
		createVoucher.mockImplementation(() => frappeCallRejected(new Error("already has an open POS shift")));
		const onRegister = vi.fn();
		const wrapper = await mountDialog({ onRegister });

		await submitButton(wrapper).trigger("click");
		await flushPromises();

		expect(onRegister).not.toHaveBeenCalled();
		expect(vueErrors).not.toHaveBeenCalled();
		expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();
		await submitButton(wrapper).trigger("click");
		expect(createVoucher).toHaveBeenCalledTimes(2);
	});
});
