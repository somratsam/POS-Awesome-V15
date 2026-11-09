// Messages about credit note vouchers (scan, lookup, supervisor approval,
// reprint) must be readable while Payments or Invoice Management is open.
// Frappe's own message box opens *behind* those screens, so voucher calls are
// made without it and the reason is shown as a red toast, which sits above
// every screen. All voucher messages share one key: a new one replaces the
// one on screen instead of waiting in the toast queue behind it.

declare const frappe: any;
declare const __: (text: string, args?: any[]) => string;

export const VOUCHER_MESSAGE_KEY = "credit-voucher-message";
export const VOUCHER_ERROR_TIMEOUT = 8000;
export const VOUCHER_INFO_TIMEOUT = 5000;
// A strong red (#C62828): the theme's "error" is a light coral that white
// text is hard to read on.
export const VOUCHER_ERROR_COLOR = "red-darken-3";

export function voucherErrorToast(title: string) {
	return { title, color: VOUCHER_ERROR_COLOR, timeout: VOUCHER_ERROR_TIMEOUT, key: VOUCHER_MESSAGE_KEY };
}

export function voucherSuccessToast(title: string) {
	return { title, color: "success", timeout: VOUCHER_INFO_TIMEOUT, key: VOUCHER_MESSAGE_KEY };
}

const stripTags = (text: string) =>
	String(text || "")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/** The reason in a Frappe error response, as plain text ("" if none). */
export function serverMessageOf(body: any): string {
	if (!body || typeof body !== "object") return "";
	if (body._server_messages) {
		try {
			const messages = JSON.parse(body._server_messages)
				.map((entry: any) => {
					try {
						const parsed = JSON.parse(entry);
						return parsed?.message ?? parsed;
					} catch {
						return entry;
					}
				})
				.map((text: any) => stripTags(String(text ?? "")))
				.filter(Boolean);
			const unique = Array.from(new Set(messages));
			if (unique.length) return unique.join(" ");
		} catch {
			/* fall through */
		}
	}
	if (body._error_message) return stripTags(body._error_message);
	if (typeof body.exception === "string") {
		const parts = body.exception.split(":");
		return stripTags(parts.length > 1 ? parts.slice(1).join(":") : parts[0]);
	}
	return "";
}

/**
 * Calls a whitelisted method without Frappe's message box. Resolves with the
 * method's return value; on a refusal throws an Error whose message is the
 * server's reason, ready to show.
 */
export async function callWithoutDialog<T = any>(method: string, args: Record<string, any> = {}): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`/api/method/${method}`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-Frappe-CSRF-Token": frappe?.csrf_token || "",
			},
			body: JSON.stringify(args),
		});
	} catch {
		throw new Error(__("Can't reach the server. Check the connection and try again."));
	}
	let body: any = {};
	try {
		body = await response.json();
	} catch {
		body = {};
	}
	if (response.ok) return body?.message as T;
	throw new Error(serverMessageOf(body) || __("The server refused this (error {0}).", [response.status]));
}

/** Blue: information the cashier must notice, not a problem. */
export function voucherInfoToast(title: string) {
	return { title, color: "info", timeout: VOUCHER_ERROR_TIMEOUT, key: VOUCHER_MESSAGE_KEY };
}

/**
 * Credit worth more than the sale: the rest stays on the credit note, and a
 * credit note voucher prints for it after the sale. amount is formatted.
 */
export function creditRemainderMessage(amount: string): string {
	return __("A credit note for {0} will be issued for the remaining credit.", [amount]);
}
