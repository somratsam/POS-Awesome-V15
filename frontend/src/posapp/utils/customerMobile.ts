// One mobile number per customer, in one format. The same rule as the
// server (posawesome/posawesome/api/customer_mobile.py), so the till's own
// offline check and the server agree:
// - spaces, dashes, brackets, dots and "+" are removed;
// - an Omani number (8 digits, or 968 / 00968 / +968 then 8 digits) becomes
//   the plain 8-digit local number: "9123 4567", "91234567" and
//   "+968 91234567" are the same number;
// - any other number is foreign and is kept as "+" and its digits
//   ("+44 7700 900123", "0044 7700 900123", "447700900123");
// - a number shorter than 8 digits keeps its digits as typed.

const OMAN_CODE = "968";
const LOCAL_LENGTH = 8;

export function cleanMobileNumber(value: unknown): string {
	const text = String(value ?? "").trim();
	let digits = text.replace(/\D/g, "");
	if (!digits) return "";
	const international = text.startsWith("+") || digits.startsWith("00");
	if (digits.startsWith("00")) digits = digits.slice(2);
	if (digits.length === LOCAL_LENGTH && !international) return digits;
	if (digits.startsWith(OMAN_CODE) && digits.length === OMAN_CODE.length + LOCAL_LENGTH) {
		return digits.slice(OMAN_CODE.length);
	}
	return international || digits.length > LOCAL_LENGTH ? `+${digits}` : digits;
}

/** True once enough has been typed to be a whole number worth checking. */
export function isCheckableMobile(value: unknown): boolean {
	return cleanMobileNumber(value).replace(/^\+/, "").length >= LOCAL_LENGTH;
}

/** The index key the till's customer table can be searched on. */
export function mobileLookupKey(value: unknown): string {
	return cleanMobileNumber(value).replace(/\D/g, "").slice(-LOCAL_LENGTH);
}

export type ExistingCustomer = { name: string; customer_name?: string; mobile_no?: string };

type Finder = (mobile: string, excludeCustomer: string | null) => Promise<ExistingCustomer | null | undefined>;

export const MOBILE_CHECK_DELAY = 400;

/**
 * The new-customer form's check while typing. After the cashier pauses, it
 * looks in the till's own customer list first (works offline), then asks
 * the server when online. Only the answer for the number still in the box
 * is reported; a reply for an older number is dropped.
 */
export function createMobileDuplicateCheck({
	findLocal,
	findRemote,
	isOffline,
	onResult,
	delay = MOBILE_CHECK_DELAY,
}: {
	findLocal: Finder;
	findRemote: Finder;
	isOffline: () => boolean;
	onResult: (existing: ExistingCustomer | null, mobile: string) => void;
	delay?: number;
}) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let current = "";

	const run = async (mobile: string, excludeCustomer: string | null) => {
		let existing: ExistingCustomer | null = null;
		try {
			existing = (await findLocal(mobile, excludeCustomer)) || null;
		} catch (error) {
			console.error("Local mobile check failed", error);
		}
		if (!existing && !isOffline() && current === mobile) {
			try {
				existing = (await findRemote(mobile, excludeCustomer)) || null;
			} catch (error) {
				// The server still refuses the duplicate on Submit.
				console.error("Server mobile check failed", error);
			}
		}
		if (current === mobile) onResult(existing, mobile);
	};

	return {
		/** Call on every change of the mobile box. */
		check(value: unknown, excludeCustomer: string | null = null) {
			if (timer) clearTimeout(timer);
			const mobile = cleanMobileNumber(value);
			current = mobile;
			if (!isCheckableMobile(mobile)) {
				onResult(null, mobile);
				return;
			}
			timer = setTimeout(() => {
				timer = null;
				void run(mobile, excludeCustomer);
			}, delay);
		},
		/** Run a pending check now (Submit) and wait for its answer. */
		async now(value: unknown, excludeCustomer: string | null = null) {
			if (timer) clearTimeout(timer);
			timer = null;
			const mobile = cleanMobileNumber(value);
			current = mobile;
			if (!isCheckableMobile(mobile)) {
				onResult(null, mobile);
				return;
			}
			await run(mobile, excludeCustomer);
		},
		cancel() {
			if (timer) clearTimeout(timer);
			timer = null;
			current = "";
		},
	};
}
