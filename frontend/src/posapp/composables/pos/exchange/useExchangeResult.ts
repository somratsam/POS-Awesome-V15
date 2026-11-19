// The exchange's result line -- "Customer pays: OMR X", "Credit note to
// issue: OMR X", "Even exchange — nothing to pay" -- for the cart's summary
// (normal screen and fast counter mode) and the small-screen dock
// (section 109). Always the server's figures (quote_exchange, checked 0.4 s
// after the cart's last change); while a change is being checked the last
// result stays, dimmed, with "Checking…".

import { computed, ref, watch } from "vue";
import { useExchangeStore } from "../../../stores/exchangeStore";
import { useUIStore } from "../../../stores/uiStore";
import { useFormat } from "../../../format";
import { exchangeFigures } from "../../../utils/oneScreenExchange";
import { exchangeResultLine, type ExchangeResultTone } from "../../../utils/oneScreenExchangeText";

declare const __: (text: string, args?: any[]) => string;

const translate = (text: string, args?: any[]) =>
	typeof __ === "function" ? __(text, args) : text.replace(/\{(\d+)\}/g, (_m, i) => String(args?.[Number(i)] ?? ""));

export function useExchangeResult() {
	const exchange = useExchangeStore();
	const ui = useUIStore();
	const { formatCurrency, currencySymbol } = useFormat();
	const precision = computed(() => Number(ui.posProfile?.currency_precision) || 3);
	// No-break space: the amount never wraps away from its symbol.
	const money = (value: number) =>
		`${currencySymbol(ui.posProfile?.currency || "")} ${formatCurrency(Math.abs(Number(value) || 0))}`;

	/** Server figures for the cart as it is now; null while being checked. */
	const figures = computed(() => {
		const quote = exchange.serverQuote;
		if (!quote) return null;
		return exchangeFigures(quote.returned, quote.sale_total ?? null, precision.value);
	});

	const last = ref<{ tone: ExchangeResultTone; text: string } | null>(null);
	const current = computed(() => exchangeResultLine(figures.value, money, translate));
	watch(
		current,
		(value) => {
			if (value.tone !== "checking") last.value = value;
		},
		{ immediate: true },
	);
	watch(
		() => exchange.active,
		(active) => {
			if (!active) last.value = null;
		},
	);

	const retry = () => exchange.retryQuote();
	const result = computed(() => {
		if (current.value.tone !== "checking") return { ...current.value, checking: false, error: "", retry };
		// The check failed or timed out: say so, with Retry -- never a
		// "Checking…" that stays forever.
		if (exchange.quoteError) {
			return {
				tone: "error" as const,
				text: translate("Totals not checked"),
				checking: false,
				error: exchange.quoteError,
				retry,
			};
		}
		return last.value
			? { ...last.value, checking: true, error: "", retry }
			: { ...current.value, checking: true, error: "", retry };
	});
	/** Server's "New items" total (null: none, or being checked). */
	const newItemsTotal = computed(() => exchange.serverQuote?.sale_total ?? null);

	return { result, figures, newItemsTotal, money };
}
