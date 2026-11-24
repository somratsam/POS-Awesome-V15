// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

const cart = vi.hoisted(() => ({ itemsCount: 0 }));

vi.mock("../src/posapp/stores/invoiceStore", () => ({
	useInvoiceStore: () => ({
		get itemsCount() {
			return cart.itemsCount;
		},
	}),
}));
vi.mock("../src/posapp/stores/customersStore", () => ({
	useCustomersStore: () => ({ pendingExchange: null }),
}));

import UpdatePrompt from "../src/posapp/components/ui/UpdatePrompt.vue";
import { useUpdateStore } from "../src/posapp/stores/updateStore";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: { value: false },
		rtlClasses: {},
		rtlStyles: {},
	}),
}));

const VDialogStub = defineComponent({
	name: "VDialogStub",
	emits: ["update:modelValue"],
	props: {
		modelValue: {
			type: Boolean,
			default: false,
		},
		persistent: {
			type: Boolean,
			default: false,
		},
		retainFocus: {
			type: Boolean,
			default: true,
		},
		scrim: {
			type: [Boolean, String],
			default: true,
		},
		maxWidth: {
			type: [String, Number],
			default: undefined,
		},
	},
	setup(props, { slots }) {
		return () =>
			h(
				"div",
				{
					"data-test": "update-dialog",
					"data-model-value": String(props.modelValue),
					"data-persistent": String(props.persistent),
					"data-retain-focus": String(props.retainFocus),
					"data-scrim": String(props.scrim),
					"data-max-width": String(props.maxWidth ?? ""),
				},
				slots.default?.(),
			);
	},
});

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const VButtonStub = defineComponent({
	name: "VButtonStub",
	emits: ["click"],
	props: {
		disabled: { type: Boolean, default: false },
		href: { type: String, default: undefined },
	},
	setup(props, { slots, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					disabled: props.disabled,
					onClick: () => emit("click"),
				},
				slots.default?.(),
			);
	},
});

const mountPrompt = () =>
	mount(UpdatePrompt, {
		global: {
			components: {
				VDialog: VDialogStub,
				VCard: BoxStub,
				VCardTitle: BoxStub,
				VCardText: BoxStub,
				VCardActions: BoxStub,
				VIcon: BoxStub,
				VSpacer: BoxStub,
				VBtn: VButtonStub,
			},
		},
	});

describe("UpdatePrompt", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorage.clear();
		cart.itemsCount = 0;
		(globalThis as any).__ = (value: string) => value;
	});

	it("renders the update prompt as a non-blocking dialog", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);

		const wrapper = mountPrompt();
		const dialog = wrapper.get('[data-test="update-dialog"]');

		expect(dialog.attributes("data-model-value")).toBe("true");
		expect(dialog.attributes("data-persistent")).toBe("false");
		expect(dialog.attributes("data-retain-focus")).toBe("false");
		expect(dialog.attributes("data-scrim")).toBe("false");
	});

	it("dismisses the update when the dialog closes externally", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);

		const wrapper = mountPrompt();

		wrapper.getComponent(VDialogStub).vm.$emit("update:modelValue", false);
		await wrapper.vm.$nextTick();

		expect(updateStore.dismissedVersion).toBe("build-2000");
		expect(updateStore.shouldPrompt).toBe(false);
		expect(wrapper.get('[data-test="update-dialog"]').attributes("data-model-value")).toBe("false");
	});

	it("tells the cashier to refresh, has no Reload Now and no release notes", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);
		updateStore.$patch({
			availableMessage: "commit message",
			availableBranch: "develop-swan",
			availableReleaseUrl: "https://example.invalid/notes",
			availableCommits: [{ commit_hash: "abc", commit_message: "commit message" }],
		});

		const wrapper = mountPrompt();
		expect(wrapper.text()).toContain(
			"A new version is available. When the cart is empty, refresh the page (Ctrl+F5) to update.",
		);
		const labels = wrapper.findAll("button").map((b) => b.text());
		expect(labels).toEqual(["Dismiss"]);
		expect(wrapper.find('[data-test="update-sale-in-progress"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("Release Notes");
		expect(wrapper.text()).not.toContain("commit message");
		expect(wrapper.text()).not.toContain("develop-swan");
		expect(wrapper.text()).not.toContain("commits");
	});

	it("says to finish the sale first while the cart has items; Dismiss still works", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);
		const reload = vi.fn();
		updateStore.setReloadAction(reload);
		cart.itemsCount = 3;

		const wrapper = mountPrompt();
		expect(wrapper.get('[data-test="update-sale-in-progress"]').text()).toContain(
			"Finish or save the current sale first",
		);
		updateStore.reloadNow();
		expect(reload).not.toHaveBeenCalled();
		const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "Dismiss")!;
		await dismissBtn.trigger("click");
		expect(updateStore.shouldPrompt).toBe(false);
	});

	it("comes back after Dismiss only for a newer version", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);
		const wrapper = mountPrompt();
		const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "Dismiss")!;
		await dismissBtn.trigger("click");
		const dialog = () => wrapper.get('[data-test="update-dialog"]').attributes("data-model-value");
		expect(dialog()).toBe("false");

		updateStore.setAvailableVersion("build-2000", 2000);
		await wrapper.vm.$nextTick();
		expect(dialog()).toBe("false");

		updateStore.setAvailableVersion("build-3000", 3000);
		await wrapper.vm.$nextTick();
		expect(dialog()).toBe("true");
	});
});
