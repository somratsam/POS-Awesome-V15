// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import api from "../src/posapp/services/api";

describe("api envelope handling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("frappe", {
			call: vi.fn(),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("returns a timeout envelope and passes a request_id", async () => {
		(frappe.call as any).mockImplementation(() => undefined);

		const pending = api.callEnvelope(
			"pos.test.timeout",
			{},
			{ timeoutMs: 10 },
		);
		await vi.advanceTimersByTimeAsync(10);
		const result = await pending;

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "TIMEOUT",
				retryable: true,
			},
		});
		expect(result.requestId).toEqual(expect.stringMatching(/^posa-/));
		expect(frappe.call).toHaveBeenCalledWith(
			expect.objectContaining({
				args: expect.objectContaining({ request_id: result.requestId }),
			}),
		);
	});

	it("normalizes transport errors into retryable envelopes", async () => {
		(frappe.call as any).mockImplementation(({ error }: any) => {
			error({ status: 503, statusText: "Service Unavailable" });
		});

		const result = await api.callEnvelope("pos.test.http_error");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "HTTP_ERROR",
				message: "Service Unavailable",
				retryable: true,
			},
		});
	});

	it("reports a refused request (Frappe error body, no HTTP status) as the server's reason, not a lost connection", async () => {
		(frappe.call as any).mockImplementation((options: any) => {
			options.error({
				exc_type: "PermissionError",
				_server_messages: JSON.stringify([
					JSON.stringify({
						message: "Store credit from ACC-SINV-2026-00257 needs the customer's credit note voucher.",
					}),
				]),
			});
		});

		const result = await api.callEnvelope("pos.test.refused");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "BUSINESS_RULE",
				message: "Store credit from ACC-SINV-2026-00257 needs the customer's credit note voucher.",
				retryable: false,
			},
		});
	});

	it("a real lost connection (xhr with no response body) is still a transport error", async () => {
		(frappe.call as any).mockImplementation((options: any) => {
			options.error({ readyState: 0, status: 0, statusText: "error" });
		});
		const result = await api.callEnvelope("pos.test.offline");
		expect(result).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", retryable: true } });
	});

	it("normalizes business-rule responses into non-retryable envelopes", async () => {
		(frappe.call as any).mockImplementation(({ callback }: any) => {
			callback({
				message: {
					error: {
						code: "VALIDATION_ERROR",
						message: "Customer is required",
					},
				},
			});
		});

		const result = await api.callEnvelope("pos.test.business_error");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "VALIDATION_ERROR",
				message: "Customer is required",
				retryable: false,
			},
		});
	});

	it("classifies a QueryDeadlockError response as DEADLOCK, not a generic business rule", async () => {
		// Real shape of what reaches the frontend when a submission-ledger
		// save hits a transient lock conflict and exhausts its retries --
		// see invoice_processing/creation.py's _save_ledger_with_lock_retry.
		(frappe.call as any).mockImplementation(({ callback }: any) => {
			callback({
				exc: "frappe.exceptions.QueryDeadlockError: (1213, 'Deadlock found when trying to get lock; try restarting transaction')",
			});
		});

		const result = await api.callEnvelope("pos.test.deadlock");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "DEADLOCK",
			},
		});
	});

	it("classifies a lock-wait-timeout response as DEADLOCK too", async () => {
		(frappe.call as any).mockImplementation(({ callback }: any) => {
			callback({
				exc: "frappe.exceptions.QueryTimeoutError: (1205, 'Lock wait timeout exceeded; try restarting transaction')",
			});
		});

		const result = await api.callEnvelope("pos.test.lock_timeout");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "DEADLOCK",
			},
		});
	});

	it("still classifies an unrelated business error as BUSINESS_RULE, not DEADLOCK", async () => {
		// Regression guard for the new deadlock-detection branch: it must
		// not be so broad that it swallows real, unrelated errors.
		(frappe.call as any).mockImplementation(({ callback }: any) => {
			callback({
				exc: "frappe.exceptions.ValidationError: Item XYZ is out of stock",
			});
		});

		const result = await api.callEnvelope("pos.test.unrelated_error");

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "BUSINESS_RULE",
			},
		});
	});
});
