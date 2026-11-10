// @vitest-environment jsdom

// Bank offer rates (POS Discount Reason "Offer %"): a reminder for the
// cashier only. Shown in the ⓘ list by the Disc % title and as a chip on each
// reason in the prompt; a reason whose rate differs from the line's Disc %
// shows an orange "Change % / Keep" line. Nothing here ever sets a discount.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";

import DiscountReasonDialog from "../src/posapp/components/pos/invoice/DiscountReasonDialog.vue";
import DiscountOfferRates from "../src/posapp/components/pos/invoice/DiscountOfferRates.vue";
import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";
import dialogSource from "../src/posapp/components/pos/invoice/DiscountReasonDialog.vue?raw";
import { useUIStore } from "../src/posapp/stores/uiStore";
import {
	formatOfferRate,
	lineDiscountPercent,
	linesOffReasonRate,
	reasonMatchesPercent,
	reasonOfferRate,
	sortReasonsForLines,
} from "../src/posapp/utils/discountReasons";

const passthrough = (name: string, tag = "div") =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h(tag, { ...attrs }, slots.default?.());
		},
	});

const VDialogStub = defineComponent({
	name: "VDialog",
	props: { modelValue: Boolean, persistent: Boolean, contentProps: { type: Object, default: () => ({}) } },
	setup(props, { slots }) {
		return () =>
			props.modelValue ? h("div", { ...props.contentProps, class: "v-overlay__content", tabindex: -1 }, slots.default?.()) : null;
	},
});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup(props, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-testid": attrs["data-testid"],
					"data-reason": attrs["data-reason"],
					"data-match": attrs["data-match"],
					"data-dim": attrs["data-dim"],
					"aria-checked": attrs["aria-checked"],
					"aria-label": attrs["aria-label"],
					disabled: props.disabled,
					onClick: (event: Event) => emit("click", event),
				},
				slots.default?.(),
			);
	},
});

const VCheckboxStub = defineComponent({
	name: "VCheckbox",
	inheritAttrs: false,
	props: { modelValue: { type: Boolean, default: false } },
	emits: ["update:modelValue"],
	setup(props, { attrs, emit }) {
		return () =>
			h("input", {
				type: "checkbox",
				"data-testid": attrs["data-testid"],
				checked: props.modelValue,
				onChange: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).checked),
			});
	},
});

const VMenuStub = defineComponent({
	name: "VMenu",
	setup(_props, { slots }) {
		return () => h("div", [slots.activator?.({ props: {} }), slots.default?.()]);
	},
});

const components = {
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardSubtitle: passthrough("VCardSubtitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VSpacer: passthrough("VSpacer"),
	VIcon: passthrough("VIcon", "i"),
	VAlert: passthrough("VAlert"),
	VBtn: VBtnStub,
	VCheckbox: VCheckboxStub,
	VMenu: VMenuStub,
};

const REASONS = [
	{ name: "NBO Sadara", display_order: 1, offer_percentage: 20 },
	{ name: "OAB Credit Card", display_order: 4, offer_percentage: 10 },
	{ name: "Bank Muscat Asalah", display_order: 7, offer_percentage: 15 },
	{ name: "WGO", display_order: 10, offer_percentage: 0 },
	{ name: "Staff", display_order: 14 },
];

const line = (percent: number, extra: Record<string, unknown> = {}) => ({
	posa_row_id: `r${percent}`,
	item_name: "Navy 38",
	discount_percentage: percent,
	...extra,
});

describe("offer rate helpers", () => {
	it("0, blank and missing all mean no fixed rate", () => {
		expect(reasonOfferRate({ name: "a", offer_percentage: 20 })).toBe(20);
		for (const rate of [0, null, undefined, "", "abc"]) {
			expect(reasonOfferRate({ name: "a", offer_percentage: rate as any })).toBeNull();
		}
	});

	it("formats rates without trailing zeros", () => {
		expect(formatOfferRate(20)).toBe("20%");
		expect(formatOfferRate(12.5)).toBe("12.5%");
		expect(formatOfferRate(14.999)).toBe("15%");
	});

	it("a line's Disc % matches a rate within rounding, and a line without Disc % matches nothing", () => {
		const sadara = REASONS[0];
		expect(reasonMatchesPercent(sadara, 20)).toBe(true);
		expect(reasonMatchesPercent(sadara, 19.999)).toBe(true);
		expect(reasonMatchesPercent(sadara, 15)).toBe(false);
		expect(reasonMatchesPercent(REASONS[3], 0)).toBe(false);
		expect(lineDiscountPercent({ discount_percentage: 0, discount_amount: 5 })).toBeNull();
	});

	it("matching reasons come first, the rest keep their order", () => {
		expect(sortReasonsForLines(REASONS, [line(15)]).map((r) => r.name)).toEqual([
			"Bank Muscat Asalah",
			"NBO Sadara",
			"OAB Credit Card",
			"WGO",
			"Staff",
		]);
		expect(sortReasonsForLines(REASONS, [line(12)]).map((r) => r.name)).toEqual(REASONS.map((r) => r.name));
	});

	it("only reasons with a rate can be off-rate", () => {
		expect(linesOffReasonRate(REASONS[0], [line(15), line(20)]).map((l) => l.discount_percentage)).toEqual([15]);
		expect(linesOffReasonRate(REASONS[4], [line(15)])).toEqual([]);
		expect(linesOffReasonRate(REASONS[3], [line(15)])).toEqual([]);
	});
});

describe("DiscountReasonDialog offer rates", () => {
	let ui: ReturnType<typeof useUIStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
		ui = useUIStore();
		ui.setRegisterData({ discount_reasons: REASONS } as any);
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	const open = async (request: Record<string, any> = {}) => {
		const wrapper = mount(DiscountReasonDialog, { attachTo: document.body, global: { components } });
		const result = ui.requestDiscountReason({ mode: "line", lines: [line(15)], ...request });
		await nextTick();
		await nextTick();
		return { wrapper, result };
	};
	const optionNames = (wrapper: any) => wrapper.findAll("[data-reason]").map((b: any) => b.attributes("data-reason"));

	it("shows each reason's rate as a chip, matching reasons first: green chip, no ✓, the others dimmed", async () => {
		const { wrapper } = await open();
		expect(optionNames(wrapper)).toEqual(["Bank Muscat Asalah", "NBO Sadara", "OAB Credit Card", "WGO", "Staff"]);
		expect(wrapper.get('[data-testid="discount-reason-rate-NBO Sadara"]').text()).toBe("20%");
		const matchChip = wrapper.get('[data-testid="discount-reason-rate-Bank Muscat Asalah"]');
		expect(matchChip.text()).toBe("15%");
		expect(matchChip.classes()).toContain("discount-reason__rate--match");
		expect(wrapper.get('[data-reason="Bank Muscat Asalah"]').attributes("data-match")).toBe("true");
		expect(wrapper.get('[data-reason="NBO Sadara"]').attributes("data-match")).toBeUndefined();
		// A match is a hint, not a selection: no ✓, not checked, not dimmed.
		expect(wrapper.text()).not.toContain("✓");
		expect(wrapper.get('[data-reason="Bank Muscat Asalah"]').attributes("aria-checked")).toBe("false");
		expect(wrapper.get('[data-reason="Bank Muscat Asalah"]').attributes("data-dim")).toBeUndefined();
		for (const name of ["NBO Sadara", "OAB Credit Card", "WGO", "Staff"]) {
			expect(wrapper.get(`[data-reason="${name}"]`).attributes("data-dim")).toBe("true");
		}
		// No rate, no chip.
		expect(wrapper.find('[data-testid="discount-reason-rate-WGO"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="discount-reason-rate-Staff"]').exists()).toBe(false);
		// The first (matching) reason gets focus, so Enter takes it.
		await nextTick();
		expect((document.activeElement as HTMLElement)?.dataset?.reason).toBe("Bank Muscat Asalah");
		wrapper.unmount();
	});

	it("the ✓ and strong highlight go only on the one selected reason", async () => {
		const { wrapper } = await open();
		await wrapper.get('[data-reason="Staff"]').trigger("click");
		const marks = wrapper.findAll('[data-testid="discount-reason-selected-mark"]');
		expect(marks).toHaveLength(1);
		expect(wrapper.get('[data-reason="Staff"]').text()).toContain("✓");
		expect(wrapper.get('[data-reason="Staff"]').attributes("aria-checked")).toBe("true");
		// Selected, so not dimmed even though it doesn't match.
		expect(wrapper.get('[data-reason="Staff"]').attributes("data-dim")).toBeUndefined();
		expect(wrapper.get('[data-reason="Bank Muscat Asalah"]').text()).not.toContain("✓");
		wrapper.unmount();
	});

	it("nothing is dimmed when no reason matches the typed %", async () => {
		const { wrapper } = await open({ lines: [line(12)] });
		expect(wrapper.findAll('[data-dim="true"]')).toHaveLength(0);
		wrapper.unmount();
	});

	it("a matching reason, or one without a rate: select, then Confirm (labelled with the rate)", async () => {
		for (const [name, label] of [
			["Bank Muscat Asalah", "Confirm: Bank Muscat Asalah · 15%"],
			["Staff", "Confirm: Staff"],
			["WGO", "Confirm: WGO"],
		]) {
			const { wrapper, result } = await open();
			await wrapper.get(`[data-reason="${name}"]`).trigger("click");
			expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(false);
			expect(ui.discountReasonRequest).not.toBeNull();
			const confirmButton = wrapper.get('[data-testid="discount-reason-confirm"]');
			expect(confirmButton.text()).toBe(label);
			await confirmButton.trigger("click");
			await expect(result).resolves.toEqual({ reason: name, applyToOthers: false });
			wrapper.unmount();
		}
	});

	it("an off-rate pick shows the orange line; Keep records it with the line's % untouched", async () => {
		const l = line(15);
		const { wrapper, result } = await open({ lines: [l] });
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(ui.discountReasonRequest).not.toBeNull();
		const warning = wrapper.get('[data-testid="discount-reason-rate-warning"]');
		expect(warning.text()).toContain("NBO Sadara is usually 20%; this line has 15%.");
		const confirmButton = wrapper.get('[data-testid="discount-reason-confirm"]');
		expect(confirmButton.text()).toBe("Confirm: NBO Sadara · 20%");
		expect(confirmButton.attributes("disabled")).toBeDefined();
		await nextTick();
		expect((document.activeElement as HTMLElement)?.dataset?.testid).toBe("discount-reason-change-percent");
		// Enter outside a button, or a second tap on the same reason, never skips the question.
		await wrapper.get('[data-testid="discount-reason-dialog"]').trigger("keydown", { key: "Enter" });
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(ui.discountReasonRequest).not.toBeNull();
		await wrapper.get('[data-testid="discount-reason-keep"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: false });
		expect(l.discount_percentage).toBe(15);
		wrapper.unmount();
	});

	it("Change % resolves without recording the reason, carrying the pick to preselect later", async () => {
		const { wrapper, result } = await open();
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		await wrapper.get('[data-testid="discount-reason-change-percent"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: false, changePercent: true });
		wrapper.unmount();
	});

	it("selecting another reason clears the warning", async () => {
		const { wrapper, result } = await open();
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(true);
		await wrapper.get('[data-reason="Bank Muscat Asalah"]').trigger("click");
		expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(false);
		await wrapper.get('[data-testid="discount-reason-confirm"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "Bank Muscat Asalah", applyToOthers: false });
		wrapper.unmount();
	});

	it("a preselected off-rate reason shows the warning straight away, and Enter doesn't skip it", async () => {
		const { wrapper } = await open({ preselect: "NBO Sadara" });
		expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(true);
		await wrapper.get('[data-testid="discount-reason-dialog"]').trigger("keydown", { key: "Enter" });
		expect(wrapper.get('[data-testid="discount-reason-rate-warning"]').text()).toContain("NBO Sadara is usually 20%");
		expect(ui.discountReasonRequest).not.toBeNull();
		wrapper.unmount();
	});

	it("'Also use for' checks the other lines' Disc % too", async () => {
		const { wrapper, result } = await open({
			lines: [line(20)],
			otherMissingCount: 2,
			otherLines: [line(15, { posa_row_id: "b" }), line(10, { posa_row_id: "c" })],
		});
		await wrapper.get('[data-testid="discount-reason-apply-others"]').setValue(true);
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(wrapper.get('[data-testid="discount-reason-rate-warning"]').text()).toContain(
			"NBO Sadara is usually 20%; 2 of these lines have 15%, 10%.",
		);
		await wrapper.get('[data-testid="discount-reason-keep"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: true });
		wrapper.unmount();
	});

	it("without 'Also use for', only the line itself is checked", async () => {
		const { wrapper, result } = await open({
			lines: [line(20)],
			otherMissingCount: 1,
			otherLines: [line(15, { posa_row_id: "b" })],
		});
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(false);
		await wrapper.get('[data-testid="discount-reason-confirm"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: false });
		wrapper.unmount();
	});

	it("ticking 'Also use for' after selecting shows the warning for the other lines at once", async () => {
		const { wrapper } = await open({
			lines: [line(20)],
			otherMissingCount: 1,
			otherLines: [line(15, { posa_row_id: "b" })],
		});
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(wrapper.find('[data-testid="discount-reason-rate-warning"]').exists()).toBe(false);
		await wrapper.get('[data-testid="discount-reason-apply-others"]').setValue(true);
		expect(wrapper.get('[data-testid="discount-reason-rate-warning"]').text()).toContain("one of these lines has 15%");
		wrapper.unmount();
	});

	it("on the Pay check, a matching selection is recorded for every listed line with Confirm", async () => {
		const { wrapper, result } = await open({ mode: "pay", lines: [line(20), line(20, { posa_row_id: "b" })] });
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(ui.discountReasonRequest).not.toBeNull();
		await wrapper.get('[data-testid="discount-reason-confirm"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: false });
		wrapper.unmount();
	});

	it("on the Pay check, Change % goes back to the cart (payment stays blocked)", async () => {
		const { wrapper, result } = await open({ mode: "pay", lines: [line(15), line(20, { posa_row_id: "b" })] });
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		expect(wrapper.get('[data-testid="discount-reason-rate-warning"]').text()).toContain(
			"NBO Sadara is usually 20%; one of these lines has 15%.",
		);
		await wrapper.get('[data-testid="discount-reason-change-percent"]').trigger("click");
		await expect(result).resolves.toBeNull();
		wrapper.unmount();
	});

	it("reasons without any rates behave exactly as before (old cached boot data)", async () => {
		ui.setRegisterData({ discount_reasons: [{ name: "NBO Sadara" }, { name: "Staff" }] } as any);
		const { wrapper, result } = await open();
		expect(optionNames(wrapper)).toEqual(["NBO Sadara", "Staff"]);
		expect(wrapper.find(".discount-reason__rate").exists()).toBe(false);
		await wrapper.get('[data-reason="NBO Sadara"]').trigger("click");
		await wrapper.get('[data-testid="discount-reason-confirm"]').trigger("click");
		await expect(result).resolves.toEqual({ reason: "NBO Sadara", applyToOthers: false });
		wrapper.unmount();
	});

	it("the dialog never writes a discount or a rate", () => {
		expect(dialogSource).not.toMatch(/discount_percentage\s*=[^=]/);
		expect(dialogSource).not.toMatch(/offer_percentage\s*=[^=]/);
	});
});

describe("DiscountOfferRates (ⓘ by Disc %)", () => {
	beforeEach(() => {
		(window as any).__ = (text: string, args?: any[]) =>
			args ? text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) : text;
	});

	it("lists the reasons with a rate, read-only, and names the ones without", () => {
		const wrapper = mount(DiscountOfferRates, { props: { reasons: REASONS }, global: { components } });
		const rows = wrapper
			.findAll('[data-testid^="discount-offer-rate-"]')
			.map((row) => row.findAll("span").map((part) => part.text()).join(" "));
		expect(rows).toEqual(["NBO Sadara · 20%", "OAB Credit Card · 10%", "Bank Muscat Asalah · 15%"]);
		expect(wrapper.get('[data-testid="discount-offer-rates-unrated"]').text()).toBe("No fixed rate: WGO, Staff");
		expect(wrapper.find("input").exists()).toBe(false);
	});

	it("the button stops click and Enter/Space from reaching the header's sort", async () => {
		let headerClicks = 0;
		let headerKeys = 0;
		const Host = defineComponent({
			setup: () => () =>
				h("th", { onClick: () => headerClicks++, onKeydown: () => headerKeys++ }, [h(DiscountOfferRates, { reasons: REASONS })]),
		});
		const wrapper = mount(Host, { global: { components } });
		const button = wrapper.get('[data-testid="discount-offer-rates-button"]');
		await button.trigger("click");
		await button.trigger("keydown", { key: "Enter" });
		await button.trigger("keydown", { key: " " });
		expect([headerClicks, headerKeys]).toEqual([0, 0]);
	});

	it("is hidden when no reason has a rate", () => {
		const wrapper = mount(DiscountOfferRates, {
			props: { reasons: [{ name: "Staff" }, { name: "WGO", offer_percentage: 0 }] },
			global: { components },
		});
		expect(wrapper.find('[data-testid="discount-offer-rates-button"]').exists()).toBe(false);
	});
});

describe("ItemsTable.vue wiring", () => {
	it("puts the ⓘ in the Disc % header, only where the store asks for a reason", () => {
		expect(itemsTableSource).toMatch(/<template #header\.discount_percentage="\{ column, getSortIcon, isSorted \}">/);
		expect(itemsTableSource).toMatch(
			/<span v-if="showOfferRates" class="posa-disc-header__info">\s*<DiscountOfferRates :reasons="uiStore\.discountReasons" \/>/,
		);
		expect(itemsTableSource).toMatch(
			/const showOfferRates = computed\(\s*\(\) => !props\.isReturnInvoice && isDiscountReasonRequired\(props\.pos_profile\),?\s*\);/,
		);
	});

	it("passes the other missing lines and handles Change % without setting the reason", () => {
		const prompt = itemsTableSource.match(/const promptDiscountReason = async \([\s\S]*?\n\};/)?.[0] || "";
		expect(prompt).toMatch(/otherLines: others,/);
		expect(prompt).toMatch(
			/if \(result\?\.changePercent\) \{[\s\S]*?line\._discount_reason_hint = result\.reason;\s*stayOnGridEntryFromItem\(line, "discount_percentage", \{ editNow: true \}\);\s*return;\s*\}/,
		);
		expect(prompt).toMatch(/line\._discount_reason_hint \|\| preselectDiscountReason/);
		// The hint is preselected only; the reason is set only by a real pick.
		const changeBranch = prompt.match(/if \(result\?\.changePercent\) \{[\s\S]*?\n\t\}/)?.[0] || "";
		expect(changeBranch).not.toMatch(/setLineDiscountReason/);
		expect(prompt).not.toMatch(/discount_percentage\s*=[^=]/);
	});
});
