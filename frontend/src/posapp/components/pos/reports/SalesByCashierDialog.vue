<template>
	<v-dialog
		v-model="dialogVisible"
		fullscreen
		:persistent="overlayOpen"
		transition="dialog-bottom-transition"
	>
		<div
			class="sbc"
			:class="[`sbc--${layout}`, { 'sbc--still': still }]"
			data-testid="sales-by-cashier-dialog"
			:data-layout="layout"
			@keydown.esc="onEscape"
		>
			<!-- Header -->
			<header class="sbc-top">
				<div class="sbc-top__row">
					<button
						type="button"
						class="sbc-back"
						:aria-label="__('Back to till')"
						data-testid="sbc-back"
						@click="close"
					>
						<v-icon icon="mdi-chevron-left" size="20" />
						<span v-if="layout !== 'phone'">{{ __("Back to till") }}</span>
					</button>
					<div class="sbc-titles">
						<h1>{{ __("Sales by Cashier") }}</h1>
						<div class="sbc-titles__store" data-testid="sbc-subtitle">{{ subtitle }}</div>
					</div>
					<button
						v-if="layout === 'wide'"
						type="button"
						class="sbc-switch"
						role="switch"
						:aria-checked="compare ? 'true' : 'false'"
						data-testid="sbc-compare"
						@click="toggleCompare"
					>
						<span class="sbc-switch__knob"></span>{{ __("Compare with another period") }}
					</button>
				</div>

				<div v-if="layout !== 'phone'" class="sbc-controls">
					<div class="sbc-seg" role="group" :aria-label="__('Period')">
						<button
							v-for="option in periodPresets"
							:key="option.id"
							type="button"
							:aria-pressed="preset1 === option.id ? 'true' : 'false'"
							:data-testid="`sbc-preset-${option.id}`"
							@click="choosePreset(option.id)"
						>
							{{ option.label }}
						</button>
					</div>
					<div class="sbc-pill-wrap">
						<button
							type="button"
							class="sbc-pill"
							:aria-expanded="pop === 'p1' ? 'true' : 'false'"
							data-testid="sbc-range-1"
							@click="togglePop('p1')"
						>
							<v-icon icon="mdi-calendar-blank-outline" size="16" />{{ label(range1) }}
							<v-icon icon="mdi-chevron-down" size="16" />
						</button>
						<div v-if="pop === 'p1'" class="sbc-pop" data-testid="sbc-pop-1">
							<SalesByCashierCalendar
								:range="range1"
								:today="today"
								:months="2"
								:week-start="weekStart"
								@pick="pickRange(1, $event)"
							/>
						</div>
					</div>
					<div v-if="compare" class="sbc-pill-wrap">
						<button
							type="button"
							class="sbc-pill sbc-pill--p2"
							:aria-expanded="pop === 'p2' ? 'true' : 'false'"
							data-testid="sbc-range-2"
							@click="togglePop('p2')"
						>
							<span class="sbc-pill__vs">{{ __("vs") }}</span>{{ label(range2) }}
							<v-icon icon="mdi-chevron-down" size="16" />
						</button>
						<div
							v-if="pop === 'p2'"
							class="sbc-pop"
							:class="{ 'sbc-pop--right': layout === 'tablet' }"
							data-testid="sbc-pop-2"
						>
							<div class="sbc-choices">
								<button
									v-for="option in comparePresets"
									:key="option.id"
									type="button"
									:aria-pressed="preset2 === option.id ? 'true' : 'false'"
									:data-testid="`sbc-compare-preset-${option.id}`"
									@click="chooseComparePreset(option.id)"
								>
									{{ option.label }}
								</button>
							</div>
							<SalesByCashierCalendar
								:range="range2"
								:today="today"
								:months="2"
								:week-start="weekStart"
								@pick="pickRange(2, $event)"
							/>
						</div>
					</div>
					<button
						v-if="layout === 'tablet'"
						type="button"
						class="sbc-switch"
						role="switch"
						:aria-checked="compare ? 'true' : 'false'"
						data-testid="sbc-compare"
						@click="toggleCompare"
					>
						<span class="sbc-switch__knob"></span>{{ __("Compare with another period") }}
					</button>
				</div>

				<div v-else class="sbc-chips">
					<button type="button" class="sbc-chip" data-testid="sbc-chip-period" @click="openPeriodSheet('p1')">
						<v-icon icon="mdi-calendar-blank-outline" size="16" />{{ presetName }} · {{ label(range1) }}
						<v-icon icon="mdi-chevron-down" size="16" />
					</button>
					<button
						type="button"
						class="sbc-chip"
						:class="{ 'sbc-chip--on': compare }"
						data-testid="sbc-chip-compare"
						@click="openPeriodSheet(compare ? 'p2' : 'p1')"
					>
						<v-icon icon="mdi-swap-horizontal" size="16" />{{
							compare ? __("vs {0}", [label(range2)]) : __("Compare")
						}}
					</button>
				</div>
			</header>
			<div v-if="pop" class="sbc-pop-catcher" data-testid="sbc-pop-catcher" @click="pop = ''"></div>

			<!-- Body -->
			<div class="sbc-scroll">
				<div v-if="problem" class="sbc-card sbc-problem" :class="`sbc-problem--${problem.type}`" data-testid="sbc-problem">
					<v-icon :icon="problem.icon" size="22" />
					<span>{{ problem.text }}</span>
					<button v-if="problem.retry" type="button" class="sbc-problem__retry" data-testid="sbc-retry" @click="load">
						{{ __("Try again") }}
					</button>
				</div>

				<template v-else>
					<div class="sbc-tiles" data-testid="sbc-tiles">
						<template v-if="view && !isEmpty">
							<div v-for="tile in tiles" :key="tile.id" class="sbc-tile" :data-testid="`sbc-tile-${tile.id}`">
								<div class="sbc-tile__label">{{ tile.label }}</div>
								<div class="sbc-tile__value">
									<small v-if="tile.currency">{{ tile.currency }}</small>{{ tile.value }}
								</div>
								<div class="sbc-tile__sub">
									<SalesByCashierChange v-if="tile.change" :period1="tile.change[0]" :period2="tile.change[1]" />
									<span v-if="tile.badge" class="sbc-badge" :class="`sbc-badge--${tile.badge.kind}`" data-testid="sbc-badge">{{
										tile.badge.text
									}}</span>
									<span v-if="tile.text">{{ tile.text }}</span>
								</div>
							</div>
						</template>
						<template v-else-if="!view">
							<div v-for="index in 4" :key="index" class="sbc-tile">
								<div class="sbc-sk" style="width: 40%"></div>
								<div class="sbc-sk sbc-sk--tall" style="width: 70%"></div>
								<div class="sbc-sk" style="width: 50%"></div>
							</div>
						</template>
					</div>

					<div class="sbc-main">
						<section class="sbc-card sbc-chart" :class="{ 'sbc-chart--loading': loading && view }">
							<div class="sbc-progress"></div>
							<div class="sbc-card__head">
								<h2>{{ __("Net sales by cashier") }}</h2>
								<div class="sbc-seg sbc-seg--small" role="group" :aria-label="__('View')">
									<button
										type="button"
										:aria-pressed="mode === 'chart' ? 'true' : 'false'"
										data-testid="sbc-view-chart"
										@click="mode = 'chart'"
									>
										{{ __("Chart") }}
									</button>
									<button
										type="button"
										:aria-pressed="mode === 'table' ? 'true' : 'false'"
										data-testid="sbc-view-table"
										@click="mode = 'table'"
									>
										{{ __("Table") }}
									</button>
								</div>
							</div>

							<div v-if="!view" class="sbc-skeleton" data-testid="sbc-loading">
								<div v-for="width in [90, 64, 46, 30, 18]" :key="width" class="sbc-skeleton__row">
									<span class="sbc-sk sbc-sk--dot"></span><span class="sbc-sk"></span
									><span class="sbc-sk sbc-sk--bar" :style="{ width: `${width}%` }"></span>
								</div>
								<p class="sbc-note">{{ __("Loading sales…") }}</p>
							</div>

							<div v-else-if="isEmpty" class="sbc-empty" data-testid="sbc-empty">
								<span class="sbc-empty__icon"><v-icon icon="mdi-chart-bar" size="28" /></span>
								<h3>{{ __("No sales in this period.") }}</h3>
								<p>{{ __("Pick another period above.") }}</p>
							</div>

							<div v-else data-testid="sbc-report" class="sbc-report">
								<div v-if="view.compare" class="sbc-legend" data-testid="sbc-legend">
									<span
										><i class="sbc-legend__bar"></i><b>{{ __("Period 1") }}</b> · {{ view.periodLabels[0] }}</span
									>
									<span
										><i class="sbc-legend__marker"></i><b>{{ __("Period 2") }}</b> · {{ view.periodLabels[1] }}</span
									>
								</div>

								<SalesByCashierBars
									v-if="mode === 'chart'"
									:key="openSeq"
									:rows="view.rows"
									:period-count="view.periods.length"
									:store-net="view.store[0].net"
									:selected-key="selectedKey"
									:layout="layout"
									:still="still"
									:format-money="money"
									@select="select"
								/>

								<table v-else-if="layout !== 'phone'" class="sbc-table" data-testid="sbc-table">
									<thead>
										<tr v-if="!view.compare">
											<th>{{ __("Cashier") }}</th>
											<th>{{ __("Gross") }}</th>
											<th>{{ __("Returns") }}</th>
											<th>{{ __("Net") }}</th>
											<th>{{ __("Sales") }}</th>
											<th>{{ __("Avg basket (before returns)") }}</th>
											<th>{{ __("Share") }}</th>
										</tr>
										<tr v-else>
											<th>{{ __("Cashier") }}</th>
											<th>{{ __("Net · Period 1") }}</th>
											<th>{{ __("Net · Period 2") }}</th>
											<th>{{ __("Change") }}</th>
											<th>{{ __("Sales 1") }}</th>
											<th>{{ __("Sales 2") }}</th>
										</tr>
									</thead>
									<tbody>
										<tr
											v-for="row in tableRows"
											:key="row.key"
											:class="`sbc-table__row--${row.kind}`"
											data-testid="sbc-table-row"
										>
											<td>
												<span class="sbc-table__who">
													<span v-if="row.kind !== 'total'" class="sbc-table__avatar">{{ row.initials }}</span
													>{{ row.label }}
												</span>
											</td>
											<template v-if="!view.compare">
												<td>{{ money(row.values[0].gross) }}</td>
												<td>{{ money(row.values[0].returns) }}</td>
												<td class="sbc-table__strong">{{ money(row.values[0].net) }}</td>
												<td>{{ row.values[0].sales }}</td>
												<td>{{ basket(row.values[0].avg_basket) }}</td>
												<td>{{ share(row) }}</td>
											</template>
											<template v-else>
												<td class="sbc-table__strong">{{ money(row.values[0].net) }}</td>
												<td>{{ money(row.values[1].net) }}</td>
												<td>
													<SalesByCashierChange :period1="row.values[0].net" :period2="row.values[1].net" />
												</td>
												<td>{{ row.values[0].sales }}</td>
												<td>{{ row.values[1].sales }}</td>
											</template>
										</tr>
									</tbody>
								</table>

								<div v-else class="sbc-cards" data-testid="sbc-cards">
									<div
										v-for="row in tableRows"
										:key="row.key"
										class="sbc-mcard"
										:class="`sbc-mcard--${row.kind}`"
										data-testid="sbc-card"
									>
										<div class="sbc-mcard__top">
											<span>{{ row.label }}</span><span>{{ money(row.values[0].net) }}</span>
										</div>
										<div v-if="!view.compare" class="sbc-mcard__grid">
											<span>{{ __("Gross") }} <b>{{ money(row.values[0].gross) }}</b></span>
											<span>{{ __("Returns") }} <b>{{ money(row.values[0].returns) }}</b></span>
											<span>{{ __("Sales") }} <b>{{ row.values[0].sales }}</b></span>
											<span
												>{{ __("Avg basket (before returns)") }} <b>{{ basket(row.values[0].avg_basket) }}</b></span
											>
										</div>
										<div v-else class="sbc-mcard__grid">
											<span>{{ __("Net · Period 2") }} <b>{{ money(row.values[1].net) }}</b></span>
											<span
												>{{ __("Change") }}
												<SalesByCashierChange :period1="row.values[0].net" :period2="row.values[1].net"
											/></span>
											<span>{{ __("Sales 1") }} <b>{{ row.values[0].sales }}</b></span>
											<span>{{ __("Sales 2") }} <b>{{ row.values[1].sales }}</b></span>
										</div>
									</div>
								</div>

								<div class="sbc-reconcile" data-testid="sbc-reconcile">
									<p v-for="(line, index) in totalLines" :key="index" class="sbc-reconcile__line">{{ line }}</p>
									<p class="sbc-note">
										{{ __("Till sales only. Matches the Z Reports for these dates when every shift opened and closed within them.") }}
									</p>
									<p v-if="othersNote" class="sbc-note sbc-note--icon" data-testid="sbc-others-note">
										<v-icon icon="mdi-information-outline" size="15" /><span>{{ othersNote }}</span>
									</p>
								</div>
							</div>
						</section>

						<aside v-if="layout === 'wide'" class="sbc-card sbc-side" data-testid="sbc-side">
							<SalesByCashierDetail
								v-if="view && !isEmpty"
								:view="view"
								:selected-key="selectedKey"
								:format-money="money"
								:others-note="othersNote"
								@clear="selectedKey = ''"
							/>
							<template v-else-if="!view">
								<div class="sbc-sk" style="width: 50%"></div>
								<div class="sbc-sk sbc-sk--tall" style="width: 75%"></div>
							</template>
							<p v-else class="sbc-note">{{ __("No sales in this period.") }}</p>
						</aside>
					</div>
				</template>
			</div>

			<!-- Bottom sheets (tablet and phone) -->
			<div class="sbc-sheet-layer" :class="{ 'sbc-sheet-layer--open': sheet }" data-testid="sbc-sheet-layer">
				<div class="sbc-sheet-layer__scrim" data-testid="sbc-sheet-scrim" @click="closeSheet"></div>
				<div v-if="sheet" class="sbc-sheet" role="dialog" aria-modal="true" data-testid="sbc-sheet" :data-sheet="sheet">
					<div class="sbc-sheet__grab"></div>
					<div class="sbc-sheet__head">
						<b>{{ sheet === "detail" ? __("Details") : __("Period") }}</b>
						<button type="button" class="sbc-icon-btn" :aria-label="__('Close')" data-testid="sbc-sheet-close" @click="closeSheet">
							<v-icon icon="mdi-close" size="18" />
						</button>
					</div>

					<SalesByCashierDetail
						v-if="sheet === 'detail' && view"
						:view="view"
						:selected-key="selectedKey"
						:format-money="money"
						:others-note="othersNote"
						@clear="closeSheet"
					/>

					<template v-else-if="sheet === 'period'">
						<div v-if="compare" class="sbc-seg sbc-seg--tabs" role="tablist">
							<button
								type="button"
								role="tab"
								:aria-pressed="sheetTab === 'p1' ? 'true' : 'false'"
								data-testid="sbc-sheet-tab-p1"
								@click="sheetTab = 'p1'"
							>
								{{ __("Period 1") }}
							</button>
							<button
								type="button"
								role="tab"
								:aria-pressed="sheetTab === 'p2' ? 'true' : 'false'"
								data-testid="sbc-sheet-tab-p2"
								@click="sheetTab = 'p2'"
							>
								{{ __("Period 2") }}
							</button>
						</div>
						<div v-if="activeTab === 'p1'" class="sbc-choices sbc-choices--grid">
							<button
								v-for="option in periodPresets"
								:key="option.id"
								type="button"
								:aria-pressed="preset1 === option.id ? 'true' : 'false'"
								:data-testid="`sbc-preset-${option.id}`"
								@click="choosePreset(option.id)"
							>
								{{ option.label }}
							</button>
						</div>
						<div v-else class="sbc-choices">
							<button
								v-for="option in comparePresets"
								:key="option.id"
								type="button"
								:aria-pressed="preset2 === option.id ? 'true' : 'false'"
								:data-testid="`sbc-compare-preset-${option.id}`"
								@click="chooseComparePreset(option.id)"
							>
								{{ option.label }}
							</button>
						</div>
						<SalesByCashierCalendar
							:key="activeTab"
							:range="activeTab === 'p1' ? range1 : range2"
							:today="today"
							:months="1"
							:week-start="weekStart"
							@pick="pickRange(activeTab === 'p1' ? 1 : 2, $event)"
						/>
						<button
							type="button"
							class="sbc-switch sbc-switch--sheet"
							role="switch"
							:aria-checked="compare ? 'true' : 'false'"
							data-testid="sbc-compare"
							@click="toggleCompare"
						>
							<span class="sbc-switch__knob"></span>{{ __("Compare with another period") }}
						</button>
					</template>
				</div>
			</div>
		</div>
	</v-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useUIStore } from "../../../stores/uiStore";
import { useEmployeeStore } from "../../../stores/employeeStore";
import { useFormat } from "../../../format";
import api from "../../../services/api";
import { isOffline } from "../../../../offline/index";
import SalesByCashierBars from "./SalesByCashierBars.vue";
import SalesByCashierCalendar from "./SalesByCashierCalendar.vue";
import SalesByCashierChange from "./SalesByCashierChange.vue";
import SalesByCashierDetail from "./SalesByCashierDetail.vue";
import {
	MONTHS_SHORT,
	compareRange,
	initials,
	presetRange,
	rangeLabel,
	rangeProblem,
	weekStartIndex,
} from "../../../utils/salesByCashierPeriods";

const METHOD = "posawesome.posawesome.api.sales_by_cashier.get_sales_by_cashier";

const uiStore = useUIStore();
const employeeStore = useEmployeeStore();
const { formatCurrency } = useFormat();
const { width } = useDisplay();

// Till (side panel) from 1280px, tablet (bottom sheets) from 600px, else phone.
const layout = computed(() => {
	const w = Number(width.value) || 0;
	if (w >= 1280) return "wide";
	if (w >= 600) return "tablet";
	return "phone";
});

const dialogVisible = computed({
	get: () => uiStore.salesByCashierDialog,
	set: (value) => {
		if (!value) close();
	},
});

const periodPresets = [
	{ id: "today", label: __("Today") },
	{ id: "yesterday", label: __("Yesterday") },
	{ id: "this_week", label: __("This week") },
	{ id: "this_month", label: __("This month") },
	{ id: "last_month", label: __("Last month") },
	{ id: "custom", label: __("Custom") },
];
const comparePresets = [
	{ id: "previous", label: __("Previous period") },
	{ id: "last_year", label: __("Same period last year") },
	{ id: "custom", label: __("Custom") },
];

const preset1 = ref("this_month");
const range1 = ref({ from: "", to: "" });
const compare = ref(false);
const preset2 = ref("previous");
const range2 = ref({ from: "", to: "" });

const report = ref(null);
const loading = ref(false);
const refusal = ref("");
const failed = ref(false);
const offline = ref(false);
const mode = ref("chart");
const selectedKey = ref("");
const pop = ref("");
const sheet = ref("");
const sheetTab = ref("p1");
const openSeq = ref(0);
const still = ref(false);
let requestSeq = 0;
let openingPending = false;

const today = computed(() => frappe?.datetime?.get_today?.() || new Date().toISOString().slice(0, 10));
const weekStart = computed(() => weekStartIndex(frappe?.boot?.sysdefaults?.first_day_of_the_week));
const months = MONTHS_SHORT.map((month) => __(month));
const label = (range) => (range?.from && range?.to ? rangeLabel(range, months) : "");

const precision = computed(() => Number(report.value?.precision ?? 3));
const money = (value) => formatCurrency(Number(value) || 0, precision.value);
const basket = (value) => (value === null || value === undefined ? "—" : money(value));

const overlayOpen = computed(() => Boolean(pop.value || sheet.value));
const activeTab = computed(() => (compare.value ? sheetTab.value : "p1"));
const presetName = computed(() => (periodPresets.find((option) => option.id === preset1.value) || periodPresets[5]).label);

const subtitle = computed(() => {
	const store = report.value?.store || uiStore.posProfile?.name || "";
	return store ? `${store} · ${__("Net sales incl. VAT")}` : __("Net sales incl. VAT");
});

const hideMode = computed(() => report.value?.hidden_mode === "hide");

// The server's report, shaped for the screen. Keys stay the same across
// reloads so rows can slide to their new rank.
const view = computed(() => {
	const result = report.value;
	if (!result) return null;
	const seen = {};
	const rows = result.rows.map((row) => {
		const base = `${row.kind}:${row.label}`;
		seen[base] = (seen[base] || 0) + 1;
		return {
			...row,
			key: seen[base] > 1 ? `${base}#${seen[base]}` : base,
			initials: row.kind === "others" ? "··" : row.kind === "not_recorded" ? "?" : initials(row.label),
			sub: row.kind === "others" ? __("Hidden accounts and former staff") : "",
			lead: false,
		};
	});
	const cashiers = rows.filter((row) => row.kind === "cashier");
	if (cashiers[0] && Number(cashiers[0].values[0].net) > 0) cashiers[0].lead = true;
	return {
		compare: result.periods.length > 1,
		periods: result.periods,
		periodLabels: result.periods.map((period) => label(period)),
		rows,
		cashiers,
		store: result.totals.store,
		currency: result.currency || "",
	};
});

const isEmpty = computed(() =>
	(report.value?.totals?.store || []).every((values) => !values.sales && !Number(values.gross) && !Number(values.returns)),
);

function share(row) {
	const storeNet = Number(view.value?.store[0].net) || 0;
	if (row.kind === "total") return storeNet > 0.0005 ? "100%" : "—";
	if (!(storeNet > 0.0005)) return "—";
	return `${Math.round((Number(row.values[0].net) / storeNet) * 100)}%`;
}

const tableRows = computed(() =>
	view.value
		? [...view.value.rows, { key: "total", label: __("Store total"), kind: "total", initials: "", values: view.value.store }]
		: [],
);

const tiles = computed(() => {
	const v = view.value;
	if (!v) return [];
	const now = v.store[0];
	const before = v.store[1];
	const returnsShare = (values) => (Number(values.gross) ? (Math.abs(Number(values.returns)) / Number(values.gross)) * 100 : 0);
	const salesBadge = () => {
		const diff = Number(now.sales) - Number(before.sales);
		const kind = diff > 0 ? "up" : diff < 0 ? "down" : "same";
		const arrow = diff > 0 ? "▲ " : diff < 0 ? "▼ " : "";
		return { kind, text: `${arrow}${__("{0} sales", [Math.abs(diff)])}` };
	};
	return [
		{
			id: "net",
			label: __("Net sales"),
			currency: v.currency,
			value: money(now.net),
			change: v.compare ? [Number(now.net), Number(before.net)] : null,
			text: v.compare ? __("vs {0}", [v.periodLabels[1]]) : __("Till sales · incl. VAT"),
		},
		{
			id: "sales",
			label: __("Sales"),
			value: String(now.sales),
			badge: v.compare ? salesBadge() : null,
			text: v.compare ? "" : __("Receipts in this period"),
		},
		{
			id: "basket",
			label: __("Avg basket (before returns)"),
			value: basket(now.avg_basket),
			change: v.compare ? [Number(now.avg_basket) || 0, Number(before.avg_basket) || 0] : null,
			text: v.compare ? "" : __("Gross ÷ sales"),
		},
		{
			id: "returns",
			label: __("Returns"),
			value: money(now.returns),
			text: v.compare
				? `${__("{0}% of gross", [returnsShare(now).toFixed(1)])} · ${__("was {0}%", [returnsShare(before).toFixed(1)])}`
				: __("{0}% of gross", [returnsShare(now).toFixed(1)]),
		},
	];
});

const othersPresent = computed(() =>
	report.value
		? hideMode.value
			? report.value.totals.others_net.some((net) => Math.abs(Number(net) || 0) >= 0.0005)
			: report.value.rows.some((row) => row.kind === "others")
		: false,
);
const notRecordedPresent = computed(() => Boolean(report.value?.rows.some((row) => row.kind === "not_recorded")));

const totalLines = computed(() => {
	if (!report.value) return [];
	const { totals } = report.value;
	return report.value.periods.map((_, index) => {
		let line = __("Store total {0} = shown cashiers {1}", [money(totals.store[index].net), money(totals.shown_net[index])]);
		if (othersPresent.value) {
			line += hideMode.value
				? ` ${__("+ not shown {0}", [money(totals.others_net[index])])}`
				: ` ${__("+ Others {0}", [money(totals.others_net[index])])}`;
		}
		if (notRecordedPresent.value) {
			line += ` ${__("+ Cashier not recorded {0}", [money(totals.not_recorded_net[index])])}`;
		}
		return report.value.periods.length > 1 ? `${index === 0 ? __("Period 1") : __("Period 2")}: ${line}` : line;
	});
});

const othersNote = computed(() => {
	if (!othersPresent.value) return "";
	return hideMode.value
		? __("Not shown: cashiers hidden by the store and staff no longer assigned.")
		: __("Others: cashiers hidden by the store and staff no longer assigned.");
});

const REFUSALS = {
	not_assigned: () => __("You are not assigned to this store."),
	disabled: () => __("Sales by Cashier is turned off for this store."),
	locked: () => __("Unlock the till with your PIN to see this report."),
};

function rangeMessage(kind) {
	if (kind === "order") return __("The From date must be on or before the To date.");
	if (kind === "too_long") return __("Choose a period of one year or less.");
	return __("Choose a From and a To date.");
}

const rangeIssue = computed(() => {
	const first = rangeProblem(range1.value);
	if (first) return first;
	return compare.value ? rangeProblem(range2.value) : "";
});

const problem = computed(() => {
	if (rangeIssue.value) return { type: "info", icon: "mdi-calendar-alert", text: rangeMessage(rangeIssue.value) };
	if (offline.value) return { type: "info", icon: "mdi-wifi-off", text: __("This report needs a connection to the server.") };
	if (refusal.value) return { type: "warning", icon: "mdi-lock-outline", text: refusal.value };
	if (failed.value)
		return {
			type: "error",
			icon: "mdi-alert-circle-outline",
			text: __("Couldn't load the report. Check the connection and try again."),
			retry: true,
		};
	return null;
});

async function load() {
	if (rangeIssue.value) {
		requestSeq += 1;
		loading.value = false;
		return;
	}
	const seq = ++requestSeq;
	refusal.value = "";
	failed.value = false;
	offline.value = false;
	if (isOffline()) {
		offline.value = true;
		loading.value = false;
		return;
	}
	loading.value = true;
	const args = {
		pos_profile: uiStore.posProfile?.name,
		from_date: range1.value.from,
		to_date: range1.value.to,
		opened: openingPending ? 1 : 0,
	};
	if (compare.value) {
		args.compare_from = range2.value.from;
		args.compare_to = range2.value.to;
	}
	try {
		const result = await api.call(METHOD, args);
		if (seq !== requestSeq) return;
		openingPending = false;
		if (!result?.allowed) {
			report.value = null;
			refusal.value = (REFUSALS[result?.reason] || (() => result?.message || __("Couldn't load the report.")))();
			return;
		}
		report.value = result;
	} catch (error) {
		if (seq !== requestSeq) return;
		console.error("Sales by Cashier failed to load", error);
		failed.value = true;
	} finally {
		if (seq === requestSeq) loading.value = false;
	}
}

function syncPeriod2() {
	if (!compare.value || preset2.value === "custom") return;
	const next = compareRange(preset2.value, range1.value, preset1.value);
	if (next) range2.value = next;
}

function choosePreset(id) {
	if (id === "custom") {
		// Keep the dates and pick new ones in the calendar.
		preset1.value = "custom";
		if (layout.value !== "phone") pop.value = "p1";
		return;
	}
	preset1.value = id;
	range1.value = presetRange(id, today.value, weekStart.value);
	syncPeriod2();
	pop.value = "";
	if (sheet.value === "period") sheet.value = "";
	load();
}

function chooseComparePreset(id) {
	preset2.value = id;
	if (id === "custom") return; // pick the dates in the calendar below
	syncPeriod2();
	pop.value = "";
	if (sheet.value === "period") sheet.value = "";
	load();
}

function pickRange(period, range) {
	if (period === 1) {
		range1.value = range;
		preset1.value = "custom";
		syncPeriod2();
	} else {
		range2.value = range;
		preset2.value = "custom";
	}
	pop.value = "";
	sheet.value = "";
	load();
}

function toggleCompare() {
	compare.value = !compare.value;
	if (compare.value) {
		preset2.value = "previous";
		syncPeriod2();
		sheetTab.value = "p2";
	} else {
		sheetTab.value = "p1";
	}
	pop.value = "";
	load();
}

function togglePop(which) {
	pop.value = pop.value === which ? "" : which;
}

function openPeriodSheet(tab) {
	sheetTab.value = tab;
	sheet.value = "period";
}

function select(key) {
	if (layout.value === "wide") {
		selectedKey.value = selectedKey.value === key ? "" : key;
		return;
	}
	selectedKey.value = key;
	sheet.value = "detail";
}

function closeSheet() {
	if (sheet.value === "detail") selectedKey.value = "";
	sheet.value = "";
}

function onEscape(event) {
	// Esc first closes a calendar or a sheet, then the view itself.
	if (pop.value) {
		pop.value = "";
		event.stopPropagation();
	} else if (sheet.value) {
		closeSheet();
		event.stopPropagation();
	}
}

function reset() {
	preset1.value = "this_month";
	range1.value = presetRange("this_month", today.value, weekStart.value);
	compare.value = false;
	preset2.value = "previous";
	range2.value = { from: "", to: "" };
	report.value = null;
	refusal.value = "";
	failed.value = false;
	offline.value = false;
	mode.value = "chart";
	selectedKey.value = "";
	pop.value = "";
	sheet.value = "";
	sheetTab.value = "p1";
	still.value = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
	openSeq.value += 1;
}

function close() {
	requestSeq += 1;
	loading.value = false;
	pop.value = "";
	sheet.value = "";
	uiStore.closeSalesByCashier();
}

// A row that is no longer in the report can't stay selected.
watch(view, (next) => {
	if (selectedKey.value && !next?.rows.some((row) => row.key === selectedKey.value)) {
		selectedKey.value = "";
		if (sheet.value === "detail") sheet.value = "";
	}
});

watch(
	dialogVisible,
	(visible) => {
		if (visible) {
			reset();
			openingPending = true;
			load();
		}
	},
	{ immediate: true },
);

// The report belongs to whoever unlocked the till: close it on a lock or a
// PIN switch.
watch(
	() => employeeStore.isLocked,
	(locked) => {
		if (locked && dialogVisible.value) close();
	},
);
watch(
	() => employeeStore.currentCashier?.user || "",
	(next, previous) => {
		if (dialogVisible.value && next !== previous) close();
	},
);

defineExpose({ load, choosePreset, chooseComparePreset, toggleCompare, pickRange, close, select });
</script>

<style scoped>
.sbc {
	--sbc-line: rgba(var(--v-theme-on-surface), 0.09);
	--sbc-line-strong: rgba(var(--v-theme-on-surface), 0.16);
	--sbc-surface-2: rgba(var(--v-theme-on-surface), 0.06);
	--sbc-surface-3: rgba(var(--v-theme-on-surface), 0.11);
	--sbc-muted: rgba(var(--v-theme-on-surface), 0.62);
	--sbc-faint: rgba(var(--v-theme-on-surface), 0.38);
	--sbc-track: rgba(var(--v-theme-on-surface), 0.035);
	--sbc-muted-bar: rgba(var(--v-theme-on-surface), 0.22);
	--sbc-primary-soft: rgba(var(--v-theme-primary), 0.14);
	--sbc-primary-ghost: rgba(var(--v-theme-primary), 0.32);

	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
	background-color: rgb(var(--v-theme-background));
	background-image: linear-gradient(rgba(var(--v-theme-on-surface), 0.03), rgba(var(--v-theme-on-surface), 0.03));
	color: rgb(var(--v-theme-on-surface));
	font-variant-numeric: tabular-nums;
}

.sbc button {
	color: inherit;
	font: inherit;
}

/* Header */
.sbc-top {
	position: relative;
	z-index: 6;
	display: flex;
	flex: 0 0 auto;
	flex-direction: column;
	gap: 12px;
	padding: 16px 24px 14px;
	border-bottom: 1px solid var(--sbc-line);
	background: rgb(var(--v-theme-surface));
}

.sbc-top__row {
	display: flex;
	align-items: center;
	gap: 16px;
}

.sbc-back {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 9px 14px 9px 10px;
	border: 1px solid var(--sbc-line);
	border-radius: 10px;
	background: var(--sbc-surface-2);
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.sbc-back:hover {
	background: var(--sbc-surface-3);
}

.sbc-titles {
	flex: 1 1 auto;
	min-width: 0;
}

.sbc-titles h1 {
	margin: 0;
	font-size: 22px;
	font-weight: 700;
	letter-spacing: -0.01em;
}

.sbc-titles__store {
	margin-top: 2px;
	font-size: 14px;
	color: var(--sbc-muted);
}

.sbc-controls {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px 14px;
}

.sbc-seg {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 2px;
	padding: 3px;
	border-radius: 11px;
	background: var(--sbc-surface-2);
}

.sbc-seg button {
	padding: 8px 13px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--sbc-muted);
	font-size: 14px;
	font-weight: 500;
	white-space: nowrap;
	cursor: pointer;
	transition: background-color 0.2s, color 0.2s;
}

.sbc .sbc-seg button[aria-pressed="true"] {
	background: rgb(var(--v-theme-primary));
	color: rgb(var(--v-theme-on-primary));
	font-weight: 700;
}

.sbc-seg--small {
	flex: 0 0 auto;
	flex-wrap: nowrap;
}

.sbc-seg--small button {
	padding: 6px 12px;
	font-size: 13px;
}

.sbc-seg--tabs {
	display: flex;
	margin-bottom: 14px;
}

.sbc-seg--tabs button {
	flex: 1 1 0;
}

.sbc-pill-wrap {
	position: relative;
}

.sbc-pill {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 8px 14px;
	border: 1px solid var(--sbc-line);
	border-radius: 999px;
	background: var(--sbc-surface-2);
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.sbc-pill:hover,
.sbc-pill[aria-expanded="true"] {
	border-color: var(--sbc-primary-ghost);
}

.sbc-pill--p2 {
	border-style: dashed;
	background: transparent;
}

.sbc-pill__vs {
	font-weight: 500;
	color: var(--sbc-muted);
}

.sbc-pop {
	position: absolute;
	top: calc(100% + 8px);
	left: 0;
	z-index: 30;
	padding: 16px;
	border: 1px solid var(--sbc-line);
	border-radius: 16px;
	background: rgb(var(--v-theme-surface));
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
	animation: sbc-pop-in 0.16s ease-out;
}

.sbc-pop--right {
	right: 0;
	left: auto;
}

@keyframes sbc-pop-in {
	from {
		opacity: 0;
		transform: translateY(-6px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

.sbc-pop-catcher {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	z-index: 5;
}

.sbc-switch {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 10px;
	padding: 4px 0;
	border: 0;
	background: none;
	font-size: 14px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.sbc-switch__knob {
	position: relative;
	width: 40px;
	height: 23px;
	border-radius: 999px;
	background: var(--sbc-surface-3);
	transition: background-color 0.2s;
}

.sbc-switch__knob::after {
	content: "";
	position: absolute;
	top: 3px;
	left: 3px;
	width: 17px;
	height: 17px;
	border-radius: 50%;
	background: rgb(var(--v-theme-on-surface));
	transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sbc-switch[aria-checked="true"] .sbc-switch__knob {
	background: rgb(var(--v-theme-primary));
}

.sbc-switch[aria-checked="true"] .sbc-switch__knob::after {
	transform: translateX(17px);
	background: rgb(var(--v-theme-on-primary));
}

.sbc-switch--sheet {
	margin-top: 16px;
}

.sbc-choices {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 14px;
}

.sbc-choices--grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
}

.sbc-choices button {
	padding: 9px 12px;
	border: 1px solid var(--sbc-line);
	border-radius: 10px;
	background: var(--sbc-surface-2);
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}

.sbc .sbc-choices button[aria-pressed="true"] {
	border-color: rgb(var(--v-theme-primary));
	background: rgb(var(--v-theme-primary));
	color: rgb(var(--v-theme-on-primary));
}

.sbc-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.sbc-chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 7px 12px;
	border: 1px solid var(--sbc-line);
	border-radius: 999px;
	background: var(--sbc-surface-2);
	font-size: 13.5px;
	font-weight: 600;
	cursor: pointer;
}

.sbc .sbc-chip--on {
	border-color: var(--sbc-primary-ghost);
	color: rgb(var(--v-theme-primary));
}

/* Body */
.sbc-scroll {
	flex: 1 1 auto;
	overflow: auto;
	padding: 20px 24px 28px;
}

.sbc-card {
	position: relative;
	overflow: hidden;
	padding: 18px 20px;
	border: 1px solid var(--sbc-line);
	border-radius: 18px;
	background: rgb(var(--v-theme-surface));
}

.sbc-problem {
	display: flex;
	align-items: center;
	gap: 12px;
	font-size: 15px;
	font-weight: 600;
}

.sbc-problem--warning {
	color: rgb(var(--v-theme-warning));
}

.sbc-problem--error {
	color: rgb(var(--v-theme-error));
}

.sbc-problem__retry {
	margin-left: auto;
	padding: 8px 14px;
	border: 1px solid var(--sbc-line);
	border-radius: 10px;
	background: var(--sbc-surface-2);
	font-weight: 700;
	cursor: pointer;
}

.sbc-tiles {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 14px;
	margin-bottom: 18px;
}

.sbc-tile {
	min-width: 0;
	padding: 16px 18px;
	border: 1px solid var(--sbc-line);
	border-radius: 16px;
	background: rgb(var(--v-theme-surface));
}

.sbc-tile__label {
	font-size: 13px;
	font-weight: 600;
	letter-spacing: 0.02em;
	text-transform: uppercase;
	color: var(--sbc-muted);
}

.sbc-tile__value {
	margin-top: 6px;
	overflow: hidden;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.02em;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sbc-tile__value small {
	margin-right: 4px;
	font-size: 15px;
	font-weight: 600;
	letter-spacing: 0;
	color: var(--sbc-muted);
}

.sbc-tile__sub {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin-top: 6px;
	font-size: 13px;
	color: var(--sbc-muted);
}

.sbc-badge {
	display: inline-flex;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 13px;
	font-weight: 700;
	white-space: nowrap;
}

.sbc-badge--up {
	color: rgb(var(--v-theme-success));
	background: rgba(var(--v-theme-success), 0.14);
}

.sbc-badge--down {
	color: rgb(var(--v-theme-error));
	background: rgba(var(--v-theme-error), 0.14);
}

.sbc-badge--same {
	color: var(--sbc-muted);
	background: var(--sbc-surface-2);
}

.sbc-main {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 330px;
	align-items: start;
	gap: 18px;
}

.sbc-card__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 8px;
}

.sbc-card__head h2 {
	margin: 0;
	font-size: 17px;
	font-weight: 700;
}

.sbc-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 22px;
	margin: 4px 0 10px;
	font-size: 13px;
	color: var(--sbc-muted);
}

.sbc-legend b {
	font-weight: 600;
	color: rgb(var(--v-theme-on-surface));
}

.sbc-legend__bar,
.sbc-legend__marker {
	display: inline-block;
	margin-right: 6px;
	vertical-align: middle;
}

.sbc-legend__bar {
	width: 14px;
	height: 10px;
	border-radius: 3px;
	background: rgb(var(--v-theme-primary));
}

.sbc-legend__marker {
	width: 3px;
	height: 14px;
	margin-right: 8px;
	border-radius: 2px;
	background: rgb(var(--v-theme-on-surface));
}

.sbc-progress {
	position: absolute;
	top: 0;
	right: 0;
	left: 0;
	height: 3px;
	overflow: hidden;
	opacity: 0;
	transition: opacity 0.2s;
}

.sbc-progress::after {
	content: "";
	position: absolute;
	top: 0;
	bottom: 0;
	left: -35%;
	width: 35%;
	border-radius: 3px;
	background: rgb(var(--v-theme-primary));
	animation: sbc-slide 1s ease-in-out infinite;
}

.sbc-chart--loading .sbc-progress {
	opacity: 1;
}

.sbc-chart--loading .sbc-report {
	opacity: 0.55;
	transition: opacity 0.2s;
}

@keyframes sbc-slide {
	from {
		left: -35%;
	}
	to {
		left: 100%;
	}
}

.sbc-sk {
	height: 14px;
	margin-top: 10px;
	border-radius: 7px;
	background: linear-gradient(90deg, var(--sbc-surface-2) 0%, var(--sbc-surface-3) 50%, var(--sbc-surface-2) 100%);
	background-size: 200% 100%;
	animation: sbc-shimmer 1.2s linear infinite;
}

.sbc-sk--tall {
	height: 28px;
}

.sbc-sk--dot {
	width: 36px;
	height: 36px;
	margin: 0;
	border-radius: 50%;
}

.sbc-sk--bar {
	height: 30px;
	margin: 0;
	border-radius: 9px;
}

@keyframes sbc-shimmer {
	from {
		background-position: 200% 0;
	}
	to {
		background-position: -200% 0;
	}
}

.sbc-skeleton {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 8px 0;
}

.sbc-skeleton__row {
	display: grid;
	grid-template-columns: 36px 10rem 1fr;
	align-items: center;
	gap: 14px;
}

.sbc-skeleton__row .sbc-sk:not(.sbc-sk--dot):not(.sbc-sk--bar) {
	margin: 0;
}

.sbc-empty {
	padding: 46px 12px;
	text-align: center;
}

.sbc-empty__icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 56px;
	height: 56px;
	margin-bottom: 12px;
	border-radius: 16px;
	background: var(--sbc-primary-soft);
	color: rgb(var(--v-theme-primary));
}

.sbc-empty h3 {
	margin: 0 0 4px;
	font-size: 18px;
}

.sbc-empty p {
	margin: 0;
	color: var(--sbc-muted);
}

.sbc-note {
	margin: 0;
	font-size: 13px;
	color: var(--sbc-muted);
}

.sbc-note--icon {
	display: flex;
	align-items: flex-start;
	gap: 6px;
}

.sbc-reconcile {
	display: flex;
	flex-direction: column;
	gap: 5px;
	margin-top: 16px;
	padding-top: 14px;
	border-top: 1px solid var(--sbc-line);
}

.sbc-reconcile__line {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

/* Table */
.sbc-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 15px;
}

.sbc-table th,
.sbc-table td {
	padding: 11px 10px;
	border-bottom: 1px solid var(--sbc-line);
	text-align: end;
	white-space: nowrap;
}

.sbc-table th {
	font-size: 12.5px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--sbc-muted);
}

.sbc-table th:first-child,
.sbc-table td:first-child {
	text-align: start;
}

.sbc-table__who {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	font-weight: 600;
}

.sbc-table__avatar {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 50%;
	background: var(--sbc-primary-soft);
	color: rgb(var(--v-theme-primary));
	font-size: 11px;
	font-weight: 700;
}

.sbc-table__row--others td,
.sbc-table__row--not_recorded td {
	color: var(--sbc-muted);
}

.sbc-table__row--others .sbc-table__avatar,
.sbc-table__row--not_recorded .sbc-table__avatar {
	background: var(--sbc-surface-2);
	color: var(--sbc-muted);
}

.sbc-table__row--total td {
	border-top: 2px solid var(--sbc-line-strong);
	border-bottom: 0;
	font-weight: 800;
}

.sbc-table__strong {
	font-weight: 700;
}

.sbc-cards {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.sbc-mcard {
	padding: 12px 14px;
	border: 1px solid var(--sbc-line);
	border-radius: 14px;
}

.sbc-mcard--total {
	border-width: 2px;
	border-color: var(--sbc-line-strong);
}

.sbc-mcard__top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 16px;
	font-weight: 700;
}

.sbc-mcard__grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 4px 12px;
	margin-top: 6px;
	font-size: 13.5px;
	color: var(--sbc-muted);
}

.sbc-mcard__grid b {
	font-weight: 600;
	color: rgb(var(--v-theme-on-surface));
}

/* Bottom sheets */
.sbc-sheet-layer {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	z-index: 40;
	pointer-events: none;
}

.sbc-sheet-layer--open {
	pointer-events: auto;
}

.sbc-sheet-layer__scrim {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	background: rgba(0, 0, 0, 0.5);
	opacity: 0;
	transition: opacity 0.25s;
}

.sbc-sheet-layer--open .sbc-sheet-layer__scrim {
	opacity: 1;
}

.sbc-sheet {
	position: absolute;
	right: 0;
	bottom: 0;
	left: 0;
	max-height: 86%;
	overflow: auto;
	padding: 10px 18px 22px;
	border-radius: 22px 22px 0 0;
	background: rgb(var(--v-theme-surface));
	box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.25);
	animation: sbc-sheet-up 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sbc--tablet .sbc-sheet {
	right: auto;
	left: 50%;
	width: min(560px, 100%);
	transform: translateX(-50%);
	animation-name: sbc-sheet-up-centered;
}

@keyframes sbc-sheet-up {
	from {
		transform: translateY(100%);
	}
	to {
		transform: none;
	}
}

@keyframes sbc-sheet-up-centered {
	from {
		transform: translate(-50%, 100%);
	}
	to {
		transform: translate(-50%, 0);
	}
}

.sbc-sheet__grab {
	width: 44px;
	height: 5px;
	margin: 2px auto 12px;
	border-radius: 3px;
	background: var(--sbc-surface-3);
}

.sbc-sheet__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
	font-size: 17px;
}

.sbc-icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: 10px;
	background: var(--sbc-surface-2);
	cursor: pointer;
}

/* Tablet */
.sbc--tablet .sbc-top {
	padding: 14px 18px 12px;
}

.sbc--tablet .sbc-scroll {
	padding: 16px 18px 24px;
}

.sbc--tablet .sbc-tiles {
	grid-template-columns: 1fr 1fr;
}

.sbc--tablet .sbc-main,
.sbc--phone .sbc-main {
	grid-template-columns: minmax(0, 1fr);
}

/* Phone */
.sbc--phone .sbc-top {
	gap: 10px;
	padding: 14px 14px 12px;
}

.sbc--phone .sbc-titles h1 {
	font-size: 19px;
}

.sbc--phone .sbc-titles__store {
	font-size: 12.5px;
}

.sbc--phone .sbc-back {
	padding: 8px;
}

.sbc--phone .sbc-scroll {
	padding: 12px 12px 22px;
}

.sbc--phone .sbc-tiles {
	grid-template-columns: 1fr 1fr;
	gap: 10px;
	margin-bottom: 12px;
}

.sbc--phone .sbc-tile {
	padding: 11px 12px;
	border-radius: 14px;
}

.sbc--phone .sbc-tile__label {
	font-size: 11px;
}

.sbc--phone .sbc-tile__value {
	font-size: 19px;
}

.sbc--phone .sbc-tile__value small {
	font-size: 12px;
}

.sbc--phone .sbc-tile__sub {
	font-size: 11.5px;
}

.sbc--phone .sbc-card {
	padding: 14px;
	border-radius: 16px;
}

.sbc--phone .sbc-card__head h2 {
	font-size: 15.5px;
}

/* Reduced motion: nothing slides, grows or shimmers. */
.sbc--still *,
.sbc--still *::before,
.sbc--still *::after {
	transition: none !important;
	animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
	.sbc *,
	.sbc *::before,
	.sbc *::after {
		transition: none !important;
		animation: none !important;
	}
}
</style>
