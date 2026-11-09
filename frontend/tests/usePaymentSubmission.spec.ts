import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";
import { ApiEnvelopeError } from "../src/posapp/services/api";

vi.mock("../src/offline/index", () => ({
	enqueueInvoiceOutboxEntry: vi.fn(async () => ({})),
	isOffline: vi.fn(() => false),
	persistInvoiceIntentJournal: vi.fn(() => "test-request-id"),
	removeInvoiceOutboxEntry: vi.fn(async () => 1),
	saveOfflineInvoice: vi.fn(),
	updateLocalStock: vi.fn(),
}));

vi.mock("../src/posapp/services/invoiceService", () => ({
	default: {
		submitInvoice: vi.fn(),
	},
}));

vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: {
		applyInvoiceConsumption: vi.fn(),
	},
}));

describe("usePaymentSubmission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_match, index) =>
				String(args[Number(index)] ?? ""),
			);
		});
		vi.stubGlobal("frappe", {
			utils: {
				play_sound: vi.fn(),
			},
		});
	});

	it("restores negative return payments back to normal amounts", () => {
		const invoiceDoc = ref<any>({
			is_return: 0,
			payments: [
				{
					mode_of_payment: "Cash",
					amount: -120,
					base_amount: -120,
					default: 1,
				},
				{ mode_of_payment: "Card", amount: 0, base_amount: 0 },
				{ mode_of_payment: "Bank", amount: 35, base_amount: 35 },
			],
		});

		const { restoreReturnPayments } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(true),
		});

		restoreReturnPayments();

		expect(invoiceDoc.value.payments).toEqual([
			{
				mode_of_payment: "Cash",
				amount: 120,
				base_amount: 120,
				default: 1,
			},
			{ mode_of_payment: "Card", amount: 0, base_amount: 0 },
			{ mode_of_payment: "Bank", amount: 35, base_amount: 35 },
		]);
	});

	it("blocks submission validation when a sale row is below trade price", async () => {
		const invoiceDoc = ref<any>({
			is_return: 0,
			items: [
				{
					item_code: "02017",
					item_name: "ARINAC FORT",
					qty: 1,
					rate: 10,
					trade_price: 12.75,
				},
			],
			payments: [{ mode_of_payment: "Cash", amount: 10, type: "Cash" }],
			rounded_total: 10,
			grand_total: 10,
		});

		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({ posa_allow_partial_payment: 0 }),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
			},
			diff_payment: ref(0) as any,
			isCashback: ref(true),
		});

		await expect(validateSubmission(true)).rejects.toThrow(
			/below Trade Price/i,
		);
	});

	describe("store credit worth more than the sale", () => {
		const setup = (redeemed: number, cash = 0) => {
			const invoiceDoc = ref<any>({
				is_return: 0,
				items: [{ item_code: "A", qty: 1, rate: 45 }],
				payments: [{ mode_of_payment: "Cash", amount: cash, type: "Cash" }],
				rounded_total: 45,
				grand_total: 45,
			});
			return usePaymentSubmission({
				invoiceDoc,
				posProfile: ref({ posa_allow_partial_payment: 0 }),
				stockSettings: ref({}),
				invoiceType: ref("Invoice"),
				formatFloat: (value) => Number(value || 0),
				stores: { toastStore: { show: vi.fn() } },
				diff_payment: ref(0) as any,
				isCashback: ref(true),
				customerCreditRedemptionRequested: ref(true),
				customerCreditDict: ref([
					{ type: "Invoice", credit_origin: "CN-1", total_credit: 50, credit_to_redeem: redeemed },
				]),
				redeemedCustomerCredit: ref(redeemed),
			} as any);
		};

		it("accepts credit used up to the sale amount, the rest staying on the credit note", async () => {
			await expect(setup(45).validateSubmission(true)).resolves.toBe(true);
		});

		it("refuses credit typed down to keep more of it, the gap paid in cash", async () => {
			await expect(setup(40, 5).validateSubmission(true)).rejects.toThrow(/must cover the sale up to 45/);
		});
	});

	it("allows warning-only below-cost policy and shows a warning", async () => {
		const toastShow = vi.fn();
		const invoiceDoc = ref<any>({
			is_return: 0,
			items: [{ item_code: "LOW", qty: 1, rate: 9, trade_price: 10 }],
			payments: [{ mode_of_payment: "Cash", amount: 9, type: "Cash" }],
			rounded_total: 9,
			grand_total: 9,
		});
		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({ posa_below_cost_action: "Warning Only" }),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: { toastStore: { show: toastShow } },
			diff_payment: ref(0) as any,
			isCashback: ref(true),
		});

		await expect(validateSubmission(true)).resolves.toBe(true);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ color: "warning" }),
		);
	});

	it("captures a POS supervisor override reason before submission", async () => {
		const requestBelowCostOverride = vi.fn().mockResolvedValue({
			approved: true,
			reason: "Approved clearance",
		});
		const invoiceDoc = ref<any>({
			is_return: 0,
			items: [{ item_code: "LOW", qty: 1, rate: 9, trade_price: 10 }],
			payments: [{ mode_of_payment: "Cash", amount: 9, type: "Cash" }],
			rounded_total: 9,
			grand_total: 9,
		});
		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_below_cost_action: "POS Supervisor Override",
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			requestBelowCostOverride,
			diff_payment: ref(0) as any,
			isCashback: ref(true),
		});

		await expect(validateSubmission(true)).resolves.toBe(true);
		expect(invoiceDoc.value.posa_below_cost_override).toBe(1);
		expect(invoiceDoc.value.posa_below_cost_override_reason).toBe(
			"Approved clearance",
		);
	});

	it("defers print and schedules background wait when invoice submission is queued", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0001",
			doctype: "Sales Invoice",
			status: 0,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0001",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(true, {
			onPrint,
			onScheduleBackgroundCheck,
			onFinishNavigation: vi.fn(),
		});

		expect(onPrint).not.toHaveBeenCalled();
		expect(onScheduleBackgroundCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0001",
				doctype: "Sales Invoice",
				print: true,
				waitForInvoiceProcessing: true,
				waitForPostSubmitPayments: true,
			}),
		);
	});

	it("schedules deferred printing instead of calling onPrint when post-submit work remains", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0002",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0002",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck,
		});

		expect(onPrint).not.toHaveBeenCalled();
		expect(onScheduleBackgroundCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0002",
				doctype: "Sales Invoice",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: true,
			}),
		);
	});

	it("prints immediately when there is no deferred post-submit work", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0004",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0004",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const onPrint = vi.fn();
		const onScheduleBackgroundCheck = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck,
		});

		expect(onPrint).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ACC-SINV-0004",
				doctype: "Sales Invoice",
				docstatus: 1,
			}),
			expect.objectContaining({
				name: "ACC-SINV-0004",
				doctype: "Sales Invoice",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: false,
			}),
		);
		expect(onScheduleBackgroundCheck).not.toHaveBeenCalled();
	});

	it("prints a newly submitted Sales Order with the server-assigned name", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "SAL-ORD-0001",
		});

		const invoiceDoc = ref<any>({
			doctype: "Sales Order",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			posa_delivery_date: "2026-07-01",
		});
		const onPrint = vi.fn();
		const setLastInvoice = vi.fn();
		const mergeInvoiceDoc = vi.fn((patch) => {
			Object.assign(invoiceDoc.value, patch);
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				posa_allow_sales_order: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Order"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice,
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value, mergeInvoiceDoc },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(true, {
			onPrint,
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(onPrint).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "SAL-ORD-0001",
				doctype: "Sales Order",
				docstatus: 1,
			}),
			expect.objectContaining({
				name: "SAL-ORD-0001",
				doctype: "Sales Order",
				waitForInvoiceProcessing: false,
				waitForPostSubmitPayments: false,
			}),
		);
		expect(mergeInvoiceDoc).toHaveBeenCalledWith({
			name: "SAL-ORD-0001",
			doctype: "Sales Order",
			docstatus: 1,
		});
		expect(invoiceDoc.value.name).toBe("SAL-ORD-0001");
		expect(setLastInvoice).toHaveBeenCalledWith("SAL-ORD-0001");
	});

	it("shows a merged processing toast instead of a plain success toast when post-submit payments are pending", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0003",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0003",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 690, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});
		const toastShow = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: toastShow },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(true),
			paidChange: ref(10),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(100),
			customerCreditDict: ref([]),
			diff_payment: ref(-10),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "invoice-processing::ACC-SINV-0003",
				title: "Invoice Submitted",
				loading: true,
			}),
		);
	});

	// Real change: a plain submit with no post-submit background work used
	// to show a "Invoice {id} is Submitted" success toast on top of the
	// natural screen transition (and receipt print) that already confirms
	// completion -- removed entirely, matching standard retail POS practice
	// (no replacement toast). The loading/processing toast above is a
	// separate, deliberately-kept branch since it's the only signal for
	// genuine background work. See PROGRESS_NOTES.md section 36.
	it("shows no toast at all for a plain submit with no post-submit background work", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});
		const toastShow = vi.fn();

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: toastShow },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(toastShow).not.toHaveBeenCalled();
	});

	it("includes gift card redemptions in the submit payload", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0005",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0005",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 390, type: "Cash" }],
			rounded_total: 690,
			grand_total: 690,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-0001",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 1,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			giftCardRedemptions,
			diff_payment: ref(390),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
		});

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-0001",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 390,
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});

	it("adds a stable client request id to invoice submissions", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0099",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 50, type: "Cash" }],
			rounded_total: 50,
			grand_total: 50,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc.posa_client_request_id).toEqual(expect.any(String));
		expect(invoiceDoc.value.posa_client_request_id).toBe(
			submittedDoc.posa_client_request_id,
		);
	});

	it("computes base write-off amount with the invoice conversion rate", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-MC-WRITEOFF",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-MC-WRITEOFF",
			doctype: "Sales Invoice",
			currency: "USD",
			conversion_rate: 280,
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 90, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				currency: "PKR",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(10),
			is_write_off_change: ref(true),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc.write_off_amount).toBe(10);
		expect(submittedDoc.base_write_off_amount).toBe(2800);
	});

	it("reuses one identity after an ambiguous timeout and Submit & Print retry", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		const offlineModule = await import("../src/offline/index");
		(invoiceService.submitInvoice as any)
			.mockRejectedValueOnce(
				new ApiEnvelopeError({
					ok: false,
					data: null,
					error: {
						code: "TIMEOUT",
						message: "Request timed out",
						retryable: true,
					},
					requestId: "transport-timeout-001",
					serverTime: null,
				}),
			)
			.mockResolvedValueOnce({
				name: "ACC-SINV-0100",
				doctype: "Sales Invoice",
				docstatus: 1,
			});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0100",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 50, type: "Cash" }],
			rounded_total: 50,
			grand_total: 50,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).rejects.toThrow("Request timed out");
		await submitInvoice(true, {
			onFinishNavigation: vi.fn(),
		});

		const firstData = (invoiceService.submitInvoice as any).mock.calls[0][0];
		const firstSubmittedDoc = (invoiceService.submitInvoice as any).mock
			.calls[0][1];
		const secondData = (invoiceService.submitInvoice as any).mock.calls[1][0];
		const secondSubmittedDoc = (invoiceService.submitInvoice as any).mock
			.calls[1][1];

		expect(firstSubmittedDoc.posa_client_request_id).toEqual(
			expect.any(String),
		);
		expect(secondSubmittedDoc.posa_client_request_id).toBe(
			firstSubmittedDoc.posa_client_request_id,
		);
		expect(invoiceDoc.value.posa_client_request_id).toBe(
			firstSubmittedDoc.posa_client_request_id,
		);
		expect(firstData).toEqual(
			expect.objectContaining({
				idempotency_key: firstSubmittedDoc.posa_client_request_id,
				client_request_id: firstSubmittedDoc.posa_client_request_id,
			}),
		);
		expect(secondData).toEqual(
			expect.objectContaining({
				idempotency_key: firstSubmittedDoc.posa_client_request_id,
				client_request_id: firstSubmittedDoc.posa_client_request_id,
			}),
		);
		expect(offlineModule.enqueueInvoiceOutboxEntry).toHaveBeenCalledTimes(2);
		expect(offlineModule.enqueueInvoiceOutboxEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				invoice: expect.objectContaining({
					posa_client_request_id: firstSubmittedDoc.posa_client_request_id,
				}),
			}),
		);
		expect(offlineModule.removeInvoiceOutboxEntry).toHaveBeenCalledWith(
			firstSubmittedDoc.posa_client_request_id,
		);
		consoleError.mockRestore();
	});

	it("normalizes loyalty redemption fields before online submit", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-LOYALTY-ONLINE",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-ONLINE",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 1,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 60, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 0,
			redeem_loyalty_points: 0,
			loyalty_points: 0,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "USD",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(40),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 10,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc).toEqual(
			expect.objectContaining({
				loyalty_amount: 40,
				redeem_loyalty_points: 1,
				loyalty_points: 4,
				loyalty_program: "Retail Loyalty",
			}),
		);
	});

	it("recomputes loyalty points when explicit loyalty amount differs from document amount", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-LOYALTY-STALE",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-STALE",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 1,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 80, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 10,
			redeem_loyalty_points: 1,
			loyalty_points: 1,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "USD",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(20),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 10,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc).toEqual(
			expect.objectContaining({
				loyalty_amount: 20,
				redeem_loyalty_points: 1,
				loyalty_points: 2,
			}),
		);
	});

	it("clears stale document loyalty redemption when explicit loyalty amount is zero", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-LOYALTY-CLEAR",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-CLEAR",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 1,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 10,
			redeem_loyalty_points: 1,
			loyalty_points: 1,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "USD",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(0),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 10,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc).toEqual(
			expect.objectContaining({
				loyalty_amount: 0,
				redeem_loyalty_points: 0,
				loyalty_points: 0,
			}),
		);
	});

	it("derives loyalty points from company currency during multi-currency submit", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-LOYALTY-MULTI",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-MULTI",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 280,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 90, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 0,
			redeem_loyalty_points: 0,
			loyalty_points: 0,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "PKR",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(10),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 70,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc).toEqual(
			expect.objectContaining({
				loyalty_amount: 10,
				redeem_loyalty_points: 1,
				loyalty_points: 40,
				loyalty_program: "Retail Loyalty",
			}),
		);
	});

	it("clears loyalty redemption when amount is too small to redeem one point", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-LOYALTY-TINY",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-TINY",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 1,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 0,
			redeem_loyalty_points: 0,
			loyalty_points: 0,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "USD",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(0.5),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 10,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc).toEqual(
			expect.objectContaining({
				loyalty_amount: 0,
				redeem_loyalty_points: 0,
				loyalty_points: 0,
			}),
		);
	});

	it("normalizes loyalty redemption fields before saving an offline invoice", async () => {
		const offlineModule = await import("../src/offline/index");
		(offlineModule.isOffline as any).mockReturnValue(true);

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-LOYALTY-OFFLINE",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-LOYALTY",
			company: "Test Company",
			currency: "USD",
			conversion_rate: 1,
			update_stock: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 60, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
			loyalty_amount: 0,
			redeem_loyalty_points: 0,
			loyalty_points: 0,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				name: "Main POS",
				company: "Test Company",
				currency: "USD",
				customer: "Default Customer",
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				syncStore: { updatePendingCount: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
			loyaltyAmount: ref(40),
			customerInfo: ref({
				name: "CUST-LOYALTY",
				loyalty_program: "Retail Loyalty",
				conversion_factor: 10,
			}),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		expect(offlineModule.saveOfflineInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				invoice: expect.objectContaining({
					loyalty_amount: 40,
					redeem_loyalty_points: 1,
					loyalty_points: 4,
					loyalty_program: "Retail Loyalty",
				}),
			}),
		);

		(offlineModule.isOffline as any).mockReturnValue(false);
	});

	it("blocks offline invoice save when gift card redemption is present", async () => {
		const offlineModule = await import("../src/offline/index");
		(offlineModule.isOffline as any).mockReturnValue(true);

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0006",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [
				{ mode_of_payment: "Gift Card", amount: 300, type: "Bank" },
			],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-0002",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				syncStore: { updatePendingCount: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).rejects.toThrow("Gift card redemption requires an online connection");

		(offlineModule.isOffline as any).mockReturnValue(false);
	});

	it("submits gift card redemptions without requiring a gift card payment row", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0007",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0007",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					type: "Cash",
					account: "1110 - Cash",
					amount: 0,
				},
			],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-ONLY",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
				posa_allow_partial_payment: 0,
				payments: [
					{
						mode_of_payment: "Cash",
						type: "Cash",
						account: "1110 - Cash",
						default: 1,
					},
				],
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).resolves.not.toThrow();

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-ONLY",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 0,
						account: "1110 - Cash",
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});

	it("maps validation envelope failures and preserves the request id", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockRejectedValue(
			new ApiEnvelopeError({
				ok: false,
				data: null,
				error: {
					code: "VALIDATION_ERROR",
					message: "Customer is required",
					retryable: false,
				},
				requestId: "req-validation-1",
				serverTime: "2026-05-01T06:00:00Z",
			}),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const toastStore = { show: vi.fn() };

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-VALIDATION",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore,
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).rejects.toThrow("Customer is required");

		expect(toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Unable to submit invoice",
				detail: expect.stringContaining("req-validation-1"),
				// strong red, up long enough to read the server's reason
				color: "red-darken-3",
				timeout: 8000,
			}),
		);
		expect(consoleError).toHaveBeenCalledWith(
			"Error submitting invoice:",
			expect.objectContaining({
				code: "VALIDATION_ERROR",
				requestId: "req-validation-1",
			}),
		);
		consoleError.mockRestore();
	});

	it("recovers a DEADLOCK failure silently when the invoice was actually already submitted", async () => {
		// Simulates the ledger-save deadlock/lock-conflict exhausting its
		// backend retries (invoice_processing/creation.py's
		// _save_ledger_with_lock_retry) after the invoice itself had
		// already committed -- the exact scenario the original
		// investigation confirmed is harmless. The fix must recognize this
		// as a recoverable case and show a calm confirmation, not the raw
		// deadlock error.
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockRejectedValue(
			new ApiEnvelopeError({
				ok: false,
				data: null,
				error: {
					code: "DEADLOCK",
					message:
						"frappe.exceptions.QueryDeadlockError: (1213, 'Deadlock found when trying to get lock; try restarting transaction')",
					retryable: true,
				},
				requestId: "req-deadlock-1",
				serverTime: "2026-05-01T06:00:00Z",
			}),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const toastStore = { show: vi.fn() };
		const onSuccess = vi.fn();
		const frappeCall = vi.fn().mockResolvedValue({ message: { docstatus: 1 } });
		vi.stubGlobal("frappe", {
			utils: { play_sound: vi.fn() },
			call: frappeCall,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-DEADLOCK-1",
			doctype: "Sales Invoice",
			posa_client_request_id: "req-id-deadlock-1",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore,
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		const result = await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
			onSuccess,
		});

		expect(result).toMatchObject({ recoveredDuplicateSubmission: true });
		expect(frappeCall).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "frappe.client.get_value",
				args: expect.objectContaining({
					doctype: "Sales Invoice",
					filters: { name: "ACC-SINV-DEADLOCK-1" },
				}),
			}),
		);
		expect(toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Invoice ACC-SINV-DEADLOCK-1 was already submitted",
				color: "warning",
			}),
		);
		// The calm-fallback DEADLOCK toast must NOT also fire -- recovery
		// found the invoice really did go through, so this is a success
		// path, not the "genuinely still failed" path.
		expect(toastStore.show).not.toHaveBeenCalledWith(
			expect.objectContaining({
				title: expect.stringContaining("Busy processing"),
			}),
		);
		expect(onSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ recovered: true, docstatus: 1 }),
		);
		expect(consoleError).toHaveBeenCalledWith(
			"Error submitting invoice:",
			expect.objectContaining({ code: "DEADLOCK" }),
		);
		consoleError.mockRestore();
	});

	it("shows a calm message for a DEADLOCK failure that genuinely was not submitted", async () => {
		// The rare true-residual case: even after the backend's own retry
		// is exhausted, the recovery check confirms the invoice really
		// didn't go through this time. Must still surface as a failure
		// (never silently swallowed), but with calm wording instead of the
		// raw deadlock/lock-wait error text.
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockRejectedValue(
			new ApiEnvelopeError({
				ok: false,
				data: null,
				error: {
					code: "DEADLOCK",
					message:
						"frappe.exceptions.QueryDeadlockError: (1213, 'Deadlock found when trying to get lock; try restarting transaction')",
					retryable: true,
				},
				requestId: "req-deadlock-2",
				serverTime: "2026-05-01T06:00:00Z",
			}),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const toastStore = { show: vi.fn() };
		const frappeCall = vi.fn().mockResolvedValue({ message: { docstatus: 0 } });
		vi.stubGlobal("frappe", {
			utils: { play_sound: vi.fn() },
			call: frappeCall,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-DEADLOCK-2",
			doctype: "Sales Invoice",
			posa_client_request_id: "req-id-deadlock-2",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore,
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, { onFinishNavigation: vi.fn() }),
		).rejects.toThrow();

		expect(toastStore.show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Busy processing another request — please try again",
				color: "warning",
			}),
		);
		// The raw exception text must never reach the cashier as the toast
		// title -- that's the entire point of this fix.
		expect(toastStore.show).not.toHaveBeenCalledWith(
			expect.objectContaining({
				title: expect.stringContaining("QueryDeadlockError"),
			}),
		);
		consoleError.mockRestore();
	});

	it("normalizes return payment rows before submit even when cashback is disabled", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-RETURN-0001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-RETURN-0001",
			doctype: "Sales Invoice",
			is_return: 1,
			items: [{ item_code: "ITEM-1", qty: -1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					amount: 90,
					base_amount: 90,
					type: "Cash",
				},
			],
			rounded_total: -90,
			grand_total: -90,
		});

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref("Return"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await submitInvoice(false, {
			onFinishNavigation: vi.fn(),
		});

		const [, submittedDoc] = (invoiceService.submitInvoice as any).mock
			.calls[0];
		expect(submittedDoc.payments).toEqual([
			expect.objectContaining({
				mode_of_payment: "Cash",
				amount: -90,
				base_amount: -90,
			}),
		]);
	});

	it("allows cashback validation for returns without an original invoice", async () => {
		const invoiceDoc = ref<any>({
			name: "ACC-SINV-RETURN-WITHOUT-INVOICE",
			doctype: "Sales Invoice",
			is_return: 1,
			items: [{ item_code: "ITEM-1", qty: -1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					amount: -2625,
					base_amount: -2625,
					type: "Cash",
				},
			],
			rounded_total: -2625,
			grand_total: -2625,
			posa_refundable_amount: 0,
		});

		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({}),
			stockSettings: ref({}),
			invoiceType: ref("Return"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(true),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await expect(validateSubmission(false)).resolves.toBe(true);
	});

	it("rejects cashback above paid amount for returns against an original invoice", async () => {
		const invoiceDoc = ref<any>({
			name: "ACC-SINV-RETURN-AGAINST-INVOICE",
			doctype: "Sales Invoice",
			is_return: 1,
			return_against: "ACC-SINV-0001",
			items: [{ item_code: "ITEM-1", qty: -1 }],
			payments: [
				{
					mode_of_payment: "Cash",
					amount: -2625,
					base_amount: -2625,
					type: "Cash",
				},
			],
			rounded_total: -2625,
			grand_total: -2625,
			posa_refundable_amount: 0,
		});

		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({}),
			stockSettings: ref({}),
			invoiceType: ref("Return"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(true),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});

		await expect(validateSubmission(false)).rejects.toThrow(
			"Cannot refund 2625 for this return: only 0 was paid on the original invoice",
		);
	});

	it("allows gift card submission when no gift card mode of payment is configured", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-0008",
			doctype: "Sales Invoice",
			docstatus: 1,
		});

		const invoiceDoc = ref<any>({
			name: "ACC-SINV-0008",
			doctype: "Sales Invoice",
			is_return: 0,
			items: [{ item_code: "ITEM-1", qty: 1 }],
			payments: [{ mode_of_payment: "Cash", amount: 0, type: "Cash" }],
			rounded_total: 300,
			grand_total: 300,
		});

		const giftCardRedemptions = ref([
			{
				gift_card_code: "GC-MISSING",
				amount: 300,
				cashier: "cashier@example.com",
			},
		]);

		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
				posa_allow_partial_payment: 0,
				payments: [
					{
						mode_of_payment: "Cash",
						type: "Cash",
						account: "1110 - Cash",
						default: 1,
					},
				],
			}),
			stockSettings: ref({}),
			invoiceType: ref("Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: {
					setLastInvoice: vi.fn(),
					setLastStockAdjustment: vi.fn(),
				},
				customersStore: { setSelectedCustomer: vi.fn() },
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			giftCardRedemptions,
			diff_payment: ref(0),
		});

		await expect(
			submitInvoice(false, {
				onFinishNavigation: vi.fn(),
			}),
		).resolves.not.toThrow();

		expect(invoiceService.submitInvoice).toHaveBeenCalledWith(
			expect.objectContaining({
				gift_card_redemptions: [
					expect.objectContaining({
						gift_card_code: "GC-MISSING",
						amount: 300,
					}),
				],
			}),
			expect.objectContaining({
				payments: [
					expect.objectContaining({
						mode_of_payment: "Cash",
						amount: 0,
					}),
				],
			}),
			"Invoice",
			expect.any(Object),
		);
	});
	describe("partial payment off: the whole settlement must cover the total, not cash alone", () => {
		const line = (mode_of_payment: string, type: string, amount: number) => ({
			mode_of_payment,
			type,
			amount,
			base_amount: amount,
		});
		const cash = (amount: number) => line("Cash", "Cash", amount);
		const visa = (amount: number) => line("Visa", "Bank", amount);
		const mastercard = (amount: number) => line("Master Card", "Bank", amount);

		const validate = (
			payments: any[],
			{
				total = 100,
				partial = 0,
				isReturn = 0,
				creditSale = false,
				loyalty = 0,
				customerCredit = 0,
				giftCard = 0,
				writeOff = 0,
				writeOffLimit = 0,
			}: Record<string, any> = {},
		) => {
			const paid =
				payments.reduce((sum, p) => sum + p.amount, 0) +
				loyalty +
				customerCredit +
				giftCard;
			const invoiceDoc = ref<any>({
				is_return: isReturn,
				items: [],
				payments,
				rounded_total: total,
				grand_total: total,
				write_off_amount: writeOff,
				loyalty_amount: loyalty,
				loyalty_points: loyalty,
			});
			const { validateSubmission } = usePaymentSubmission({
				invoiceDoc,
				posProfile: ref({
					posa_allow_partial_payment: partial,
					posa_allow_credit_sale: 1,
					posa_max_write_off_amount: writeOffLimit,
				}),
				stockSettings: ref({}),
				invoiceType: ref("Invoice"),
				formatFloat: (value) => Math.round(Number(value || 0) * 100) / 100,
				stores: { toastStore: { show: vi.fn() } },
				diff_payment: ref(total - paid) as any,
				paidChange: ref(Math.max(paid - total, 0)),
				creditChange: ref(0),
				isCashback: ref(true),
				is_credit_sale: ref(creditSale),
				is_write_off_change: ref(writeOff > 0),
				loyaltyAmount: ref(loyalty),
				redeemedCustomerCredit: ref(customerCredit),
				giftCardRedemptions: ref(
					giftCard ? [{ gift_card_code: "GC-1", amount: giftCard }] : [],
				),
			});
			return validateSubmission(true);
		};

		it.each([
			["Cash 80 + Visa 20", [cash(80), visa(20)]],
			["Cash 50 + Visa 30 + Mastercard 20", [cash(50), visa(30), mastercard(20)]],
			["Cash 100", [cash(100)]],
			["Visa 100", [visa(100)]],
		])("allows %s on an invoice of 100", async (_label, payments) => {
			await expect(validate(payments)).resolves.toBe(true);
		});

		it("allows Cash 90 + 10 of loyalty", async () => {
			await expect(validate([cash(90)], { loyalty: 10 })).resolves.toBe(true);
		});

		it("allows Cash 90 + 10 of customer credit", async () => {
			await expect(validate([cash(90)], { customerCredit: 10 })).resolves.toBe(true);
		});

		it("allows Cash 90 + a 10 gift card", async () => {
			await expect(validate([cash(90)], { giftCard: 10 })).resolves.toBe(true);
		});

		it("allows Cash 95 + a write-off of 5 within the profile limit", async () => {
			await expect(
				validate([cash(95)], { writeOff: 5, writeOffLimit: 5 }),
			).resolves.toBe(true);
		});

		it.each([
			["Cash 80 alone", [cash(80)]],
			["Cash 50 + Visa 30", [cash(50), visa(30)]],
			["Visa 80 alone", [visa(80)]],
		])("still blocks %s on an invoice of 100 as not complete", async (_label, payments) => {
			await expect(validate(payments)).rejects.toThrow("The amount paid is not complete");
		});

		it("still blocks Cash 90 + a write-off of 5 that leaves 5 unpaid", async () => {
			await expect(
				validate([cash(90)], { writeOff: 5, writeOffLimit: 5 }),
			).rejects.toThrow(/Write off amount exceeds the allowed limit|not complete/);
		});

		it("never shows the old cash-only message", async () => {
			await expect(validate([cash(80)])).rejects.not.toThrow(/Cash payment cannot be less/);
		});

		it("with partial payment on, still allows Cash 80 alone", async () => {
			await expect(validate([cash(80)], { partial: 1 })).resolves.toBe(true);
		});

		it("skips the check for a credit sale", async () => {
			await expect(validate([cash(0)], { creditSale: true })).resolves.toBe(true);
		});

		it("skips the check for a return", async () => {
			await expect(
				validate([line("Cash", "Cash", -80)], { total: -100, isReturn: 1 }),
			).resolves.toBe(true);
		});

		it("works with the overpayment guard: cash-covered change passes, card-only excess is over", async () => {
			await expect(validate([cash(80), visa(30)])).resolves.toBe(true);
			await expect(validate([visa(100), mastercard(10)])).rejects.toThrow(/^Over by 10:/);
		});
	});
});

describe("usePaymentSubmission exchange after a store-credit return", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() } });
	});

	const submitDoc = async (doc: any, returnIntent: "exchange" | "credit_note" | null = null) => {
		const invoiceService = (await import("../src/posapp/services/invoiceService")).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: doc.name,
			doctype: "Sales Invoice",
			docstatus: 1,
		});
		const invoiceDoc = ref<any>(doc);
		const customersStore = {
			setSelectedCustomer: vi.fn(),
			armExchangeCredit: vi.fn(),
		};
		const { submitInvoice } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({
				customer: null,
				posa_allow_submissions_in_background_job: 0,
				create_pos_invoice_instead_of_sales_invoice: 0,
			}),
			stockSettings: ref({}),
			invoiceType: ref(doc.is_return ? "Return" : "Invoice"),
			formatFloat: (value) => Number(value || 0),
			stores: {
				toastStore: { show: vi.fn() },
				uiStore: { setLastInvoice: vi.fn(), setLastStockAdjustment: vi.fn() },
				customersStore,
				invoiceStore: { invoiceDoc: invoiceDoc.value },
			},
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});
		const result = await submitInvoice(returnIntent === "credit_note", {
			onFinishNavigation: vi.fn(),
			onScheduleBackgroundCheck: vi.fn(),
			returnIntent,
		});
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		return { customersStore, result };
	};

	it("keeps the customer and arms their credit for the next sale", async () => {
		const { customersStore, result } = await submitDoc({
			name: "ACC-SINV-RET-1",
			doctype: "Sales Invoice",
			is_return: 1,
			customer: "CUST-R",
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 0, type: "Cash" }],
			rounded_total: -50,
			grand_total: -50,
		});

		expect(result?.success).toBe(true);
		expect(customersStore.setSelectedCustomer).toHaveBeenLastCalledWith("CUST-R");
		expect(customersStore.armExchangeCredit).toHaveBeenCalledWith("CUST-R");
	});

	const creditReturn = (name: string) => ({
		name,
		doctype: "Sales Invoice",
		is_return: 1,
		customer: "CUST-R",
		items: [],
		payments: [{ mode_of_payment: "Cash", amount: 0, type: "Cash" }],
		rounded_total: -50,
		grand_total: -50,
	});

	it("Exchange: continue to new sale keeps the customer and arms their credit", async () => {
		const { customersStore } = await submitDoc(creditReturn("ACC-SINV-RET-2"), "exchange");
		expect(customersStore.setSelectedCustomer).toHaveBeenLastCalledWith("CUST-R");
		expect(customersStore.armExchangeCredit).toHaveBeenCalledWith("CUST-R");
	});

	it("Credit note issue ends the visit: no exchange sale is set up", async () => {
		const { customersStore, result } = await submitDoc(creditReturn("ACC-SINV-RET-3"), "credit_note");
		expect(result?.success).toBe(true);
		expect(customersStore.armExchangeCredit).not.toHaveBeenCalled();
		expect(customersStore.setSelectedCustomer).toHaveBeenLastCalledWith(null);
	});

	it("does nothing special after a normal sale", async () => {
		const { customersStore } = await submitDoc({
			name: "ACC-SINV-SALE-1",
			doctype: "Sales Invoice",
			is_return: 0,
			customer: "CUST-S",
			items: [],
			payments: [{ mode_of_payment: "Cash", amount: 100, type: "Cash" }],
			rounded_total: 100,
			grand_total: 100,
		});

		expect(customersStore.armExchangeCredit).not.toHaveBeenCalled();
		expect(customersStore.setSelectedCustomer).toHaveBeenLastCalledWith(null);
	});
});
