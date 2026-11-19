/**
 * The POS's own confirm / notice dialog, in place of the browser's
 * window.confirm / window.alert ("staging.local:8000 says ...").
 *
 * appConfirm() resolves true (confirm button) or false (cancel, Esc, click
 * outside); appNotice() resolves when the notice is closed. The dialog is
 * AppConfirmDialog.vue, mounted once in DefaultLayout. Only one at a time: a
 * newer request answers an open confirm with false.
 *
 * A caller with no dialog mounted (outside the POS layout) falls back to Frappe's own frappe.confirm /
 * frappe.msgprint, and only without Frappe to the browser pop-up.
 *
 * All text is passed in already translated (__()).
 */
import { shallowRef } from "vue";

export type AppDialogRequest = {
	kind: "confirm" | "notice";
	title: string;
	message: string;
	confirmText: string;
	cancelText: string;
	// Red confirm button and the focus on Cancel, for cancel/delete actions.
	danger: boolean;
};

export type AppConfirmOptions = {
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
};

export type AppNoticeOptions = {
	title?: string;
	message: string;
	okText?: string;
};

export const appDialogRequest = shallowRef<AppDialogRequest | null>(null);

let resolver: ((_value: boolean) => void) | null = null;
let hostCount = 0;

function __(text: string) {
	const translator = (globalThis as any).__ || (globalThis as any).frappe?._;
	return typeof translator === "function" ? translator(text) : text;
}

/** AppConfirmDialog calls this on mount; returns the unregister function. */
export function registerAppDialogHost() {
	hostCount += 1;
	return () => {
		hostCount = Math.max(0, hostCount - 1);
		if (!hostCount) answerAppDialog(false);
	};
}

export function hasAppDialogHost() {
	return hostCount > 0;
}

/** Called by the dialog's buttons (and Esc / click outside with false). */
export function answerAppDialog(value: boolean) {
	const resolve = resolver;
	resolver = null;
	appDialogRequest.value = null;
	resolve?.(value);
}

function open(request: AppDialogRequest): Promise<boolean> {
	if (resolver) answerAppDialog(false);
	appDialogRequest.value = request;
	return new Promise((resolve) => {
		resolver = resolve;
	});
}

function fallbackConfirm(options: AppConfirmOptions): Promise<boolean> {
	const frappe = (globalThis as any).frappe;
	if (typeof frappe?.confirm === "function") {
		return new Promise((resolve) => {
			let answered = false;
			const done = (value: boolean) => {
				if (answered) return;
				answered = true;
				resolve(value);
			};
			frappe.confirm(
				options.message,
				() => done(true),
				() => done(false),
			);
		});
	}
	if (typeof window !== "undefined" && typeof window.confirm === "function") {
		return Promise.resolve(window.confirm(options.message));
	}
	return Promise.resolve(false);
}

export function appConfirm(options: AppConfirmOptions): Promise<boolean> {
	if (!hasAppDialogHost()) return fallbackConfirm(options);
	return open({
		kind: "confirm",
		title: options.title || __("Please confirm"),
		message: options.message,
		confirmText: options.confirmText || __("Yes"),
		cancelText: options.cancelText || __("No"),
		danger: Boolean(options.danger),
	});
}

export async function appNotice(options: AppNoticeOptions): Promise<void> {
	if (!hasAppDialogHost()) {
		const frappe = (globalThis as any).frappe;
		if (typeof frappe?.msgprint === "function") {
			frappe.msgprint({ title: options.title, message: options.message });
		} else if (typeof window !== "undefined" && typeof window.alert === "function") {
			window.alert(options.message);
		}
		return;
	}
	await open({
		kind: "notice",
		title: options.title || __("Notice"),
		message: options.message,
		confirmText: options.okText || __("OK"),
		cancelText: "",
		danger: false,
	});
}
