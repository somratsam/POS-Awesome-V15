# POS Awesome — develop-swan Fork Progress Notes

Last updated: 2026-08-11

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

- `f3e794c` — fix: re-lock terminal on every return to POS Awesome, show
  username instead of email, add Back to Desk escape
- `4dfe2c8` — feat: enforce credit-only returns per POS Profile
  (posa_returns_credit_only)
- `9c4c387` — feat: pull receipt address and phone dynamically per POS Profile
- `fd5f349` — docs: define fixed final regression check checklist in
  CLAUDE.md/AGENTS.md
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
- ~~**250ms cold-start cache race in `itemsStore.ts`.**~~ Addressed 2026-08-11 —
  widened to 700ms and the fallback fetch is now failure-safe. See section 10.
- **`get_items_from_barcode()` has no POS Profile / warehouse scoping.**
  Added 2026-08-11 while fixing the barcode scan bug (section 11): the
  function takes no `pos_profile` argument at all, so any authenticated
  session can resolve any barcode's full item detail (rate, stock flags,
  variant/group info) without it being scoped to a specific store's warehouse
  or price list the way `get_items()` is. Not currently known to be
  exploitable for cross-store stock/pricing leakage in practice (the item
  data itself isn't warehouse-specific; `rate`/`price_list_rate` come from
  whatever price list is passed in as a plain argument, same as
  `get_item_detail()`), but it's the same category of gap as the
  `_ensure_pos_profile()` finding below — worth a deliberate look together
  rather than assuming it's fine because nothing has gone wrong yet.
- **`_ensure_pos_profile()` trusts client-supplied POS Profile JSON verbatim
  (multi-store isolation gap).** Found while verifying warehouse isolation
  for `actual_qty` stock data: `actual_qty` is always read from the current
  POS Profile's own warehouse in the normal flow, confirmed by tracing the
  actual code path — but `_ensure_pos_profile()` (`posawesome/posawesome/
  api/utils.py`) accepts a POS Profile as raw JSON from the client and does
  not re-verify server-side that the requesting user is actually assigned to
  that profile before using its warehouse/company for the query. A crafted
  request naming a different store's POS Profile could plausibly read that
  store's stock data. Reported to the user as a finding; not yet fixed —
  no fix has been requested.
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

### Fix 3 — receipt address and phone, dynamic per store (`9c4c387`)

Same pattern as Fix 1: the receipt's address block (English line, Arabic line,
phone number) was hardcoded in the print format, one fixed address for every
store. Checked for a reusable built-in mechanism first, same reasoning as the
logo — POS Profile already has a standard `company_address` field (Link →
Address) and its linked Warehouse has its own built-in address fields, but
neither supports the bilingual English/Arabic pairing this receipt needs
(both are single-language records), so neither was a clean fit. New
`posa_receipt_address_en` / `posa_receipt_address_ar` (Small Text) /
`posa_receipt_phone` (Data) fields on POS Profile instead, following the same
per-store-config precedent as `posa_receipt_logo`. CR No stays hardcoded —
explicit decision, it's a company-level legal registration number, not
per-store data.

**Field-ordering lesson from Fix 2 applied proactively this time**: chained
linearly after `posa_receipt_logo` (`posa_receipt_logo` → `posa_receipt_
address_en` → `posa_receipt_address_ar` → `posa_receipt_phone` →
`posa_raw_printing`, re-pointing `posa_raw_printing`'s own `insert_after` one
more link down the chain) specifically to avoid recreating the shared-target
cascade bug. Verified via `bench migrate` run twice (both the raw
`insert_after` chain and the actual rendered field order via
`frappe.get_meta("POS Profile")` came back correct and identical both times)
— landed right the first time, no follow-up patch needed.

Template fetches the three fields via one inline `frappe.db.get_value("POS
Profile", doc.pos_profile, [...], as_dict=True)` call — no new Python file or
whitelisted endpoint needed this time (unlike the logo, there's no binary
file to base64-encode), matching the same inline-`frappe.db.get_value`
pattern this template already used for the sales-person lookup. "Test Pos"
backfilled with today's exact text; confirmed via real-HTTP `get_html_and_
style` check that the rendered address block is byte-for-byte identical to
the old hardcoded version.

**Arabic text — encoding verified, translation accuracy NOT verified.**
User asked to see the exact stored Arabic strings and get a best-effort
(non-professional) reading of each, to sanity-check meaning separately.
Two items flagged during that pass, still awaiting a native speaker's
judgment:
- `مسؤول مبيعا` (paired with "Sales Person" in the transaction-info table)
  reads like it may be missing a final ت — the standard word would be
  `مسؤول مبيعات`. Might be intentional shorthand, might be a typo.
- The exchange-policy paragraph's Arabic (`... مع ارفاق الفاتورة.`) reads as
  "... with the invoice attached," while the paired English says "With tags
  attached & Original invoice" — a possible content mismatch (invoice vs.
  tags), not an encoding issue.

Neither of these affects the address/phone feature — flagging here since
they were surfaced while reviewing the same template and are still open.

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

### Verified (all three fixes, before commit)

Frontend `vitest run`: 217/217 files, 1054/1054 tests passing (no frontend files
touched by this session's changes; run anyway per standing convention). Backend,
in isolation: `test_api_imports.py` 4/4, `test_pos_closing_shift.py` 9/9,
`test_gift_card_profile_settings.py` 3/3, `test_sale_floor_profile_settings.py`
3/3, `test_customer_credit_invoice_fields.py` 2/2 — the last three chosen for
Fix 3 specifically because they parse `custom_field.json` directly, the exact
file that change modified. `bench --site staging.local migrate`: clean, exit 0,
run twice for each fix to confirm idempotency (field ordering re-verified via
`frappe.get_meta` after each run, not just the raw `insert_after` values). No
frontend files changed this session, so no `bench build` needed for any of these
three fixes (the earlier investigation-phase build failure was an unrelated
WSL2 OOM/cwd issue, resolved and noted in section 6 above).

This full check (Fix 3's regression pass specifically) is also the first run
under the newly-codified fixed 6-item "final regression check" checklist now
in `CLAUDE.md`/`AGENTS.md` (`fd5f349`) — added because the phrase had been used
repeatedly across this session without a fixed definition, so thoroughness
varied. Going forward every "final regression check" (or equivalent phrasing)
means: full frontend suite, relevant backend modules in isolation, `bench
build` if frontend files were touched (else state N/A), `bench migrate` twice
if a new field/doc was involved (else state N/A), an explicit security review
of anything touching user input/auth/data access (else state N/A), and explicit
naming of adjacent features confirmed unbroken — no silent skipping of any item.

## 8. Confirmed business policy: exchange/credit-only returns, no refunds of any kind

**Confirmed by the user 2026-08-10**, precise wording, not previously written
down anywhere in this repo (checked — no prior mention in this file, and no
code enforces it): **exchange and credit only — no refund of any kind, ever,
on any payment method.** Not cash, not card, not any other mode, no
exceptions under current policy. A return must always end up as store
credit or an exchange, never money handed back through Cash/Visa/etc.

**Investigated whether this is actually enforced today — it is not.**
`PaymentMethods.vue` renders every payment-mode button (Cash, Visa, ...)
fully enabled for a return with no gating tied to the "Store as Credit?"
toggle at all. Whether a return defaults to a live, editable refund amount is
decided by `Payments.vue`'s `applyReturnCreditDefault()`, which — contrary to
what the policy would suggest — actually **defaults to a live cash/card
refund** whenever `shouldApplyReturnRefundCap()` can't compute a cap (no
`return_against`, i.e. a return not linked to an original invoice — which
`posa_allow_return_without_invoice=1` on "Test Pos" explicitly allows) or
when the original invoice was fully paid. `use_cashback` (currently `0` on
Test Pos) only hides a UI label, it does not gate the buttons or block
submission. The only backend guard, `_guard_return_cash_refund()`
(`creation.py`), *caps* a cash refund at what was actually paid on the
original — it does not block cash refunds outright, and it silently does
nothing at all when there's no `return_against` (the invoice-less-return
case), so today even that cap doesn't apply in that scenario. `is_cashback`
is sent to the backend in the submit payload but never read there — purely a
frontend concept with zero server-side awareness.

**Decision: build this as a toggleable POS Profile setting
(`posa_returns_credit_only`), not a hardcoded removal** — policy is
credit-only today, but the business wants the ability to turn it off later
(a future store, a policy change) without a code change, same pattern as
every other POS Profile toggle in this codebase.

**Separately investigated, before building: does "Return Without Invoice"
(`posa_allow_return_without_invoice`) work correctly and safely today?**
Mechanically yes — a cashier can create a blank `is_return=1` invoice with no
`return_against`, add items and a customer manually, and it submits and
issues genuine, correctly-redeemable store credit (`get_available_credit()`
in `api/payments.py` filters purely on `outstanding_amount < 0` + customer +
company, never on `return_against`, so credit issuance, the Z Report, and
the receipt's same-shift exchange detection all work identically whether or
not the return is linked to an original invoice).

**But it's a real control gap, not just a hypothetical one.** Three separate
safeguards elsewhere in this codebase all happen to gate on the same field
this flow deliberately leaves empty (`return_against`):
1. `creation.py:1580`'s `validate_return_items()` call — checks returned
   items/qty against the original invoice — only runs
   `if ... invoice_doc.get("return_against")`. Skipped entirely for an
   invoice-less return: no verification the customer ever bought what's
   being "returned," at any quantity or rate.
2. `_validate_return_window()` (`invoice_processing/utils.py:60-62`)
   explicitly no-ops when there's no `return_against` — `posa_return_
   validity_days`/`posa_enable_return_validity` silently do not apply to
   this flow at all, even when enabled.
3. `_guard_return_cash_refund()` — established in the prior investigation —
   also gates on `return_against`, so today's refund cap doesn't apply here
   either (the new `posa_returns_credit_only` guard being built now
   deliberately does NOT have this gap — see below).

Net: an intentional, working feature (dedicated button, its own POS Profile
toggle) whose surrounding safeguards were evidently built assuming a linked
original invoice and never extended to cover the invoice-less path — a
cashier can fabricate a return for an item never sold, at any price, with no
age limit, and none of the business's other return controls engage. Flagged
for a future follow-up investigation, out of scope for the credit-only fix
below (which closes the refund-cap instance of this gap as a side effect,
but not the other two).

### Shipped: `posa_returns_credit_only` (2026-08-10)

New Check field on POS Profile, **default ON** (the safe direction for a
restriction, not a capability grant — every other risk-bearing toggle in this
codebase, `posa_allow_credit_sale`/`posa_use_gift_cards`/`posa_allow_partial_
payment`, defaults off because those *grant* capability; this one *removes*
it, so the safe default runs the other way). Backfills to `1` on every
existing row automatically via the `ALTER TABLE ... DEFAULT 1`, matching
"Test Pos"'s real policy with no manual data-fix needed.

**Frontend** (`Payments.vue`, `PaymentOptions.vue`, `PaymentMethods.vue`):
"Store as Credit?" forced on and shown disabled (not hidden) with an
explanatory caption when the policy is active; "Cashback?" hidden entirely;
Cash/Visa/other payment-method rows on a return replaced with a single
informational note. `applyReturnCreditDefault()` short-circuits to credit
when the policy is active; a defensive `watch` re-forces `is_credit_return`
back to `true` from any of the 7 places in `Payments.vue` that reset it to
`false` (cancel/reload/new-return flows) — added as a backstop rather than
patching all 7 individually, since a future 8th reset site is exactly the
kind of thing that would otherwise silently reopen this.

**Backend** (`creation.py`): `_guard_return_cash_refund()` extended with a
new layer that blocks any nonzero return payment outright when the profile
flag is on — checked before the pre-existing `return_against` gate, so it
also covers invoice-less returns (see the control-gap note above). This is
the real security boundary, not the frontend hiding.

**Field placement**: ended up between "Use Raw Receipt Printing" and "Raw
Receipt Width" (the print-settings area), not beside the other return
controls. The "Sales and Return Controls" section turned out to have
pre-existing shared-`insert_after`-target ties stacked many levels deep —
traced the full ancestor chain and found a new tie every time one was fixed,
including one masquerading as fixed after a first attempt (`posa_apply_
customer_discount`, an unrelated pricing field, sharing a target with two
genuine return fields). Rather than restructure a wide swath of this
doctype's existing field order, anchored to the receipt-print chain built
earlier this session instead — already proven clean via two verified migrate
cycles, and it doesn't touch fields whose history/purpose isn't fully known.
Correctly discoverable and stable, just not ideally grouped.

**Mid-session bug, found via live testing before this ever shipped**: the
new credit-only check initially ran unconditionally inside `_guard_return_
cash_refund()`, called (via `_normalize_return_payment_rows()`) from all 5
places that touch return payment rows — including `update_invoice()`, the
whitelisted endpoint the frontend calls on every debounced cart-background-
sync (`triggerBackgroundFlush`, 2s debounce), not just at Pay/Submit. Result:
adding a single item (qty -1) to a return cart threw the "refunds are
disabled" error immediately, before the cashier ever reached the Payments
screen — return functionality was completely unusable. Fixed by threading a
new `enforce_credit_only_policy` parameter through `_normalize_return_
payment_rows()`/`_guard_return_cash_refund()`, defaulting `False` (matching
every caller's real pre-existing behavior) and explicitly set `True` only at
the 4 call sites inside `submit_invoice()`/`submit_in_background_job()` —
i.e. only at genuine final submission. `update_invoice()`'s call site is
untouched; the pre-existing cap-based guard (layer 2) still runs there
exactly as it always did.

**Verified** (both the feature and the fix, confirmed live in the browser by
the user before commit): frontend `vitest run` 217/217 files, 1054/1054
tests; `vue-tsc --noEmit` clean; `bench build --app posawesome` clean, exit
0; `bench --site staging.local migrate` run twice, field position
re-verified via `frappe.get_meta()` after each run; relevant backend
modules in isolation — `test_submitted_invoice_shift_security.py` 1/1,
`test_same_shift_exchange.py` 5/5, `test_pos_closing_shift.py` 9/9,
`test_customer_credit_invoice_fields.py` 2/2, `test_gift_card_profile_
settings.py` 3/3, `test_sale_floor_profile_settings.py` 3/3, `test_api_
imports.py` 4/4 (`test_creation.py` excluded — confirmed via git-stash
comparison that its `ImportError` is a pre-existing environment issue,
identical on unmodified code). Direct function-level tests of `_guard_
return_cash_refund()` covering all 4 real scenarios (cart-building/no
error, genuine-refund-attempt/blocked, genuine-credit-return/passes,
normal-sale/unaffected). Live browser confirmation: cart-building no longer
errors, Payments screen correctly enforces credit-only, normal sales
unaffected.

## 9. Terminal lock/PIN dialog: re-lock on return, username display, Back to Desk escape (2026-08-11, `f3e794c`)

Three related fixes to the terminal lock/PIN feature, investigated and shipped
as one commit in a single session.

**Bug found: lock screen looked broken after leaving and returning to POS
Awesome.** Reported flow: lock the terminal, enter the correct PIN, unlock
works, navigate to Desk, navigate back into POS Awesome — the lock dialog
visually appears again, but is already unlocked underneath, no PIN required,
terminal instantly accessible.

Root cause traced through two layers. Server-side, lock state
(`terminal_state.py`) is a cache entry keyed by `(browser session, POS
Profile)` with a flat 24-hour TTL, and it only ever flips back to
`locked: True` via an explicit `lock_terminal` call — nothing anywhere calls
it on navigation away, so a verified unlock silently stays valid for up to a
day regardless of what the user does with the tab. Client-side,
`Navbar.vue`'s `goDesk()` does a hard `window.location.href = "/app"`
navigation, which fully tears down the Vue app and Pinia store; returning to
`/app/posapp` is therefore always a genuine fresh page load (`posapp.js` has
no `on_page_show` handler, so `on_page_load` reruns from scratch). The lock
dialog's `lockDialogOpen` ref correctly defaults to `true` on that fresh
mount, but the first authoritative `get_terminal_state` fetch then read the
still-valid, still-unlocked 24h cache from before — flipping the dialog back
to unlocked automatically, with no PIN ever entered. Not corrupted state;
nothing in the system had ever re-engaged the lock.

**Decision confirmed by the user (2026-08-11): Option A, no timeout,
"simple, no exceptions."** Considered and presented three options: (1)
re-require the PIN on every navigation regardless of elapsed time, (2) an
idle/inactivity timeout, (3) stay unlocked until explicitly locked (today's
de-facto behavior). Recommended the timeout approach as matching how most
real POS systems (Square/Clover/Toast-style) balance security against
cashier friction, but the user chose the simplest rule instead: every return
to POS Awesome always re-locks, no exceptions — including a plain browser
refresh or a background auto-update reload, since the client genuinely
cannot distinguish those from a real Desk round-trip (`on_page_load` reruns
identically in all three cases), and special-casing just Desk-navigation
would require heuristics the user explicitly didn't want.

**Fix**: `Navbar.vue`'s `fetchTerminalEmployees()` now calls `lock_terminal`
(instead of the read-only `get_terminal_state`) on its *first* invocation per
app instance only, gated by a new `hasForcedInitialTerminalLock` flag — this
forces the server cache back to `locked: true` before it is ever read on a
fresh mount, so there is no window in which a stale unlocked cache entry can
be observed. Later calls within the same running instance (the dialog's
"Retry" button after a failed cashier-list load, a POS Profile switch)
continue to use the read-only `get_terminal_state`, so an unrelated network
hiccup can never yank the terminal away from an active cashier mid-sale. No
backend change was needed for this: `lock_terminal` already existed (it's the
manual F8/lock-button path) and shares the exact same `get_authorized_pos_
profile()` authorization chain as the endpoint it replaces at this one call
site — calling it more often only narrows access, never grants it.

Side effect noted and accepted, not a bug: lock state is keyed by browser
session, not per-tab (matching the pre-existing cross-tab `BroadcastChannel`
lock-intent design already in this file), so opening a second POS Awesome tab
in the same browser will now also force-lock an already-unlocked first tab.

**The flash/misleading-render symptom resolves as a consequence of the fix
above, not as a separate change.** Traced every branch to confirm: `begin
TerminalEmployeesLoad()` sets `lockDialogOpen = true` synchronously, before
any network call even starts, and the first authoritative response can now
only ever confirm `locked: true` (a request failure also falls through to
`applyTerminalState(null)` → locked, unchanged fail-closed behavior). No code
path can flip the dialog to unlocked without a real PIN verification on a
fresh mount anymore — so no separate loading-state UI was needed; the dialog
already shows the correct state (locked) from the first frame through
confirmation.

**Step 1 — username instead of email on the Unlock POS dialog.**
`get_terminal_employees` (`employees.py`) now also selects and returns
`username` (falling back to the User's `name`/email if blank — `User.
username` is `unique` in Frappe's core doctype but not `reqd`, confirmed via
the doctype JSON and by checking live data on `staging.local`). Threaded
through `TerminalEmployee` in `employeeStore.ts` and the localStorage
optimistic-cache normalizer in `terminalEmployeeCache.ts` (same fallback
logic in all three places), so a cache-warm first paint — now common, since
every return re-locks and re-shows this dialog — never flashes email before
correcting to username once the live fetch resolves. Only the lock dialog's
cashier row changed; the separate "Switch Cashier" dialog in the same file
still shows email, deliberately left alone since the request was scoped to
the Unlock POS dialog only.

**Step 2 — "Back to Desk" escape button on the lock dialog.** Added next to
"Unlock POS" in the dialog's action row (secondary-then-primary button order,
mirroring the "Switch Cashier" dialog's existing Cancel-then-primary
pattern), so a cashier who forgot their PIN isn't stuck with no way to reach
a supervisor for a reset. Direct navigation
(`window.location.href = "/app"`), no confirmation dialog — matches the
existing unconfirmed `goDesk()` navigation used elsewhere in this app, and
adding a confirmation step would just be friction for someone who's already
stuck. Implemented as a local `goToDesk()` inside `EmployeeSwitchDialog.vue`
rather than emitting an event up to `Navbar.vue`, since it's a one-line
action with no dependency on any Navbar state. Does not touch lock state and
makes no API call at all — verified via a new test
(`employeeSwitchDialog.spec.ts`) asserting `employeeStore.isLocked` stays
`true` after clicking it, so it's a pure UI escape hatch, not a security
bypass. Combined with the re-lock-on-return fix, there is no way to chain
"leave via this button" + "return" into a state that skips the PIN prompt.

**Verified** (full 6-item regression check, run against the complete final
state of all three changes together, immediately before commit): frontend
`vitest run` **217/217 files, 1055/1055 tests** — one transient failure in
`tests/performance/catalogLoad.spec.ts` was observed on a run that happened
to overlap a concurrent `bench build` in the background; that spec asserts
wall-clock timing thresholds, so re-ran it alone (9/9 pass) and then re-ran
the full suite clean with nothing else competing for CPU (217/217, 0
failures) to confirm it was resource contention, not a real regression, since
none of the six changed files touch catalog loading in any way. Backend:
`test_terminal_state` 5/5, `test_employees` 21/21 (including `test_get_
terminal_employees_returns_profile_users_with_current_flag`, which directly
exercises the changed function), `test_pos_access` 12/12 — 38/38 total.
`bench build --app posawesome` clean exit 0. `bench migrate` **N/A** — no
doctype, fixture, or print-format file was touched, only Python API logic and
Vue/TS frontend files. Security review re-stated explicitly for all three
changes combined: `lock_terminal` and `get_terminal_state` share the
identical authorization chain, so calling the former more often only narrows
access; the added `username` field is no more sensitive than the `full_name`/
email already shown in the same pre-PIN-entry cashier list and is rendered
via `{{ }}` text interpolation, never `v-html`, so no new XSS surface; the
Back to Desk button's navigation target is a hardcoded literal, not
attacker-influenceable, and the button issues no API call of any kind.
Also checked `AGENTS.md`'s referenced `docs/ARCHITECTURE.md`, `docs/
FEATURE_CONTRACTS.md`, `docs/CODEX_WORKFLOW.md`, `docs/TESTING_AND_
VERIFICATION.md` before committing — all four define contracts for pricing/
cart/offline/printing/customer/UOM/POS-Profile areas only; none define an
authentication/terminal-lock contract, so none apply to this work.

Files: `posawesome/posawesome/api/employees.py`,
`frontend/src/posapp/components/Navbar.vue`,
`frontend/src/posapp/components/pos/employee/EmployeeSwitchDialog.vue`,
`frontend/src/posapp/stores/employeeStore.ts`,
`frontend/src/posapp/utils/terminalEmployeeCache.ts`,
`frontend/tests/employeeSwitchDialog.spec.ts`.

## 10. Item catalog load reliability + empty-by-default browsing + fashion-retail empty state (2026-08-11, `d360a0f`)

**Investigation.** Traced the full cold-start item-load sequence end to end
(what's fetched, in what order, parallel vs. sequential, the IndexedDB-vs-
server cache race) to answer a general "what actually happens on POS
mount" question, then found two concrete reliability gaps while doing so:
`runInitialization()`'s fallback fetch had no error handling, so a genuine
network failure on cold start silently left the grid empty with no error
shown and no way to recover short of a full page reload; and the empty grid
looked identical whether the catalog had genuinely failed to load or a
search had zero matches, giving cashiers no signal to tell the two apart.

**Fix, three parts, each confirmed with the user individually before
applying:**
1. Wrapped the fallback fetch in `runInitialization()` (`itemsStore.ts`) in
   try/catch: on failure, `finishStartupPhase(phase, "error", {...})` fires
   (so it's traceable in startup diagnostics) and the error is re-thrown
   instead of swallowed. `useItemsSelectorInitialization.ts` was refactored
   to extract `runInitializationAttempt()` and return
   `{ stop, retry }` instead of just the watcher's stop handle.
   `ItemsSelector.vue` now shows a distinct "Catalog failed to load" state
   (`showCatalogLoadFailure`) with a Retry button wired to the new
   `retry()`, instead of an indistinguishable blank grid.
2. `COLD_START_CACHE_GRACE_MS` widened from 250ms to 700ms (see the retired
   deferred item in section 4) — real cold IndexedDB opens (first-ever load,
   cleared storage, a new browser profile) can run past 250ms, which threw
   away a nearly-finished local read and forced an unnecessary live server
   round-trip. 700ms gives cold storage realistic room to win without
   meaningfully delaying the genuinely-missing case.
3. Separately, investigated why setting POS Profile "Search Limit" to 0
   (intending an empty grid until the cashier searches or scans) worked for
   the initial load but not for "Reload Items" — root cause was a
   falsy-zero bug repeated in three places across FE/BE, all treating
   `0` as "not set" rather than "no limit." Decided, with the user, **not**
   to fix by patching those falsy-zero checks (that would keep Search
   Limit=0 as an overloaded, easy-to-regress signal for two unrelated
   things: a real fetch cap, and "start empty"). Instead built a dedicated,
   reversible toggle: `BROWSE_WITHOUT_SEARCH_REQUIRES_QUERY` (`itemsStore.ts`),
   checked once inside `loadItems()` so it applies uniformly to every
   caller — initial load, Reload Items, price-list changes, background
   warmup — without touching any of them individually. When `true` and
   there's no search/scan term, `loadItems()` returns immediately with an
   empty result; the fetch/population logic it guards is otherwise
   untouched, so flipping the constant back to `false` fully restores the
   original populate-on-load behavior with nothing else to rebuild.
   Paired with a fashion-retail-appropriate empty state in
   `ItemsSelector.vue` (`showBrowsePrompt`) — "Scan a tag or search to
   begin" / "Find any item by name, style code, barcode or brand — search
   above or scan the tag." — using the app's real `--pos-*` design tokens
   (mocked up and approved as an Artifact before implementation), distinct
   from the normal zero-result "No items found" state.
4. Removed a dead `void startupInitPromise;` reference (and its now-unused
   import) left over from an earlier refactor, in both
   `useItemsSelectorInitialization.ts` and `DefaultLayout.vue`.

**Verified** (full 6-item regression check, run against the complete final
state of this fix together with the barcode fix in section 11, immediately
before committing both): frontend `vitest run` **218/218 files, 1061/1061
tests**. Backend: **N/A** — this piece touches no Python files (backend
coverage for the sibling barcode fix is reported separately in section 11).
`bench build --app posawesome`: clean exit 0, "built in 21.17s", Chrome 109
CSS audit passed. `bench migrate`: **N/A** — no doctype, fixture, or
print-format file touched. Security review: no new user input surface —
the gate is a pure client-side boolean check with no new inputs, and the
retry button re-runs the exact same already-authorized initialization call.
Explicitly confirmed unaffected: normal typed search still returns and
displays results, scanning still adds items to cart, and every current
`loadItems()` caller (`runInitialization`, `recoverItemCatalog`/Reload
Items, `updatePriceList`, `refreshItems`/background warmup, the pagination-
reset path in `useItemsLoader.ts`) was enumerated via grep and confirmed to
route through the same single gate — `itemsStoreLoadItems.spec.ts` (27/27),
`useItemsSelectorInitialization.spec.ts` (4/4, new file),
`itemsStartupNonBlocking.spec.ts`, `useItemsSelectorSearch.spec.ts` (9/9).
Also confirmed live in the browser per the user's own testing before this
commit.

Files: `frontend/src/posapp/stores/itemsStore.ts`,
`frontend/src/posapp/composables/pos/items/useItemsSelectorInitialization.ts`,
`frontend/src/posapp/components/pos/items/ItemsSelector.vue`,
`frontend/src/posapp/layouts/DefaultLayout.vue`,
`frontend/tests/itemsStartupNonBlocking.spec.ts`,
`frontend/tests/itemsStoreLoadItems.spec.ts`,
`frontend/tests/useItemsSelectorInitialization.spec.ts` (new).

## 11. Barcode scan "Item not found" fix (2026-08-11, `31854d7`)

**Bug report.** Scanning barcode `35740232030014` returned "Item not found"
despite the item (`HAT-CAP-BLACK-58`, a variant, 50 in stock) genuinely
existing. Investigated whether this was a regression from the section 10
work (disabled background pre-loading, the new browse gate) — proved
empirically, not by assumption, that it was neither: forced
`posa_hide_variants_items = 0` in-memory via `bench console` as the sole
changed variable and the scan started resolving correctly, isolating the
real cause to that one setting. Also proved background sync is not a
factor — `backgroundSyncItemsUnlocked` calls the same filtered `get_items()`
endpoint, so it was never going to help regardless of section 10.

**Root cause.** The scan handler's "not found locally" fallback in
`useScanProcessor.ts` called `get_items()` — the same filtered search
endpoint the browse grid uses, which applies `posa_hide_variants_items` and
other catalog-visibility filters meant for browsing. Every real barcode
belongs to a specific variant item, so Hide Variants Items excludes almost
every legitimate scan target — this was very likely misfiring for any store
with that setting on, independent of anything else in this session.

**Fix.** `useScanProcessor.ts`'s fallback now calls
`itemService.getItemsFromBarcodeData()` (`get_items_from_barcode()`) for a
plain scanned barcode — a dedicated Item Barcode table lookup with no
`pos_profile` argument and therefore no visibility filtering at all. One
subtlety caught before shipping: after serial/batch resolution,
`searchCode` is already a resolved `item_code`, not a raw barcode, which
`get_items_from_barcode()`'s barcode-table lookup would never match — a new
`resolvedToItemCode` flag routes that case through `get_item_detail()`
instead (same endpoint already used for scale barcodes, which takes an
item_code directly). On the backend, `get_items_from_barcode()`
(`barcode.py`) now also returns `has_variants`, `variant_of`, `item_group`,
`has_batch_no`, `has_serial_no`, `max_discount`, `brand`,
`allow_negative_stock`, and `idx` — all read off the `Item` doc it already
loads via `frappe.get_cached_doc`, zero extra queries — so the scan handler
gets the same complete item shape `get_items()` provides.

**Verified** (full 6-item regression check, same combined run as section 10):
frontend `vitest run` **218/218 files, 1061/1061 tests**, including the new
`useScanProcessor.spec.ts` test proving a plain scan calls
`getItemsFromBarcodeData` and never `get_items`. Backend, run in isolation:
`test_barcode` **2/2** (includes a new regression test using the actual
reported item's real data, asserting the full field shape and asserting the
function signature still takes no `pos_profile` parameter, as a guard
against ever reintroducing visibility filtering here), `test_item_fetchers`
**5/5**. Three unrelated modules (`test_details`, `test_item_search_
serialization`, `test_items_numeric_code`) failed but were rigorously
confirmed **pre-existing** via `git stash`/`git stash pop` A/B comparison —
identical failures reproduce on the unmodified codebase (a framework-level
`frappe.clear_cache()` cleanup crash for the first two, an ERPNext test-
data-seeding `DuplicateEntryError` for the third), unrelated to this change.
`bench build --app posawesome`: clean exit 0 (shared build with section 10).
`bench migrate`: **N/A** — `barcode.py`/`test_barcode.py` are plain API
logic, not doctype/fixture/print-format files. Security review: the backend
change only adds fields already loaded on the in-memory `Item` doc (no new
query, no new data exposure beyond what `get_items()` already exposes for
the same item); no permission check was added or removed — `get_items_from_
barcode()`'s pre-existing lack of a `pos_profile`/authorization scope was
identified as a separate, deliberately out-of-scope finding (see section 4).
Explicitly confirmed: regular typed search still respects Hide Variants
Items — re-ran the live `get_items(search_value="35740232030014")` call
against the current profile with Hide Variants Items still on and got 0
results, identical to before this fix; and the actual reported bug is fixed
— re-ran `get_items_from_barcode()` live against the same barcode and got
the full correct item. Named tests: `useScanProcessor.spec.ts` (7/7),
`scanProcessorAssignment.spec.ts` (3/3), `scannerInputPaste.spec.ts` (3/3),
`useScannerInput.spec.ts` (3/3), `useBarcodeIndexing.spec.ts` (2/2),
`useItemsSelectorSearch.spec.ts` (9/9), `itemsStoreLoadItems.spec.ts`
(27/27), `useItemAddition.spec.ts` (15/15), `itemAdditionSerials.spec.ts`
(3/3) — 72/72 across 9 files. Also confirmed live in the browser per the
user's own testing before this commit.

Files: `posawesome/posawesome/api/item_processing/barcode.py`,
`posawesome/posawesome/api/item_processing/test_barcode.py`,
`frontend/src/posapp/composables/pos/items/useScanProcessor.ts`,
`frontend/tests/useScanProcessor.spec.ts`.
