// The credit note voucher card's model (section 112), shared by the Active
// sale box (InvoiceSummary.vue) and the small-screen sale dock (Pos.vue).
import { computed, ref, watch } from "vue";
import { useSaleCreditStore } from "../../../stores/saleCreditStore";
import { buildSaleCreditCard } from "../../../utils/saleCreditCard";

declare const window: any;

export function useSaleCreditCard(money: (_value: number) => string) {
	const saleCredit = useSaleCreditStore();
	const t = (text: string, args?: any[]) => {
		const translate =
			window.__ ||
			((value: string, list?: any[]) => (list || []).reduce((out, a, i) => out.replace(`{${i}}`, a), value));
		return translate(text, args);
	};

	const card = computed(() =>
		buildSaleCreditCard({
			vouchers: saleCredit.vouchers || [],
			figures: saleCredit.figures,
			today: window.frappe?.datetime?.get_today?.() || new Date().toISOString().slice(0, 10),
			money,
			formatDate: (value: string) => window.frappe?.datetime?.str_to_user?.(value) || value,
			t,
		}),
	);

	// PAY keeps the last amount, dimmed, while the cart is re-checked.
	const lastPay = ref("");
	watch(
		() => [saleCredit.active, card.value.pay] as const,
		([active, pay]) => {
			if (!active) lastPay.value = "";
			else if (pay) lastPay.value = pay;
		},
		{ immediate: true },
	);

	const labels = computed(() => {
		if (!saleCredit.active) return { amount: "", pay: "", pending: false };
		const figures = saleCredit.figures;
		return {
			amount: figures ? `−${money(figures.credit)}` : card.value.available,
			pay: card.value.pay || lastPay.value,
			pending: !card.value.pay,
		};
	});

	return { saleCredit, card, labels };
}
