import { describe, expect, it } from "vitest";
import {
	SCANNER_MAX_KEY_GAP_MS,
	createCodeEntryState,
	trackCodeEntry,
} from "../src/posapp/composables/pos/items/stockLookupTyping";

// Feed the code one key at a time, `gap` ms apart; return the last answer.
function typeCode(code: string, gap: number, state = createCodeEntryState(), start = 1000) {
	let fast = true;
	for (let i = 1; i <= code.length; i += 1) {
		fast = trackCodeEntry(state, code.slice(0, i), start + i * gap);
	}
	return { fast, state };
}

describe("Check Stock: scanner speed vs hand typing", () => {
	it("a scanner (keys a few ms apart) counts as fast", () => {
		expect(typeCode("43649930030014", 8).fast).toBe(true);
		expect(typeCode("43649930030014", SCANNER_MAX_KEY_GAP_MS).fast).toBe(true);
	});

	it("a person typing (keys hundreds of ms apart) counts as hand-typed", () => {
		expect(typeCode("43649930030014", 600).fast).toBe(false);
	});

	it("one slow key in the middle makes the whole entry hand-typed", () => {
		const state = createCodeEntryState();
		trackCodeEntry(state, "436", 1000);
		trackCodeEntry(state, "4364", 1300);
		expect(trackCodeEntry(state, "43649", 1305)).toBe(false);
	});

	it("a paste of the whole code at once counts as fast", () => {
		expect(trackCodeEntry(createCodeEntryState(), "43649930030014", 1000)).toBe(true);
	});

	it("a Backspace marks the entry as hand-typed", () => {
		const { state } = typeCode("4364993", 5);
		expect(trackCodeEntry(state, "436499", 2000)).toBe(false);
	});

	it("a new scan typed over a selected code starts fresh, even with the same first digit", () => {
		const { state } = typeCode("4364993", 600); // hand-typed earlier
		expect(state.fast).toBe(false);
		let fast = trackCodeEntry(state, "4", 5000); // replaces the selected text
		for (const [i, value] of ["43", "436", "4364", "43649", "436499", "4364993"].entries()) {
			fast = trackCodeEntry(state, value, 5000 + (i + 1) * 6);
		}
		expect(fast).toBe(true);
	});

	it("emptying the box resets it", () => {
		const { state } = typeCode("4364993", 600);
		trackCodeEntry(state, "", 9000);
		expect(typeCode("4364993", 5, state, 9001).fast).toBe(true);
	});
});
