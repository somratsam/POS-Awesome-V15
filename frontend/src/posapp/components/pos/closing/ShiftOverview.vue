<template>
	<div class="overview-section">
		<div class="table-header mb-4">
			<h4 class="text-h6 text-high-emphasis mb-1">
				{{ __("Shift Overview") }}
			</h4>
			<p class="text-body-2 text-medium-emphasis">
				{{ __("Review shift totals before submitting the closing entry") }}
			</p>
		</div>

		<div class="overview-wrapper" v-if="loading">
			<v-progress-circular color="primary" indeterminate size="32"></v-progress-circular>
		</div>

		<div v-else class="overview-wrapper">
			<div class="insight-grid">
				<v-row dense>
					<v-col
						v-for="card in primaryInsights"
						:key="card.key"
						cols="12"
						sm="6"
						md="3"
						class="d-flex"
					>
						<div class="insight-card">
							<div class="insight-icon" :class="card.color">
								<v-icon size="22">{{ card.icon }}</v-icon>
							</div>
							<div class="insight-body">
								<div class="insight-label">{{ card.label }}</div>
								<div class="insight-value" :style="insightValueStyle(card.value)">{{ card.value }}</div>
								<div class="insight-caption" :title="card.caption">{{ card.caption }}</div>
							</div>
						</div>
					</v-col>
				</v-row>
				<v-row dense class="mt-2" v-if="secondaryInsights.length">
					<v-col
						v-for="card in secondaryInsights"
						:key="card.key"
						cols="12"
						sm="6"
						md="3"
						class="d-flex"
					>
						<div class="insight-card compact">
							<div class="insight-icon" :class="card.color">
								<v-icon size="20">{{ card.icon }}</v-icon>
							</div>
							<div class="insight-body">
								<div class="insight-label">{{ card.label }}</div>
								<div class="insight-value" :style="insightValueStyle(card.value)">{{ card.value }}</div>
								<div class="insight-caption" :title="card.caption">{{ card.caption }}</div>
							</div>
						</div>
					</v-col>
				</v-row>
			</div>

			<div class="table-section mt-6">
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Totals by Invoice Currency") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Shows the distribution of invoices per currency") }}
					</p>
				</div>

				<div v-if="multiCurrencyTotals.length" class="overview-table-wrapper">
					<table class="overview-table">
						<thead>
							<tr>
								<th>{{ __("Currency") }}</th>
								<th class="text-end">
									{{ __("Total") }}
								</th>
								<th class="text-end">
									{{ __("Invoices") }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="row in multiCurrencyTotals" :key="row.currency">
								<td>{{ row.currency }}</td>
								<td class="text-end">
									<div class="amount-with-base">
										<div class="amount-primary">
											<span class="overview-amount">
												{{
													formatCurrencyWithSymbol(
														row.total || 0,
														row.currency || overviewCompanyCurrency,
													)
												}}
											</span>
											<span
												v-if="shouldShowCompanyEquivalent(row, row.currency)"
												class="company-equivalent"
											>
												({{
													formatCurrencyWithSymbol(
														row.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}})
											</span>
										</div>
										<div
											v-if="showExchangeRates(row, row.currency)"
											class="exchange-note"
										>
											{{
												formatExchangeRates(
													row.exchange_rates,
													row.currency || overviewCompanyCurrency,
													overviewCompanyCurrency,
												)
											}}
										</div>
									</div>
								</td>
								<td class="text-end">{{ row.invoice_count || 0 }}</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div v-else class="overview-empty text-body-2">
					{{ __("No invoices recorded for this shift.") }}
				</div>
			</div>

			<v-row dense class="mt-4">
				<v-col cols="12" md="6">
					<div class="table-section">
						<div class="table-header mb-2">
							<h5 class="text-subtitle-1 text-high-emphasis mb-1">
								{{ __("Outstanding Credit by Currency") }}
							</h5>
							<p class="text-body-2 text-medium-emphasis">
								{{ __("Credit sales remaining to be collected") }}
							</p>
						</div>
						<div v-if="creditInvoicesByCurrency.length" class="overview-table-wrapper">
							<table class="overview-table">
								<thead>
									<tr>
										<th>{{ __("Currency") }}</th>
										<th class="text-end">
											{{ __("Outstanding") }}
										</th>
										<th class="text-end">
											{{ __("Invoices") }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="row in creditInvoicesByCurrency"
										:key="`credit-${row.currency}`"
									>
										<td>{{ row.currency }}</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.total || 0,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="shouldShowCompanyEquivalent(row, row.currency)"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.company_currency_total || 0,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
										<td class="text-end">
											{{ row.invoice_count || 0 }}
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="overview-empty text-body-2">
							{{ __("No outstanding credit invoices for this shift.") }}
						</div>
					</div>
				</v-col>
				<v-col cols="12" md="6">
					<div class="table-section">
						<div class="table-header mb-2">
							<h5 class="text-subtitle-1 text-high-emphasis mb-1">
								{{ __("Returned by currency") }}
							</h5>
							<p class="text-body-2 text-medium-emphasis">
								{{ __("Returns in this shift") }}
							</p>
						</div>
						<div v-if="returnsByCurrency.length" class="overview-table-wrapper">
							<table class="overview-table">
								<thead>
									<tr>
										<th>{{ __("Currency") }}</th>
										<th class="text-end">
											{{ __("Returns") }}
										</th>
										<th class="text-end">
											{{ __("Count") }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in returnsByCurrency" :key="`return-${row.currency}`">
										<td>{{ row.currency }}</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.total || 0,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="shouldShowCompanyEquivalent(row, row.currency)"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.company_currency_total || 0,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
										<td class="text-end">
											{{ row.invoice_count || 0 }}
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="overview-empty text-body-2">
							{{ __("No returns were processed in this shift.") }}
						</div>
					</div>
				</v-col>
			</v-row>

			<v-row dense class="mt-4">
				<v-col cols="12" md="6">
					<div class="table-section">
						<div class="table-header mb-2">
							<h5 class="text-subtitle-1 text-high-emphasis mb-1">
								{{ __("Change Returned") }}
							</h5>
							<p class="text-body-2 text-medium-emphasis">
								{{ __("Track how much cash was handed back to customers") }}
							</p>
						</div>
						<div v-if="changeReturnedRows.length" class="overview-table-wrapper">
							<table class="overview-table">
								<thead>
									<tr>
										<th>{{ __("Currency") }}</th>
										<th class="text-end">
											{{ __("Invoice Change") }}
										</th>
										<th class="text-end">
											{{ __("Overpayment Change") }}
										</th>
										<th class="text-end">
											{{ __("Total Change") }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="row in changeReturnedRows"
										:key="`change-returned-${row.currency}`"
									>
										<td>{{ row.currency }}</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.invoice_total,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="
															shouldShowCompanyEquivalent(
																{
																	currency: row.currency,
																	total: row.invoice_total,
																	company_currency_total:
																		row.invoice_company_currency_total,
																},
																row.currency,
															)
														"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.invoice_company_currency_total,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.overpayment_total,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="
															shouldShowCompanyEquivalent(
																{
																	currency: row.currency,
																	total: row.overpayment_total,
																	company_currency_total:
																		row.overpayment_company_currency_total,
																},
																row.currency,
															)
														"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.overpayment_company_currency_total,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.total,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="
															shouldShowCompanyEquivalent(
																row.company_currency_total,
																row.currency,
															)
														"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.company_currency_total,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="overview-empty text-body-2">
							{{ __("No change returned recorded for this shift.") }}
						</div>
					</div>
					<!-- End: Change Returned -->
					<div v-if="!hideExpectedAmounts" class="table-section" data-test="cash-drawer-snapshot">
						<div class="table-header mb-2">
							<h5 class="text-subtitle-1 text-high-emphasis mb-1">
								{{ __("Cash Drawer Snapshot") }}
							</h5>
							<p class="text-body-2 text-medium-emphasis">
								{{ __("Expected cash on hand grouped by currency") }}
							</p>
						</div>
						<div v-if="cashExpectedByCurrency.length" class="overview-table-wrapper">
							<table class="overview-table">
								<thead>
									<tr>
										<th>{{ __("Currency") }}</th>
										<th class="text-end">
											{{ __("Expected Cash") }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in cashExpectedByCurrency" :key="`cash-${row.currency}`">
										<td>{{ row.currency }}</td>
										<td class="text-end">
											<div class="amount-with-base">
												<div class="amount-primary">
													<span class="overview-amount">
														{{
															formatCurrencyWithSymbol(
																row.total || 0,
																row.currency || overviewCompanyCurrency,
															)
														}}
													</span>
													<span
														v-if="shouldShowCompanyEquivalent(row, row.currency)"
														class="company-equivalent"
													>
														({{
															formatCurrencyWithSymbol(
																row.company_currency_total || 0,
																overviewCompanyCurrency,
															)
														}})
													</span>
												</div>
												<div
													v-if="
														isCashMode(row.mode_of_payment) &&
														overpaymentDeductionForCurrency(row.currency)
													"
													class="exchange-note"
												>
													{{
														__("Overpayment change deducted: {0}", [
															formatCurrencyWithSymbol(
																overpaymentDeductionForCurrency(row.currency),
																row.currency || overviewCompanyCurrency,
															),
														])
													}}
												</div>
												<div
													v-if="showExchangeRates(row, row.currency)"
													class="exchange-note"
												>
													{{
														formatExchangeRates(
															row.exchange_rates,
															row.currency || overviewCompanyCurrency,
															overviewCompanyCurrency,
														)
													}}
												</div>
											</div>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="overview-empty text-body-2">
							{{ __("No cash expected for this shift.") }}
						</div>
					</div>
					<div class="table-section mt-4">
						<div class="table-header mb-2">
							<h5 class="text-subtitle-1 text-high-emphasis mb-1">
								{{ __("Submitted Cash Movements") }}
							</h5>
							<p class="text-body-2 text-medium-emphasis">
								{{ __("Expenses and deposits posted during this shift") }}
							</p>
						</div>
						<div v-if="cashMovementSummary?.count" class="overview-table-wrapper">
							<table class="overview-table">
								<thead>
									<tr>
										<th>{{ __("Movement Type") }}</th>
										<th class="text-end">{{ __("Amount") }}</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="row in cashMovementSummary.by_type || []"
										:key="`cash-movement-${row.movement_type}`"
									>
										<td>{{ row.movement_type }}</td>
										<td class="text-end">
											{{
												formatCurrencyWithSymbol(
													row.total || 0,
													overviewCompanyCurrency,
												)
											}}
										</td>
									</tr>
									<tr>
										<td>
											<strong>{{ __("Total") }}</strong>
										</td>
										<td class="text-end">
											<strong>
												{{
													formatCurrencyWithSymbol(
														cashMovementSummary.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}}
											</strong>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="overview-empty text-body-2">
							{{ __("No submitted cash movements in this shift.") }}
						</div>
					</div>
				</v-col>
			</v-row>

			<div
				v-if="hasLoyaltyRedemption(loyaltyRedemptionSummary, loyaltyRedemptionByCurrency)"
				class="table-section mt-4"
			>
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Loyalty Redemption") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Invoice value settled by loyalty points, not cash collection") }}
					</p>
				</div>

				<div class="overview-table-wrapper">
					<table class="overview-table">
						<thead>
							<tr>
								<th>{{ __("Currency") }}</th>
								<th class="text-end">
									{{ __("Used") }}
								</th>
								<th class="text-end">
									{{ __("Points") }}
								</th>
								<th class="text-end">
									{{ __("Invoices") }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="row in loyaltyRedemptionByCurrency"
								:key="`loyalty-${row.currency}`"
							>
								<td>{{ row.currency }}</td>
								<td class="text-end">
									<div class="amount-with-base">
										<div class="amount-primary">
											<span class="overview-amount">
												{{
													formatCurrencyWithSymbol(
														row.total || 0,
														row.currency || overviewCompanyCurrency,
													)
												}}
											</span>
											<span
												v-if="shouldShowCompanyEquivalent(row, row.currency)"
												class="company-equivalent"
											>
												({{
													formatCurrencyWithSymbol(
														row.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}})
											</span>
										</div>
										<div
											v-if="showExchangeRates(row, row.currency)"
											class="exchange-note"
										>
											{{
												formatExchangeRates(
													row.exchange_rates,
													row.currency || overviewCompanyCurrency,
													overviewCompanyCurrency,
												)
											}}
										</div>
									</div>
								</td>
								<td class="text-end">{{ row.points || 0 }}</td>
								<td class="text-end">{{ row.invoice_count || 0 }}</td>
							</tr>
							<tr>
								<td>
									<strong>{{ __("Total") }}</strong>
								</td>
								<td class="text-end">
									<strong>
										{{
											formatCurrencyWithSymbol(
												loyaltyRedemptionSummary.company_currency_total || 0,
												overviewCompanyCurrency,
											)
										}}
									</strong>
								</td>
								<td class="text-end">
									<strong>{{ loyaltyRedemptionSummary.points || 0 }}</strong>
								</td>
								<td class="text-end">
									<strong>{{ loyaltyRedemptionSummary.count || 0 }}</strong>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<div
				v-if="
					hasMonetaryRedemption(
						customerCreditRedeemedSummary,
						customerCreditRedeemedByCurrency,
					)
				"
				class="table-section mt-4"
			>
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Credit notes used") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Sales paid with credit notes, not money") }}
					</p>
				</div>

				<div class="overview-table-wrapper">
					<table class="overview-table">
						<thead>
							<tr>
								<th>{{ __("Currency") }}</th>
								<th class="text-end">
									{{ __("Used") }}
								</th>
								<th class="text-end">
									{{ __("Invoices") }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="row in customerCreditRedeemedByCurrency"
								:key="`customer-credit-${row.currency}`"
							>
								<td>{{ row.currency }}</td>
								<td class="text-end">
									<div class="amount-with-base">
										<div class="amount-primary">
											<span class="overview-amount">
												{{
													formatCurrencyWithSymbol(
														row.total || 0,
														row.currency || overviewCompanyCurrency,
													)
												}}
											</span>
											<span
												v-if="shouldShowCompanyEquivalent(row, row.currency)"
												class="company-equivalent"
											>
												({{
													formatCurrencyWithSymbol(
														row.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}})
											</span>
										</div>
										<div
											v-if="showExchangeRates(row, row.currency)"
											class="exchange-note"
										>
											{{
												formatExchangeRates(
													row.exchange_rates,
													row.currency || overviewCompanyCurrency,
													overviewCompanyCurrency,
												)
											}}
										</div>
									</div>
								</td>
								<td class="text-end">{{ row.invoice_count || 0 }}</td>
							</tr>
							<tr>
								<td>
									<strong>{{ __("Total") }}</strong>
								</td>
								<td class="text-end">
									<strong>
										{{
											formatCurrencyWithSymbol(
												customerCreditRedeemedSummary.company_currency_total || 0,
												overviewCompanyCurrency,
											)
										}}
									</strong>
								</td>
								<td class="text-end">
									<strong>{{ customerCreditRedeemedSummary.count || 0 }}</strong>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<div
				v-if="
					hasMonetaryRedemption(
						customerCreditIssuedSummary,
						customerCreditIssuedByCurrency,
					)
				"
				class="table-section mt-4"
			>
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Credit notes issued") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Credit notes issued in this shift") }}
					</p>
				</div>

				<div class="overview-table-wrapper">
					<table class="overview-table">
						<thead>
							<tr>
								<th>{{ __("Currency") }}</th>
								<th class="text-end">
									{{ __("Issued") }}
								</th>
								<th class="text-end">
									{{ __("Invoices") }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="row in customerCreditIssuedByCurrency"
								:key="`customer-credit-issued-${row.currency}`"
							>
								<td>{{ row.currency }}</td>
								<td class="text-end">
									<div class="amount-with-base">
										<div class="amount-primary">
											<span class="overview-amount">
												{{
													formatCurrencyWithSymbol(
														row.total || 0,
														row.currency || overviewCompanyCurrency,
													)
												}}
											</span>
											<span
												v-if="shouldShowCompanyEquivalent(row, row.currency)"
												class="company-equivalent"
											>
												({{
													formatCurrencyWithSymbol(
														row.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}})
											</span>
										</div>
										<div
											v-if="showExchangeRates(row, row.currency)"
											class="exchange-note"
										>
											{{
												formatExchangeRates(
													row.exchange_rates,
													row.currency || overviewCompanyCurrency,
													overviewCompanyCurrency,
												)
											}}
										</div>
									</div>
								</td>
								<td class="text-end">{{ row.invoice_count || 0 }}</td>
							</tr>
							<tr>
								<td>
									<strong>{{ __("Total") }}</strong>
								</td>
								<td class="text-end">
									<strong>
										{{
											formatCurrencyWithSymbol(
												customerCreditIssuedSummary.company_currency_total || 0,
												overviewCompanyCurrency,
											)
										}}
									</strong>
								</td>
								<td class="text-end">
									<strong>{{ customerCreditIssuedSummary.count || 0 }}</strong>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<div v-if="!hideExpectedAmounts" class="table-section mt-4" data-test="payments-by-mode">
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Payments by Mode of Payment") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Grouped totals for each payment method and currency") }}
					</p>
				</div>

				<div v-if="paymentsByMode.length" class="overview-table-wrapper">
					<table class="overview-table">
						<thead>
							<tr>
								<th>{{ __("Mode of Payment") }}</th>
								<th>{{ __("Currency") }}</th>
								<th class="text-end">
									{{ __("Amount") }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="row in paymentsByMode" :key="`${row.mode_of_payment}-${row.currency}`">
								<td>{{ row.mode_of_payment }}</td>
								<td>{{ row.currency }}</td>
								<td class="text-end">
									<div class="amount-with-base">
										<div class="amount-primary">
											<span class="overview-amount">
												{{
													formatCurrencyWithSymbol(
														row.total || 0,
														row.currency || overviewCompanyCurrency,
													)
												}}
											</span>
											<span
												v-if="shouldShowCompanyEquivalent(row, row.currency)"
												class="company-equivalent"
											>
												({{
													formatCurrencyWithSymbol(
														row.company_currency_total || 0,
														overviewCompanyCurrency,
													)
												}})
											</span>
										</div>
										<div
											v-if="showExchangeRates(row, row.currency)"
											class="exchange-note"
										>
											{{
												formatExchangeRates(
													row.exchange_rates,
													row.currency || overviewCompanyCurrency,
													overviewCompanyCurrency,
												)
											}}
										</div>
									</div>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div v-else class="overview-empty text-body-2">
					{{ __("No payments registered for this shift.") }}
				</div>
			</div>

			<!-- Total: the Z Report's TOTAL block, under the payments it starts
			     from. Credit notes issued (-) and used (+) and the other
			     non-money lines, each only when not zero; TOTAL = Net Sales.
			     Hidden in a blind count, as it shows the money taken. -->
			<div v-if="!hideExpectedAmounts" class="table-section mt-4" data-test="takings-bridge">
				<div class="table-header mb-2">
					<h5 class="text-subtitle-1 text-high-emphasis mb-1">
						{{ __("Total") }}
					</h5>
					<p class="text-body-2 text-medium-emphasis">
						{{ __("Payments with credit notes add up to Net Sales") }}
					</p>
				</div>
				<div class="overview-table-wrapper">
					<table class="overview-table">
						<tbody>
							<tr v-for="row in takingsRows" :key="row.key" :data-test="`takings-${row.key}`">
								<td>{{ row.label }}</td>
								<td class="text-end">
									{{ signedAmount(row) }}
								</td>
							</tr>
							<tr data-test="takings-grand-total">
								<td>
									<strong class="takings-grand-total">{{ __("TOTAL") }}</strong>
								</td>
								<td class="text-end">
									<strong class="takings-grand-total">{{
										formatCurrencyWithSymbol(totalAmount, overviewCompanyCurrency)
									}}</strong>
								</td>
							</tr>
							<tr data-test="takings-equals-net-sales">
								<td class="text-body-2 text-medium-emphasis">{{ __("= Net Sales") }}</td>
								<td></td>
							</tr>
							<tr data-test="takings-total">
								<td>{{ __("Takings (cash + card)") }}</td>
								<td class="text-end">
									{{ formatCurrencyWithSymbol(takingsTotal, overviewCompanyCurrency) }}
								</td>
							</tr>
							<tr data-test="left-as-store-credit">
								<td>{{ __("Left on credit notes") }}</td>
								<td class="text-end">
									{{ formatCurrencyWithSymbol(leftAsStoreCredit, overviewCompanyCurrency) }}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
const props = defineProps({
	loading: Boolean,
	primaryInsights: Array,
	secondaryInsights: Array,
	multiCurrencyTotals: Array,
	creditInvoicesByCurrency: Array,
	returnsByCurrency: Array,
	changeReturnedRows: Array,
	cashExpectedByCurrency: Array,
	cashMovementSummary: Object,
	loyaltyRedemptionSummary: Object,
	loyaltyRedemptionByCurrency: Array,
	customerCreditRedeemedSummary: Object,
	customerCreditRedeemedByCurrency: Array,
	customerCreditIssuedSummary: Object,
	customerCreditIssuedByCurrency: Array,
	// The Z Report's TOTAL block (useClosingSummary): the lines above TOTAL,
	// TOTAL (= Net Sales) and Takings (cash + card).
	takingsRows: { type: Array, default: () => [] },
	totalAmount: { type: Number, default: 0 },
	takingsTotal: { type: Number, default: 0 },
	leftAsStoreCredit: { type: Number, default: 0 },
	paymentsByMode: Array,
	overviewCompanyCurrency: String,
	// Blind count (POS Profile "Hide Expected Amount"): hide the cash and
	// payment totals the cashier could count against.
	hideExpectedAmounts: Boolean,
	// Functions
	formatCurrencyWithSymbol: Function,
	shouldShowCompanyEquivalent: Function,
	showExchangeRates: Function,
	formatExchangeRates: Function,
	isCashMode: Function,
	overpaymentDeductionForCurrency: Function,
});

const __ = window.__ || ((t) => t);

// A TOTAL-block line with its sign: "OMR -97.650" for credit notes issued,
// "OMR +139.300" for credit notes used (the "+" before the number, where the
// formatter puts a "-").
const signedAmount = (row) => {
	const text = props.formatCurrencyWithSymbol(row.amount, props.overviewCompanyCurrency);
	return row.sign === "+" && Number(row.amount) > 0 ? String(text).replace(/(\d)/, "+$1") : text;
};

// The card's amount stays on one line: its font follows the card's width and
// the amount's length (CSS below), never below 0.8rem (the labels are 0.75rem).
const insightValueStyle = (value) => ({ "--insight-chars": String(Math.max(String(value ?? "").trim().length, 6)) });

const hasRedemptionSummary = (summary, rows = [], extraKeys = []) => {
	if (!summary) return false;
	if (Number(summary.company_currency_total || 0) !== 0) return true;
	if (extraKeys.some((key) => Number(summary?.[key] || 0) !== 0)) return true;
	if (Number(summary.count || 0) !== 0) return true;
	return (Array.isArray(rows) ? rows : []).some(
		(row) =>
			Number(row?.total || 0) !== 0 ||
			Number(row?.company_currency_total || 0) !== 0 ||
			extraKeys.some((key) => Number(row?.[key] || 0) !== 0) ||
			Number(row?.invoice_count || 0) !== 0,
	);
};

const hasMonetaryRedemption = (summary, rows = []) => hasRedemptionSummary(summary, rows);

const hasLoyaltyRedemption = (summary, rows = []) => hasRedemptionSummary(summary, rows, ["points"]);
</script>

<style scoped>
/* TOTAL: bold and about 1.2x the other lines, as on the Z Report. */
.takings-grand-total {
	font-size: 1.2em;
}
.overview-wrapper {
	display: flex;
	flex-direction: column;
	gap: 24px;
	width: 100%;
}

.table-header {
	margin-bottom: 24px;
}

.insight-grid {
	margin-bottom: 8px;
}

.insight-card {
	background: rgb(var(--v-theme-surface));
	border-radius: 12px;
	padding: 16px;
	display: flex;
	align-items: flex-start;
	gap: 12px;
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	width: 100%;
	transition: all 0.2s ease;
}

.insight-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	border-color: rgba(var(--v-border-color), 0.5);
}

.insight-card.compact {
	padding: 12px 16px;
}

.insight-icon {
	width: 48px;
	height: 48px;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}
.insight-card.compact .insight-icon {
	width: 40px;
	height: 40px;
}

/* Accent Colors for Icons - Theme Aware */
.accent-primary {
	background-color: rgba(var(--v-theme-primary), 0.1);
	color: rgb(var(--v-theme-primary));
}
.accent-success {
	background-color: rgba(var(--v-theme-success), 0.1);
	color: rgb(var(--v-theme-success));
}
.accent-secondary {
	background-color: rgba(var(--v-theme-secondary), 0.1);
	color: rgb(var(--v-theme-secondary));
}
.accent-info {
	background-color: rgba(var(--v-theme-info), 0.1);
	color: rgb(var(--v-theme-info));
}
.accent-warning {
	background-color: rgba(var(--v-theme-warning), 0.1);
	color: rgb(var(--v-theme-warning));
}

.insight-body {
	flex: 1;
	min-width: 0;
	/* lets the amount size itself to this box (cqi below) */
	container-type: inline-size;
}

.insight-label {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	opacity: 0.7;
	font-weight: 600;
	margin-bottom: 4px;
}

/* The amount stays on one line ("OMR" never above the number); a long
   amount is set a little smaller instead of wrapping. */
.insight-value {
	/* ~0.62em per character of a bold amount ("OMR 686.150") */
	font-size: clamp(0.8rem, calc(100cqi / (var(--insight-chars, 8) * 0.62)), 1.25rem);
	font-weight: 700;
	line-height: 1.2;
	white-space: nowrap;
}

.insight-card.compact .insight-value {
	font-size: clamp(0.8rem, calc(100cqi / (var(--insight-chars, 8) * 0.62)), 1.1rem);
}

/* The hint shows in full, wrapping (tills are touch screens, so no
   hover-only text); cards in a row keep one height. */
.insight-caption {
	font-size: 0.75rem;
	opacity: 0.6;
	margin-top: 4px;
	line-height: 1.35;
	white-space: normal;
	overflow-wrap: anywhere;
}

.table-section {
	background: rgb(var(--v-theme-surface));
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
	border-radius: 12px;
	padding: 24px;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.overview-table-wrapper {
	overflow-x: auto;
	width: 100%;
}

.overview-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.875rem;
}

.overview-table th {
	text-align: left;
	opacity: 0.7;
	font-weight: 600;
	padding: 12px 16px;
	border-bottom: 2px solid rgba(var(--v-border-color), 0.1);
	white-space: nowrap;
}

.overview-table td {
	padding: 14px 16px;
	border-bottom: 1px solid rgba(var(--v-border-color), 0.05);
	vertical-align: top;
}

.overview-table tbody tr:last-child td {
	border-bottom: none;
}

.overview-table tbody tr:hover {
	background-color: rgba(var(--v-theme-on-surface), 0.02);
}

.text-end {
	text-align: right !important;
}

.amount-with-base {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
}

.amount-primary {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
}

.overview-amount {
	font-weight: 600;
}

.company-equivalent {
	font-size: 0.75rem;
	opacity: 0.6;
	margin-top: 2px;
}

.exchange-note {
	font-size: 0.7rem;
	color: rgb(var(--v-theme-primary));
	background-color: rgba(var(--v-theme-primary), 0.1);
	padding: 2px 6px;
	border-radius: 4px;
	margin-top: 4px;
	display: inline-block;
}

.overview-empty {
	padding: 24px;
	text-align: center;
	background-color: rgba(var(--v-theme-on-surface), 0.03);
	border-radius: 8px;
	opacity: 0.6;
	font-style: italic;
}
</style>
