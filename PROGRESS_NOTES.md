# POS Awesome — develop-swan Fork Progress Notes

Last updated: 2026-08-10

This file exists so a future session (mine or another Claude Code session) can pick up
context on this fork quickly without re-deriving it from scratch. If you're starting
fresh with no memory of prior sessions, read this whole file before touching anything
related to POS Closing Shift / Z Report — section 2 below is written to be
self-sufficient.

## Fork tracking

This repo tracks Defendicon's original **POS-Awesome-V15** upstream at
`github.com/somratsam/POS-Awesome-V15`, branch **develop-swan**.
(Production currently runs Defendicon's original `develop` branch directly at
`github.com/defendicon/POS-Awesome-V15` — not this fork. At last check, that branch's
HEAD was identical to this fork's base commit `cd5eba1`, i.e. no drift yet.)

Local git remote is named `upstream` and points at the fork above; `develop-swan` is
currently up to date with `upstream/develop-swan`.

## 1. Completed and pushed to upstream develop-swan

Confirmed via `git log` — present on `upstream/develop-swan`, newest first:

- `d916379` — fix: correct posa_receipt_logo field position on the POS Profile form
- `97a2656` — feat: embed receipt logo locally per POS Profile, eliminating external
  fetch on print
- `c4de168` — feat: track same-shift exchanges separately on Z Report ("Exchanges Today")
- `ab0ba1b` — feat: enforce all-or-nothing customer credit redemption
- `64d5c69` — feat: add VAT and Additional Information section to Z Report
- `863d66f` — feat: add Z Report history/reprint dialog to POS Awesome
- `f4aa91b` — refactor: extract printZReport into a shared, reusable service function
- `6d136d7` — feat: add list_closing_shifts for the Z Report history/reprint lookup
- `9f1dcd5` — docs: note Z Report reprint follow-up and standard-doc collision risk
- `2043356` — feat: print the Z Report automatically via QZ Tray on shift close
- `15fb224` — feat: show Customer Credit Issued on the pre-close shift summary
- `e393e89` — feat: track Customer Credit Issued/Redeemed on POS Closing Shift
- `d94bc15` — docs: add fork progress notes and a verify-against-live-state rule
- `189692c` — fix: stop Item Quick Edit from bypassing the POS Profile flag for admin
  roles
- `4c7fdd2` — fix: always fetch variant attrsMeta so Size/Color chips render reliably
- `fa862e6` — fix: decouple "Show Customer Balance" from "Allow Change Posting Date"
- `166eeab` — fix: suppress stale "Payment methods refreshed" toast on invoice update
- `97df3cd` — fix: avoid spurious Sales Order lookup in Sales Invoice.is_subcontracted

`97df3cd`/`166eeab`/`fa862e6` are dated 2026-08-05. Everything from `4c7fdd2` onward
(attribute chip fix through today's Z Report work) is dated 2026-08-06. All sit on top
of base commit `cd5eba1` ("Release: 15.33.0 — 2026-07-23").

See section 3 for what `4c7fdd2`/`189692c` fixed. **Section 2 below covers today's
main body of work — the seven newest commits, `e393e89` through `863d66f`.**

## 2. Today's major work: POS Closing Shift Z Report (Part A + Part B + Part C)

### Why this happened

The end-of-day "Z Report" printed from Frappe **Desk** (not POS Awesome) via a
DB-only Print Format on `POS Closing Shift` with `raw_printing: 1` (literal ESC/POS
control codes in a Jinja `raw_commands` field) — a print format that was never
tracked in git, only discovered mid-session by querying the database directly. It
printed through Frappe **core's own, separate** QZ Tray integration
(`frappe/public/js/frappe/form/print_utils.js`'s `qz_connect()`), which registers
**no certificate or signature** with QZ Tray — every connection is anonymous, which
is why it showed a permission popup and a 2-3 second connect delay every single
print. POS Awesome's own receipt printing already had a working, silent, popup-free
QZ Tray pipeline (`qzTray.ts`'s `setupSecurity()`, backed by
`posawesome.posawesome.api.qz.get_certificate`/`sign_message`, cert+key stored
server-side). The goal was to move the Z Report onto that same pipeline.

Along the way, a full line-by-line data audit (against a real submitted shift,
`POSA-CS-26-0000001`, cross-checked live via `bench console`) found that two figures
already shown on the old printed report — "Credit Issued Today" and "Credit Redeemed
Today" — weren't visible anywhere *else*: not on the doctype, not in the pre-close
preview screen. That became **Part A**. **Part B** is the actual print migration,
built on top of Part A.

### Part A — Customer Credit Issued/Redeemed fields (`e393e89`, `15fb224`)

Two new stored fields on `POS Closing Shift`: `customer_credit_issued`,
`customer_credit_redeemed` (Currency, `read_only: 1`, `default: "0"`), matching how
`grand_total`/`net_total`/`total_quantity` already work — computed once at close time
and persisted, not recomputed on demand.

**Definitions** (same as what the old raw report already showed, just now stored):
- `customer_credit_issued` = `abs(sum of return-invoice grand_total)` for the shift.
  **Known caveat, not yet resolved**: this is *not* a real customer-credit-ledger
  issuance figure — it's literally the shift's total returns amount, relabeled. Worth
  confirming with the business whether that's the intended definition before treating
  it as authoritative; see "Deferred" below for a related nuance (same-shift
  exchanges).
- `customer_credit_redeemed` = sum of `posa_redeemed_customer_credit` across
  non-return invoices in the shift.

**Data flow**:
1. New helper `get_shift_invoice_rows(closing_shift_doc)` in
   `closing_processing/data.py` — resolves the shift's invoice list from the
   `pos_transactions` child table (already populated in-memory before save by
   `make_closing_shift_from_opening`), **not** by re-querying
   `posa_pos_opening_shift` the way `get_pos_invoices()` does. This matters:
   `get_pos_invoices()`'s own filter excludes consolidated POS Invoices, which is
   fine pre-close but returns **zero rows post-close** for POS-Invoice-mode shops,
   since `on_submit()` → `consolidate_closing_shift_invoices()` sets
   `consolidated_invoice` on every invoice in the shift.
2. `pos_closing_shift.py`'s `validate()` calls a new `update_customer_credit_totals()`
   method (sibling to the existing `update_payment_reconciliation()` call — same
   established pattern) which uses that helper to compute and set the two fields on
   every save.
3. `posa_redeemed_customer_credit` is a plain Currency **Custom Field** on Sales
   Invoice/POS Invoice with **no `base_` currency sibling** (unlike core fields like
   `base_grand_total`) — confirmed by checking `custom_field.json` directly after a
   `MySQLdb.OperationalError: Unknown column 'base_posa_redeemed_customer_credit'`
   broke shift-closing the first time this shipped. Fixed by calling
   `get_base_value(row, "posa_redeemed_customer_credit", conversion_rate=...)`
   **without** an explicit `base_fieldname`, so it correctly falls through to its
   `value * conversion_rate` path instead of trying to `SELECT` a column that doesn't
   exist. This is now the only call site in the codebase that omits `base_fieldname` —
   every other `get_base_value()` call passes a real, existing base column.
4. The **separate** pre-close preview endpoint, `get_closing_shift_overview()` (used
   by the summary screen shown *before* a shift is submitted, when none of the above
   stored-field logic has run yet), gets a matching `customer_credit_issued` key added
   to its return dict — a zero-cost alias of `returns_company_currency_total`, which
   that function's own per-invoice loop already computes for other purposes. No new
   query needed there.
5. Frontend display mirrors the existing "Customer Credit Redeemed" wiring across 4
   files/6 touch points: `useClosingShift.ts` (normalizes the new payload key) →
   `useClosingSummary.ts` (`customerCreditIssuedSummary`/`ByCurrency` computeds + a
   KPI card) → `ShiftOverview.vue` (dedicated table section) → `ClosingDialog.vue`
   (passes the new props through).

**Important architectural note**: the pre-close preview (`get_closing_shift_overview`,
step 4) and the actual persisted doc (steps 1-2) are genuinely separate code paths
that don't share data — the preview is built from an *unsaved*, in-progress closing
shift, while the stored fields only exist once the doc is saved. Both needed their
own wiring; don't assume fixing one fixes the other.

### Part B — Print the Z Report via QZ Tray (`2043356`)

**Full data flow, in order:**

1. **`get_z_report_data(pos_closing_shift)`** — new whitelisted function in new file
   `closing_processing/z_report.py`. Takes the **submitted closing shift name** (not
   the opening shift — it needs post-close fields that don't exist pre-close).
   Assembles the report from whichever source is actually correct per figure
   (established via the same line-by-line audit mentioned above):
   - **Direct from the doc**: `net_total`/`grand_total`, `payment_reconciliation`
     child rows (Opening/Expected/Actual cash per mode — the *only* place these
     exist; they're typed in manually by the cashier at close time, not derivable
     from any invoice query), `customer_credit_issued`/`customer_credit_redeemed`
     (Part A fields — no query needed anymore), `pos_profile`, `posting_date`,
     `company`.
   - **Via `get_shift_invoice_rows()`** (the Part A helper, reused as-is): total
     sales/returns amounts+counts, and **sales-only quantity** — explicitly *not*
     `doc.total_quantity`, which was confirmed wrong for this purpose (nets in
     returns; verified 5.0 stored vs. 6.0 actually sold on a shift with one return).
     Discount totals are summed **row-wise via `get_base_value()`**, not a raw SQL
     `SUM()`, for multi-currency correctness — matches how every other money figure
     in this codebase is handled.
   - **Via new `get_payment_mode_counts()`** (also in `data.py`): per-payment-mode
     transaction *counts* (not just totals). Genuinely nowhere else to get this — the
     `pos_payments` child table on the doc looks like it should have it but is
     **empty in normal use** (it tracks a separate `Payment Entry` flow this app
     doesn't use for ordinary sales).
   - **Store name** resolves through a fallback chain (custom brand name if
     `posa_enable_custom_branding` is set → linked Warehouse's `warehouse_name` →
     POS Profile name as last resort) — the POS Profile's own name (e.g. "Test Pos")
     is usually an internal identifier, not a real customer-facing store name.
   - All currency amounts rounded to 3 decimal places before returning, to avoid
     floating-point artifacts (`77.69999999999999`) reaching the printed page.

2. **New standard Print Format**: `posawesome/posawesome/print_format/z_report/z_report.json`
   — `name: "Z Report"`, `doc_type: POS Closing Shift`, `print_format_type: Jinja`,
   `raw_printing: 0` (**rendered HTML this time, not raw ESC/POS** — prints via the
   pixel/HTML QZ path, same mechanism as receipts). The template calls
   `get_z_report_data()` from *within* the Jinja template itself, the same way the
   old raw report ran inline SQL:
   ```jinja
   {% set report = frappe.call("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.z_report.get_z_report_data", pos_closing_shift=doc.name) %}
   ```
   **Gotcha discovered**: `frappe.get_attr(...)` (the obvious first choice) is **not**
   exposed in the Jinja print-format sandbox (`module has no attribute 'get_attr'`).
   `frappe.call(...)` is the correct sandboxed primitive (maps to
   `call_whitelisted_function` in `frappe/utils/safe_exec.py`). It also requires a
   **genuine HTTP request context** internally (`is_valid_http_method` needs
   `frappe.local.request`), so testing it via a bare `bench console` call fails with
   an unrelated-looking `AttributeError: 'request'` — this is *not* a real bug, just
   a testing-environment gap. Verified correctly by hitting
   `frappe.www.printview.get_html_and_style` (the same endpoint the browser actually
   calls) over real HTTP with a temporary Administrator API key, which was revoked
   immediately after.

3. **Print trigger**: `usePosShift.ts`'s `submit_closing_pos()` success handler calls
   a new `printZReport(closingShiftName)` helper, which calls **`printDocumentViaQz()`
   directly** — deliberately **not** `printDocumentViaConfiguredQz()` from
   `documentPrint.ts`. That function checks `shouldUseRawDocumentPrinting(profile)`
   (`posa_raw_printing`, a real, commonly-used POS Profile setting for *receipt*
   printing) and would route a Z Report print through `printRawDocumentViaQz()` — a
   Sales-Invoice-shaped raw ESC/POS builder that would silently build garbage against
   a `POS Closing Shift` doc on exactly the profiles most likely to be tested. Print
   is fire-and-forget (not awaited) — a print failure logs a warning and shows a
   non-blocking toast rather than disrupting the already-successful shift close.
   `r.message` from `submit_closing_shift` (the backend call) is the closing shift's
   `name` string — that's what gets passed through as the print target.

**One-time incident, resolved, standing note added**: the first `bench migrate` after
creating the new `z_report.json` **force-deleted** a pre-existing, hand-authored
Print Format that happened to share the exact name "Z Report" (the original raw
ESC/POS format, never in git). Frappe's standard-doc sync
(`frappe/modules/import_file.py`'s `delete_old_doc()`) does a genuine delete-then-
recreate by name, not a merge — no backup, bypasses version history even with
`track_changes` on. The user had a separate backup of the original content, so no
data was permanently lost, but the mechanism is a real trap. See the standing note
now in `CLAUDE.md`/`AGENTS.md`: **always check for a name collision via a direct DB
query before creating any standard doc**, not just by browsing Desk.

### Part C — Z Report history + reprint (`6d136d7`, `f4aa91b`, `863d66f`)

Fills the gap Part B's own notes flagged as deferred: the automatic print only
covers the shift that was *just* closed. Built in three pieces, each reviewed
and tested before the next:

1. **`list_closing_shifts(pos_profile, search, from_date, to_date, limit)`**
   (new, in `closing_processing/data.py`) — reuses `get_authorized_pos_profile()`
   from `pos_access.py` exactly as `item_quick_edit.py` already does. `pos_profile`
   is only a hint; the query always filters on `profile_doc.name` (the
   server-validated result), never the raw client input — confirmed live: a bogus
   profile name throws cleanly, never returns data. `limit_page_length` clamped to
   `max(1, min(cint(limit) or 50, 200))`, added after a pre-apply security review
   caught that this whitelisted method has no ceiling otherwise — callable
   directly by any authenticated session regardless of what the frontend sends.
   That same review traced the `search` parameter's `or_filters` LIKE query
   through `frappe/model/db_query.py`'s `prepare_filter_condition()` into the
   MariaDB driver's `escape()` (real `escape_string()` + quoting, not string
   interpolation) to confirm it's injection-safe. This review prompted a new
   standing rule in `CLAUDE.md`/`AGENTS.md`: every change now requires both a
   regression check (relevant tests run, not just "does it work") and, for
   anything touching user input/authorization/data access, a genuine traced
   security review — not an assertion that something is "probably fine."
2. **`printZReport` extraction** — moved out of `usePosShift.ts`'s private closure
   into an exported function in `documentPrint.ts` (pure relocation, identical
   behavior — confirmed via `usePosShift.spec.ts`'s existing test that exercises
   `submit_closing_pos()`'s success path). Needed since the history dialog has to
   call the same print path against an arbitrary *past* shift name, and the
   function had no actual dependency on `usePosShift()`'s own state.
3. **`ZReportHistoryDialog.vue`** (new, in `components/pos/closing/`) + a
   NavbarMenu entry — date range + search, one-click per-row Print icon. Deliberately
   **no POS Profile picker anywhere in the UI**: the dialog reads
   `uiStore.posProfile.name` once per fetch and sends it only as a hint; the
   `get_authorized_pos_profile()` call above is the actual scope boundary, not
   anything client-side. Deliberately **no supervisor gate** either — sits in
   `NavbarMenu.vue`'s unconditional `quickActions` grid (same array as "Print Last
   Invoice"/"Close Shift"), not `supervisorSections`; reprinting an
   already-printed report isn't a sensitive action, and the real access control is
   the same server-side profile check, not a client-side role check.

Two existing specs (`navbarMenu.spec.ts`, `navbarMenuActions.spec.ts`) hardcoded
the exact `quickActions` id array and correctly caught the new entry — fixed by
updating both to expect it, not by weakening the assertions.

**Verified in the browser** (not just isolated tests): entry point, dialog,
search, and print all confirmed working — and, just as importantly, receipts and
the automatic Z Report print-on-close were both re-confirmed still working
afterward, since this work touched `usePosShift.ts` and `NavbarMenu.vue`,
both actively-used, shared components.

### What's verified (all today, on `staging.local`)

- Part A: real submitted shifts with returns and credit redemptions
  (`POSA-CS-26-0000003`, `POSA-CS-26-0000004`) checked via `bench console` — stored
  field values match hand-computed sums from the underlying invoices.
- `get_closing_shift_overview()`'s new `customer_credit_issued` key confirmed live,
  matches the stored field exactly on the same shifts.
- `get_z_report_data()` output cross-checked field-by-field against those same two
  shifts, including the rounding fix (confirmed `77.69999999999999` → `77.7`).
- Z Report Print Format rendered end-to-end over a **real HTTP request** (not just
  console) against `frappe.www.printview.get_html_and_style`, twice — once right
  after creation, once again as a final health check after the naming-collision
  incident — both times returning `200` with every section's numbers matching
  `get_z_report_data()` exactly.
- Backend doctype test suite run in isolation (the full `bench run-tests` suite has a
  pre-existing, unrelated `ModuleNotFoundError`/`AttributeError` environment crash,
  confirmed identical whether today's changes are present or stashed out —
  see `test_overview_loyalty.py`, which hits it regardless): `test_pos_closing_shift.py`
  9/9 passing, `test_cash_movement_integration.py` 2/2 passing.
- Full frontend `vitest run`: 217/217 test files, 1051/1051 tests passing (both
  before Part C and again after, once two pre-existing specs that hardcoded the
  `quickActions` id list were updated for the new entry).
- `bench build --app posawesome`: clean, exit 0, zero errors.
- `bench --site staging.local migrate`: clean, exit 0, zero errors.
- Checked for file/logic overlap with every prior commit this session — none found.
- **Live end-to-end test: confirmed working**, for both Part B and Part C. The user
  closed a real shift in the browser and the Z Report printed automatically via QZ
  Tray with no permission popup (Part B). Separately, the Z Report History dialog's
  entry point, search, and per-row print were all confirmed working in the browser
  too, and — since this touched `usePosShift.ts`/`NavbarMenu.vue`, both shared,
  actively-used components — receipts and the automatic print-on-close were
  re-confirmed still working afterward (Part C).
- **Gap worth knowing about**: no dedicated unit tests were written for
  `list_closing_shifts` or `ZReportHistoryDialog.vue` specifically — verification
  was live/manual (bench console + browser) plus confirming the existing suite
  still passes, not new automated coverage. Fine for now, but if this feature
  needs to change later, there's no regression net specific to it yet.

### Deferred from today's work

- **Z Report lookup + reprint — DONE, see Part C above.** Was deferred when Part B
  shipped; built later the same day. Not listed as still-open here anymore.
- **Same-shift exchange distinction not carried into the Z Report — DONE
  (2026-08-09), see Part F above.** The *old*, invoice-level "Swan Sales Invoice"
  print format has logic to distinguish two cases when
  `posa_redeemed_customer_credit > 0` on an invoice: if a matching return invoice
  for the same customer exists **within the same POS opening shift**, it's
  treated as an **"Exchange"**; otherwise it's genuine **"Credit Applied"** from
  an older, separate visit. `customer_credit_issued`/`customer_credit_redeemed`
  themselves still make no such distinction (unchanged, by design — see Part F's
  display-only scope), but a new `same_shift_exchange_total` field/"Exchanges
  Today" line now surfaces the same-shift portion as its own breakdown figure
  alongside them, on the doctype, the pre-close overview, and the printed report.
- **"Credit Issued Today" is definitionally just "Total Returns," not a real credit
  ledger figure.** Already noted under Part A above — flagging again here since it's
  the kind of thing that's easy to forget is a placeholder/approximation rather than
  a deliberate design choice.
- **VAT section — DONE, see Part D below.** Was intentionally left out of the new
  HTML Z Report per explicit user instruction ("leave out VAT for now — will add
  later once VAT is configured on staging and we can verify real numbers"). VAT
  was configured on staging and the section was built and verified 2026-08-09.

### Part D — VAT + Additional Information section (2026-08-09, `64d5c69`)

**Why this happened**: deferred from Part B specifically because VAT wasn't
configured on staging yet (see the now-resolved deferred bullet above). Once it
was, this filled in the Z Report's "Additional Information" section from the old
raw report's reference wording (Number of Receipts, Number of Returns, Number of
Items, Items/Receipt, Discounts Granted, Tax Incl. Sales Figure, VAT Amount, Net
Excl. VAT, Sales Figure/Receipt, Sales Figure/Item, plus a Total Sales Receipts /
Total Register line), backed by real numbers instead of the old hardcoded-rate
approach.

**Real tax setup found on staging** (confirmed via `bench console` before writing
any code, per the standing verify-against-live-state rule): one `Sales Taxes and
Charges Template`, "VAT 5% Inclusive - S", company Swan, `is_default: 1`, single
tax row — `charge_type: On Net Total`, `rate: 5.0`, `account_head: VAT - S`,
`included_in_print_rate: 1` (item prices are tax-inclusive; `grand_total` is the
tax-inclusive figure, `net_total` is back-derived). No `Tax Category`, `Item Tax
Template`, or `Tax Rule` records exist — a genuinely flat, single-rate setup.

**Important gotcha found along the way, since fixed by the user**: the template's
`is_default: 1` flag does *not* make it apply automatically to POS Awesome
invoices. Traced the real code path (`sales_invoice.py`/`pos_invoice.py`'s
POS-specific `set_missing_values()`, `AccountsController.set_taxes()` /
`set_taxes_and_charges()` in `accounts_controller.py`): a POS-Awesome-created
invoice only gets tax applied if the **POS Profile's own `taxes_and_charges`
field** is set (it gets copied onto the invoice, which then triggers
`set_taxes()`). The company-default fallback (`set_other_charges()`) is only
reachable via Customer/Lead-quotation mapped-doc transforms, not POS Awesome's
invoice creation path. Confirmed live: the template existed for ~25 minutes
before any invoice used it, because the POS Profile ("Test Pos") had
`taxes_and_charges: None` — fixed by linking it on the POS Profile, after which
the very next invoice (`ACC-SINV-2026-00024`) correctly showed
`total_taxes_and_charges: 9.686` against `net_total: 193.714`,
`grand_total: 203.4` (math confirmed both directions: `net_total × 5% = 9.686`
and `net_total + tax = grand_total` exactly).

**Implementation** (`closing_processing/data.py`, `closing_processing/z_report.py`,
`print_format/z_report/z_report.json`):
- `get_shift_invoice_rows()` now also selects `total_taxes_and_charges` /
  `base_total_taxes_and_charges` per invoice (both real columns — unlike
  `posa_redeemed_customer_credit`, no missing-base-column special case needed).
- `get_z_report_data()` sums VAT row-wise via `get_base_value()` across the
  shift's non-return invoices — the same multi-currency-safe pattern already used
  for `total_discount` — **not** a hardcoded `total_sales × rate / (100 + rate)`
  formula like the old raw report used. With today's flat single-rate setup the
  two approaches happen to produce identical numbers, but reading the real
  per-invoice tax amount stays correct if the rate changes or item/customer-level
  exceptions get added later, without needing a code change.
- New derived fields: `total_vat`, `net_excl_vat` (`total_sales - total_vat`),
  `items_per_receipt`, `sales_per_receipt`, `sales_per_item` (all guarded against
  divide-by-zero for a no-sales shift), `total_register_count`
  (`sale_count + return_count`). `net_sales` (already returned) is reused as-is
  for the "Total Register" line's net amount — no duplicate field needed.
- `Tax Incl. Sales Figure` reuses the existing `total_sales` field directly — it
  was already tax-inclusive by construction (sum of `base_grand_total`), confirmed
  against the real taxed invoice above (`get_base_value()` on that invoice's row
  returned `203.4`, exactly `grand_total`).
- Print format: new "Additional Information" section added between "Cash Balance"
  and the footer, same `.section-label`/`.row` markup as the rest of the report.
  One deliberate wording choice: the count-of-returns line is labeled **"Number of
  Returns"**, not "Number of Credit Notes" — staff's everyday vocabulary only
  calls a *cross-shift* return a "credit note"; a same-shift return-and-rebuy is
  just an "exchange" to them, even though ERPNext creates a credit note document
  either way. This is a plain count of every return in the shift regardless of
  same-shift vs. cross-shift — it does **not** attempt the
  same-shift-exchange-vs-cross-shift distinction, which is still deferred (see
  below). Proper accounting terminology is untouched everywhere else in the
  system; this is purely a wording choice for this one staff-facing printed line.

**Verified**: real invoice math traced above; `get_z_report_data()` sanity-checked
live via `bench console` against an already-closed, pre-VAT shift
(`POSA-CS-26-0000006`) before any tax data existed, to confirm the new fields
compute cleanly with no exceptions and no divide-by-zero on a single-receipt shift
(`total_vat: 0.0`, `net_excl_vat` = `total_sales`, ratios all correct). Later
confirmed end-to-end against a real closed shift containing the taxed invoice,
with the printed report's new section checked against hand-computed numbers.
Backend: `test_pos_closing_shift.py` 9/9, `test_cash_movement_integration.py` 2/2,
both passing. Frontend: full `vitest run`, 217/217 files, 1051/1051 tests passing
(no frontend files touched by this change; run anyway per standing convention).
`bench build --app posawesome --force`: clean, exit 0. `bench --site staging.local
migrate`: clean, exit 0 — confirmed via direct DB query that the "Z Report" Print
Format record's `html` column actually contains the new section text post-migrate,
not just that migrate didn't error.

**Still deferred, unchanged by this work**: the same-shift-exchange vs.
cross-shift-credit distinction for the *monetary* Credit Issued/Redeemed figures
(see the bullet below) — this session only affects the plain return *count* label,
not that figure's underlying computation.

### Part E — Enforce all-or-nothing customer credit redemption (`ab0ba1b`)

**Why**: confirmed company policy — customers must purchase items worth at least
their available credit, and when eligible must redeem the *full* amount, never a
partial one. Investigated the existing redemption flow first (`api/payments.py`'s
`get_available_credit()`, `useRedemptionLogic.ts`) and confirmed partial redemption
was fully possible before this change — no minimum, only upper-bound validation.

**Frontend** (`useRedemptionLogic.ts`): `normalizeCustomerCreditAllocations()` is
now the single place that re-derives eligibility every time it runs (triggered by
credit-dict changes, loyalty changes, *and* a new watcher on the invoice total —
needed because a cashier can leave Payments to add items, then come back, and
nothing else re-triggers a fetch). Ineligible → toggle stays **on**, redemption
held at 0, a banner explains why (auto-applies once the cart grows enough — no
re-toggle needed, per explicit user confirmation on this UX point). Eligible →
every row forced to its full amount; manual edits snap back.

**Backend** (`creation.py`): new `_validate_customer_credit_redemption()`,
called from `submit_invoice()`, re-fetches real available credit server-side via
the same `get_available_credit()` the frontend calls — previously
`redeemed_customer_credit` was trusted verbatim from the client payload with no
re-verification, a real gap now closed.

**M-Pesa carve-out**: investigation found `usePaymentMethods.ts`'s
`set_mpesa_payment()` reuses the *exact same* `customer_credit_dict`/
`redeemed_customer_credit` state shape and row shape as genuine balance
redemption, for a deliberately partial, unrelated settlement amount (a specific
mobile-money payment, not "redeem all my credit"). Scoped via a new
`customer_credit_redemption_requested` flag, set only by the genuine toggle
flow and never by M-Pesa — confirmed both flags get reset even if a genuine
redemption was already in progress when M-Pesa takes over
(`usePaymentMethods.spec.ts`). M-Pesa is not configured on staging currently
(`Mpesa C2B Register URL` has zero rows for Swan), so this was a latent risk
caught before it could bite, not an active bug.

Confirmed via code tracing, not assumption: "Allow Partial Payment"
(`posa_allow_partial_payment`) only gates whether *total* payments across all
methods can be less than the invoice total — a different comparison entirely
from "was the full available credit redeemed." Multi-method remainder-splitting
(`rebalancePreferredPaymentLine()`) only reads whatever `redeemedCustomerCredit`
currently equals — unaffected by whether that number came from a manual edit or
the new forced-full logic. Verified live end-to-end on staging: a real invoice
with full credit (139.3) redeemed and the remainder split Visa (8.1) + Cash (3).

**Deferred from this work**: a "Deadlock Occurred" error surfaced during this
same live test — investigated in depth (see the deferred bullet below); confirmed
pre-existing and NOT caused by this validation, though its extra DB call may
slightly widen the pre-existing race's timing window.

### Part F — "Exchanges Today" same-shift exchange tracking (`c4de168`)

**Why**: the Sales Invoice receipt (Print Format "Swan Sales Invoice", hand-authored,
not in git — same situation as the old raw Z Report before it was migrated) already
distinguishes a genuine same-visit exchange from real cross-shift credit redemption
at the *single-invoice* level: an existence check (does this customer have any
return in the same POS Opening Shift?), driving "Exchange Value" vs "Credit
Applied" on the printed receipt. That distinction was never rolled up to the
shift/Z Report level. Deliberately scoped as **display-only** — no changes to
`update_customer_credit_totals()` or any stored accounting figure.

New `get_same_shift_exchange_total()` (`closing_processing/data.py`) mirrors the
receipt's own existence-check simplification (not per-source amount attribution)
— now reliable end-to-end since Part E's all-or-nothing enforcement removes the
"was this a partial exchange" ambiguity for the genuine-redemption case. Shown in
the same three places Part A's Customer Credit Issued/Redeemed already are: a new
`same_shift_exchange_total` stored field on POS Closing Shift (computed by
`update_same_shift_exchange_total()`, called as a **sibling** to — not inside —
the existing `update_customer_credit_totals()`, which is untouched), the pre-close
overview screen (zero-cost alias over the already-fetched invoice list in
`get_closing_shift_overview()`, no new query), and the printed Z Report's
Customer Credit section as "Exchanges Today" (label chosen from a few
staff-friendly options, matching the report's existing plain tone).

**Known inherited limitation, not new**: because M-Pesa (Part E above) sets
`posa_redeemed_customer_credit` through the same field, a customer who pays via
M-Pesa *and* has a same-shift return would have that M-Pesa amount miscounted
as a same-shift exchange. This is not a new risk from this feature — the
existing single-invoice receipt logic has the identical characteristic already,
since both use the same `posa_redeemed_customer_credit > 0` condition. Low risk
today since M-Pesa isn't configured for this business; worth remembering if it
ever is.

Verified live against a real multi-customer shift on staging
(`POSA-OS-26-0000008`): two separate customers, each returning then redeeming
within the same shift (139.3 + 172.5), summed correctly to 311.8 across the
stored field, the pre-close overview, and the printed report. New unit tests,
`test_same_shift_exchange.py`, 5/5 passing (the real scenario above plus edge
cases: no returns, wrong customer, no redemption despite a return).

**Verified for both Part E and Part F together** (final combined check before
commit): backend — `test_pos_closing_shift.py` 9/9, `test_cash_movement_integration.py`
2/2, `test_same_shift_exchange.py` 5/5, `test_offline_sync_invoices.py` 4/4,
`test_customer_credit_invoice_fields.py` 2/2, `test_submitted_invoice_shift_security.py`
1/1 — all in isolation, all passing. Frontend: `vue-tsc --noEmit` clean, full
`vitest run` 217/217 files / 1054/1054 tests. `bench build --app posawesome --force`
and `bench --site staging.local migrate`: both clean, exit 0. Security review
covering both features together: no new whitelisted endpoints, no new
client-controllable input, no new SQL — both features' new code paths operate
on data already fetched via existing, already-scoped queries.

## 3. What `4c7fdd2` and `189692c` fixed

**`4c7fdd2` — attribute chip fix** — `frontend/src/posapp/composables/pos/items/addition/useItemCreation.ts`

Root cause: `handleVariantItem()` only fetched `get_item_variants` (and thus
`attrsMeta`) when no variants were already cached client-side. When variants *were*
already cached (e.g. `posa_show_template_items=1` + `posa_hide_variants_items=0`),
`attrsMeta` stayed `{}`, which caused `Variants.vue`'s watcher to wipe
`parentItem.attributes` to `[]` — the Size/Color filter chip row silently disappeared
while the variant cards still rendered fine.

Fix: extracted a `fetchItemVariantsMeta()` helper and now always calls it for
`attrsMeta`, regardless of whether variants were already cached — cards still use the
cached list as before, only the attrsMeta fetch always runs. Wrapped in try/catch so
an offline/failed call just leaves `attrsMeta = {}` (dialog opens with cards, no
chips) instead of throwing. Verified: full frontend `vitest run` (1051 tests) passing,
`bench build --app posawesome` clean.

**`189692c` — item quick-edit permission fix** — `posawesome/posawesome/api/item_quick_edit.py`,
`frontend/src/posapp/utils/itemQuickEditPermission.ts`, `frontend/tests/itemQuickEditPermission.spec.ts`

Root cause: both `_can_save()` (backend) and `canShowItemQuickEdit()` (frontend) gave
System Manager/Stock Manager/Item Manager an unconditional bypass of
`posa_allow_item_quick_edit`, checked *before* the profile flag — so "Update Item"
stayed visible and saveable for those roles regardless of the flag. Confirmed live
with the flag off on the `Test Pos` profile.

Fix: removed the bypass from both functions — the flag is now authoritative for every
role, and a user additionally needs the "POS Awesome Supervisor" role to save (the
same thing every other supervisor-gated POS Awesome feature already checks via
`_is_pos_supervisor()`). Also collapsed a redundant `boot.user.roles`/`user_roles`
merge in the frontend check to the single canonical source (`frappe.user_roles` is
literally set equal to `frappe.boot.user.roles` at desk boot).

Important correction made mid-investigation: an initial diagnosis claimed the
frontend (role-based) and backend (User-doc-field-based) supervisor checks were
mismatched and needed reconciling via a new `boot_session` hook. That was wrong —
`_is_pos_supervisor()` already checks the role first, and `bench console` against
`staging.local` confirmed the legacy `posa_is_pos_supervisor` Custom Field has
already been deleted by `posawesome/patches/migrate_pos_supervisor_to_role.py`,
which already ran on this site. No boot hook was added; the fix stayed minimal. See
the standing note in `CLAUDE.md`/`AGENTS.md` about verifying against live site state
before trusting code-only permission/role reasoning.

Both commits verified before push: full frontend `vitest run` (1051 tests) passing,
`test_item_quick_edit.py` run in isolation (8/8 passing — the full backend suite has
a pre-existing, unrelated `ModuleNotFoundError` environment issue, confirmed
identical whether these commits are present or not), `bench build --app posawesome`
clean (exit 0, zero errors), `bench --site staging.local migrate` clean (exit 0, zero
errors). Checked for file/logic overlap with the three 2026-08-05 commits above — none
found.

## 4. Deferred / low priority, pre-dating today

- **"Available Qty" sort only sorts the loaded page, not the full catalog.**
  `ItemsSelectorTable.vue`'s `v-data-table-virtual` sorts `displayedItems`, which is
  capped by `filterAndPaginate()` to `itemsPerPage` (default 50) — not the full
  ~6000-item catalog. Root cause confirmed, not yet fixed. Low impact: staff
  primarily use the barcode scanner and search instead of manual sort, so this is
  deferred.
- **250ms cold-start cache race in `itemsStore.ts`.** `runInitialization()` races
  the IndexedDB cache read against a 250ms timeout (`COLD_START_CACHE_GRACE_MS`);
  the loser keeps running detached and can desync `itemsLoaded` from actual grid
  contents. Can occasionally cause an empty/stale item grid on POS mount, most
  likely on cold/slow IndexedDB (first load, cleared cache, new browser profile).
  Not yet fixed.
- **Redis empty-result caching bug in `get_items`.** The `@redis_cache` wrapper
  around `get_items` (gated by `posa_use_server_cache`) has no negative-result
  protection — a transient empty response can get cached and replayed for the full
  TTL (`posa_server_cache_duration`, default 30 min). Currently **mitigated** by
  leaving "Use Server Cache" OFF in POS Profile settings (see baseline below).
  Proper code fix (e.g. skip-caching empty results, or a dedicated cache-bust hook
  on POS Profile save) still pending.
- **Known issue (2026-08-09): rare "Deadlock Occurred" / HTTP 508 error can appear
  during invoice submission** (confirmed root cause: a pre-existing race condition
  in the Submission Ledger's optimistic-locking, most likely triggered by
  offline-sync retry logic combined with hourly scheduler job bursts — NOT caused
  by the credit redemption validation added today, though that validation's extra
  DB call may slightly widen the timing window). Observed specifically on a
  full-credit + Visa + Cash 3-way split; a simpler full-credit + Visa case worked
  without issue. IMPORTANT: in the observed case, the sale actually SUBMITTED
  SUCCESSFULLY despite the error being shown — real risk is cashier
  confusion/possible accidental duplicate retry, not actual transaction failure.
  Needs investigation: (1) whether the existing duplicate-submission guard would
  actually catch a retry in this scenario, (2) whether the submission-ledger's
  locking can be hardened. Deferred for a future session.

(Z Report lookup/reprint, the same-shift exchange distinction, and the VAT
section are all done now — see section 2 above. Still genuinely open: "Credit
Issued Today" is definitionally just "Total Returns," not a real credit-ledger
figure — a business definition question, not a bug.)

## 5. Recommended POS Profile baseline settings

Landed on for a variant-heavy, multi-brand catalog (current real-world case: Swan
International, ~6000 items across 9 fashion brands, one warehouse live, more coming):

| Setting | Value |
|---|---|
| Show Template Items | **ON** |
| Hide Variants Items | **ON** |
| Hide Unavailable Items (`posa_display_items_in_stock`) | **OFF** |
| Use Server Cache (`posa_use_server_cache`) | **OFF** (see Redis bug above) |
| Use Limit Search (`pose_use_limit_search` — note the fixture fieldname typo, it's not `posa_`) | **ON**, with Search Limit Number = **500** |

Rationale: templates-only browsing avoids flooding the grid with every size/color
variant as a separate card (variants surface via the variant dialog, which also
sidesteps the attrsMeta caching bug above since `posa_hide_variants_items=1` forces
the always-correct fetch path). "Hide Unavailable Items" is left off because only one
of nine brands' warehouses is live — turning it on would silently drop not-yet-stocked
items rather than showing them as "Out of Stock." "Use Server Cache" stays off until
the Redis empty-result bug above is fixed in code.

Known trap: the "Hide Variants Items" field is UI-gated (`depends_on`) on "Show
Template Items" — if "Show Template Items" gets unchecked, "Hide Variants Items"
disappears from the form but its stored value does NOT reset, and can still silently
affect the backend query. Worth checking both fields together whenever revisiting
this baseline.

## 6. Environment notes

- **WSL2 memory allocation must be at least 6GB for `bench build --app posawesome`
  to succeed.** At the default/lower allocation (4GB), the frontend build (Vite,
  large Vuetify + MDI icon bundle) gets OOM-killed partway through — exits with
  code 137 (SIGKILL), or 143 (SIGTERM) if it was also running as a backgrounded
  process that got torn down. Confirmed 2026-08-09: a build failed twice at 4GB,
  succeeded immediately once the user raised WSL2's memory cap to 6GB (via
  `.wslconfig`). If a build fails with 137/143 and the code changes look correct,
  check WSL2's memory allocation before assuming the build itself is broken.

## 7. Receipt print performance + receipt logo, multi-store (2026-08-10, `97a2656`, `d916379`)

### Why this happened

User reported Sales Invoice/receipt printing felt slow despite receipts already
using the same QZ Tray pipeline (`printDocumentViaQz`) as the Z Report. Investigated
the full click-to-printer flow rather than assuming: timed `frappe.www.printview.
get_html_and_style` directly against real invoices/closing shifts (temporary
Administrator API key, revoked immediately after each use, per the standing
verify-against-live-state convention) — server-side HTML generation was **not**
the bottleneck, both receipt and Z Report render in ~75-80ms warm, statistically
indistinguishable. The Sales Invoice print format ("Swan Sales Invoice" — hand-
authored, DB-only, never in git, same situation as the old raw Z Report before
it was migrated) had one concrete, fixed, per-print cost the Z Report doesn't:
an unconditional `<img src="https://e.swan-intl.com/files/swanGalleriaLogo_bw.png">`
with **no `Cache-Control`/`Expires` header** (confirmed via direct fetch — 859ms,
no caching to rely on). That fetch happens client-side, during QZ Tray's HTML-to-
pixel rendering, invisible to server-side timing — and is paid on every single
receipt regardless of item count, which is why even short receipts felt slow.
Also found (not the main cost, but real): a duplicated
`frappe.db.get_value("User", doc.modified_by, "full_name")` lookup in the
template, computed twice (header row + "served by" line) for the same value.

### Fix 1 — embed the receipt logo locally, per store (`97a2656`)

New **posa_receipt_logo** (Attach Image) Custom Field on POS Profile — each store's
logo now lives on its own profile instead of one hardcoded external URL, matching
this business's actual multi-brand setup (Swan International, 9 brands, one
warehouse live per the POS Profile baseline in section 5). New whitelisted
`get_receipt_logo_data_uri(pos_profile)` (`posawesome/api/print_assets.py`) reads
the profile's attached file straight off local disk (`frappe.utils.file_manager.
get_file`) and returns it as a `data:image/...;base64,...` URI — called from the
Jinja template via `frappe.call(...)`, the same sandboxed-call pattern the Z Report
already established (`frappe.get_attr` isn't available in the print-format Jinja
sandbox; `frappe.call` is). No logo uploaded for a profile → prints with no `<img>`
tag at all (explicit user decision: no generic bundled fallback). "Test Pos" was
backfilled with the existing Swan logo (downloaded once, attached as a real File)
so current output is visually unchanged.

**Verified**: real-HTTP `get_html_and_style` checks (temp API key pattern) against
both a plain invoice and a credit-redemption invoice confirmed the returned HTML
has zero occurrences of the external host and exactly one `data:image` `<img>` tag.
Direct timing of `get_receipt_logo_data_uri` itself: ~2.3-3.4ms warm (local disk
read + base64 encode) vs. the 859ms uncached external fetch it replaces — roughly
250-370x faster, and (unlike the old URL) has no external network dependency to be
slow or unavailable at all. Also fixed the duplicate `frappe.db.get_value` lookup
in the same template pass — computed once via `{% set sales_person_name = ... %}`,
reused in both places.

### Fix 2 — the new field didn't render on the POS Profile form (`d916379`)

Shipped `97a2656` with `posa_receipt_logo`'s `insert_after` set to
`"posa_qz_printer_name"` — the same anchor the pre-existing `posa_raw_printing`
field already used. User reported the field wasn't visible on the form even after
`bench migrate` + `bench clear-cache` + a hard refresh. Investigated (not assumed)
against the user's own four specific hypotheses: `permlevel` was 0 (not it);
`DocType.field_order` doesn't exist as a column in this Frappe version for POS
Profile at all, so that mechanism was never in play; the field wasn't hidden in a
collapsed section, it was just in the wrong section entirely; `frappe.clear_cache`
(both scoped and global) had no effect since the *position* isn't a caching
artifact — it's freshly, deterministically recomputed wrong from the underlying
data every time.

**Real root cause**, found by instrumenting Frappe's own field-order resolver
live (`frappe.model.meta.Meta.sort_fields` / `_update_field_order_based_on_
insert_after`) rather than guessing: it processes every field sharing an
`insert_after` target together in one pass, then keeps nudging whichever one
"loses" the pairing forward every time a later link in the *winner's own*
downstream chain resolves. `posa_raw_printing`'s chain (`posa_raw_print_width` →
`posa_print_format_rules` → the Cash Movement section) consistently won that
position tie, walking `posa_receipt_logo` step-by-step all the way past the
entire Cash Movement and Sales Returns sections to a buried, semantically
unrelated spot on the form. Confirmed empirically that `idx` cannot durably fix
this: Custom Field's own controller (`frappe/custom/doctype/custom_field/
custom_field.py`'s `validate()`) unconditionally recomputes `idx` from
`insert_after` on every fresh creation, ignoring whatever value a fixture
supplies — a live `frappe.db.set_value` patch to `idx` "worked" but silently
didn't survive a real `bench migrate`.

**Fix**: re-point `posa_raw_printing` at `posa_receipt_logo` instead of
`posa_qz_printer_name`, making the whole local chain strictly linear — no two
fields sharing a target, so there's no tie to lose. This is the exact same
technique this codebase already used twice before for this identical class of
bug (`patches/move_qz_raw_print_fields_to_printing_section.py`, `patches/
refresh_qz_raw_print_fields_layout.py` — both pre-existing, found while looking
for precedent). Fixture change (`custom_field.json`) covers fresh installs; new
`patches/insert_receipt_logo_field_in_print_chain.py` repairs already-migrated
sites like staging. **Verified via a genuine clean `bench migrate`** (deleted the
field, reset `posa_raw_printing` to the pre-fix state, migrated from scratch —
not just a live DB patch) and confirmed idempotent on a second migrate.

### Also verified this session (user-run, findings confirmed against DB/print output)

- **"Remaining Credit" line, post all-or-nothing redemption (Part E, `ab0ba1b`)**:
  investigated whether it can ever trigger anymore. Live data inconclusive — zero
  invoices have exercised credit redemption since `ab0ba1b` actually landed
  (2026-08-09 17:32:19); the closest existing redemption invoices predate it by
  ~75 minutes. Code-level trace of `_validate_customer_credit_redemption`
  confirmed redemption is genuinely all-or-nothing (blocks entirely rather than
  capping) whenever it succeeds, so `posa_remaining_customer_credit_balance` is
  mathematically forced to 0 going forward — but recommended **against** removing
  the template line: it's already conditionally hidden (`{% if ... > 0 %}`) so
  removing it changes nothing for new receipts, while it would silently break
  correctness for reprints of the 3 real historical invoices
  (`ACC-SINV-2026-00021/00018/00009`) that still have genuine nonzero remaining
  balances from before the fix. User agreed to leave it as-is.
- **Same-shift vs. cross-shift exchange logic (Part F, `c4de168`)**: user ran both
  real scenarios live. Same-shift return-then-redeem correctly showed "Exchange
  Value" on the receipt and was correctly reflected in that shift's Z Report
  "Exchanges Today". Cross-shift (return in one shift, close, reopen, redeem in
  the new shift) correctly showed "Credit Applied" (not Exchange) and correctly
  left the new shift's "Exchanges Today" at 0. Both confirmed working as designed.

### Verified (both fixes together, before commit)

Frontend `vitest run`: 217/217 files, 1054/1054 tests passing (no frontend files
touched by this session's changes; run anyway per standing convention). Backend:
`test_api_imports.py` 4/4 (confirms `print_assets.py` imports cleanly),
`test_pos_closing_shift.py` 9/9, both in isolation. `bench --site staging.local
migrate`: clean, exit 0, run twice to confirm idempotency. No frontend files
changed this session, so no `bench build` needed for these fixes specifically
(the earlier investigation-phase build failure was an unrelated WSL2 OOM/cwd
issue, resolved and noted in section 6 above).
