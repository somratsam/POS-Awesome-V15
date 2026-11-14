import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canUseDesk } from "../src/posapp/utils/deskAccess";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");
const navbarSource = read("src/posapp/components/Navbar.vue");
const menuSource = read("src/posapp/components/navbar/NavbarMenu.vue");
const appBarSource = read("src/posapp/components/navbar/NavbarAppBar.vue");
const invoiceSource = read("src/posapp/components/pos/Invoice.vue");
const arabic = read("../posawesome/translations/ar.csv");

describe("Back to Desk: who sees it", () => {
	it("is for users with Desk access (System User) and Administrator only", () => {
		const ctx = (user: string, user_type?: string) => ({ session: { user }, boot: { user: { user_type } } });
		expect(canUseDesk(ctx("Administrator"))).toBe(true);
		expect(canUseDesk(ctx("cashier@x.test", "System User"))).toBe(true);
		expect(canUseDesk(ctx("shopper@x.test", "Website User"))).toBe(false);
		expect(canUseDesk(ctx("cashier@x.test"))).toBe(false);
		expect(canUseDesk(ctx("Guest", "System User"))).toBe(false);
		expect(canUseDesk(undefined)).toBe(false);
	});

	it("is a back-arrow icon button with a tooltip, first in the top bar, gated on canUseDesk", () => {
		const button = appBarSource.match(/<v-tooltip v-if="showBackToDesk"[\s\S]*?<\/v-tooltip>/)?.[0] || "";
		expect(button).toContain(":text=\"__('Back to Desk')\"");
		expect(button).toContain('@click="$emit(\'go-desk\')"');
		expect(button).toContain('isRtl ? "mdi-arrow-right" : "mdi-arrow-left"');
		expect(appBarSource).toMatch(/showBackToDesk\(\) \{\s*return canUseDesk\(\);/);
		// Before the drawer icon and the store title.
		expect(appBarSource.indexOf("navbar-back-to-desk")).toBeLessThan(appBarSource.indexOf("<v-app-bar-nav-icon"));
		expect(appBarSource.indexOf("navbar-back-to-desk")).toBeLessThan(appBarSource.indexOf("<v-toolbar-title"));
		expect(appBarSource).toMatch(/\.back-to-desk-btn \{\s*order: -1;/);
	});

	it("is forwarded by the real caller: Navbar listens for go-desk on NavbarAppBar", () => {
		const barTag = navbarSource.match(/<NavbarAppBar[\s\S]*?>/)?.[0] || "";
		expect(barTag).toContain('@go-desk="goDesk"');
	});

	it("is no longer in the Menu", () => {
		expect(menuSource).not.toContain("back-to-desk");
		expect(menuSource).not.toContain("go-desk");
		expect(menuSource).not.toContain("Back to Desk");
	});
});

describe("Back to Desk: no sale lost silently", () => {
	// The Navbar methods, run against a small stand-in for the component.
	const methodsSource = navbarSource.slice(navbarSource.indexOf("goDesk() {"), navbarSource.indexOf("openCloseShift() {"));
	// eslint-disable-next-line no-new-func
	let cartCount = 0;
	const methods = new Function("useInvoiceStore", `return { ${methodsSource} };`)(() => ({ itemsCount: cartCount }));

	const makeVm = (itemsCount: number, saved?: boolean | "no-listener") => {
		cartCount = itemsCount;
		const vm: any = {
			leavePosDialog: false,
			leavingPos: false,
			toastStore: { show: vi.fn() },
			__: (text: string) => text,
			leaveToDesk: vi.fn(),
			eventBus: {
				emit: vi.fn((name: string, request: any) => {
					if (saved === "no-listener") return;
					request.handled = true;
					request.done(saved);
				}),
			},
		};
		vm.goDesk = methods.goDesk.bind(vm);
		vm.confirmLeavePos = methods.confirmLeavePos.bind(vm);
		return vm;
	};

	it("leaves straight away with an empty cart", () => {
		const vm = makeVm(0);
		vm.goDesk();
		expect(vm.leaveToDesk).toHaveBeenCalledOnce();
		expect(vm.leavePosDialog).toBe(false);
	});

	it("asks first when the cart has items", () => {
		const vm = makeVm(2);
		vm.goDesk();
		expect(vm.leaveToDesk).not.toHaveBeenCalled();
		expect(vm.leavePosDialog).toBe(true);
	});

	it("saves the sale as a draft, then leaves", () => {
		const vm = makeVm(2, true);
		vm.goDesk();
		vm.confirmLeavePos();
		expect(vm.eventBus.emit).toHaveBeenCalledWith("save_draft_before_leaving", expect.any(Object));
		expect(vm.leaveToDesk).toHaveBeenCalledOnce();
		expect(vm.leavePosDialog).toBe(false);
	});

	it("stays when the draft could not be saved", () => {
		const vm = makeVm(2, false);
		vm.goDesk();
		vm.confirmLeavePos();
		expect(vm.leaveToDesk).not.toHaveBeenCalled();
		expect(vm.leavePosDialog).toBe(true);
		expect(vm.leavingPos).toBe(false);
	});

	it("stays and says so when nothing could save the sale", () => {
		const vm = makeVm(2, "no-listener");
		vm.goDesk();
		vm.confirmLeavePos();
		expect(vm.leaveToDesk).not.toHaveBeenCalled();
		expect(vm.toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({ title: "The current sale couldn't be saved. It is still in the cart." }),
		);
	});

	it("the title click goes through the same guard, and the cart saves via Save & Clear", () => {
		expect(navbarSource).toContain('@go-desk="goDesk"');
		expect(navbarSource).not.toMatch(/goDesk\(\) \{\s*window\.location\.href/);
		expect(invoiceSource).toMatch(
			/save_draft_before_leaving: \(request\) => \{\s*if \(!request\) return;\s*request\.handled = true;\s*Promise\.resolve\(this\.save_and_clear_invoice\(\)\)/,
		);
	});

	it("has Arabic for every new string", () => {
		for (const text of [
			"Back to Desk",
			"Leave the POS?",
			"The current sale will be kept as a draft.",
			"Stay",
			"Save draft and leave",
			"The current sale couldn't be saved. It is still in the cart.",
			"Walk-in (no customer)",
		]) {
			expect(arabic).toContain(`\n${text},`);
		}
		expect(arabic).toContain("Walk-in (no customer),عميل عابر (بدون عميل)");
	});
});
