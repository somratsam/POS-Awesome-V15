// The scanner's beep: 880 Hz for success, 220 Hz for an error. Used by the
// item scanner (useScannerInput, its own AudioContext) and by the credit note
// voucher scan on the main screen (saleCreditStore, the shared one below), so
// both sound the same.

declare const frappe: any;

export type ScanToneType = "success" | "error";

/** Plays the tone on an AudioContext the caller owns. */
export function playToneOn(ctx: AudioContext, type: ScanToneType = "success") {
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
}

/** Frappe's own sound when there is no Web Audio. */
export function playFallbackSound(type: ScanToneType = "success") {
	if (typeof frappe !== "undefined" && frappe?.utils?.play_sound) {
		frappe.utils.play_sound(type === "success" ? "submit" : "error");
	}
}

let sharedContext: AudioContext | null = null;

/** The same beep on one shared AudioContext (for code outside a component). */
export function playScanTone(type: ScanToneType = "success") {
	if (typeof window === "undefined") return;
	try {
		if (!sharedContext) {
			const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
			if (!AudioContextClass) {
				playFallbackSound(type);
				return;
			}
			sharedContext = new AudioContextClass();
		}
		if (sharedContext?.state === "suspended") sharedContext.resume().catch(() => {});
		playToneOn(sharedContext as AudioContext, type);
	} catch (error) {
		console.warn("Scan tone playback failed:", error);
		playFallbackSound(type);
	}
}
