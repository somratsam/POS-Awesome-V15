import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useToastStore } from "../src/posapp/stores/toastStore";

// A new message that replaces the one on screen (same key) must stay up for
// its own full time, not the remainder of the previous one's.
describe("toastStore: a message merged into the one on screen restarts its timer", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("pauses the timer and sets the full timeout again for the new text", () => {
		const store = useToastStore();
		store.show({ title: "Voucher C26-1 has already been used.", color: "error", timeout: 8000, key: "v" });
		expect(store.visible).toBe(true);
		expect(store.timeout).toBe(8000);

		store.show({ title: "Voucher C26-2 expired on 01-09-2026.", color: "error", timeout: 8000, key: "v" });
		expect(store.text).toContain("C26-2 expired");
		expect(store.timeout).toBe(-1);
		vi.runAllTimers();
		expect(store.timeout).toBe(8000);
	});

	it("leaves a toast with another key queued as before", () => {
		const store = useToastStore();
		store.show({ title: "first", key: "a", timeout: 3000 });
		store.show({ title: "second", key: "b", timeout: 3000 });
		expect(store.text).toBe("first");
		expect(store.timeout).toBe(3000);
	});
});
