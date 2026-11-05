// Tells a barcode scanner from a person typing in Check Stock's code box,
// by the time between keys. A scanner sends each key a few ms apart; a
// person is far slower. Same threshold as the main search's keyboard-scan
// detection (useScannerInput.ts's keyboardScanMaxInterval).
export const SCANNER_MAX_KEY_GAP_MS = 45;

export interface CodeEntryState {
	value: string;
	lastAt: number;
	fast: boolean;
}

export function createCodeEntryState(): CodeEntryState {
	return { value: "", lastAt: 0, fast: true };
}

/**
 * Update the state after the code box changed to `value` at time `now`.
 * Returns whether everything typed since the box was last emptied or
 * replaced came in at scanner speed. A paste, or a code set in one go,
 * counts as fast; a slow key or a deletion marks the entry as hand-typed.
 */
export function trackCodeEntry(state: CodeEntryState, value: string, now: number): boolean {
	const previous = state.value;
	if (!value) {
		state.fast = true;
	} else if (!previous || !value.startsWith(previous)) {
		// First key, or the old text was replaced (selected and typed over,
		// or pasted over): a new entry starts here. Only a single Backspace
		// is a hand edit -- a scan typed over a selected code can start with
		// the same digit as the old one.
		const isBackspace = previous.startsWith(value) && value.length === previous.length - 1;
		state.fast = !isBackspace;
	} else if (value.length === previous.length + 1) {
		if (now - state.lastAt > SCANNER_MAX_KEY_GAP_MS) state.fast = false;
	}
	// value grew by several characters at once (paste, or keys batched by
	// the browser): leave the speed as it was.
	state.value = value;
	state.lastAt = now;
	return state.fast;
}
