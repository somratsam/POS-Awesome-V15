# POS Awesome — develop-swan Fork Progress Notes

Last updated: 2026-08-06

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
main body of work — the four newest commits, `e393e89` through `9f1dcd5`.**

## 2. Today's major work: POS Closing Shift Z Report (Part A + Part B)

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
- Full frontend `vitest run`: 217/217 test files, 1051/1051 tests passing.
- `bench build --app posawesome`: clean, exit 0, zero errors.
- `bench --site staging.local migrate`: clean, exit 0, zero errors.
- Checked for file/logic overlap with every prior commit this session — none found.
- **Live end-to-end test: confirmed working.** The user closed a real shift in the
  browser and the Z Report printed automatically via QZ Tray with no permission
  popup — the entire point of this migration. Part B is proven in practice, not just
  via isolated backend/render verification.

### Deferred from today's work

- **Z Report lookup + reprint.** The Z Report only auto-prints on the just-closed
  shift (`submit_closing_pos()` → `printZReport()` → `printDocumentViaQz()`). There's
  no screen in POS Awesome to browse past `POS Closing Shift` records and reprint one
  — needed for when the automatic print fails/jams, a second copy is needed, or a
  shift from days ago needs checking. Build: a search/list screen (by date, shift
  number, or similar) that lets staff pick a past shift and calls the same
  `printZReport()`/`printDocumentViaQz()` path manually against the chosen shift's
  name instead of the just-closed one. Not started.
- **Same-shift exchange distinction not carried into the Z Report.** The *old*,
  invoice-level "Swan Sales Invoice" print format has logic to distinguish two cases
  when `posa_redeemed_customer_credit > 0` on an invoice: if a matching return
  invoice for the same customer exists **within the same POS opening shift**, it's
  treated as an **"Exchange"** (the customer returned an item and immediately used
  that value toward a new purchase in the same visit — arguably not real credit
  issuance/redemption, just a swap); otherwise it's genuine **"Credit Applied"** from
  an older, separate visit. The new shift-level `get_z_report_data()`/
  `customer_credit_issued`/`customer_credit_redeemed` fields make **no such
  distinction** — same-shift exchanges and genuine cross-visit credit redemptions are
  currently summed together into one "Credit Issued Today"/"Credit Redeemed Today"
  figure. Whether that's acceptable for a shift-level summary (as opposed to the
  per-invoice receipt, where the distinction matters more) hasn't been decided —
  worth raising with the business before treating today's numbers as final.
- **"Credit Issued Today" is definitionally just "Total Returns," not a real credit
  ledger figure.** Already noted under Part A above — flagging again here since it's
  the kind of thing that's easy to forget is a placeholder/approximation rather than
  a deliberate design choice.
- **VAT section intentionally left out of the new Z Report.** The old raw report had
  a hardcoded 5% VAT calculation. Left out of the new HTML version per explicit user
  instruction ("leave out VAT for now — will add later once VAT is configured on
  staging and we can verify real numbers"). Add once that's ready — don't assume the
  omission was accidental.

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

(See section 2 above for today's new deferred items: Z Report lookup/reprint,
same-shift exchange distinction, Credit Issued definition, VAT section.)

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
