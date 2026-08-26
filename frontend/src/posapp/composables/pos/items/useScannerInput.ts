import { ref, nextTick, onMounted, onUnmounted } from "vue";
import { useToastStore } from "../../../stores/toastStore";
import {
	normalizeScaleBarcodeSettings,
	parseScaleBarcodeSettingsResponse,
	getScaleBarcodePrefix,
	scaleBarcodeMatches,
} from "../../../utils/scaleBarcode.js";
import {
	getScanTimestamp,
	isBarcodeCandidateChar,
	isLikelyKeyboardScan,
	isSearchFieldPrimedForScan,
} from "../../../utils/keyboardScan.js";
import {
	perfMarkStart,
	perfMarkEnd,
	scheduleFrame,
} from "../../../utils/perf.js";
import { classifyClipboardScanText } from "./scannerInput/clipboardScan";

declare const frappe: any;
declare const __: (_str: string, _args?: any[]) => string;
declare const onScan: any;

// "high" confidence means the trigger itself independently proves this was a
// deliberate scan -- real scanner-hardware keystroke timing (isLikelyKeyboardScan,
// or the onScan.js library's own document-level detection), or a locally
// already-confirmed exact barcode match. A miss for these is a genuine signal
// worth surfacing (a real scan of an unregistered/mislabeled item).
// "low" confidence means the trigger only *looks* barcode-shaped by charset/
// length (idle-settle typing, paste, or a blind numeric-length heuristic) --
// real search terms (style codes, item codes) can be indistinguishable from a
// real barcode by shape alone, so a miss here must not alarm the user; it
// just means this wasn't a barcode, and normal search proceeds undisturbed.
// See PROGRESS_NOTES.md section 34.
export type ScanConfidence = "high" | "low";

export interface ScannerInputOptions {
	onScan?: (
		_code: string,
		_confidence?: ScanConfidence,
	) => Promise<void> | void;
	getSearchInput?: () => string;
	setSearchInput?: (_val: string) => void;
	clearSearch?: () => void;
	focusSearch?: () => void;
}

export function useScannerInput(options: ScannerInputOptions = {}) {
	// Handlers (Ref-based for lazy binding)
	const onScanHandler = ref(options.onScan || null);
	const getSearchInputHandler = ref(options.getSearchInput || null);
	const setSearchInputHandler = ref(options.setSearchInput || null);
	const clearSearchHandler = ref(options.clearSearch || null);
	const focusSearchHandler = ref(options.focusSearch || null);

	const setScanHandler = (
		fn: (_code: string, _confidence?: ScanConfidence) => Promise<void> | void,
	) => {
		onScanHandler.value = fn;
	};
	const setInputHandlers = (handlers: {
		get?: () => string;
		set?: (_val: string) => void;
		clear?: () => void;
		focus?: () => void;
	}) => {
		if (handlers.get) getSearchInputHandler.value = handlers.get;
		if (handlers.set) setSearchInputHandler.value = handlers.set;
		if (handlers.clear) clearSearchHandler.value = handlers.clear;
		if (handlers.focus) focusSearchHandler.value = handlers.focus;
	};

	const toastStore = useToastStore();

	// State
	const scannerLocked = ref(false);
	const cameraScannerActive = ref(false); // To tracked if camera UI is open
	const scanErrorDialog = ref(false);
	const scanErrorMessage = ref("");
	const scanErrorCode = ref("");
	const scanErrorDetails = ref("");
	// Non-blocking, dismissible hint shown after a scan-add of an item that
	// belongs to a variant family (item.variant_of set) -- "other
	// sizes/colors may be available". Only the most recently scanned such
	// item's hint is shown; set/replaced on every scan-add (variant or not)
	// so it never lingers on a stale item. Purely informational -- never
	// blocks or delays the scan-and-add flow itself, and never fetches
	// anything on its own (see useScanProcessor.ts's addScannedItemToInvoice
	// and ItemsSelector.vue's handling of the resulting @view event).
	const scanVariantHint = ref<{
		itemCode: string;
		itemName: string;
		variantOf: string;
	} | null>(null);
	const pendingScanCode = ref("");
	const awaitingScanResult = ref(false);
	const scaleBarcodeSettings = ref(normalizeScaleBarcodeSettings());
	const scaleBarcodeSettingsLoaded = ref(false);

	const searchFromScanner = ref(false);
	const scanAudioContext = ref<AudioContext | null>(null);
	const scanDebounceId = ref<any>(null);
	const scanQueuedCode = ref("");
	const activeScanCodes = new Set<string>();

	// Keyboard Scan Detection State
	const keyboardScanBuffer = ref("");
	const keyboardScanTimer = ref<any>(null);
	const keyboardScanLastTime = ref(-1);
	const keyboardScanStartTime = ref(-1);
	const keyboardScanPendingValue = ref("");
	// Largest single inter-keystroke gap seen in the current sequence -- see
	// isLikelyKeyboardScan's maxGapObserved: an average-only check can be
	// fooled by a fast-typed prefix followed by one human pause.
	const keyboardScanMaxGapObserved = ref(0);

	// Config
	// 7, not a rounder-looking number: it's the real observed minimum
	// barcode length across this store's full 9-brand catalog (Charlotte
	// Wix's "PA1 9LF" and similar are 7 characters). Was previously 12,
	// which assumed digits-only barcodes and silently excluded every
	// Charlotte Wix item (their only format) plus a handful of GEOX/LIU.JO
	// exceptions -- see PROGRESS_NOTES.md section 34.
	const keyboardScanMinLength = 7;
	const keyboardScanMaxInterval = 45;
	const keyboardScanMaxDuration = 250;
	const keyboardScanProcessingDelay = 100;

	// --- Audio ---
	const ensureScanAudioContext = () => {
		if (typeof window === "undefined") return null;
		if (!scanAudioContext.value) {
			const AudioContextClass =
				(window as any).AudioContext ||
				(window as any).webkitAudioContext;
			if (!AudioContextClass) return null;
			scanAudioContext.value = new AudioContextClass();
		}
		if (scanAudioContext.value?.state === "suspended") {
			scanAudioContext.value.resume().catch(() => {});
		}
		return scanAudioContext.value;
	};

	const playScanTone = (type: "success" | "error" = "success") => {
		if (typeof window === "undefined") return;
		try {
			const ctx = ensureScanAudioContext();
			if (!ctx) {
				if (typeof frappe !== "undefined" && frappe.utils?.play_sound) {
					frappe.utils.play_sound(
						type === "success" ? "submit" : "error",
					);
				}
				return;
			}
			const now = ctx.currentTime;
			const duration = type === "success" ? 0.16 : 0.35;
			const oscillator = ctx.createOscillator();
			const gainNode = ctx.createGain();
			oscillator.type = "sine";
			oscillator.frequency.value = type === "success" ? 880 : 220;
			gainNode.gain.setValueAtTime(type === "success" ? 0.18 : 0.28, now);
			gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
			oscillator.connect(gainNode);
			gainNode.connect(ctx.destination);
			oscillator.start(now);
			oscillator.stop(now + duration);
		} catch (error) {
			console.warn("Scan tone playback failed:", error);
			if (typeof frappe !== "undefined" && frappe.utils?.play_sound) {
				frappe.utils.play_sound(
					type === "success" ? "submit" : "error",
				);
			}
		}
	};

	// --- Error Handling ---
	const showScanError = (
		options: { message?: string; code?: string; details?: string } = {},
	) => {
		scanErrorMessage.value =
			options.message || __("Unable to add scanned item.");
		scanErrorCode.value = options.code || "";
		scanErrorDetails.value = options.details || "";
		if (options.code) pendingScanCode.value = options.code;

		awaitingScanResult.value = false;
		searchFromScanner.value = false;
		scanErrorDialog.value = true;
		scannerLocked.value = true;

		playScanTone("error");

		if (typeof frappe !== "undefined" && frappe.show_alert) {
			frappe.show_alert(
				{ message: scanErrorMessage.value, indicator: "red" },
				5,
			);
		}
	};

	const handleScanPipelineError = (error: any, code = "") => {
		const normalizedCode = code || pendingScanCode.value || "";
		console.error("Unexpected barcode processing error:", error);
		const details =
			error && typeof error.message === "string" && error.message.trim()
				? error.message
				: __("Please try again or enter the item manually.");

		showScanError({
			message: __("Unable to add scanned item."),
			code: normalizedCode,
			details,
		});
	};

	const acknowledgeScanError = () => {
		scanErrorDialog.value = false;
		scannerLocked.value = false;
		scanErrorMessage.value = "";
		scanErrorCode.value = "";
		scanErrorDetails.value = "";
		pendingScanCode.value = "";
		awaitingScanResult.value = false;

		if (clearSearchHandler.value) clearSearchHandler.value();
		if (focusSearchHandler.value) focusSearchHandler.value();
	};

	const clearScanVariantHint = () => {
		scanVariantHint.value = null;
	};

	// --- onScan Integration ---
	const initScanner = () => {
		try {
			if ((document as any)._scannerAttached) return;

			// Assuming onScan is globally loaded script
			if (typeof onScan !== "undefined") {
				onScan.attachTo(document, {
					suffixKeyCodes: [],
					keyCodeMapper: function (oEvent: KeyboardEvent) {
						oEvent.stopImmediatePropagation();
						oEvent.preventDefault();
						return onScan.decodeKeyEvent(oEvent);
					},
					onScan: function (sCode: string) {
						if (scannerLocked.value) {
							playScanTone("error");
							return;
						}
						triggerOnScan(sCode);
					},
				});
				(document as any)._scannerAttached = true;
			}
		} catch (error: any) {
			console.warn("Scanner initialization error:", error.message);
		}
	};

	const triggerOnScan = (sCode: string) => {
		if (scannerLocked.value) {
			playScanTone("error");
			return;
		}
		searchFromScanner.value = true;
		if (setSearchInputHandler.value) setSearchInputHandler.value(sCode);
		pendingScanCode.value = sCode;

		nextTick(() => {
			// The onScan.js library independently detects real hardware
			// scanner keystroke patterns document-wide -- this is a genuine
			// scan, not a shape guess.
			onBarcodeScanned(sCode, "high");
		});
	};

	// --- Scale Barcode Settings ---
	const updateScaleBarcodeSettings = (settings: any) => {
		const normalized = normalizeScaleBarcodeSettings(settings);
		scaleBarcodeSettings.value = {
			...scaleBarcodeSettings.value,
			...normalized,
		};
		scaleBarcodeSettingsLoaded.value = true;
		return scaleBarcodeSettings.value;
	};

	const ensureScaleBarcodeSettings = async (force = false) => {
		if (!force && scaleBarcodeSettingsLoaded.value) {
			return scaleBarcodeSettings.value;
		}

		try {
			const res = await frappe.call({
				method: "posawesome.posawesome.api.items.parse_scale_barcode",
				args: { barcode: "" },
			});
			const settings = parseScaleBarcodeSettingsResponse(res);
			if (settings) {
				updateScaleBarcodeSettings(settings);
			} else {
				scaleBarcodeSettings.value = normalizeScaleBarcodeSettings();
				scaleBarcodeSettingsLoaded.value = true;
			}
		} catch (error) {
			console.error("Failed to load scale barcode settings", error);
			scaleBarcodeSettings.value = normalizeScaleBarcodeSettings();
			scaleBarcodeSettingsLoaded.value = true;
		}
		return scaleBarcodeSettings.value;
	};

	// --- Main Scan Handler ---
	const onBarcodeScanned = (
		scannedCode: string,
		confidence: ScanConfidence = "low",
	) => {
		resetKeyboardScanDetection();
		const normalizedCode = String(scannedCode || "").trim();
		if (!normalizedCode) return;
		if (
			scanQueuedCode.value === normalizedCode ||
			activeScanCodes.has(normalizedCode)
		) {
			return;
		}

		if (scannerLocked.value) {
			playScanTone("error");
			if (typeof frappe !== "undefined" && frappe.show_alert) {
				frappe.show_alert(
					{
						message: __(
							"Acknowledge the error to resume scanning.",
						),
						indicator: "red",
					},
					3,
				);
			}
			return;
		}

		const runScanPipeline = async (code: string) => {
			const mark = perfMarkStart("pos:scan-handler");
			try {
				console.log("Barcode scanned:", code);
				pendingScanCode.value = code;
				searchFromScanner.value = true;

				// Show feedback
				if (toastStore) {
					toastStore.show({
						title: __("Scanning for: {0}", [code]),
						summary: __("Scanning items"),
						detail: code,
						color: "info",
						timeout: 2000,
						key: "scanner-progress",
					});
				}

				if (onScanHandler.value) {
					await (onScanHandler.value as any)(code, confidence);
				}
			} catch (error) {
				handleScanPipelineError(error, code);
			} finally {
				activeScanCodes.delete(code);
				perfMarkEnd("pos:scan-handler", mark);
			}
		};

		if (scanDebounceId.value) clearTimeout(scanDebounceId.value);
		scanQueuedCode.value = normalizedCode;

		scanDebounceId.value = setTimeout(() => {
			scanDebounceId.value = null;
			const code = scanQueuedCode.value || normalizedCode;
			scanQueuedCode.value = "";
			activeScanCodes.add(code);

			scheduleFrame(() => {
				const maybePromise = runScanPipeline(code);
				if (maybePromise && typeof maybePromise.catch === "function") {
					maybePromise.catch((e: any) =>
						handleScanPipelineError(e, code),
					);
				}
			});
		}, 12);
	};

	// --- Keyboard Scan Detection ---
	const resetKeyboardScanDetection = () => {
		if (keyboardScanTimer.value) {
			clearTimeout(keyboardScanTimer.value);
			keyboardScanTimer.value = null;
		}
		keyboardScanBuffer.value = "";
		keyboardScanLastTime.value = -1;
		keyboardScanStartTime.value = -1;
		keyboardScanPendingValue.value = "";
		keyboardScanMaxGapObserved.value = 0;
	};

	const evaluateKeyboardScan = (currentInput: string) => {
		if (keyboardScanTimer.value) {
			clearTimeout(keyboardScanTimer.value);
			keyboardScanTimer.value = null;
		}

		const code = (
			keyboardScanPendingValue.value ||
			currentInput ||
			""
		).trim();
		const now = getScanTimestamp();
		const duration = keyboardScanStartTime.value >= 0
			? now - keyboardScanStartTime.value
			: 0;

		if (
			isLikelyKeyboardScan({
				code,
				duration,
				minLength: keyboardScanMinLength,
				maxDuration: keyboardScanMaxDuration,
				maxInterval: keyboardScanMaxInterval,
			})
		) {
			resetKeyboardScanDetection();
			if (code) {
				// isLikelyKeyboardScan already verified real scanner-speed
				// keystroke timing (<=45ms/char average) -- a human cannot
				// type that fast, so this is a genuine scan.
				onBarcodeScanned(code, "high");
			}
			return true; // Detected
		}
		resetKeyboardScanDetection();
		return false;
	};

	const handleSearchKeydown = (event: KeyboardEvent) => {
		if (!event) return;
		const key = event.key || "";

		// Pass-through navigation keys
		if (key === "ArrowDown" || key === "ArrowUp") return false;
		if (key === "Enter" || key === "Escape") return false;

		// Reset on modifiers
		if (event.metaKey || event.ctrlKey || event.altKey) {
			resetKeyboardScanDetection();
			return false;
		}

		// Real barcodes aren't digits-only (e.g. Charlotte Wix's "PA4 79SF") --
		// this only rejects characters no real barcode format uses at all.
		// Timing (isLikelyKeyboardScan below) is what actually distinguishes a
		// real scan from ordinary typing now that charset can't.
		if (!isBarcodeCandidateChar(key)) {
			resetKeyboardScanDetection();
			return false;
		}

		const currentVal = getSearchInputHandler.value
			? (getSearchInputHandler.value as any)()
			: "";
		if (!isSearchFieldPrimedForScan(currentVal)) {
			resetKeyboardScanDetection();
			return false;
		}

		const now = getScanTimestamp();
		if (
			keyboardScanLastTime.value >= 0 &&
			now - keyboardScanLastTime.value > keyboardScanMaxInterval
		) {
			// Gap too long, reset but start new buffer
			keyboardScanBuffer.value = "";
			keyboardScanStartTime.value = now;
			keyboardScanMaxGapObserved.value = 0;
		} else if (keyboardScanLastTime.value >= 0) {
			// Track the worst single gap in this sequence, not just the
			// eventual average -- see isLikelyKeyboardScan's maxGapObserved.
			keyboardScanMaxGapObserved.value = Math.max(
				keyboardScanMaxGapObserved.value,
				now - keyboardScanLastTime.value,
			);
		}

		if (!keyboardScanBuffer.value) {
			keyboardScanStartTime.value = now;
		}

		keyboardScanBuffer.value += key;
		keyboardScanLastTime.value = now;

		if (keyboardScanTimer.value) clearTimeout(keyboardScanTimer.value);

		if (keyboardScanBuffer.value.length < keyboardScanMinLength) {
			return true;
		}

		// Schedule evaluation
		keyboardScanTimer.value = setTimeout(() => {
			evaluateKeyboardScan(
				getSearchInputHandler.value
					? (getSearchInputHandler.value as any)()
					: "",
			);
		}, keyboardScanProcessingDelay);

		return true;
	};

	const handleSearchInput = (value: string) => {
		const currentValue = String(value || "").trim();
		if (!currentValue) {
			resetKeyboardScanDetection();
			return false;
		}

		if (!isSearchFieldPrimedForScan(currentValue)) {
			resetKeyboardScanDetection();
			return false;
		}

		// If handleSearchKeydown's own per-keystroke tracking is already
		// watching this exact value (only possible for genuinely fast,
		// scanner-speed input -- real human typing keeps resetting that
		// buffer via its own gap check), it will make its own, more
		// rigorous, timing-verified decision once it settles. Don't also
		// schedule a second, competing "has the value gone idle" evaluation
		// for the same string here -- without this, a genuine fast scan
		// could get evaluated twice, redundantly, by two independent
		// mechanisms for the same moment. This does NOT, on its own, stop
		// an idle-settle evaluation from ever firing on an incomplete value
		// during ordinary human typing (a real, >100ms pause mid-sequence
		// can still trigger one) -- what makes that harmless is that such a
		// miss is tagged "low" confidence and stays silent (see
		// ScanConfidence / PROGRESS_NOTES.md section 34), not this check.
		const alreadyTrackedByKeydown = keyboardScanBuffer.value === currentValue;

		const now = getScanTimestamp();
		const previousValue = keyboardScanPendingValue.value || "";
		const isAppend =
			!previousValue ||
			(currentValue.length >= previousValue.length &&
				currentValue.startsWith(previousValue));

		if (keyboardScanStartTime.value < 0 || !isAppend) {
			keyboardScanStartTime.value = now;
		}

		keyboardScanBuffer.value = currentValue;
		keyboardScanPendingValue.value = currentValue;
		keyboardScanLastTime.value = now;

		if (alreadyTrackedByKeydown) {
			return currentValue.length >= keyboardScanMinLength;
		}

		if (keyboardScanTimer.value) {
			clearTimeout(keyboardScanTimer.value);
		}

		if (currentValue.length < keyboardScanMinLength) {
			keyboardScanTimer.value = null;
			return false;
		}

		keyboardScanTimer.value = setTimeout(() => {
			const latestValue = (
				getSearchInputHandler.value
					? (getSearchInputHandler.value as any)()
					: currentValue
			)
				?.toString?.()
				?.trim?.() || "";

			if (!latestValue || latestValue !== currentValue) {
				return;
			}

			// Virtual scanners (for example AHK-based tools) often populate the
			// field without reliable key timing, so fall back to idle-value
			// detection. Low confidence: shape-only, not a verified real scan --
			// a miss here must not alarm the user (see ScanConfidence).
			resetKeyboardScanDetection();
			onBarcodeScanned(latestValue, "low");
		}, keyboardScanProcessingDelay);

		return currentValue.length >= keyboardScanMinLength;
	};

	const handleSearchPaste = (event: ClipboardEvent) => {
		if (!event?.clipboardData) return;
		const pastedText = event.clipboardData.getData("text");
		if (!pastedText) return;

		const pasteScan = classifyClipboardScanText(
			pastedText,
			keyboardScanMinLength,
		);
		if (pasteScan.shouldPreventDefault) {
			event.preventDefault();
		}

		if (pasteScan.shouldScan) {
			if (setSearchInputHandler.value)
				(setSearchInputHandler.value as any)(pasteScan.sanitizedText);

			nextTick(() => {
				// Low confidence: a pasted value only looks barcode-shaped by
				// charset/length, same as idle-settle typing -- e.g. a style
				// code copied from a report is just as plausible as a real
				// barcode. A miss must not alarm the user (see ScanConfidence).
				onBarcodeScanned(pasteScan.sanitizedText, "low");
			});
		}
	};

	// Lifecycle
	onMounted(() => {
		initScanner();
	});

	onUnmounted(() => {
		if (scanAudioContext.value) {
			scanAudioContext.value.close().catch(() => {});
		}
		if (
			(document as any)._scannerAttached &&
			typeof onScan !== "undefined"
		) {
			try {
				onScan.detachFrom(document);
				(document as any)._scannerAttached = false;
			} catch (error: any) {
				console.warn("Scanner detach error:", error.message);
			}
		}
	});

	return {
		// State
		scannerLocked,
		scanErrorDialog,
		scanErrorMessage,
		scanErrorCode,
		scanErrorDetails,
		scanVariantHint,
		pendingScanCode,
		awaitingScanResult,
		searchFromScanner,
		cameraScannerActive,
		scaleBarcodeSettings,

		// Methods
		playScanTone,
		showScanError,
		acknowledgeScanError,
		clearScanVariantHint,
		onBarcodeScanned, // Call this when a code is detected
		triggerOnScan,
		ensureScaleBarcodeSettings,
		updateScaleBarcodeSettings,
		handleSearchKeydown,
		handleSearchInput,
		handleSearchPaste,
		handleScanPipelineError,
		resetKeyboardScanDetection,

		// Utils exposed
		getScaleBarcodePrefix: () =>
			getScaleBarcodePrefix(scaleBarcodeSettings.value),
		scaleBarcodeMatches: (_val: string) =>
			scaleBarcodeMatches(scaleBarcodeSettings.value, _val),
		setScanHandler,
		setInputHandlers,
	};
}
