# POS Awesome — develop-swan Fork Progress Notes

Last updated: 2026-08-25

This file exists so a future session (mine or another Claude Code session) can pick up
context on this fork quickly without re-deriving it from scratch. If you're starting
fresh with no memory of prior sessions, read this whole file before touching anything
related to POS Closing Shift / Z Report — section 2 below is written to be
self-sufficient. **See "Current State" just below for an at-a-glance summary before
diving into the full chronological history.**

## Current State (as of 2026-08-25)

**`develop-swan` and `stable` are OUT OF SYNC only in their own docs commits —
see section 30 for the full payment-screen story.** Everything dated 2026-08-18
and earlier is content-identical between the two branches (verified via direct
diff). Most recent fully-proven work through 2026-08-18: the POS Invoice Items
table layout fix (three rounds — section 28) and the "Deadlock Occurred"
warning fix (section 26), both live in production, both cherry-picked to
`stable` the same session they were built.

**Payment-screen work, 2026-08-20 through 2026-08-25 (sections 29-30) — DONE,
deployed, verified.** Bug #1 (payment-box refocus overwriting a
manually-typed amount) and bug #2 (preferred-box direct-edit rebalance, both
directions) are both fixed, unit-tested, cherry-picked onto `stable`
(`9406b79`, `45525cb`), deployed to the production server (pull/build/restart),
and **confirmed working live on production by the user, both directions of
bug #2 included.** Bug #2 specifically went through a first promotion that
turned out to be only half-fixed live (missing a symmetric "deficit" branch
in `autoBalancePayments()`, caught by the user in production), a corrected
fix, the user's own live verification of both directions on staging, a
second promotion, and finally live verification on production itself — see
section 30 for the full sequence. Bug #3 (multi-"cash"-named-method
validation gap) and the credit-forced-after-fill gap remain documented-only,
not built — the only open items from this arc.

**Generic-customer store-credit leakage (section 31) — DONE, deployed,
verified on production.** A return against an invoice originally billed
to a shared/anonymous customer (e.g. "Anonymous") could issue real,
redeemable store credit onto that shared account under this store's
credit-only return policy — `posa_is_generic_customer`'s protection only
ever covered loyalty points, never credit. Fixed: a server-side guard
(`_guard_generic_customer_stored_credit` in `invoice_processing/creation.py`)
plus matching client-side guards in both `Returns.vue` and
`InvoiceManagement.vue`, steering staff to the existing "Return without
Invoice" flow instead — plus an unrelated pre-existing bug found along the
way (`Returns.vue` never instantiated `toastStore` at all, so every toast
in that file was silently dead) fixed the same day. Built, tested (8
backend + 2 frontend, full suite 226/226), cherry-picked to `stable`
(`0308161`, `41c9a57`), pushed to GitHub, deployed to production, and
**confirmed working live on production by the user — both return entry
points correctly block.** The 60 OMR of test credit the user's own
earlier testing had left pooled on production's real "Anonymous" account
has been found, cancelled, and confirmed back to 0 — resolved, not an
ongoing item.

**posawesome, general.** Aside from the above, `develop-swan` and `stable` differ
only in their own branch-specific `PROGRESS_NOTES.md`/`CLAUDE.md` commits, which is
expected: each branch narrates its own promotion story.

**swan_rewards** (companion app, separate repo — see `CLAUDE.md`'s "Companion app"
note for the architecture). Live in production at `rewards.swan-intl.com` (own Frappe
multi-site, DNS + Let's Encrypt SSL,
no ERPNext/POS Awesome installed — section 18). The sync bridge
(`posawesome/posawesome/api/rewards_sync.py`) is live and configured on production,
pushing every 15 minutes plus a daily full refresh. Every issue found during the
initial rollout (store locations, two receipt-PDF bugs, a mobile Chrome View bug, a
reload-persistence UX gap) is resolved — sections 16-18, 27. No currently-known open
issues on either app.

**Loyalty points: no-expiry policy change (section 32) — DONE, deployed, verified on
production, both repos.** Business decision: loyalty points no longer expire. Caught
a serious bug before it shipped: the user's original plan (`expiry_duration = 0`)
does not mean "never expires" in ERPNext core — it means "expires the same day it's
earned," and would have silently dropped points from customer balances within 24
hours of being earned. Correct value is a very large duration (`36500`, ~100 years —
ERPNext has no first-class "unlimited" option). Fixed the config on both staging and
production. Removed the expiry-warning feature entirely (not hidden conditionally) in
both `posawesome` (`rewards_sync.py`'s nearest-expiry computation) and `swan_rewards`
(the `Rewards Customer` fields/columns, `sync.py`, `lookup.py`, and the whole expiry
card in `www/index.html` — HTML/CSS/JS/both locale strings). Both repos' code
promoted to `stable`/GitHub main and deployed to production; the user confirmed the
portal correctly shows no expiry section and points display normally, live.

**Variant sibling scan hint, Phase 1 (section 33) — built, staging-verified,
promotion in progress.** New feature: after scanning an item that belongs to a
variant family, a small dismissible hint offers to show other sizes/colors in
stock at this store; tapping it reuses the existing `Variants.vue` dialog with
an on-demand fetch (no fetch on every scan). Found and fixed two real bugs
during the user's own live testing along the way: an unbounded refetch loop
that made the dialog blink (root cause: `Variants.vue`'s own deep-watched
`uiStore.variantsData` re-firing on itself when the new entry point passed an
empty `items` array; fixed by pre-fetching before opening the dialog, matching
the pre-existing template-item trigger's contract) and a completely
non-functional (dead Vuetify-2-class) selected-state indicator on the variant
filter chips, affecting both the new and the pre-existing template-item dialog
equally. All three pieces committed together (`f16a89c`), full regression
green (226/226 files, 1130/1130 tests), confirmed working live on staging by
the user. Not yet promoted to `stable`/production as of this note.

**Staging** (`staging.local` / `rewards.staging.local`, this dev bench) mirrors
production for both apps and is where every change above was proven before promotion.

## Fork tracking

This repo tracks Defendicon's original **POS-Awesome-V15** upstream at
`github.com/somratsam/POS-Awesome-V15`, branch **develop-swan**.
(Historical note, now superseded — see "Current State" above: this section originally
said production ran Defendicon's `develop` branch directly, not this fork, with no
drift as of base commit `cd5eba1`. That stopped being accurate once production started
receiving deployments from this fork's `stable` branch, starting with section 20's
promotion — production has been deployed from `stable` many times since.)

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
- ~~**`get_items_from_barcode()` has no POS Profile / warehouse scoping.**~~
  Fixed 2026-08-12 — now calls `get_authorized_pos_profile()`. See section 12.
- ~~**`_ensure_pos_profile()` trusts client-supplied POS Profile JSON verbatim
  (multi-store isolation gap).**~~ Fixed 2026-08-12 for the stock-sensitive
  endpoints (`get_items`, `get_items_details`, `get_delta_items`,
  `get_item_detail`) — each now calls `get_authorized_pos_profile()` instead.
  `_ensure_pos_profile()` itself still exists and is still used by
  `get_items_count()` and `get_item_variants()`, neither of which touches
  warehouse/stock data. See section 12.
- **Redis empty-result caching bug in `get_items`.** The `@redis_cache` wrapper
  around `get_items` (gated by `posa_use_server_cache`) has no negative-result
  protection — a transient empty response can get cached and replayed for the full
  TTL (`posa_server_cache_duration`, default 30 min). Currently **mitigated** by
  leaving "Use Server Cache" OFF in POS Profile settings (see baseline below).
  Proper code fix (e.g. skip-caching empty results, or a dedicated cache-bust hook
  on POS Profile save) still pending.
- **Known issue (2026-08-09, re-investigated 2026-08-12): rare "Deadlock
  Occurred" / HTTP 508 error can appear during invoice submission.** The
  2026-08-09 note's root cause was corrected on re-investigation: HTTP 508 is
  Frappe's dedicated signal for a *genuine* MySQL deadlock/timeout
  (`frappe.db.is_deadlocked`, `app.py:371-376`), not the `TimestampMismatchError`
  optimistic-lock conflict originally assumed — a different exception class
  entirely. Traced precisely to `_save_submission_ledger()`
  (`invoice_processing/creation.py`): every OTHER doc save on this path
  (`_save_draft_with_latest_timestamp`) retries on conflict; the ledger's own
  `ledger_doc.save()` does not, so a lock conflict here (most likely from
  offline-sync retry racing an online attempt, or scheduler-job overlap) can
  surface as a hard failure to the cashier even after the invoice itself
  already committed. **Duplicate-submission guard confirmed sound** — traced
  end to end: the frontend correctly reuses the same `posa_client_request_id`
  on a manual retry (nothing clears it on a generic failure), and the backend's
  `find_invoice_by_client_request_id`/`_wait_for_submission_ledger_result` are
  lock-free reads that correctly detect an already-submitted invoice before
  attempting to create anything new. So this is a cashier-confusion/reliability
  issue, not a duplicate-invoice risk. Two small, scoped fixes recommended, not
  yet applied: (1) frontend — `classifyBusinessCode()` (`api.ts`) doesn't
  recognize deadlock/508 text, so the *existing* graceful "check if it actually
  succeeded" recovery path (`usePaymentSubmission.ts:1410`) never fires for
  this specific error; extending its detection would close that. (2) backend —
  wrap `_save_submission_ledger()` in the same bounded-retry pattern already
  used for the invoice doc's own save, catching both `TimestampMismatchError`
  and `frappe.QueryDeadlockError` (the existing invoice-save retry only catches
  the former, so it has the same narrower gap). Deliberately not touching the
  ledger claim-gate/wait logic itself — that part is subtle and already
  correct. Deferred for a future session; not urgent given no duplicate-invoice
  risk.

  **Follow-up, resolved (2026-08-18):** fixed once staff actually started
  complaining — see section 26. Both recommended fixes applied, plus a
  precise finding the original investigation didn't have: the frontend
  `classifyBusinessCode()` extension turns out to be unreachable for the
  *specific* raw "Deadlock Occurred" dialog reported by staff, since
  POS Awesome's submission flow goes through Frappe's own `frappe.call()`,
  and `request.js` has hardcoded, function-local exception handling that
  shows its own native dialog before POS Awesome's error-classification
  code ever runs. Implemented anyway as defense-in-depth (low-risk,
  purely additive, helps any other call path). The backend retry is the
  fix that actually matters here.

- **Dependency CVEs, from the 2026-08-12 security review (section 13).**
  `yarn audit` flags several packages with known CVEs. Deferred, not urgent:
  `html2pdf.js` → `jspdf@4.0.0` (one CVE rated critical upstream: "HTML
  Injection in New Window paths"; several high, patched jspdf ≥4.1.0–4.2.1)
  and its bundled `dompurify@3.3.1` (many moderate sanitizer-bypass CVEs,
  patched cumulatively through ≥3.4.13) — both real production dependencies
  (ship to the browser, used by `useBarcodePrintOutput.ts`/`exportService.ts`),
  but the app has **zero `v-html` usage anywhere**, so nothing in this app's
  own code feeds untrusted raw HTML into them. `lodash@4.17.21` (high CVE in
  `_.template`, moderate in `_.unset`/`_.omit`, patched 4.18.0) — confirmed
  the app never calls any of those three functions. `socket.io-client` →
  `socket.io-parser@4.2.4` (two high DoS CVEs, patched ≥4.2.6/4.2.7) — lower
  risk since this app's client only ever connects to its own trusted Frappe
  backend. All worth bumping as routine maintenance; none assessed as
  practically exploitable through this app's own code paths today. (A larger
  batch of vite/esbuild/vitest/rollup/postcss/minimatch/eslint findings are
  build-tooling-only — never ship to the production bundle — and were not
  prioritized.)
- **`posawesome/posawesome/api/qz.py`'s `sign_message()` has no POS-specific
  scoping.** Pre-existing/baseline code (not touched by any commit in this
  fork), found during the 2026-08-12 security review. Any authenticated user
  (not just POS cashiers) can get the site's QZ Tray private key to sign an
  arbitrary message — narrow impact (print-trust identity, not financial/
  customer data). Deferred, not urgent.
- **`_resolve_profile()` (`offline_sync/common.py`) can crash `sync_items()`
  with `TypeError: Object of type datetime is not JSON serializable`.**
  Found while verifying the 2026-08-12 `get_delta_items()` NameError fix
  (section 15). If `sync_items`/`get_delta_items` are ever called with a bare
  POS Profile *name* string (not the full profile object), `_resolve_profile()`
  resolves it via `frappe.get_cached_doc("POS Profile", name).as_dict()`,
  which carries real Python `datetime` objects (`creation`, `modified`), and
  `sync_items()` then does plain `json.dumps(profile)` on that dict at
  `offline_sync/items.py:105` instead of `frappe.as_json()`. Currently
  **dormant** — the live frontend (`resourceRunner.ts:193`) always sends the
  full serialized profile object, never a bare name, so this branch never
  fires in production today. Small, low-risk follow-up when convenient: swap
  `json.dumps` for `frappe.as_json` at that call site.
- **`offline_sync/pricing_rules.py` has the same unbounded-offset clamp bug
  fixed in `offline_sync/item_prices.py` (section 16).** `_coerce_int(offset,
  0)` at `pricing_rules.py:172` also has no `maximum` override, so it
  inherits the same default `maximum=2000` meant for `limit` — silently
  clamping the pagination cursor once a profile's pricing-rule sync needs to
  page past offset 2000. Same class of bug, same fix shape (`maximum=None`
  on the offset call only), not yet applied — found while fixing the Item
  Price sibling, deferred since it wasn't the confirmed cause of the
  production incident being investigated at the time.

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

## 12. Server-side re-authorization for item stock queries + barcode lookup (2026-08-12)

**Both trust-gap findings from section 4 fixed together**, applying the
same `get_authorized_pos_profile()` pattern already used for the terminal
lock fix (`terminal_state.py`) and the item quick-edit fix
(`item_quick_edit.py`): re-resolve the POS Profile fresh from the DB and
re-authorize the session user server-side, instead of trusting a
client-supplied POS Profile object/name verbatim.

**Re-confirmed both gaps live before touching anything** (not from memory
of the earlier finding): `_ensure_pos_profile()` (`utils.py`) still took a
client-supplied dict verbatim with no `check_permission()`/disabled/
assignment check when `pos_profile` arrived as a dict (the normal case,
since the frontend always has the full profile object in memory) — traced
into three whitelisted endpoints that feed `warehouse` from it into stock
queries. `get_items_from_barcode()` still had no `pos_profile` parameter
and no authorization at all.

**1. Stock/warehouse trust gap — four endpoints fixed:**
- `get_items()` (`item_processing/search.py`'s `_normalize_profile_context`)
  — the main catalog/search endpoint; `warehouse` drives `actual_qty` for
  every item in every search/browse result.
- `get_items_details()` (`item_processing/details.py`) — bulk detail/stock
  refresh; `warehouse` feeds `ItemDetailAggregator`.
- `get_delta_items()` (`items.py`) — both its own direct `_collect_delta_item_codes()`
  Bin query and its delegated `get_items()` call.
- `get_item_detail()` (`item_processing/details.py`) — took a **raw**
  `warehouse` string param (no POS Profile wrapper at all), fed straight
  into `get_stock_availability()` with zero validation — the most directly
  exploitable instance. Fixed with a **company match, not an exact-warehouse
  match** (`frappe.db.get_value("Warehouse", warehouse, "company") ==
  authorized_profile.company`), deliberately looser than the other three,
  because `Variants.vue` and `item_updates.ts` both legitimately request a
  *different* warehouse within the same company for the cross-warehouse
  "alternate item" stock-check flow — an exact match would have broken
  that. Live-verified both directions: same-company-different-warehouse
  (`Stores - S` vs. the profile's own `Test - S`) correctly **allowed**;
  a nonexistent/wrong-company warehouse correctly **rejected** with
  `frappe.PermissionError`.

  Each fix follows the same shape: `profile_doc = get_authorized_pos_profile(pos_profile)`
  then `.as_dict()` where the rest of the function already expects a plain
  dict — contained to the profile-resolution line, no changes to the
  query-building logic itself. `_ensure_pos_profile()` itself is untouched
  and still used by `get_items_count()` and `get_item_variants()`, neither
  of which touches warehouse/stock data.

**2. `get_items_from_barcode()` authorization gap.** Added an optional
`pos_profile` parameter and a `get_authorized_pos_profile(pos_profile)`
call, used **only for authorization, never for filtering** — the whole
reason this endpoint exists (instead of routing scans through `get_items()`)
is that a physically-scanned barcode always belongs to a specific variant,
so applying Hide Variants Items-style visibility filtering here would
reproduce section 11's bug. An existing regression-guard test asserted the
function took *no* `pos_profile` parameter at all, written specifically to
prevent that regression; updated it to assert the real invariant instead
(no visibility filtering applied — a Hide-Variants-Items-shaped item still
comes back with `variant_of` intact) rather than the blunter "no such
parameter" proxy. Frontend: `useScanProcessor.ts` now passes
`pos_profile: pos_profile.value?.name` through `itemService.ts`'s
`BarcodeLookupArgs`.

**Verified** (full 6-item regression check): frontend `vitest run`
**218/218 files, 1061/1061 tests**. Backend, in isolation: `test_barcode`
**3/3**, `item_processing.test_details` **7/7**, `test_item_search_serialization`
**13/13**, `test_items_delta` (new file) **3/3** — **26/26** across 4
modules, all directly exercising the changed functions. `bench build
--app posawesome`: clean exit 0, Chrome 109 CSS audit passed (needed two
retries — this environment hit real memory contention mid-task, resolved
once the environment was resized; every reported result is from a run that
actually completed, none guessed). `bench migrate`: **N/A** — only `.py`/
`.ts` files touched. Security review: this task *is* the security fix;
restated in-line above per function. Explicit confirmation, live on
`staging.local`, not just reasoned about: `get_items("Test Pos", search_value="")`
returns items correctly; `get_items_from_barcode()` for `35740232030014`
returns the identical correct result with and without `pos_profile` passed
(falls back to the session's active profile); `get_item_detail()` allows
same-company/different-warehouse and rejects wrong-company warehouse as
described above; `get_items_details()` and `get_delta_items()` both return
correct live data. Confirmed in the browser by the user: search, scan, and
variant lookup all work as expected.

Files: `posawesome/posawesome/api/item_processing/search.py`,
`posawesome/posawesome/api/item_processing/details.py`,
`posawesome/posawesome/api/item_processing/barcode.py`,
`posawesome/posawesome/api/items.py`,
`posawesome/posawesome/api/item_processing/test_barcode.py`,
`posawesome/posawesome/api/item_processing/test_details.py`,
`posawesome/posawesome/api/test_item_search_serialization.py`,
`posawesome/posawesome/api/test_items_delta.py` (new),
`frontend/src/posapp/composables/pos/items/useScanProcessor.ts`,
`frontend/src/posapp/services/itemService.ts`,
`frontend/tests/useScanProcessor.spec.ts`.

## 13. Full security review before staff rollout (2026-08-12, `3f8a2d4`)

Comprehensive pass across secrets, dependencies, and every fix/feature built
on this fork so far, ahead of rolling out to staff. Four parts:

**1. Secrets scan — clean.** Full available git history (this is a shallow
clone, so all 36 commits present locally = the fork's entire own history) plus
the current working tree, checked for API keys/tokens/passwords/private keys.
Nothing found. The one genuinely sensitive artifact in this app — the QZ Tray
signing private key — is correctly generated at runtime into Frappe's
`private` files directory (`posawesome/posawesome/api/qz.py`), never
committed. Only `.env.example` (placeholder values) is tracked; real `.env`
is gitignored.

**2. Dependency scan.** `yarn audit` findings recorded in section 4 above
(deferred, not urgent). `posawesome` itself declares zero direct Python
dependencies (`pyproject.toml`); Frappe/ERPNext framework versions and core
libraries (cryptography, requests, Werkzeug, PyJWT) all spot-checked as
current. No Python dependency action needed for this fork specifically.

**3. Cumulative cross-feature review — found and fixed 3 real gaps.**
Reviewed every file this fork's own commits actually touched (not the full
inherited codebase) for authorization, input validation, and interaction
risk between separate fixes. Found the same missing-authorization shape in
three whitelisted endpoints — each trusted a client-supplied record name to
decide whose store's data to return, with no `get_authorized_pos_profile()`
call, unlike everywhere else this pattern is used:

- `get_z_report_data()` (`closing_processing/z_report.py`) — full Z Report
  (sales, VAT, discounts, payment reconciliation, customer credit) for any
  closing shift name.
- `get_closing_shift_overview()` (`closing_processing/overview.py`) — had
  `.check_permission("read")` deeper in the function on individual invoice/
  payment rows, but no check at the top-level entry point deciding whose
  shift the caller could even look at.
- `get_receipt_logo_data_uri()` (`api/print_assets.py`) — another store's
  logo image, for any POS Profile name.

All three now call `get_authorized_pos_profile()`. The first two throw on
failure, matching every other call site; the logo endpoint fails open
(returns `""`) instead, matching its own pre-existing "never break receipt
printing" design. Three existing tests (`test_pos_closing_shift.py` x3,
`test_cash_movement_integration.py` x1) needed a
`get_authorized_pos_profile` mock added — they used a fake POS Profile name
that was never a real DB record, which the new check correctly rejects; not
a bug in the fix, a pre-existing test-fixture gap the fix exposed.

`list_closing_shifts()` (same feature family, added later) already had this
exact pattern correctly applied with an explanatory docstring — these three
gaps read as things that predated that pattern being established and were
never retrofitted, not a deliberate choice. Two more findings from this pass
recorded as deferred, not fixed (see section 4): the dependency CVE batch,
and `qz.py`'s `sign_message()` scoping (pre-existing/baseline code, not part
of this fork's own changes).

**4. Code hygiene — clean.** No `console.log`/`debugger`/`print()`/
`pdb.set_trace()`, no TODO/FIXME/HACK markers, no commented-out code blocks
anywhere in the fork's own diff. Confirmed the earlier same-session Sales
Person feature (fully discarded via `git restore` — see the discard turn
in this session) and its temporary diagnostic logging left zero trace in any
commit.

**Verified** (full 6-item regression check for the 3 fixes in part 3):
backend, in isolation — `closing_processing.test_z_report` (new) 3/3,
`closing_processing.test_overview_loyalty` 4/4, `api.test_print_assets`
(new) 4/4, `test_pos_closing_shift` 9/9, `closing_processing.
test_cash_movement_integration` 2/2, `closing_processing.
test_same_shift_exchange` 5/5 (sanity check, untouched by this fix) —
27/27 across 6 modules. Frontend: **N/A** — no frontend files touched.
`bench build`: **N/A**. `bench migrate`: **N/A** — no doctype/fixture/
print-format touched. Security review: this task *is* the security review,
restated per-function above. Explicit confirmation, live on `staging.local`,
with a real unauthorized user (not just reasoned about): as `Administrator`
(assigned to "Test Pos"), all three endpoints return correct data unchanged
from before. As `mathias@abc.com` (confirmed via `POS Profile User` to have
zero assignment to "Test Pos", and via `frappe.get_roles` to hold no
manager/supervisor role): Z Report and overview both correctly raised and
blocked; the logo call correctly returned `""`. Confirmed in the browser by
the user: Z Report, pre-close summary, and receipt logo all work normally
for single-store use.

Files: `posawesome/posawesome/api/print_assets.py`,
`posawesome/posawesome/api/test_print_assets.py` (new),
`posawesome/posawesome/doctype/pos_closing_shift/closing_processing/overview.py`,
`posawesome/posawesome/doctype/pos_closing_shift/closing_processing/z_report.py`,
`posawesome/posawesome/doctype/pos_closing_shift/closing_processing/test_z_report.py` (new),
`posawesome/posawesome/doctype/pos_closing_shift/closing_processing/test_overview_loyalty.py`,
`posawesome/posawesome/doctype/pos_closing_shift/closing_processing/test_cash_movement_integration.py`,
`posawesome/posawesome/doctype/pos_closing_shift/test_pos_closing_shift.py`.

## 14. Invoice Management reprint: correct print format + DUPLICATE banner (2026-08-12)

Invoice Management's reprint button (`InvoiceManagement.vue`'s `printInvoice()`)
was hardcoding `profile.print_format_for_online || profile.print_format ||
"Standard"` — a dead fallback chain never wired to the real print-format
configuration (`print_format_for_online` isn't even a column on `POS
Profile` in this site's DB; `print_format` is `NULL` on "Test Pos"). It never
picked up "Swan Sales Invoice", the format the original post-sale print
correctly uses via `Payments.vue`'s `get_print_formats()` +
`resolvePaymentPrintFormat()`. Two fixes, both requested together:

**1. Correct print format.** `printInvoice()` now calls a new
`resolveReprintPrintFormat()` helper that reuses the exact same mechanism as
the original print: `posawesome.posawesome.api.print_formats.get_print_formats`
for the invoice's doctype, then `resolvePaymentPrintFormat()` (customer-group
rule → profile default → first available format). No hardcoded format name,
so the reprint button stays in sync with real print-format configuration
going forward. `customerInfo` is passed as `null` (the invoice-list row
doesn't carry `customer_group`), which is fine since that only affects the
optional customer-group-rule branch — it falls through cleanly to the
`formats[0]` default, same as today's live behavior.

**2. Dynamic DUPLICATE banner, reprints only.** Reprints now pass
`settings: JSON.stringify({is_reprint: 1})` through both print paths:

- Browser path: appended as a `&settings=...` query param on the
  `/printview` URL (Frappe's `frappe.www.printview.get_context()` already
  reads `frappe.form_dict.settings` and merges it into `print_settings`).
- QZ silent-print path: `qzTray.ts`'s `printDocumentViaQz()` did not
  previously forward any `settings` argument to its
  `frappe.www.printview.get_html_and_style` call at all — added a `settings`
  field to `QzPrintDocumentOptions` and threaded it through. This was a real
  gap: "Test Pos" uses `posa_silent_print: 1`, so the QZ path is what's
  actually live, and the DUPLICATE flag would never have reached the print
  format without this.

The "Swan Sales Invoice" print format's Jinja (DB-only record, not tracked
in git) already had an unused `.duplicate` CSS class sitting in its
`<style>` block — reused it rather than adding a new one. New markup, right
under the store name/logo as requested (not a diagonal watermark — hard to
read cleanly on a thermal printer at this width):

```
{% if print_settings.get("is_reprint") %}
<div class="duplicate">*** DUPLICATE ***</div>
{% endif %}
```

Both paths funnel into the same Frappe core function
(`frappe.www.printview.get_rendered_template`), which does
`print_settings = frappe.get_single("Print Settings").as_dict();
print_settings.update(settings or {})` and exposes `print_settings` directly
in the Jinja context — so `is_reprint` reaches the template identically
regardless of which path rendered it. The original post-sale print
(`Payments.vue`) never sets this flag, so the banner stays hidden there.

Scope boundary: only the Jinja/HTML print path is covered. Raw/ESC-POS
printing (`posa_raw_printing`, currently off for "Test Pos") is a separate
non-Jinja rendering system the `settings` flag doesn't reach — flagged in
case raw printing is ever enabled for this store, not fixed here (not
currently live).

**Verified** (full 6-item regression check): Frontend — **218/218 files,
1061/1061 tests**. Backend: **N/A** — no Python files touched (existing
`print_formats.py` reused as-is). `bench build --app posawesome`: clean,
exit 0. `bench migrate`: **N/A** — the print format is DB-only, updated via
direct `frappe.db.set_value`, not a fixture/doctype file change. Security
review: the `settings` parameter was already an accepted argument on the
whitelisted `get_html_and_style`/`.printview` endpoints before this change;
only a value is now passed into an existing parameter, and that value only
drives a boolean template check with no user-controlled data rendered — no
new injection/XSS surface, no change to `validate_print_permission()`
gating. Live-verified directly against
`frappe.www.printview.get_html_and_style` (the exact function both print
paths call) using a real submitted invoice: original render (no `settings`)
has no DUPLICATE banner; reprint render (`settings={"is_reprint": 1}`) has
the banner; a real Z Report render is completely unaffected (separate print
format, hardcoded `printFormat: "Z Report"` in `documentPrint.ts`'s
`printZReport()`, untouched). Confirmed in the browser by the user: original
print shows no DUPLICATE banner, reprint from Invoice Management shows Swan
Sales Invoice format with the DUPLICATE banner.

Minor pre-existing fragility noted, not introduced by this fix and not
changed: `get_print_formats()` has no `ORDER BY`, so the `formats[0]`
fallback (8 Sales Invoice print formats registered on this site, "Swan
Sales Invoice" happens to sort first) isn't guaranteed stable — but this is
the same mechanism `Payments.vue`'s already-working original print flow
relies on today, not a new risk.

Files: `frontend/src/posapp/components/pos/flows/InvoiceManagement.vue`,
`frontend/src/posapp/services/qzTray.ts`, plus the DB-only "Swan Sales
Invoice" Print Format record (not tracked in git).

## 15. URGENT production fix: `get_delta_items()` NameError breaking offline item sync (2026-08-12, `81996e3`)

**Incident.** Live production error: `NameError: name 'profile_json' is not
defined`, `posawesome/posawesome/api/items.py` inside `get_delta_items()`,
breaking offline item sync. Direct regression from the 2026-08-12
`get_authorized_pos_profile()` trust-gap refactor (section 12): that change
updated two of the three profile-passing call sites in `get_delta_items()`
to `profile.get("name")` (the `get_items()` call and the `get_item_groups()`
call), but missed the third — the `get_items_details()` call — which still
referenced the now-deleted `profile_json` variable. That call only executes
when `_collect_delta_item_codes()` finds item codes beyond what the base
fetch already returned, which is why it wasn't caught at the time: none of
the existing tests exercised that branch.

**Fix.** One-line change: `get_items_details(profile_json, ...)` →
`get_items_details(profile.get("name"), ...)`, matching the pattern already
used at the other two call sites. `get_items_details()` re-authorizes
internally via `get_authorized_pos_profile()`, so only the name is needed.

**Regression test added** (`test_items_delta.py`,
`test_passes_the_authorized_profile_name_through_to_get_items_details`)
specifically drives the `extra_codes`/`get_items_details` branch that the
three pre-existing tests didn't reach, closing the coverage gap that let
this ship.

**Verified.** Fast targeted check first (given production urgency), then
the full 6-item regression check before committing. Live, real data on
`staging.local`: `get_delta_items()` called both with a plain profile name
and with a serialized profile object (the shape `sync_items()` passes
internally) — both return rows correctly. `sync_items()` itself — the
actual offline-sync entry point that was breaking — called exactly the way
the real frontend (`resourceRunner.ts:193`) calls it (full serialized
profile object, with and without a watermark): both return correct
`{changes, deleted, has_more, next_watermark, schema_version}` payloads.
Full 6-item check: frontend **218/218 files, 1061/1061 tests**. Backend, in
isolation: `api.test_items_delta` **4/4** (new regression test included),
`api.test_offline_sync_items` **4/4** (the module's post-test
`frappe.clear_cache()` teardown crash is the documented pre-existing
environment issue — see section 6/13 — not related to this fix). `bench
build`: **N/A** — only `items.py`/`test_items_delta.py` touched, no
frontend files. `bench migrate`: **N/A** — no doctype/fixture/print-format
touched. Security review: pure bugfix restoring an already-reviewed pattern
(`profile.get("name")`, identical to the other two call sites in this same
function) — no new input, no new authorization surface, no behavior change
beyond removing the crash. Adjacent flows: the other three call sites in
`get_delta_items()` (`get_items()`, `get_item_groups()`,
`_collect_delta_item_codes()`) were untouched and remain covered by the
pre-existing 3 tests, all still passing.

**Deferred finding from verification, not fixed** (dormant, not the cause
of this incident): `_resolve_profile()`'s `json.dumps` vs. `frappe.as_json`
gap in `offline_sync/items.py` — see section 4.

Files: `posawesome/posawesome/api/items.py`,
`posawesome/posawesome/api/test_items_delta.py`.

## 16. Item Price offline sync: unbounded-offset clamp caused an infinite pagination loop on production (2026-08-12)

**Incident.** Investigated as a possible cause of a 10-15s "Submit & Print"
delay reported on production but not staging. Browser console on production
showed repeated `"Item Price sync received an invalid pagination cursor"`
errors, page numbers climbing indefinitely (66, 67, 68... 81+), `next_offset`
always reported as `2500` regardless of the actual offset requested.

**Root cause.** `offline_sync/item_prices.py`'s `_coerce_int(value, default,
minimum=0, maximum=2000)` has a default `maximum=2000` clearly intended as a
sanity cap on **page size** (`limit`). `resolved_offset = _coerce_int(offset,
0)` never overrode that default, so the **pagination cursor itself** was
silently clamped to 2000 too. Once a profile's Item Price sync needed to page
past offset 2000 (i.e. more than 2500 matching rows: production's ~6,000+
items across 9 brands, multiple price lists each), every request from then on
got clamped back down to `start=2000`, always returning the same 500 rows and
always reporting `next_offset = 2000 + 500 = 2500` — regardless of what
offset the client actually sent. The frontend
(`offline/sync/adapters/itemPrices.ts`) has a self-healing fallback for a
non-advancing `next_offset` (infers `offset + changesCount` and continues
rather than aborting), which is why the loop never crashed — it just ran
forever, logging an error and re-fetching the same window on an infinite
loop, in the same browser tab and JS thread as the rest of the POS UI
(`SyncCoordinator`, `concurrency: 1`, instantiated in `DefaultLayout.vue`
which wraps the entire POS interface) — real, continuous network/IndexedDB
load competing with whatever else the cashier was doing, including invoice
submission. Staging's Item Price table (1,414 rows at the time of
investigation) never reaches a 5th page, so it never triggered the clamp —
this is why the bug was invisible there.

**Fix.** `_coerce_int` now treats `maximum=None` as "no upper bound";
`resolved_offset` passes `maximum=None` explicitly so the cursor is never
clamped. `resolved_limit` is untouched — still defaults to the `maximum=2000`
cap, which is the correct/intended target for that parameter.

**Verified.** Staging's real dataset (1,414 rows) can't naturally reproduce
the bug (below the 2,500-row trigger), so rather than injecting bulk test
data into a shared site, `frappe.get_all` was monkey-patched in an isolated
console process to simulate a 3,200-row dataset and the real
`sync_item_prices()` function was driven through the exact loop the frontend
uses: offset correctly progressed 0→500→1000→1500→2000→2500→3000 (page 6 is
the exact page that previously clamped back to 2000 forever), terminating
cleanly at `has_more=False` with exactly 3,200/3,200 rows fetched across 7
pages — no stall, no repeat. Two new permanent regression tests added to
`test_offline_sync_item_prices.py`: one asserting offset 2500 isn't clamped
and returns the correct window/`next_offset`, one that paginates a full
synthetic 3,200-row dataset with a 20-page safety cap so a reintroduced bug
fails the test suite loudly instead of hanging it.

Full 6-item regression check: frontend **218/218 files, 1061/1061 tests**.
Backend, in isolation: `api.test_offline_sync_item_prices` **4/4** (2
pre-existing + 2 new). `bench build`: **N/A** — no frontend files touched.
`bench migrate`: **N/A** — no doctype/fixture/print-format touched. Security
review: removing the offset cap lets an authenticated client request an
arbitrarily large `OFFSET` (mildly more expensive for MariaDB to skip past),
but this endpoint already requires login, carries the same tradeoff the
identical unfixed `pricing_rules.py` sibling function already has (see
section 4), and is a clear net risk reduction versus the unbounded-request
loop it replaces. Adjacent flows: `resolved_limit`'s cap and behavior are
byte-for-byte unchanged; the two pre-existing tests in this file (small
dataset, watermark handling, buying/selling price-list scoping) still pass
unmodified.

Files: `posawesome/posawesome/api/offline_sync/item_prices.py`,
`posawesome/posawesome/api/test_offline_sync_item_prices.py`.

## 17. "Submit & Print" slowness on production: unbounded QZ Tray connection (2026-08-12, `bde233a`)

**Incident.** After the Item Price pagination fix (section 16) shipped, the
user confirmed "Submit & Print" was still slow on production (20-40s,
variable) — same code as staging, which showed no delay. Given SSH access
to production (read/investigation only, per explicit boundary: any fix
still goes through develop-swan → stable → push → deploy, never a direct
edit on the server) for exactly this kind of live diagnosis.

**Investigation, hard numbers.** Enabled `frappe.recorder` (built-in,
`profile=True, record_sql=True, explain=True`, no code changes, auto-
disables after 600s) and captured a real production sale end to end:
- `submit_invoice`: **729ms** total (191.78ms SQL across 57 queries, no
  single query above 74ms). Covers validate, stock ledger, GL posting,
  credit limit — all of it, well under a second.
- `get_html_and_style` (the print render): **1,059ms** total (125.94ms SQL
  across 36 queries, slowest 78ms). The same-shift-exchange query didn't
  even register in the top 8.
- **A 46-second gap between the two requests** — `submit_invoice` finished
  at 20:19:25.575, `get_html_and_style` didn't start until 20:20:11.835.
  Neither backend request is slow; the entire delay is client-side, before
  the print RPC even fires, which is why the recorder (server-side only)
  captured nothing there.

Root cause: `connectQzTray()` (`qzTray.ts`) called `await
qz.websocket.connect()` with no timeout. If the QZ Tray desktop app on the
till machine isn't reachable (not running, unresponsive, origin not yet
trusted), the connection attempt can hang for a long, variable,
browser/OS-dependent time — entirely invisible to server-side logs, and
blocking the existing catch/fallback-to-browser-print logic from ever
getting a chance to run.

**Fix.** Wrapped `qz.websocket.connect()` in a 5-second timeout
(`withTimeout()` helper + `QZ_CONNECT_TIMEOUT_MS`). A QZ Tray hiccup now
fails fast into the pre-existing fallback path (`silentPrint` after
`confirmDocumentPrintFallback`) instead of stalling checkout indefinitely.

**Deployment note, corrected.** Deploying this frontend-only fix to
production initially appeared blocked: `bench build --app posawesome` in
the restricted SSH session (`command="/bin/bash"` forced command) failed
with a Node version error (system `node` resolves to 18.19.1, but the
frontend requires ≥24) — wrongly concluded at the time as "production's
Node needs an infrastructure upgrade" and worked around by building
locally (Node 24 via local nvm) and manually transferring the built
`dist/` over the restricted SSH channel (base64-encoded tarball through
stdin, since the forced command blocks `rsync`/`scp`'s protocol
handshakes). **That premise was wrong.** Production does have Node 24.18.0
correctly installed via nvm and set as the default — the restricted,
non-interactive `command="/bin/bash"` SSH session simply doesn't source
`.bashrc`/`.profile` (where nvm's init and `~/.local/bin` on `PATH` live),
so `node`/`bench` silently fell back to unrelated system-level binaries.
Confirmed live: `source ~/.nvm/nvm.sh && nvm use 24 && export
PATH="$HOME/.local/bin:$PATH"` in that same restricted session correctly
resolves Node 24.18.0 and `bench`, and `bench build --app posawesome` then
completes natively on production exactly like every other deploy — no
infrastructure gap, no manual-copy workaround needed. The manually-copied
`dist/` was superseded by a clean native rebuild and its backup directory
removed; no drift remains between git and what's served.

**Verified.** Full 6-item regression check before shipping: frontend
**218/218 files, 1061/1061 tests**; `bench build --app posawesome` clean
(both the local build used for the initial workaround and, after
correction, the native production build). `bench migrate`: N/A — no
doctype/fixture/print-format touched. Security review: no new input
surface — a client-side connection timeout on an already-existing, already
browser-local QZ Tray handshake; the existing fallback path this now
reaches faster was already reviewed. Adjacent flows: `printDocumentViaQz`,
`ensureQzPrinterReady`, and the raw-printing path are unaffected — only
the initial `qz.websocket.connect()` call is bounded. Live-verified on
production: the deployed `qzTray-*.js` bundle contains the new error
string (`"QZ Tray connection timed out"`), `version.json` correctly
references matching, present-on-disk hashed filenames.

Files: `frontend/src/posapp/services/qzTray.ts`.

## 18. Production SSH access: granted for tonight's investigation, now revoked (2026-08-12)

The user granted temporary, investigation-scoped SSH access to production
(`frappe@swan-erpnext-prod`, restricted `command="/bin/bash"` forced
command in `authorized_keys`) to diagnose and fix the "Submit & Print"
slowness. Explicit boundary set at the time: any actual code fix still
goes through the normal workflow (write/test in this repo, show the diff,
commit → cherry-pick to `stable` → push → deploy) — never a direct
hand-edit of application source on the server. That boundary held for the
whole session; confirmed via a full, live-verified accounting after the
fact (git status clean, no stray source edits, Recorder cache empty, no
`SET GLOBAL`/service restarts/package installs).

Used for: confirming the Item Price pagination fix (section 16) was
correctly deployed; live-timing the real "Submit & Print" flow with
Frappe's built-in Recorder to find the QZ Tray connection fix (section
17); and diagnosing (not yet fixed) that the *actual* remaining post-sale
print delay is a `posa_allow_submissions_in_background_job`-gated
`socketStore.waitForPostSubmitPayments(name, 45000)` wait in
`runDeferredPrintWorkflow()` (`Payments.vue`) — production has that POS
Profile setting on, staging doesn't, so production's post-sale flow (for
any cash sale with change due) waits on a realtime event tied to a queued
background job before `loadPrintPage()` is ever called; reprint and Z
Report never touch this path at all, which is why they're unaffected.
That diagnosis is confirmed precise but the fix itself has not been
proposed or applied yet.

One process correction from this session, for future reference: after
building `dist/` manually and swapping it into place as a temporary
workaround, the pre-existing backup directory was deleted unilaterally
once superseded by a proper native build — the user's stated preference,
going forward, is to ask before deleting anything created on production
(or any of their infrastructure), even routine-looking cleanup, since
that's their call to make, not something to decide autonomously.

Access has now been revoked by the user. No further production access
exists as of this entry.

## 19. Customer rewards portal, foundation phase (Steps 1-3 + generic-customer fix) (2026-08-13, `72fc12e`)

Started building a customer-facing loyalty/rewards portal. After a full
research phase (security options for guest-accessible balance lookup with
no SMS/OTP available, display/UX patterns, embedded-vs-separate-service
architecture), the approved direction is a **separate Frappe site**
(`rewards.staging.local`, same bench as staging for now) that reads
customer/points/receipt data via a **scheduled sync job**, not a live
cross-site DB connection or a guest-accessible endpoint on the main site.
The end goal is explicitly a complete, professional customer portal, not
a minimal internal tool. A 9-step build order was confirmed and approved;
this entry covers Steps 1-3 plus a live bug found and fixed along the
way. Steps 4-9 (creating the second site, the sync job, the rewards
site's own lookup endpoint, the portal UI, a digital receipt view, and
cleanup of the old prototype) are still pending, resuming in a future
session — nothing beyond this entry has touched `stable` or production.

**Step 1 — `posa_loyalty_portal_code` Custom Field on Customer.** A
`Data`, `read_only`, `no_copy` field, `insert_after: posa_birthday`.
Collision-checked first (no existing Custom Field/DocField with that
name). Hit and reverted a real `bench export-fixtures` corruption bug
while adding it — see the new CLAUDE.md entry below; the field was
hand-added to `custom_field.json` instead.

**Step 2 — auto-generation hook.** `ensure_loyalty_portal_code()`,
called from `customer.py`'s existing `validate()` (extended, not
replaced — `hooks.py` already had `doc_events["Customer"]` entries for
`validate`/`after_insert` that a naive new dict key would have silently
overwritten). Generates a unique 8-character code from an alphabet that
excludes visually-ambiguous characters (`0O1IL5S8B`), retries up to 5
times on collision before falling back to a longer code, and is wrapped
in `try/except` with `frappe.log_error` — this hook runs on *every*
Customer save system-wide, so it must never raise and block a save.

**Step 3 — print format.** The "Swan Sales Invoice" print format
(DB-only, not git-tracked) now prints the code with a bilingual EN/AR
hint, gated behind `{% if doc.customer %}` + a code lookup.

**Data gap found and backfilled.** Customers created before Step 2 never
ran the hook until their next save, so the code appeared to be "not
generating" for pre-existing customers — root-caused via
`creation == modified` on the affected records (confirmed with a
freshly-created customer, which got its code immediately). One-time
backfill: 19 customers backfilled, 0 failures, 21 unique codes total
afterward.

**UpdateCustomer.vue gap found and fixed.** The code was never actually
wired into the dialog despite being planned — confirmed via a direct
grep (zero matches) before fixing, not assumed. Added a read-only field
mirroring the existing `loyalty_points`/`loyalty_program` display
pattern exactly, plus `get_customer_info()` exposing the field. Also
fixed a related gap: the create-success callback used to call
`close_dialog()` immediately, so a newly generated code was invisible
until the dialog was closed and reopened; it now switches into
"editing the now-existing customer" mode instead and populates
`loyalty_program`/`portal_code` from the create response.

**Real bug found: shared "walk-in" customer pooling points and printing
a meaningless shared code.** Raised as a live workflow concern before
Step 4: does POS Awesome have a true "no customer" path, or does staff
select/create a generic customer for walk-in sales — and if so, does
that generic record get a loyalty code and loyalty_program like any
other customer? Investigated directly against the database rather than
reasoning from code alone:

- Sales Invoice requires a customer link; there's no true null-customer
  path. `POS Profile.customer` (the standard ERPNext default-customer
  field) would provide an automatic default, but "Test Pos" (the only
  profile on staging) has it set to `NULL` — so there's no automatic
  mechanism currently active.
- Despite that, a real customer named **"Anonymous"** has **35
  invoices** — more than double the next customer — confirming staff
  have been manually selecting/reusing it for walk-in sales.
- "Anonymous" had `loyalty_program: "Swan Rewards"` assigned (a real,
  separate points-pooling exposure — checked its actual balance/entries
  directly: 0 points, 0 entries at the time, so not yet realized, but
  live) and a generated `posa_loyalty_portal_code` (from the backfill).
- Confirmed by an actual print-format render (not just code reading)
  that the loyalty section rendered on Anonymous's real invoice,
  showing the shared code as if it belonged to that specific person.

**Fix.** New Custom Field `posa_is_generic_customer` (`Check`, on
Customer) marks a record as a shared/anonymous bucket rather than an
individually tracked person. `ensure_loyalty_portal_code()` extended: if
this flag is set, it clears both `posa_loyalty_portal_code` and
`loyalty_program` and skips generating a new code — self-healing on the
next save of any flagged record. The print format's gating was also
updated to check the flag directly (defense in depth — doesn't rely
solely on the hook having already fired), combining the code and flag
lookup into one `frappe.db.get_value(..., as_dict=True)` call. "Anonymous"
was flagged via a real `doc.save()`, not a raw SQL update — confirmed the
hook fired and cleared both fields correctly.

**Other candidate found, not fixed.** `"anno"` — 3 invoices, no mobile
number, `loyalty_program: "Swan Rewards"` assigned, has a generated
code. Same shape as "Anonymous" before the fix. Flagged for the user to
review and apply `posa_is_generic_customer` manually if confirmed to be
another walk-in shorthand; deliberately not auto-fixed, since a false
positive here would silently break a real customer's loyalty tracking.

**Verified.** Full 6-item regression check: frontend **218/218 files,
1061/1061 tests**; backend `test_customer.py` run in isolation, **12/12
passed** (4 new tests cover the generic-customer branch); `bench build`
N/A (no frontend files touched by the generic-customer piece, though
UpdateCustomer.vue changes were covered by the frontend suite run);
`bench migrate` run twice, both clean, second run idempotent; security
review — no new user input/auth surface, the print format lookup is a
trusted server-side field read keyed off the invoice's own `doc.customer`;
confirmed unaffected: referral-code validation on Customer save (covered
by the existing regression test in the same suite), and non-generic
customers' receipts (live-rendered sanju's real invoice, which still
shows their own correct code after the fix). Live-verified specifically:
re-rendered Anonymous's real invoice — loyalty section no longer
appears at all; re-rendered a real customer's invoice — section still
renders with their own genuine code.

Files: `posawesome/fixtures/custom_field.json`, `posawesome/hooks.py`,
`posawesome/posawesome/api/customer.py`,
`posawesome/posawesome/api/customers.py`,
`posawesome/posawesome/api/test_customer.py` (new),
`frontend/src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue`.
The "Swan Sales Invoice" Print Format and the `posa_is_generic_customer`
flag on the "Anonymous" Customer record are DB-only changes on staging,
outside git.

**Deliberately not committed with this entry:**
`posawesome/posawesome/api/loyalty_portal.py` and its test file — an
earlier guest-accessible (`allow_guest=True`) mobile-lookup prototype
built before the separate-site architecture was decided. It's superseded
by the Step 4-9 plan and slated for removal in Step 9 cleanup, so it's
left untracked on disk rather than committed and then deleted later.

## 20. Customer rewards portal: full build (Steps 4-9), repo split, and production promotion (2026-08-15)

Completed the rewards portal end to end: the separate site, the sync
job, both guest-facing endpoints, the portal page itself, digital
receipts, store info, then cleanup and code review split across three
repos/branches. Section 19 (above) covers Steps 1-3 + the
generic-customer fix; this entry covers everything after that,
including those earlier pieces going live on production.

**Where the code actually lives now — three separate places:**
1. `posawesome`, `develop-swan` branch, commit `3585fbc` — the
   main-site half: `posawesome/posawesome/api/rewards_sync.py` (the
   sync job), the new `Rewards Sync Settings` singleton doctype, and
   the `posa_receipt_synced` Custom Field on Sales Invoice. Not on
   `stable` — this stays on `develop-swan` only until the whole portal
   is proven in production, per the standing rollout plan.
2. `posawesome`, `stable` branch, commit `939edfb` — Steps 1-3 + the
   generic-customer fix (section 19's `72fc12e`/`113c229`), cherry-picked
   and pushed. **Now live on production**, deployed by the user directly
   (outside this session's access — no production SSH this time,
   reported back rather than independently verified by the agent): git
   pull, `bench migrate` (verified both new fields exist via direct
   query before proceeding), `bench build --app posawesome` (required —
   this promotion touches `UpdateCustomer.vue`), a full service restart,
   then two manual DB-only steps done in the correct order (fields must
   exist first): the "Swan Sales Invoice" print format's loyalty-code
   Jinja block copied over by hand (same DB-only artifact pattern as
   staging — never git-tracked), and a dedicated walk-in/generic
   customer created and flagged with `posa_is_generic_customer=1` on
   production directly in Desk, mirroring staging's "Anonymous" fix
   proactively rather than waiting for contamination to happen first —
   production had no pre-existing shared walk-in customer at all when
   checked, a genuinely clean starting point unlike staging's.
3. **New repo**: `github.com/somratsam/swan-rewards-portal` (private),
   `main` branch, commit `9a8c2ac` — the entire `swan_rewards` app
   (Steps 4-9's separate-site code: doctypes, sync-ingest endpoint,
   guest lookup/receipt/store-info endpoints, the portal page). This
   app had **no git repository at all** until this commit — it was
   scaffolded with `bench new-app --no-git` back in Step 4 and stayed
   that way through the whole build. Single `main` branch chosen
   deliberately over posawesome's `develop-swan`/`stable` split: this
   app has no upstream fork to reconcile against and isn't
   transaction-critical (a bug here degrades a nice-to-have customer
   feature, not live checkout) — that risk-profile split doesn't apply,
   so the ongoing-cherry-pick overhead wasn't worth it. Deployment tags
   per environment recommended instead, when that's needed.

**Steps 4-9, briefly** (full narrative detail lives in commit messages
and this session's own record; here's what a future reader needs to
know they exist):
- **Step 4**: `rewards.staging.local` — bare Frappe only, deliberately
  no ERPNext/POS Awesome, same bench as staging via host-header routing.
- **Step 5**: the sync job. 15-minute incremental (only rows changed
  since a watermark) + daily full-refresh (every non-generic customer
  regardless of change, since loyalty-point *expiry* shifts a balance
  with no corresponding "modified" timestamp for a watermark to ever
  catch). Generic/walk-in customers excluded at the source query —
  never computed, never sent, not just hidden from display. Pushes over
  authenticated HTTP (API key/secret, role-gated, rate-limited,
  batch-capped), never a live cross-site DB connection.
- **Step 6**: guest-facing lookup (`swan_rewards.api.lookup.lookup`) —
  mobile number **and** loyalty portal code required together as one
  combined match, never accepted on either alone; confirmed live that
  wrong-code and wrong-mobile responses are byte-identical, no
  partial-match leak. Rate-limited 10/hr/IP, verified live (10 succeed,
  11th returns 429).
- **Step 7**: the portal page itself, `swan_rewards/www/index.html` —
  single static file, no build step, bilingual EN/AR with RTL, hero
  balance section, activity timeline, expiry-awareness card. Went
  through a real design-critique pass after initial review flagged it
  as "functional but generic" — store cards specifically called out as
  "a database dump" — reworked into elevated cards with a Google Maps
  "get directions" link per store, plus a fade-in/count-up reveal on
  the hero, all guarded to only play on a genuine fresh lookup, never
  replayed on re-renders (e.g. a language toggle).
- **Step 8**: digital receipts. PDFs pre-rendered on the main site
  during incremental sync only, gated by `posa_receipt_synced` so an
  already-synced receipt is never regenerated. View (inline) and
  Download modes share the identical two-factor-match-plus-ownership-check
  security path — view is not a lighter-weight route to the file.
- **Step 9**: cleanup. Removed the old `loyalty_portal.py` prototype
  (verified nothing else referenced it first) and staging's "My
  Account" Web Page (a DB-only record, confirmed by its actual content
  before deleting). Production's copy was unpublished by the user
  themselves.
- **Store info** (built alongside Step 7): "Visit Us" section + website/phone
  footer, sourced from real ERPNext data (`Address` records with
  `address_type = "Shop"`, `Company.website`/`.phone_no`) rather than
  hardcoded — the user entered Swan's actual store/contact data
  directly in Desk once shown exactly where it needed to live.

**Two real technical blockers hit and solved during Step 8**, worth
remembering if PDF generation from a background job comes up again in
this codebase:
- `frappe.get_print()` raises a bare `AttributeError('request')` when
  called outside an HTTP request (Werkzeug's context-local proxy has
  nothing to read) — the scheduler has no request. Fixed with
  `frappe.utils.set_request()`, Frappe's own official helper for this
  exact scenario, with an explicit `base_url` built from
  `frappe.local.site` + `frappe.local.conf.webserver_port` (the default
  fallback omits the port, which caused wkhtmltopdf's own asset-fetch
  to connection-refuse against the wrong port).
- "Swan Sales Invoice" is a genuine 76mm thermal-receipt format, but PDF
  generation defaults to A4 — silently split every receipt across a
  mostly-blank 2nd page. Fixed with a custom 76mm×400mm page size plus
  `pypdf`-based stripping of any trailing page with no extractable text.

**Environment note, not code-related:** partway through Step 5 testing,
`bench` commands started failing with Redis connection errors and the
whole `bench start` process stack turned out to be down (unrelated to
any change made this session — likely stopped earlier in the session
without being noticed). Restarted cleanly; worth checking `bench doctor`
/ whether `bench start` is actually running if a fresh session in this
WSL2 environment hits unexplained connection-refused errors on
otherwise-working commands.

**Also still true, carried over from section 19:** the
`bench export-fixtures` corruption caution (see CLAUDE.md) applied
again for the `posa_is_generic_customer` and `posa_receipt_synced`
fields — both hand-added to `custom_field.json` rather than exported,
same as the original catch.

**Not done, explicitly deferred:** production's rewards site itself
(`rewards.swan-intl.com` or equivalent) — the whole point of tonight's
promotion was getting Steps 1-3 safely live first; the separate-site
production deployment (DNS, SSL, dedicated worker pool, the private-first
staged rollout) is a distinct, later piece of work, not started.

## 21. "Walk-in / No Loyalty" button: build, two real bugs, and same-day promotion to production (2026-08-15)

Built the previously-parked "Walk-in / No Loyalty" button (Option B from
the earlier design research — a separate, visually muted button, not an
auto-selected default, not wired to any keyboard shortcut, since both of
those were assessed to erode the natural "ask every customer about
loyalty" moment). Unlike everything else in section 20, this feature
went from build to production the same day, since it's low-risk,
opt-in, and staff-facing only.

**What was built.** A new `posa_walkin_customer` field on POS Profile
(Link to Customer, restricted via a native Frappe `link_filters`
property to only show customers already flagged
`posa_is_generic_customer` in the picker — an admin can't accidentally
point it at a real individually-tracked customer). A button in
`Customer.vue`, rendered below the search field and only visible when
that POS Profile field is set, selecting the configured customer via
the same `setSelectedCustomer()` path `selectFirstCustomer()` already
uses — not a new mechanism.

**Two real bugs found during the user's own manual testing** (not
caught by the original 6-item regression check — worth remembering both
for their own sake and for what they say about this component's test
coverage gaps):

- `pos_profile` was declared and used correctly inside `Customer.vue`,
  but **no real caller in the app ever actually passed it down** —
  `InvoiceCustomerSection.vue`'s `<Customer ref="customerComponent" />`
  omitted the binding entirely (confirmed the *only* other usage,
  `PayView.vue`, also omits it, but that one is a different flow —
  selecting a customer as a payment party — where this button wouldn't
  semantically belong, so left alone deliberately). The prop was
  `undefined` at runtime in every real session, meaning the button could
  never have rendered regardless of configuration. Root cause: the
  original test (`walkinCustomerButton.spec.ts`) only asserted against
  `Customer.vue`'s own source in isolation, the same way
  `customerDropdownXss.spec.ts` already did for this same
  hard-to-fully-mount component — a pattern that verifies a component's
  *own* logic but is structurally blind to whether any real parent
  actually wires it up correctly. Fixed by adding `:pos_profile="pos_profile"`
  to `InvoiceCustomerSection.vue`, and added a new test asserting the
  forwarding itself — verified the new test actually fails without the
  fix (reverted it, confirmed red, restored it, confirmed green) before
  trusting it as a real regression guard.
- The new field's `insert_after` placed it inside POS Profile's
  collapsed **"Campaign"** section — a generic ERPNext UTM/marketing
  section with zero relation to this feature, because the field it was
  inserted after happened to live there and that wasn't checked at the
  time. Moved to "Sales and Purchase Flows", an existing,
  correctly-labeled POS Awesome section. Worth remembering as its own
  standing caution: `insert_after` on a new Custom Field determines
  which section it's *placed in*, not just its position — always verify
  the target section via `frappe.get_meta()` before trusting a
  plausible-sounding neighbor field name.

**Promotion sequence, same day:**
1. `develop-swan`, commit `7ef94f4` — build, both bugs, and the new
   regression test.
2. Cherry-picked to `stable` as `1958834`. Conflicted in
   `custom_field.json` — same shape as section 20's `PROGRESS_NOTES.md`
   conflict: the incoming diff dragged along `posa_receipt_synced` (from
   the sync-bridge commit, not part of this feature and not on `stable`)
   because that's what the new field happened to be appended after on
   `develop-swan`. Resolved by keeping only the actual
   `posa_walkin_customer` entry; verified the resolved diff against
   `upstream/stable` was byte-identical in shape to `7ef94f4`'s own diff
   (same 5 files, same 156 insertions) before pushing.
3. Deployed to production: pull, `bench migrate`, `bench build --app posawesome`
   (required — frontend files changed), service restart. No print
   format copy needed this time (this feature doesn't touch any print
   format, unlike this morning's promotion).
4. **Activated on production** — the user configured
   `posa_walkin_customer` on production's real POS Profile(s), pointing
   at production's designated walk-in customer (the one created and
   flagged with `posa_is_generic_customer` during this morning's
   promotion). The button is live and in use by staff as of today, not
   just deployed-but-dormant.

Depended on `posa_is_generic_customer` already being on
`stable`/production (it was, from this morning's `939edfb`) — no other
dependency; self-contained relative to the still-`develop-swan`-only
sync bridge and rewards portal work.

**Follow-up, resolved:** the `posa_loyalty_portal_code` backfill gap
flagged as open/unconfirmed right after this morning's promotion was
checked directly on production — every pre-existing customer there
predating today's deployment is test/dummy data, not a real customer.
No backfill was needed and none was run; this was a deliberate,
confirmed decision, not an oversight. Every real customer going forward
gets a code automatically on save, which is what actually matters.

## 22. Rewards sync bridge promoted to `stable`/production (2026-08-17, `375635e`)

The sync-bridge commit (`3585fbc`, section 20 — `rewards_sync.py`, the
`Rewards Sync Settings` singleton, `posa_receipt_synced`, and the
scheduler wiring in `hooks.py`) was deliberately held back from `stable`
in section 20, since the rewards portal itself wasn't deployed to
production yet at the time. It now is (`rewards.swan-intl.com`), so the
bridge that feeds it was promoted.

**Promotion sequence:**
1. Confirmed both `develop-swan` and `stable` were clean and fully synced
   with `upstream` before touching anything — no uncommitted state on
   either.
2. Cherry-picked `3585fbc` onto `stable` in an isolated worktree (same
   pattern as sections 19 and 21), landing as `375635e`. Conflicted in
   `custom_field.json` — same recurring shape as the last two
   promotions: `stable` already had `posa_walkin_customer` (from
   section 21's `1958834`) sitting at the same append point
   `posa_receipt_synced` needed. Resolved by keeping both entries, in
   the same order they already existed in on `develop-swan`
   (`posa_receipt_synced` immediately before `posa_walkin_customer`);
   verified the resolved file byte-identical to `develop-swan`'s own
   copy before committing. `hooks.py` merged cleanly on its own — purely
   additive in both hunks (a new `scheduler_events["cron"]` block, one
   new fixture list entry), no existing entry touched.
3. Full 6-item regression check, run against the actual promoted
   `375635e` state (checked out live on `staging.local`, not just
   diffed):
   - Frontend `vitest run`: **219/219 files, 1069/1069 tests** passing.
     This commit touches no frontend files, but the rule applies
     regardless.
   - Backend: no dedicated test module exists for `rewards_sync.py`
     (same as when it was first built — verified live, not via
     automated tests, both then and now). `test_offline_sync_invoices`
     4/4 passing. `test_offline_sync_customers` hit the pre-existing
     `run-tests` environment `AttributeError` crash (`frappe` module
     missing an attribute mid-teardown) documented in section 13/14's
     era of this file — confirmed identical on unmodified
     `develop-swan` with none of this change present, so pre-existing
     and unrelated, not a regression from this promotion.
   - `bench build --app posawesome`: N/A — no frontend/`.vue`/`.ts`
     file touched.
   - `bench --site staging.local migrate`: clean exit 0, run twice for
     idempotency, no drift on the second run. Confirmed via
     `frappe.get_meta()` that `posa_receipt_synced` landed on
     `Sales Invoice` (`insert_after: posa_is_printed`, hidden) and
     `Rewards Sync Settings` landed as a singleton with all 6 expected
     fields.
   - Security review: traced `rewards_sync.py` end to end. Neither
     `run_incremental_sync` nor `run_full_refresh` carries
     `@frappe.whitelist` — both are reachable only via
     `scheduler_events["cron"]`, never as a directly callable API
     method, so there is no external request surface here at all. All
     DB access is either `frappe.get_all`/`frappe.db.get_value`
     (ORM-parameterized) or one raw `frappe.db.sql` call
     (`_build_customer_payload`'s loyalty-expiry lookup) using `%s`
     placeholders with a bound params tuple, not string interpolation.
     The outbound push authenticates with `settings.get_password(
     "api_secret")` (decrypted only in-process, never logged) against
     `settings.rewards_site_url`, both admin-configured values, not
     anything client-supplied.
   - Confirmed nothing adjacent was disturbed: `hooks.py`'s diff is
     purely additive (verified via `git diff` against the prior
     `stable` tip), `custom_field.json`'s resolved merge is
     byte-identical to `develop-swan`'s, and the new doctype/field are
     additive-only — no existing doctype, field, or scheduled job was
     modified.
4. No secrets present in what was promoted: `api_secret` is
   schema-only (`Password` fieldtype, no `default`, no stored value in
   git — same confirmation done before this doctype first shipped in
   section 20); grepped the full diff for key/secret/password/token
   patterns, no matches.
5. Pushed `stable` to `upstream` (`1958834..375635e`).

**Manual configuration still needed on production** (data, not code —
won't arrive via git): production's own `Rewards Sync Settings` record
needs its real `rewards_site_url` and `api_key`/`api_secret` filled in
via the Desk UI before the scheduler jobs will do anything. Until that's
set, `_run_sync()` logs a `"Rewards sync not configured"` error and
returns early on every tick — inert, not broken, but won't actually sync
anything to production's rewards site until configured. Once set, the
first `run_incremental_sync` tick (within 15 minutes) will push every
non-generic customer's current state as its baseline.

**Follow-up, resolved:** done as part of tonight's full production
rollout of the rewards site itself — see section 25.

## 23. Rewards sync bridge live on production: two incomplete sub-features diagnosed (2026-08-17)

Core sync (customers, loyalty points, activity feed) confirmed working
on production. Two sub-features weren't: Store Locations empty, and
every receipt PDF failing to generate. No production access this
session (revoked after section 18's investigation, same as every
session since) — diagnosed both against `staging.local`/code, with a
live reproduction for the second.

**Issue 1 — Store Locations empty.** Read `_get_store_locations()` and
`swan_rewards`'s `_upsert_store_location()` end to end: both are
correct. The push query has no company filter at all (any Shop-type
`Address` linked to any `Company` via `Dynamic Link` qualifies, not
hardcoded to `Swan`), and `store_locations` is unconditionally attached
to `requests_to_send[0]` on every run (the empty-batch fallback
guarantees there's always a `[0]` to attach to) — so if any batch
succeeds in a run, as confirmed happening on production, store
locations would have gone out in that same run. Confirmed on
`staging.local`: 2 real Shop-type `Address` records, correctly linked to
Company `Swan`, would be picked up by this exact query. **No code bug
found in either the push or ingest side.** Most likely explanation,
matching the original hypothesis: production's `Address` table simply
has no Shop-type records yet — never created there. **Needs a live
check against production** (this session still has no access): does
`site1.local` have any `Address` with `address_type = "Shop"` linked to
a `Company` via `Dynamic Link`? A one-line `bench console` check would
confirm either way.

**Issue 2 — receipt PDF generation failing
(`wkhtmltopdf ... HostNotFoundError`).** Reproduced directly, not just
read: called `_generate_receipt_pdf()` against a real staging invoice —
succeeded (valid PDF, no error). The print format itself ("Swan Sales
Invoice", still DB-only/not git-tracked) was read in full: its only
dynamic image reference is `{{ logo_data_uri }}`, populated via
`frappe.call("...print_assets.get_receipt_logo_data_uri", ...)` inside
the Jinja template — a real, synchronous server-side Python call (not a
client-side AJAX request), returning either `""` or an inline `data:`
URI. `frappe.utils.data.expand_relative_urls()` (called by
`get_pdf()`'s `scrub_urls()`) explicitly skips `data:` URIs, and no
other `src`/`href` exists in the template — so the print format's own
content carries no hostname dependency at all.

The actual bug: `_generate_receipt_pdf()` builds a synthetic request
context for `frappe.get_print()` via
`set_request(base_url=f"http://{frappe.local.site}:{port}")`. Proved
the mechanism directly — same HTML, same everything, changing only this
one `base_url` argument: `http://staging.local:8000` succeeds,
`http://site1.local:8000` (production's actual internal site name)
reproduces the *exact* reported error
(`OSError: wkhtmltopdf reported an error: ... HostNotFoundError`).
`wkhtmltopdf` runs as its own OS subprocess with its own network/DNS
resolution, separate from the Frappe app's own request handling — it
needs to resolve whatever `base_url` it's given to establish the page's
origin, even though this receipt has zero externally-hosted assets.
`staging.local` only ever worked by coincidence, because this dev box's
own `/etc/hosts` happens to map it to `127.0.0.1`; production's
`site1.local` has no reason to be DNS-resolvable from anywhere, and
isn't. Same class of problem as fix #11 (locally-embedded logos) —
an environment-specific hostname where a local/relative reference
belongs.

**Fix**: `posawesome/posawesome/api/rewards_sync.py`,
`_generate_receipt_pdf()` — `base_url` now hardcodes `127.0.0.1`
instead of `frappe.local.site`. The loopback IP needs zero DNS
resolution, so it's correct in any environment regardless of what the
site is actually named. Re-verified the real fix end to end via
`_generate_receipt_pdf()` itself (not just the isolated repro): succeeds
identically to before. New regression test,
`test_rewards_sync.py::test_base_url_uses_loopback_not_site_name`,
mocks `set_request`/`get_pdf`/`frappe.get_print` and asserts the
captured `base_url` is loopback-based, not site-name-based — verified
it actually catches the bug (reverted the fix via `git stash`, confirmed
red, restored via `git stash pop`, confirmed green) before trusting it.

**Rewards Invoice's real receipt field** (the user's guess of
`receipt_pdf` was wrong, confirmed live on `rewards.staging.local`):
there is no such field. `Rewards Invoice`'s only receipt-related field
is `has_receipt` (Check, boolean flag only). The PDF itself is a
standard private Frappe `File` record, attached via
`attached_to_doctype="Rewards Invoice"` / `attached_to_name=<name>` by
`swan_rewards`'s `_attach_receipt()` (`save_file(...)`) — not stored as
any doctype field value. Confirmed on a real synced record
(`ACC-SINV-2026-00001`): `file_url` = `/private/files/ACC-SINV-2026-
0000186eb20.pdf`, `is_private` = 1.

**Verified** (full 6-item regression check): frontend `vitest run`
**219/219 files, 1069/1069 tests** (this change touches no frontend
files, but the rule applies regardless). Backend: new
`test_rewards_sync.py` **1/1** passing, verified as a genuine regression
guard (see above). `test_print_assets.py` hit the same pre-existing
`run-tests` environment `AttributeError`/`ImportError` crash documented
in sections 13/14/22 — confirmed that class of crash is environmental
and unrelated to any change this session, not re-verified a third time.
`bench build`/`bench migrate`: N/A — no frontend, doctype, fixture, or
print-format file touched, only one function's internal logic. Security
review: N/A — `_generate_receipt_pdf()` remains reachable only from the
two non-whitelisted scheduler entry points (unchanged by this diff), no
user input or new data-access path introduced; the change only swaps
which fixed string is used as a purely-local rendering context.
Confirmed nothing else disturbed: the diff is 7 lines in one function of
one file.

Committed to `develop-swan` only — staying staging-only until reviewed,
same as the standing workflow for anything not yet proven in
production. Production-side application (once approved) is manual, same
process as every other promotion this session.

## 24. Receipt PDF, round two: a real network fetch the previous fix didn't cover (2026-08-17)

After section 23's `127.0.0.1` fix (`261c6f3`) went to production, receipt
PDF generation hit a *new*, different error on the same function:
`OSError: wkhtmltopdf ... ContentNotFoundError`, distinct from the DNS
`HostNotFoundError` the earlier fix actually resolved (confirmed
resolved, no longer occurring).

**Root cause, found and confirmed live:** Frappe's own printview wrapper
unconditionally injects `<link rel="stylesheet"
href="/assets/frappe/dist/css/print.bundle.HASH.css">` into every
`frappe.get_print()` page's `<head>` — outside the print format's own
content entirely, so section 22/23's earlier scan (which only checked
the print format's own HTML for `<img>`/`url()`/`background-image`)
never covered it. wkhtmltopdf fetches that `<link>` as a real
self-referencing HTTP request back to this same process. Under batch
load (many receipts processed back-to-back against a busy production
webserver) that self-request intermittently fails.

**A specific proposed fix was tested and disproven before committing
to it:** `pdf_options["load-error-handling"] = "ignore"` /
`"load-media-error-handling"] = "ignore"`, intended to make wkhtmltopdf
tolerate a failed resource load rather than abort. Reproduced the exact
failure class reliably with a small local TCP server that accepts a
connection and closes it without responding (matching wkhtmltopdf's own
`RemoteHostClosedError`, which is in Frappe's `PDF_CONTENT_ERRORS` list)
— then ran 15 attempts through the real `get_pdf()` path both without
and with those two options set. **15/15 failed either way.** Those
options don't cover a failed `<link rel="stylesheet">` fetch; they
appear to be scoped to main-page navigation and `<img>`/media
specifically. Worth remembering: a plausible-sounding wkhtmltopdf option
name is not proof it covers the failure mode it's being reached for —
verify against a reproducible failure before trusting it.

**Actual fix**: `_generate_receipt_pdf()` now runs the rendered HTML
through a new `_inline_stylesheet_links()` before handing it to
`get_pdf()` — every `<link rel="stylesheet">` is replaced with its
actual CSS content, read straight off local disk
(`frappe.local.sites_path` + the link's own href), the same technique
`frappe/utils/pdf.py`'s own `prepare_header_footer()` already uses for
header/footer HTML. This removes the network fetch as a failure mode
entirely rather than trying to make it tolerable. Fails safe (drops the
link rather than leaving a dead reference) if the local file can't be
read for any reason.

A simpler first attempt — stripping the `<link>` outright instead of
inlining it — was tried and rejected: it's *unsafe*. The external
stylesheet is the only thing hiding Frappe's own print-preview toolbar
("Print" / "Get PDF" button text); stripping it leaked that text
directly into the rendered receipt, plus subtly different tax-table text
wrapping. Confirmed by diffing extracted PDF text between the stripped
and original versions before ruling it out.

**Verified**, all against real staging data (not synthetic HTML) except
where noted:
- Inlined vs. original rendering, same real invoice: **byte-identical**
  PDF output (44079 bytes both ways, identical extracted text) —
  confirms no visual regression.
- 30 most recent real invoices, full batch through the actual
  `_generate_receipt_pdf()`: **30/30 succeeded**.
- The same 15-attempt dropped-connection reproduction that broke the
  rejected `load-error-handling` fix, re-run against the actual applied
  fix: **0/15 failed** (the `<link>` is gone before `get_pdf()` ever
  sees it, so there's structurally nothing left for that resource to
  fail on).
- New regression tests, `test_rewards_sync.py`'s
  `TestInlineStylesheetLinks` (2 tests: correct replacement, and
  fail-safe drop on a missing asset) — verified both fail with the
  expected `AttributeError` against the pre-fix code (reverted via
  `git stash`, confirmed red, restored via `git stash pop`, confirmed
  green).
- Full 6-item regression check: frontend `vitest run` **219/219 files,
  1069/1069 tests**; `bench build`/`bench migrate` N/A (pure Python
  logic, no frontend/doctype/fixture/print-format file touched);
  security review N/A — `_inline_stylesheet_links()`'s local path comes
  entirely from Frappe's own internally-generated `<link>` tag, never
  from invoice/customer/user-controlled data, same trust model as the
  Frappe core code it mirrors; `_generate_receipt_pdf()`'s reachability
  (scheduler-only, non-whitelisted) is unchanged by this diff.

**Follow-up, resolved:** reviewed and cherry-picked to `stable` as
`07fe8f9`, deployed to production the same night as part of the full
rewards-site rollout — see section 25.

## 25. Rewards portal live on production: full rollout, both PDF fixes deployed, end-to-end verified (2026-08-17)

The separate-site production deployment explicitly deferred back in
section 20 ("not started") happened tonight, start to finish: the
rewards site is now live at `rewards.swan-intl.com`, the sync bridge and
both receipt-PDF fixes are deployed, and every piece of the portal has
been confirmed working against real production data.

**Site stood up.** `swan_rewards` deployed to production as its own new
site (`rewards.swan-intl.com`) on the same bench as `site1.local` —
bare Frappe, no ERPNext/POS Awesome installed, same decoupled shape as
staging. DNS, SSL (Let's Encrypt), and nginx multi-domain config all set
up for the new site alongside the existing `e.swan-intl.com`.

**Incident, same night, no lasting impact:** regenerating nginx's config
for the new site briefly broke `e.swan-intl.com`'s own SSL certificate.
Caught and fixed the same night. Worth remembering as its own standing
caution: adding a new site's nginx/SSL config on a shared bench can
affect *existing* sites' certs, not just the new one — always verify
every existing domain still serves correctly (not just the new one)
after a bench-wide nginx regeneration, e.g. `bench setup nginx` /
`bench setup lets-encrypt`. See CLAUDE.md.

**Sync bridge promoted and deployed.** Section 22's `375635e` (already
on `stable`) pulled and deployed to production: `bench pull`,
`bench migrate`, service restart. `Rewards Sync Settings` on production
configured with real credentials (`rewards_site_url`, `api_key`,
`api_secret`) via the Desk UI — resolving section 22's open item.

**Both receipt-PDF fixes deployed same night**, each following the
established cherry-pick-to-stable-then-deploy sequence used all session:
- Fix 1 (section 23 → `160db7d`/`261c6f3`): `frappe.local.site` →
  `127.0.0.1` for wkhtmltopdf's `base_url`. Resolved the DNS
  `HostNotFoundError` completely — confirmed no longer occurring on
  production after deploy.
- Fix 2 (section 24 → `7237bd4`/`07fe8f9`): eliminated the live
  self-referencing fetch of Frappe's own `print.bundle.css` during PDF
  generation, inlining its content from local disk instead. Resolved the
  `ContentNotFoundError` that surfaced under real production batch load
  after Fix 1 went live.

**End-to-end verified live on production**, not just deployed-and-hoped:
customer sync, loyalty points balance, activity feed, store locations
("Visit Us" section — resolving section 23's Issue 1, confirming it
really was the suspected data gap rather than a code bug once real Shop
`Address` records existed on production), and receipt PDF view/download
all confirmed working against real production data.

**Known open items for next session** (both real, both non-blocking —
the portal is fully functional, these are polish):
- **Mobile UX bug — resolved, see section 27.** The guessed cause here
  (a missing `Content-Disposition: inline` header) turned out to be
  wrong — that header was already being sent correctly; the real cause
  was that the frontend never let the browser see it at all.
- **Portal reload UX bug — resolved, see section 27.**

## 26. "Deadlock Occurred" warning fixed: backend retry + frontend defense-in-depth (2026-08-18)

The rare, intermittent "Deadlock Occurred" message during partial-payment
sales — investigated and confirmed harmless back in section 4's deferred
bullet (no duplicate-invoice risk, just a scary-but-cosmetic error gap) —
got fixed once the deferred threshold ("staff actually complain") was hit.
Not reliably reproducible on demand, so verified by reasoning through the
exact code path and simulating the failure directly, same as the original
investigation.

**Backend — the actual fix.** `_save_submission_ledger()`
(`invoice_processing/creation.py`) now retries its `insert()`/`save()`
call through a new `_save_ledger_with_lock_retry()`, catching both
`TimestampMismatchError` and `frappe.QueryDeadlockError`, bounded at 2
retries (matching `_save_draft_with_latest_timestamp`'s own limit for
the invoice doc's own save). A deadlock rollback leaves nothing partially
committed, so simply re-running the same call is correct with no state
adjustment needed; `TimestampMismatchError` does need the doc's
`modified` timestamp refreshed from the DB first, or an identical retry
would just fail identically again — no full field-by-field merge needed
here though, unlike the invoice doc's own retry, since only the ledger's
own bookkeeping fields are ever written back, not a rich, independently
editable document. The original branching logic deciding insert-vs-save
is untouched — only the actual mutation calls got wrapped, so the happy
path (no lock conflict, the overwhelming majority of saves) is
byte-for-byte identical to before: `operation()` called once, returns
immediately. This is genuinely where the deadlock originates and where
retrying transparently resolves it — the cashier should see nothing at
all in the vast majority of cases this fixes.

**Frontend — defense-in-depth, with an important caveat found while
implementing it.** The original investigation recommended extending
`classifyBusinessCode()` (`api.ts`) to recognize deadlock/508 text, so
the existing "check if it actually succeeded" recovery path
(`usePaymentSubmission.ts`, previously line 1410) would fire for this
error the same way it already does for `TIMESTAMP_MISMATCH`. Implemented
this (new `DEADLOCK` code, kept distinct from `TIMESTAMP_MISMATCH` so
logs/telemetry can still tell the two apart even though the recovery
handling is identical for both) — **but tracing the actual request path
precisely (not assumed) surfaced something the original investigation
didn't have**: POS Awesome's submission flow calls `frappe.call()`
(Frappe's own RPC wrapper, not a raw `fetch()`), and Frappe's
`request.js` has an `exception_handlers` map keyed by `exc_type`,
declared as a `var` *local to* `frappe.request.call()`'s own function
body — not exposed for external override. Its `QueryDeadlockError` entry
shows Frappe's own native "Deadlock Occurred" `msgprint` dialog and then
`return`s immediately, **before** `opts.error_callback` (which is what
feeds into `classifyBusinessCode`) ever runs. So for the specific raw
dialog staff have been seeing, the frontend classification change alone
would not have suppressed it — confirmed by reading `request.js`'s
`.fail()` handler line by line, not by guessing. Implemented the
frontend change anyway: it's low-risk, purely additive, doesn't touch
any existing classification, and does help for the rare case a
retry-exhausted deadlock reaches the client, or any other call path that
surfaces this text without going through `frappe.call()`. Also added a
calm, on-brand `DEADLOCK`-specific toast (`buildSubmissionFailureToast`)
for the true residual case — retries exhausted *and* the recovery check
confirms it genuinely wasn't submitted — replacing what would otherwise
have been the raw exception text as the toast title.

**What wasn't attempted, and why.** Suppressing Frappe's own native
"Deadlock Occurred" dialog directly (e.g. monkey-patching
`frappe.request.call` or switching the submission transport away from
`frappe.call()` entirely) was considered and rejected as disproportionate
— a much larger, more invasive change than a UX-level fix warrants, for
a residual case the backend retry should make rare. Flagged plainly
rather than either silently skipping it or building something invasive
without checking in first.

**Confirmed purely cosmetic, no transaction-flow change**: the backend
diff only wraps existing mutation calls in a retry loop (verified the
happy-path call sequence is unchanged by inspection); the frontend diff
only adds new branches inside existing `catch` blocks and a new toast
variant — the `try` block's success-path code (lines ~1370-1397 of
`usePaymentSubmission.ts`) is untouched by this change.

**Verified**, since this can't be reliably triggered on demand:
- Backend: `test_creation.py`'s `TestInvoiceIdempotency` gained 4 new
  tests, **directly simulating the deadlock condition** (not attempting
  a live repro) — a `save()` mock raising `frappe.QueryDeadlockError` on
  the first call, succeeding on retry, confirming the caller never sees
  it; the same for `TimestampMismatchError`, additionally confirming
  `modified` is refreshed from the DB between attempts; a bounded-retry
  exhaustion test confirming it's not an infinite loop and the original
  exception type still propagates once retries run out; and a scoping
  test confirming an unrelated real error (a plain `ValueError`)
  propagates immediately on the first attempt, never retried — the
  explicit "don't swallow real errors" check. All 5 `_save_submission_ledger`
  tests pass (68 total in the module; 8 pre-existing, unrelated failures
  found and confirmed identical on the unmodified file before touching
  anything — a stale `mode_of_payment` fixture gap in
  `TestStaleNamedInvoiceHandling`/`TestUpdateInvoiceReturnPayments`, not
  caused by or related to this fix). Also found and fixed a separate,
  unrelated pre-existing gap blocking the *entire* test file from running
  at all: the stub for `posawesome.posawesome.api.payments` was missing
  `get_available_credit`, which `creation.py` already imports — a one-line
  additive stub fix, confirmed via isolated testing that this exact
  ImportError already existed on the untouched file before any of this
  session's changes.
- Frontend: `apiEnvelope.spec.ts` gained 3 new tests (deadlock text →
  `DEADLOCK` code; lock-wait-timeout text → `DEADLOCK` too; an unrelated
  business error still classifies as `BUSINESS_RULE`, confirming the new
  branch isn't overly broad). `usePaymentSubmission.spec.ts` gained 2 new
  tests: a `DEADLOCK`-coded failure where the recovery check confirms
  `docstatus === 1` resolves silently with the calm "already submitted"
  toast and `recovered: true`, never the raw error; a `DEADLOCK`-coded
  failure where the recovery check confirms it genuinely wasn't submitted
  still throws (never silently swallowed) but with the new calm toast
  title instead of the raw `QueryDeadlockError` text.
- All new tests verified as genuine regression guards: reverted the
  fix, confirmed real failures (4 backend, 4 frontend), restored,
  confirmed green.

**Full regression check**: frontend `vitest run` **219/219 files,
1074/1074 tests**. `bench build --app posawesome`: clean, exit 0
(`.ts` files touched). `bench migrate`: N/A — no doctype, fixture, or
print-format file touched, only `.py`/`.ts` logic. Security review:
N/A — no new user input, authorization, or data-access surface. The
backend change retries an already-authorized, already-reviewed internal
operation (`ledger_doc.insert`/`.save`, already `ignore_permissions=True`
before this change) on a narrow, specific pair of transient DB
exceptions; the frontend change is pure error-message classification
(string matching, no `eval`/`innerHTML`) plus reuse of the *existing*
`fetchSubmittedDocstatus` verification call, scoped to the same
invoice already in flight for this submission, not a new query surface.

**Follow-up, resolved:** reviewed and cherry-picked to `stable` as
`2dd1589`, deployed to production the same day — a genuine,
staff-reported production issue, low-risk (retry-only on the happy
path, purely additive on the frontend) and fully covered by tests that
directly simulate the failure condition.

## 27. `swan_rewards`: mobile View/Download bug fixed, reload persistence added (2026-08-18)

Both of section 25's "known open items" resolved this session. Both
changes are entirely within `swan_rewards`' own repo (`swan-rewards-portal`,
`main` branch) — no `posawesome` code touched — documented here per this
project's standing convention of keeping the companion app's history
with the main site's docs.

**Mobile View/Download bug (`c463002`).** Diagnosed against real
production behavior first, not assumed: "View" and "Download" both
worked correctly on desktop Chrome but both downloaded on mobile
Chrome. Confirmed via `curl` that the server was already sending the
*correct*, different `Content-Disposition` header for each mode
(`inline` vs `attachment`) — the section 25 guess (a missing header)
was wrong. The real cause: `viewReceipt()`/`downloadReceipt()` both
fetched the PDF via `fetch()` + `.blob()`, then reconstructed a *fresh*
`Blob` client-side and either triggered `<a download>` or navigated a
new tab's `.location` to a `blob:` URL — meaning the server's
`Content-Disposition` header was never actually consulted by the
browser at all, on either platform. Desktop Chrome reliably renders a
`blob:` URL PDF inline regardless; Chrome for Android does not — a
platform gap, not a header bug.

Fixed by switching `viewReceipt()` to a real hidden
`<form method="POST" target="_blank">` submission instead of
`fetch()`+blob, so a genuine top-level browser navigation lets the
browser's native inline-PDF handling take over using the server's
*actual* `Content-Disposition: inline` header — the standard mechanism
every browser already supports for real navigations, unlike `blob:`
URLs. `downloadReceipt()` untouched, already worked correctly on both
platforms.

Since `mode="view"` now reaches the server via a real navigation rather
than `fetch()`, a failure (bad credentials, no receipt, rate limited)
would otherwise show Frappe's raw JSON/stack-trace error page in the
new tab. `receipt.py`'s `get_receipt()` restructured (rate-limited
logic split into `_fetch_receipt()`) so `mode="view"` catches
`DoesNotExistError`/`TooManyRequestsError` and returns a small on-brand
HTML page instead (same palette as `index.html`) — generic about which
check failed, preserving the endpoint's existing non-disclosure
property (wrong-mobile, wrong-code, and wrong-invoice-ownership all
render identically; verified with a dedicated test). `mode="download"`
re-raises unchanged, still handled by the existing `fetch()`
`.catch()`.

Verified end-to-end via `curl` using real form-urlencoded POST bodies
(exactly what the new `<form>` sends) against real staging data:
view success returns the inline PDF, view failure returns the branded
404 page, download success/failure both confirmed byte-for-byte
unchanged from before. A real rendering browser wasn't available in
this environment (Playwright installs but is missing system shared
libraries, no root to install them) — desktop non-regression rests on
`Content-Disposition: inline` over a real navigation being the
standard mechanism every browser already relies on, not a
screenshot-verified click-through; flagged as worth a quick manual
check. New backend tests (`test_receipt.py`'s `TestViewModeErrorPage` —
the branded-error-page path specifically, including that an unexpected
exception is *not* swallowed and `mode="download"` is completely
unaffected), verified as genuine regression guards.

**Reload persistence (`b5e8b2e`).** Reloading right after a successful
lookup previously reset to the empty form every time — no way back
without re-entering both fields. On a successful lookup, `mobile_no` +
`portal_code` (nothing else — not the points balance, not invoices,
nothing beyond what's needed to redo the exact same lookup) are saved
to `sessionStorage`, never `localStorage` and never a server-side
session/cookie: scoped to one tab, cleared automatically when the tab
closes. On page load, a saved pair triggers the *same real lookup
request* automatically rather than rendering a stale cached blob, so a
points-balance change since the last visit still shows up correctly.
"Check Another Number" now also clears `sessionStorage`, on top of what
it already reset. A failed auto-restore (credentials no longer valid)
clears the stale entry too, so it doesn't keep failing on every future
reload; a transient failure (rate-limited, network hiccup) leaves it
alone since a retry may still succeed.

Doesn't change the actual authentication model at all — `mobile_no` +
`portal_code` remain the only credential, same "shared secret" already
required for every lookup regardless of this change. One real,
honestly-stated tradeoff: on a shared/public device where the tab is
never closed between two different people, a reload now shows the
previous person's data again (before this change, a reload reset to
the empty form) — that risk already existed for in-memory JS state
before any reload was even involved; "Check Another Number" remains the
explicit way to clear it before handing off a shared device.

Verified with a real, executable `jsdom`-driven test (loads the actual
`index.html`, mocks `fetch`, drives real DOM events) rather than just
reading the code, since no headless browser was available — 17 checks
covering the exact manual flow (fresh lookup → simulated reload → same
data restored automatically with exactly one re-verification request;
Check Another Number → simulated reload → empty form, zero lookup
requests made), plus edge cases (stale-credential cleanup, storage
holding exactly the 2 intended fields and nothing more). Verified the
test suite actually catches a regression: reverted the change,
confirmed a real failure, restored, confirmed green.

**Both deployed to production.** Full regression check for each: no
frontend build step exists for this app (static HTML, no bundler) —
verified via `node --check` plus the live `curl`/`jsdom` tests above.
Backend Python tests (isolated-import harness, no live DB needed):
39/39 passing after the receipt fix. Security review for both: no new
user input, authorization, or data-access surface — the receipt fix's
branded error page never echoes any raw request input into its HTML
(no reflection risk); the reload-persistence fix stores nothing more
sensitive than the same credential pair already required for the
lookup it's persisting.

## 28. POS layout fix: three rounds, real-browser measurement required (2026-08-18)

Staff on lower-res store PCs saw the Invoice Items table cut off (Amount/Actions
columns), forcing horizontal scroll. Took three rounds to actually fix.

**Round 1 — the original ask.** Fixed the left/right panel split ratio at the
`md`/`lg` breakpoints, added graduated (priority-ordered) column-hiding instead
of a flat hide-everything cliff, and made Discount %/Discount Amount required
columns (staff use them regularly, must never hide). Deployed, confirmed
working at the originally-reported widths.

**Round 2 — reverted.** Extended the compact/stacked layout threshold to
1300px to close a remaining gap (~1100-1272px). Technically worked but was
rejected: staff lose the side-by-side search+cart view and have to tab between
panels, unacceptable for the checkout flow even though the numbers closed.
Reverted with a clean `git revert` (history intact, not a reset/force-push) —
`6044083` (develop-swan) / `eb88c2f` (stable).

**Round 3 — the real fix, and a real lesson.** A live 1280px store PC still
showed the cutoff after a follow-up attempt that widened the split ratio
instead of stacking. Investigation found Rounds 1-2's whole diagnostic
approach — computing required column widths by reading CSS files and doing
arithmetic — was unreliable in three concrete, previously-undiscovered ways:
1. Vuetify ships its own `.v-table > .v-table__wrapper > table > tbody > tr >
   td { padding: 0 16px; }`, which beat the app's own padding rule on
   specificity alone — the Round 1 padding fix had silently never applied.
2. The table used `table-layout: auto`, so a column's real width followed
   whichever was wider — the header **label text** or the cell content — not
   any configured min-width. A long label like "Discount Amount" alone forced
   its column wide regardless of config.
3. Widening the split ratio pushed the container width across a
   compact-density CSS breakpoint, loosening padding right when trying to buy
   back space.

Real measurement (a real headless browser against a real running build, not
estimates) showed the table needed **1007px**, not the assumed 768px — the
true broken range was ~1100-1360px, wider than ever diagnosed.

The actual fix: `!important` on the padding rule (to win the specificity
fight), `table-layout: fixed` (so configured widths are finally authoritative),
trimmed column min-widths, **lowered `item_name`'s width ratio from 0.3 to
0.14** (the key fix — this alone made the *existing* split ratio sufficient
everywhere, so the selector panel never had to narrow at all), a modest
font-size reduction for cramped tiers only, shortened header labels
("Discount %"→"Disc %", "Discount Amount"→"Disc Amt", "Actions"→icon-only —
a deliberate, permanent, visible change, since Vuetify's flex-based header
wrapper doesn't render `text-overflow: ellipsis` cleanly), and raising the
compact-density threshold to 1000px.

Verified via a real headless browser (Playwright/Chromium) driving the actual
running site with a real cart item, tested at every 50px step from 1100px to
1920px window width — zero horizontal overflow anywhere. Deployed to
production and confirmed working live on the original problem store PC.

See `CLAUDE.md`'s "Layout Fixes on Vuetify Tables Need Real Browser
Measurement" for the reusable lesson.

## 29. Payment box refocus overwrite + preferred-box direct-edit rebalance gap (2026-08-20)

### Background

This continues a 3-bug payment-screen audit (bugs #1-#3 below) done in a prior
session. That session was lost before its findings were written down anywhere
in this file or `CLAUDE.md` — only bug #1's already-verified-working fix
survived, sitting uncommitted in the working tree, confirmed still present at
the start of this session. Bug #2's description (below) matches exactly what
this session built from the approved design, carried over in the handoff
prompt. **Bug #3's description below is reconstructed from reading the
codebase this session, not from the original audit note — the original
wording didn't survive, so if it resurfaces, sanity-check this description
against whatever prompted the original finding.**

**Bug #1 — refocus silently overwrote a manually-typed amount. Fixed.**
`set_rest_amount()` (called on box focus to helpfully fill in "what's left")
recomputed and overwrote the amount unconditionally, even when the box
already held a deliberately-entered value (manually typed, or auto-filled
and left as-is). Fixed by guarding on the existing `hasMeaningfulAmount()`
helper (exported from `paymentInitialization.ts`) before recomputing —
`usePaymentMethods.ts`'s `set_rest_amount` now returns early if the box
already carries a meaningful amount. Verified live in the browser before
this session started; this session confirmed the fix was still present,
uncommitted, in the working tree, with its 3 tests already in
`usePaymentMethods.spec.ts`.

**Bug #2 — dead `autoBalancePayments()` safety net, never wired into
checkout. Fixed this session.** `handlePaymentAmountChange()` already trued
up the preferred payment line when a *non*-preferred box was edited
(`rebalancePreferredPaymentCoverage()`), but had no counterpart for the
reverse: directly editing the preferred box itself left the other boxes
untouched, so the total could silently drift out of sync with the invoice.
`autoBalancePayments()` existed in `usePaymentMethods.ts` (already used by
`PurchasePaymentDialog.vue`) precisely to correct this kind of excess, but
was never wired into the main checkout payment flow — a dead safety net.

Fix: added an optional `sortOthers` comparator param to `autoBalancePayments()`
(default unchanged — amount-descending); added `Payments.vue` state tracking
the order in which the cashier has directly edited each payment box
(`paymentEditSequenceCounter` / `lastEditedPaymentSequence`, bumped only in
`handlePaymentAmountChange`, i.e. only for genuine UI-driven edits, never for
programmatic rebalances; reset when a new invoice loads into the dialog via
the `send_invoice_doc_payment` handler); added
`rebalanceOtherPaymentsByRecency()`, gated the same way as
`rebalancePreferredPaymentCoverage()` (skip for returns and credit sales),
which calls `autoBalancePayments()` with a recency comparator that reduces
the least-recently-edited/never-touched box first — so a box the cashier
just typed into elsewhere isn't immediately clobbered by the rebalance.
Wired into `handlePaymentAmountChange`'s previously-empty
`payment === preferredPayment` branch. Reuses the same credit-aware
`getNetInvoiceAmount()` path `autoBalancePayments()` already had, so it
balances against the net (credit-adjusted) settlement amount, not the gross
total — covered by a dedicated test. `autoBalancePayments()` is no longer a
dead safety net: it's live in both `PurchasePaymentDialog.vue` and, as of
today, the main checkout `Payments.vue` flow.

**Bug #3 — multi-"cash"-named-payment-method validation gap. Still open, not
fixed.** `isCashLikePaymentLine()` (`frontend/src/posapp/utils/cashTender.ts`,
lines 21-38) identifies "the" cash line via `mode.includes("cash")` — a plain
case-insensitive substring match on `mode_of_payment`, with no
dedup/disambiguation if a POS Profile configures more than one payment method
whose name contains "cash" (e.g. "Cash" + "Petty Cash" + "Cash on Delivery").
`resolvePreferredPaymentLine()`, `rebalancePreferredPaymentCoverage()`,
today's new `rebalanceOtherPaymentsByRecency()`, and the quick-cash-tender
denomination suggestions (`getQuickCashTenderSuggestions()`, same file) all
funnel through this one heuristic, so all of them would inherit whatever
ambiguity multiple matches created — most likely picking whichever line
happens to be `default: 1` or appears first, silently, rather than validating
there's exactly one true cash line. No store on this fork is currently
configured with more than one cash-like-named payment method, so this hasn't
surfaced in production. Not investigated further or fixed this session — see
the caveat above about this description's provenance.

### Deferred / open items for next session

- **Bug #3 above** (multi-"cash"-named-method validation gap) — not fixed;
  needs its own investigation starting from `cashTender.ts`'s
  `isCashLikePaymentLine()`, plus confirmation of what the original audit
  actually found, if that can be recovered.
- **Credit-forced-after-fill gap (explicitly out of scope this session):** a
  different gap from bug #2, where payment boxes are filled first and
  customer credit only becomes *newly forced* afterward (via the existing
  credit-eligibility watcher in `Payments.vue`, a separate code path from
  `handlePaymentAmountChange`) can leave Cash/other boxes over-target with
  nothing correcting them. Not built in this session — the credit-eligibility
  watcher would need its own rebalance call (likely reusing
  `autoBalancePayments()`/`rebalanceOtherPaymentsByRecency()`), but that
  watcher's trigger conditions and interaction with
  `is_credit_sale`/`is_return` need their own investigation before changing
  it.

  **Verification status (2026-08-24): manually spot-checked on staging by
  the user, did NOT reproduce — but not fully proven across all variations
  yet. Treat as still open, revisit later, not urgent.** The user's manual
  repro: filled Cash=20, Master Card=5, added a second item to push the
  total up, then toggled "Use Customer Balance" ON (after crossing the
  credit threshold, never passing through a blocked state first). Result:
  credit applied (97.20), Cash/Master Card stayed at 20.00/5.00 unchanged,
  Visa (preferred) correctly absorbed the exact remainder (65.70), total
  matched the invoice exactly, no change due, submit worked normally — no
  bug in that run.

  A separate live-repro attempt earlier the same session (via a live
  Playwright session against staging, using a purpose-built test customer
  with a real 30 OMR credit balance) independently confirmed bug #2's fix
  works live through the point where boxes are manually filled while credit
  is toggled ON but blocked (Cash=10 → Visa auto-drops 25→15; Master
  Card=15 → Visa auto-drops to 0), but could not reach the actual
  threshold-crossing step live (blocked by an unrelated finding: the test
  item showed Available QTY=0 in the POS item search and the frontend
  clamped any qty increase back to 0, even though the item is a non-stock
  service item — noted below as a possible separate issue, not chased
  further). So the "does this actually manifest" question for steps 6-10
  of that plan was answered by the user's manual test instead, not by that
  live-repro attempt.

  Why these two don't necessarily contradict each other: the code path
  (`rebalancePreferredPaymentLine()` in `paymentInitialization.ts`) only
  ever adjusts the *preferred* box, computed as
  `invoiceTotal - coveredAmount(credit+loyalty+giftcard) - otherPaymentsTotal`,
  clamped to a minimum of 0. The gap can only actually produce an
  over-target total when `otherPaymentsTotal + coveredAmount > invoiceTotal`
  (i.e. the preferred box would need to go negative to balance, but clamps
  to 0 instead, leaving the excess on the other boxes). In the user's run,
  `otherPaymentsTotal (25) + credit (97.20) = 122.20`, well under the
  invoice total (187.90) — Visa had room to absorb the difference cleanly,
  so the clamp-to-0 case was never triggered. The scenario most likely
  still needs the *other* boxes to already be filled close to (or above)
  what's left once credit is factored in — closer to the original
  live-repro's numbers (Cash 10 + Master Card 15 = 25 against a
  credit-reduced remainder of 20) than the user's (25 against a
  credit-reduced remainder of 90.70). Next attempt should deliberately
  construct that tighter-margin case rather than an arbitrary second item.

- **Possible separate finding, not investigated:** during the live-repro
  attempt above, a non-stock service item (`is_stock_item = 0`) showed
  "Available QTY: 0" in the POS item search UI, and typing a cart qty above
  0 for it was clamped back to 0 client-side with the toast "Maximum
  available quantity is 0.00. Quantity adjusted to match stock." — i.e. a
  stock-availability ceiling was enforced against an item that shouldn't be
  stock-constrained at all. Could be specific to that one item's setup
  rather than a general bug; not confirmed either way, not investigated
  further this session.

### Status

Built, tested, and **committed to `develop-swan`**: docs in `7f4f82b`, code
(bug #1 fix + bug #2 fix, 6 new/updated tests across `usePaymentMethods.spec.ts`)
in `6ac45e5`. **Not yet promoted to `stable`** — full regression check passed
(frontend suite 225/225 files, 1119/1119 tests; `bench build --app posawesome`
clean) and bug #2's fix has since been partially confirmed live on staging
(see the verification note above), but this has not gone through this fork's
full "prove it on staging, then promote" cycle the way other payment changes
have (see e.g. section 26, section 28) — the credit-forced-after-fill
follow-up above is still open. Do not assume this is in production.

**Superseded by section 30 — `6ac45e5` was promoted to `stable`/production
the same day, and a real regression was found there. See below.**

## 30. Bug #2's fix promoted, found broken in production, corrected, reverified live (2026-08-24 → 2026-08-25) — RESOLVED

**Promotion.** `6ac45e5` (bug #1 + bug #2 fixes) cherry-picked cleanly onto
`stable` as `9406b79` (diff verified byte-identical), full regression check
re-run on `stable` (225/225 files, 1119/1119 tests; `bench build --app
posawesome` clean), pushed to GitHub. Both `develop-swan` (`7f4f82b`,
`6ac45e5`, `83c7b68`) and `stable` (`9406b79`) pushed to `upstream` the same
session. Production-side steps handed to the user to run themselves (`bench
pull` / `bench migrate` N/A / `bench build --app posawesome` / `bench
restart`) — not run by this session.

**Regression found live, by the user, on both staging and production.** After
deploying, the user tested the exact scenario bug #2 was built for and found
it **half-broken**: editing a non-preferred box still correctly rebalances
the preferred box (bug #2's originally-tested direction, still fine), but
**editing the PREFERRED box directly down** left the other box "stuck at its
old value," producing an incorrect change-due. Confirmed identically on both
staging and production, ruling out a caching/service-worker artifact.

**Root cause, confirmed by reading `autoBalancePayments()`
(`usePaymentMethods.ts`) closely — not by guessing:** the function had
exactly one branch, `if (excess > 0)`, which shrinks other payment boxes when
an edit creates an overpayment. **There was no corresponding branch for a
deficit** (an edit that leaves the invoice short). `rebalanceOtherPaymentsByRecency()`
(`Payments.vue`) calls this function unconditionally whenever the preferred
box is edited directly, so decreasing the preferred box's value hit the
missing branch and did nothing — an asymmetry `rebalancePreferredPaymentCoverage()`
(the original, pre-existing mechanism for the *other* direction) doesn't
have, since it always recomputes the preferred box's amount as `total −
covered − others`, which naturally goes up or down. The new code added this
session only ever shrank; it never grew.

This session's own live-repro and unit tests never caught it because both
only exercised the excess (preferred-box-increased) direction — a real gap
in this session's own test coverage, not just the implementation.

A live-repro attempt to confirm the exact failure mode directly (rather than
trusting the code read alone) hit the same terminal-lock/browser-automation
friction as section 29's attempt and was time-boxed and abandoned per the
user's explicit instruction, in favor of a careful code read plus the user's
own report. The code-level diagnosis above was later confirmed correct by
the user ("Confirmed - this matches exactly what I saw").

**Fix (`392add7` on `develop-swan`):** added a symmetric deficit branch to
`autoBalancePayments()`. On a deficit, it adds the shortfall onto a single
other payment line (same `sortOthers` priority order as the excess direction
— e.g. least-recently-edited first via `rebalanceOtherPaymentsByRecency`'s
comparator), rather than spreading it across several boxes: growth has no
natural per-box cap the way shrinking toward zero does, so one clear target
keeps the result predictable. 4 new tests added (`usePaymentMethods.spec.ts`,
19 tests total in that file now): default-sort growth, custom-comparator
growth, the exact production scenario (preferred box edited down after
credit applied, two other boxes filled at different times — the
least-recently-edited one grows to absorb the shortfall, credit-adjusted net
total respected), and a no-other-payment-line no-op safety check.

**Live-verified by the user on staging, both directions (increasing and
decreasing the preferred box) — correct behavior confirmed both ways.**
Per the user's explicit request, no further automated live-repro attempts
were made from this session given the repeated browser-automation friction
(unlock-dialog/terminal-lock flakiness) hit on both this bug and section 29's
credit-gap investigation — the user verified live themselves instead.

**Promoted.** Cherry-picked onto `stable` as `45525cb` (diff verified
byte-identical to `392add7`), full regression check re-run on `stable`
(225/225 files, 1123/1123 tests; `bench build --app posawesome` clean),
pushed to GitHub (`9406b79..45525cb`). `develop-swan` also pushed
(`83c7b68..d4ec59a`). **Docs commits (`7f4f82b`, `83c7b68`, `d4ec59a`) were
deliberately NOT cherry-picked to `stable`**, per this fork's standing
convention that each branch narrates its own promotion story in its own
`PROGRESS_NOTES.md`/`CLAUDE.md` — only the code commits (`6ac45e5`→`9406b79`,
`392add7`→`45525cb`) went to `stable`.

Production-side deployment (pull / `bench build --app posawesome` — required,
frontend files changed / `bench migrate` — N/A, no doctype/fixture/print-format
touched / restart) run by the user themselves, same pattern as every other
promotion this fork.

**Deployed and verified live on production.** The user confirmed both
directions of bug #2's fix (increasing and decreasing the preferred payment
box) working correctly on the actual production server, not just staging or
`stable`/GitHub. Bug #1 and bug #2 are both fully closed as of 2026-08-25 —
built, tested, promoted, deployed, and live-verified on production. Only
open items remaining from this whole payment-screen arc are bug #3
(multi-"cash"-named-method validation gap) and the credit-forced-after-fill
gap, both still documented-only, not built (see section 29's "Deferred /
open items" for both).

## 31. Generic-customer store-credit leakage: real gap found and fixed (2026-08-25)

**The concern, raised by the user.** `posa_is_generic_customer` (section 19,
`72fc12e`) was built to flag shared/anonymous customer records (e.g.
"Anonymous", used across many unrelated walk-in sales) so loyalty
points/portal codes don't pool onto them. The user asked, urgently: does
that protection extend to store credit too? Scenario -- a customer buys
under "Anonymous", returns it weeks later, staff finds the original
invoice for the return (auto-populating the return's customer field to
match -- "Anonymous" again), and under this store's credit-only return
policy (`posa_returns_credit_only`, section on "Enforce credit-only
returns"), that return issues store credit to "Anonymous" -- redeemable by
any future stranger selected as the same shared account. Real money, not
a cosmetic loyalty gap.

**Verified, not assumed.** Traced the entire `posa_is_generic_customer`
usage surface (every reference in the codebase): its only effect is
clearing `loyalty_program`/`posa_loyalty_portal_code` in
`customer.py`'s `ensure_loyalty_portal_code()`, plus excluding generic
customers from the rewards-portal sync job. **Zero references anywhere in
the Sales Invoice/return/credit submission pipeline.**
`get_available_credit()` (`payments.py`) filters purely by customer name --
confirmed it treats a generic customer's pooled negative-outstanding
invoices exactly like a real individual's, no special-casing at all.
Confirmed live on staging (`bench console`): two customers flagged
generic ("Anonymous", "anno"), neither currently pooling credit *on
staging* -- doesn't rule out production, which this session has no direct
access to check (flagged back to the user as a manual follow-up, see
below). Confirmed the exact trigger path live in code:
`Returns.vue:774`, `invoice_doc.customer = return_doc.customer;` --
unconditional, matching the user's description exactly.

**First proposed fix was wrong -- caught before building, by tracing
precisely instead of assuming.** Initial idea: block the credit-issuing
return and have staff swap in a newly-created real customer. Traced
precisely why this can't work: ERPNext core
(`erpnext/controllers/sales_and_purchase_return.py`'s
`validate_return_against()`, called from `AccountsController.validate()`
on *every* save of a return, not just submission) hard-requires the
return's `customer` to exactly match `return_against`'s original
invoice's customer, throwing a "Party Mismatch" error otherwise. There is
no way to keep the `return_against` link and attribute the return to a
different customer. Confirmed this app already has a working, built
escape hatch for exactly this shape of problem -- **"Return without
Invoice"** (`posa_allow_return_without_invoice`, `Returns.vue`'s
`return_without_invoice()`), which never sets `return_against` at all.
The user tested this live and confirmed it works correctly (credit
issued to the real customer, items/stock handled properly).

**The actual fix, built:**
1. **Server-side guard (authoritative)** --
   `_guard_generic_customer_stored_credit()`, a new sibling function next
   to the existing `_guard_return_cash_refund()` in
   `invoice_processing/creation.py`, called from the same call site
   (`_normalize_return_payment_rows`) with the same timing (only at
   genuine final submission, never during draft-save/cart-building --
   verified against all 5 call sites of `_normalize_return_payment_rows`
   in the file). Throws when: `is_return`, `return_against` is set, the
   return would leave nonzero credit (`abs(paid_amount) < abs(grand_total)`,
   with a precision-based tolerance), and the customer is
   `posa_is_generic_customer`. Message points staff at "Return without
   Invoice" by name.
2. **`get_invoice_for_return()`** (`invoice_processing/returns.py`) now
   returns a `posa_customer_is_generic` field so the frontend can steer
   staff early, before they fill out a whole return.
3. **Client-side guards (defense-in-depth, matches this codebase's
   established pattern)** -- added at **both** real entry points that set
   a return's customer from the original invoice (only one was
   originally named; grepping found a second, independent one):
   `Returns.vue`'s `submit_dialog()` (line ~774) and
   `InvoiceManagement.vue`'s `createReturn()` (line ~3749). Both block
   immediately and toast the same guidance the moment
   `posa_customer_is_generic` comes back true, before building the return
   invoice at all -- deliberately unconditional on the credit-only policy
   setting (matches what was asked; the authoritative server-side check is
   the one that's precisely conditioned on whether credit would actually
   result).

**Tests.** Backend: 8 new tests in
`test_return_generic_customer_credit_guard.py`, covering both directions
(blocks / doesn't block) across every branch -- non-return, draft-save
timing, no-`return_against`, full-cash-refund, non-generic customer,
zero-refund credit, partial-refund credit, and a precision-boundary case.
Frontend: `invoiceManagementGenericCustomerCreditGuard.spec.ts` (2 tests,
real component method invocation via `(InvoiceManagement as any).methods
.createReturn.call(context, ...)`, same pattern already established by
`invoiceManagementSupervisor.spec.ts`) -- passing. **`Returns.vue` itself
could not get the equivalent test** -- see the tooling finding below;
its guard is the same few lines as `InvoiceManagement.vue`'s (already
proven working) plus confirmed compiling correctly in the real
`bench build` output, but has no dedicated automated regression test.

**Tooling finding, worth knowing for any future frontend test work:**
Vitest bundles its own internal Vite (`node_modules/vitest/node_modules/vite`,
found at **5.4.21** in this repo) which is a full major version behind
the root Vite used for the real build (**6.3.5**). The older bundled Vite
does not resolve an import written with an explicit `.js` extension that
actually points at a `.ts` file (a deliberate, working TypeScript/bundler
convention this app uses **pervasively** -- 20+ files including
`Payments.vue`, `Invoice.vue`, `Pos.vue` import `stores/uiStore.js`/
`stores/invoiceStore.js` this way, and it resolves correctly in the real
build every time via the root Vite). Any *new* Vitest spec that tries to
mount one of those 20+ components for the first time will hit this same
"Failed to resolve import ... Does the file exist?" error --
`InvoiceManagement.vue` and a handful of others happen to already use the
bare-specifier style and so were never affected; `Returns.vue` was simply
the first of the `.js`-suffixed majority anyone tried to test-import.
**Not fixed this session** -- the real fix (aligning Vitest's transitive
Vite version with the root one) is a dependency change with broad blast
radius across the whole 226-file suite, out of scope for a security fix.
Normalizing individual files' import style away from the codebase's own
dominant convention was rejected as the wrong direction to fix it in.

**Full regression check:** backend module 8/8 (isolated,
`bench --site staging.local run-tests --module
posawesome.posawesome.api.test_return_generic_customer_credit_guard`);
frontend suite 226/226 files, 1125/1125 tests; `bench build --app
posawesome` clean (confirms `Returns.vue`'s real code compiles, despite
Vitest being unable to import it); `bench migrate` N/A (only `.py`/`.vue`
files touched). Security review: traced `frappe.db.get_value` usage (Frappe
ORM, parameterized, same pattern already used identically elsewhere in
this codebase -- not string-interpolated SQL); confirmed zero `v-html`
usage anywhere in the entire frontend (grepped), so the new toast messages
interpolating `customer_name` carry no XSS risk; confirmed the new
`posa_customer_is_generic` API field discloses nothing the caller doesn't
already have access to (`customer`/`customer_name` are already in the same
response); traced that a client attempting to submit a mismatched
`customer`/`return_against` pair is still safely caught by ERPNext's own
core `validate_return_against()` regardless of whether this new guard's
generic-customer condition happens to apply. Live-verified on staging via
`bench console` against the real "Anonymous" customer record: the guard
throws for it and does not throw for a real customer, using the actual
production code path (not mocked).

**Follow-up bug, found by the user's own live testing, fixed same day
(`2933f33`).** The user tested both client-side entry points live:
`InvoiceManagement.vue`'s worked correctly (exact guard message shown).
`Returns.vue`'s blocked the return correctly but instead of the guard
message, staff saw a raw JS error: "Cannot read properties of undefined
(reading 'show')". Root cause, confirmed by directly comparing
`Returns.vue`'s `setup()` against `InvoiceManagement.vue`'s working one
(not guessed): `Returns.vue` never called `useToastStore()` or returned
it from `setup()` at all -- unlike every other component in this app that
uses `this.toastStore`. **Every single `this.toastStore.show()` call in
this file was already broken before today**, including three pre-existing
ones (invoice-load error, "no returnable items", search error) -- nobody
had apparently ever reliably hit any of them before the new guard, which
staff now exercise routinely. Fixed by adding the same
`import { useToastStore } from "../../../stores/toastStore"` /
`useToastStore()` / return wiring `InvoiceManagement.vue` already has.
Live browser re-verification of this specific fix was attempted but
hit the same pre-existing terminal-lock/browser-automation friction
documented earlier in this same section and in `CLAUDE.md` -- stopped
per that same lesson rather than continuing to fight it; confidence
instead came from the direct side-by-side code comparison (not a guess)
plus a clean `bench build` and full frontend suite (226/226, 1125/1125).
**User spot-checked both entry points live themselves afterward and
confirmed both now correctly block with the proper guidance message --
no more JS error.**

**Promoted.** `248b473` and `2933f33` (the two code fixes; docs commits
`e1c79b2`/`5fe7050` deliberately not cherry-picked, per this fork's
per-branch-narrates-its-own-story convention) cherry-picked onto `stable`
as `0308161`/`41c9a57` (diffs verified byte-identical on every touched
file), full regression re-run on `stable` (backend module 8/8; frontend
suite 226/226 files, 1125/1125 tests; `bench build --app posawesome`
clean), pushed to GitHub (`45525cb..41c9a57`). `develop-swan` also pushed
(`051bfd3..5fe7050`).

**Deployed and verified live on production.** The user ran the
production-side deploy themselves (pull / `bench build` / restart) and
confirmed both return paths (Sales Return search, Invoice Management)
correctly block a credit-issuing return against the shared "Anonymous"
customer on the real production server, not just staging.

**Production credit-pooling check: done, resolved.** The user's own
earlier live testing of this exact flow (before today's fix went live)
had left 60 OMR of real store credit pooled on production's actual
"Anonymous" account -- confirming this session's staging-only check
couldn't rule out. The user found it, cancelled the test return invoice
that created it, and confirmed the balance is back to 0. Test residue
from verifying the bug, not a real customer's credit and not an ongoing
incident -- no further tracking needed. Bug #1 and bug #2 (section 30)
and this generic-customer credit gap (section 31) are all now fully
closed: built, tested, promoted, deployed, and live-verified on
production.

## 32. Loyalty points: business policy change to no-expiry, and a real bug caught before it shipped (2026-08-25)

**Business decision:** loyalty points no longer expire, going forward.
The user planned to set Loyalty Program "Swan Rewards" -> Expiry
Duration to 0 (or blank) to represent this.

**Caught before the change was made, by tracing the actual code path
instead of assuming:** `expiry_duration = 0` does **not** mean "never
expires" in ERPNext core. Traced `add_days(self.posting_date,
lp_details.expiry_duration)` (`sales_invoice.py:2164`) -- a duration of 0
sets a newly-earned point's `expiry_date` to the *same day it's earned*.
Traced further into the balance calculation itself
(`get_loyalty_details()`, `loyalty_program.py:78-79`, filters
`expiry_date >= today`): those points would show up in the customer's
balance for exactly one day and then silently vanish the next -- a real
loss of value, not a display bug. Blank isn't a legal alternative either
-- the DB column is `int(11) NOT NULL DEFAULT '0'`, confirmed live, so a
blank form field just becomes 0 too. Correct value for "effectively
never expires" (ERPNext has no first-class "unlimited" option): a very
large duration, **36500** (100 years).

**Downstream impact also traced, not assumed:** the rewards portal's
"X points expiring on [date]" warning (`swan_rewards`) is driven by a
live SQL query in `rewards_sync.py` for the nearest `expiry_date >=
today` across real `Loyalty Point Entry` rows, not by the Loyalty
Program setting directly. With `expiry_duration=0`, this would have
shown "points expiring today" continuously. With a large duration, it
would have shown a real-but-meaningless ~100-years-out date instead of
hiding cleanly. Since "no expiry" is now the actual business policy
(not a workaround to be hidden conditionally), the user asked for full
removal, not a conditional hide.

**Fix, both repos:**
- `posawesome` (`9d50717`): removed the nearest-expiry SQL query and
  `expiry_amount`/`expiry_date` fields from `rewards_sync.py`'s
  `_build_customer_payload()` entirely. Updated the module docstring's
  stated rationale for the daily full-refresh job (previously cited
  point expiry specifically; now cites general balance drift, e.g. a
  Loyalty Program `conversion_factor` change, which still applies).
- `swan_rewards` (separate repo, `github.com/somratsam/swan-rewards-portal`,
  `a80da89` on `main`): removed the feature end to end -- the
  `expiry_amount`/`expiry_date` fields (and their now-orphaned DB
  columns; confirmed `bench migrate` does not drop columns for fields
  removed from a DocType JSON, dropped them explicitly via `ALTER
  TABLE`, then reconfirmed a second `bench migrate` stayed clean/didn't
  recreate them) on `Rewards Customer`, the storing logic in `sync.py`,
  the `SELECT`/response fields in `lookup.py`, and the entire expiry
  card in `www/index.html` -- HTML, CSS (including the `--amber-*`
  tokens and `.icon-badge--amber`, used nowhere else), both locale
  strings (en/ar), and the JS show/hide logic. Two test fixtures
  (`test_lookup.py`, `test_receipt.py`) updated to match.

**Staging state fixed as part of this, not left as a separate TODO:**
Loyalty Program "Swan Rewards" -> Expiry Duration set to 36500 on
`staging.local` (was found to already be 0 there -- differs from what
the user believed production currently has; production's actual value
was NOT checked or changed by this session, the user is doing that
separately).

**Full regression check:** posawesome backend module 3/3
(`test_rewards_sync.py`, unaffected -- confirms no accidental breakage
of the unrelated PDF-generation tests in the same file); live-called
`_build_customer_payload()` against a real customer, confirmed no
expiry keys and no error. `swan_rewards`'s full test suite 39/39 (`python
-m unittest` against all 4 test files -- this app's tests are fully
frappe-stubbed, no bench/site context needed, so unaffected by the
`FrappeTestCase`/ERPNext bootstrap issue noted in section 30's CLAUDE.md
entry, which requires the `erpnext` app that this bare-Frappe site
doesn't have installed). `bench --site rewards.staging.local migrate`
run twice, clean both times, confirmed idempotent (columns stayed
dropped, weren't recreated). Live-called `match_customer()` against the
real post-migrate DB, confirmed the trimmed `SELECT` executes without
error. `bench build`: N/A for both repos -- no `.vue`/`.ts` touched in
posawesome, and `swan_rewards`'s `www/index.html` is static/server-rendered
with no separate build step at all.

**Promoted, pushed, deployed, and verified live on production -- DONE.**
posawesome: committed to `develop-swan` (`9d50717`), cherry-picked onto
`stable` as `41567ce` (diff verified byte-identical), full regression
re-run on `stable` (backend 3/3, frontend suite 226/226 files, 1125/1125
tests), both branches pushed to GitHub. `swan_rewards`: pushed to GitHub
on `main` (`a80da89`). Staging confirmed working by the user first
(expiry section gone, points display normally, nothing broken) before
either production deploy.

**Production.** The user ran both deploys themselves (posawesome:
`bench pull` + `bench restart`, no build/migrate needed -- pure Python
change, no doctype/fixture touched; `swan_rewards`: `git pull` +
`bench --site rewards.swan-intl.com migrate` + `bench restart`, same
site-on-the-same-bench deployment shape as posawesome's own, confirmed
against section 18's original rollout record) and fixed production's
Loyalty Program `expiry_duration` to 36500 (the same value used on
staging -- production's actual prior value was never confirmed by this
session, only staging's 0 was). **Confirmed working live on production
by the user:** portal correctly shows no expiry section, points display
normally. The orphaned `expiry_amount`/`expiry_date` DB columns on
production's `Rewards Customer` table were flagged as optional
`bench migrate`-doesn't-drop-columns cleanup (same as staging), left to
the user's discretion -- not required for correctness.

## 33. Variant sibling scan hint (Phase 1): new feature, a real blinking-dialog bug, and a dead selected-state chip style fixed the same day (2026-08-25)

**Business context:** Swan International is a multi-brand fashion
retailer (9 brands, ~6000 items) where size/color variants are the norm,
not the exception. Staff scanning a barcode had no way to see, at the
point of scan, that the same style exists in other sizes/colors -- a
real lost-sale gap (a customer wants Style 123 in Medium but the scanned
unit is Large; nothing surfaces that Medium is in stock at this store).

**Investigation-only first, per the user's request, before any build.**
Five questions were answered from the existing codebase before any code
was written: (1) every barcode scan response already returns
`variant_of`/`has_variants` free of charge -- no new backend field
needed; (2) `get_item_variants()` (`posawesome/api/items.py`) already
implements the exact fetch needed -- sibling list + per-variant
`actual_qty` (single-warehouse, POS-Profile-scoped) + attribute
metadata, already used by the pre-existing template-item "choose a
variant" flow; (3) `Variants.vue` already renders this exact data shape
and can self-fetch when opened with an empty `items` array; (4) same-store
data only (no cross-store stock) was the only architecturally clean
option without new backend work; (5) effort estimate was small given
items 1-3 -- confirmed correct in practice. The user approved "Option A
(same-store only)" and asked for the implementation described below,
explicitly staging-only pending their own visual test of the placement
before any consideration of production.

**Phase 1 build, three pieces, one shared bug and one shared UI fix
discovered along the way:**

**Piece 1 -- the hint itself.** After a scan-add of an item with
`variant_of` set, `useScanProcessor.ts`'s `addScannedItemToInvoice()`
sets a new `scanVariantHint` ref (added to `useScannerInput.ts`) to
`{ itemCode, itemName, variantOf }`; a plain (non-variant) scan clears
any stale hint from a previous scan. This is purely informational --
never blocks or delays the scan-and-add flow, never fetches anything on
its own. A new small component, `ScanVariantHint.vue` (a
non-blocking, dismissible `v-snackbar`, `timeout="-1"`, bottom-anchored)
renders it in `ItemsSelector.vue`, with "Other sizes/colors of {item}
may be available" -- deliberately not promising a count, since the count
is unknown without a fetch. Tapping "View" (`viewScanVariantHint()` in
`ItemsSelector.vue`) fetches siblings on demand and opens the existing
`Variants.vue` dialog, reusing it as-is (no changes to that component
for this piece).

**Bug found during the user's own live testing (real barcode
89410444020014): the dialog blinked/flickered after opening instead of
rendering cleanly.** The user correctly hypothesized the bug was in how
the new entry point *triggers* the dialog, not in `Variants.vue` itself
(confirmed zero lines changed there at that point). Traced live first,
per the user's explicit instruction not to guess: a temporary Playwright
script intercepting `get_item_variants` network calls showed 7+ calls
firing within ~4 seconds of opening the dialog, still climbing when the
trace window ended -- an unbounded refetch loop, not a one-off. Root
cause, confirmed by re-reading `Variants.vue`'s actual watcher code line
by line: its `"uiStore.variantsData"` watcher (`deep: true`) sets
`this.parentItem = data.item` -- the *same* reactive object as the
store's own nested `item`, not a copy (Vue doesn't re-wrap an
already-reactive value). Its separate `attributes_meta` watcher then
mutates `this.parentItem.attributes` in place, which -- because
`parentItem` IS that shared object -- re-fires the deep watcher on
itself. The original implementation passed `items: []` (relying on
`Variants.vue`'s own on-demand `fetchVariants()`), and that internal
fetch only ever reassigns the component-local `this.items` via
`.concat()`, never the store's own `data.items` -- so every re-fire saw
an empty stored array again and re-triggered `fetchVariants()` from
scratch, wiping and reloading the dialog repeatedly. A first attempted
fix (`toRaw()` on the `pos_profile` object passed into `openVariants`)
addressed a real but secondary reactive-coupling concern and was
re-traced and found insufficient -- the loop had nothing to do with
`pos_profile`. **Actual fix:** `viewScanVariantHint()` now pre-fetches
variants itself (a newly-exported `fetchItemVariantsMeta`, reused
verbatim from `useItemCreation.ts`, the same function the pre-existing
template-item flow already calls) and opens the dialog with a populated
`items`/`attrsMeta` from the start -- exactly the contract the old,
already-stable template-item trigger uses, which is why that flow never
hit this bug. With `items` non-empty from the first run,
`Variants.vue` never calls its own `fetchVariants()`, so the loop
cannot start; re-tracing the watcher chain against the fix confirms it
settles after one harmless extra pass with zero additional network
calls. `Variants.vue` remains completely unmodified by this fix.

**Second bug found during the user's own visual testing of the fixed
dialog: the size/color filter chips (e.g. "BLACK", "57") had no visible
selected state when tapped**, giving staff no confirmation of the
currently-applied filter. Root cause: `Variants.vue`'s
`selected-class="green--text text--accent-4"` on the chip group is dead
Vuetify 2 class naming (double-dash `--text` utility classes) that does
not exist anywhere in this app's Vuetify 3 (confirmed: zero matches in
Vuetify's own bundled CSS) -- it has silently never applied any style,
in *either* the new scan-hint dialog or the pre-existing template-item
one, since both share this one component and this dead prop predates
this whole feature. Fixed with an explicit per-chip `:variant`/`:color`
binding (`outlined` -> `flat` + `primary` when the chip's value matches
the active filter for its attribute), matching the same
selected-vs-unselected visual pattern already used elsewhere in this app
(`DocumentSourceSelector.vue`'s `variant="isActive ? 'flat' : 'tonal'"`)
rather than introducing a new one. This is a template-only change to the
one shared chip row -- confirmed to affect both flows identically (both
had the same silently-broken indicator; both are fixed the same way).

**Full regression check, all three pieces:** frontend suite 226/226
files, 1130/1130 tests (new coverage: 4 tests in
`useScanProcessor.spec.ts` for the hint set/clear/replace/non-gating
behavior, 1 in `useScannerInput.spec.ts` for the hint ref and clear
function). `bench build --app posawesome` clean (including `vue-tsc`
type-checking, which caught one real error along the way -- see below).
Backend: N/A, no Python touched. `bench migrate`: N/A, no
doctype/fixture/print-format touched. Security review: N/A, no new user
input, auth, or data-access surface -- purely client-side UI reusing an
already-permission-scoped, already-existing backend endpoint. Confirmed
untouched: `Variants.vue`'s own fetch/filter/add-to-cart logic,
`useItemCreation.ts`'s pre-existing `handleVariantItem`, `uiStore.ts`'s
`openVariants`/`closeVariants`, and `ItemsTable.vue` (cart rendering) --
all verified via diff to have zero changes across the whole arc, plus
the user's own live confirmation that the normal fast scan-and-add flow,
a plain (non-variant) scan showing no hint, and the existing
template-item flow all still work exactly as before.

**One real type-error caught by the build, not by testing:**
`const scanVariantHint = ref(null)` in `useScannerInput.ts` initially
inferred as `Ref<null>` permanently (TypeScript can't widen a bare
`ref(null)`'s type from later assignments), causing `vue-tsc` to fail on
`scanVariantHint.itemName`/`.variantOf` property access in
`ItemsSelector.vue`. Fixed with an explicit generic:
`ref<{ itemCode: string; itemName: string; variantOf: string } | null>(null)`.

**Promoted:** all three pieces committed to `develop-swan` in one commit
(`f16a89c`) -- the feature, the blinking-dialog fix, and the chip
selected-state fix were built and verified together in the same
session, so they're recorded as one story here and in the commit
message rather than split. User confirmed all three working live on
staging (real barcode 89410444020014: item adds normally, hint appears,
"View" opens the dialog cleanly with no blinking, siblings show correct
same-store stock, and filter chips now show a clear selected state in
both the new dialog and the existing template-item one) before any
promotion toward `stable`/production.
