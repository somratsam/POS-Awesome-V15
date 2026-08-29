# Claude Code Configuration for POSAwesome

## About This Project

POSAwesome is a Frappe application - a Point of Sale (POS) system built on the Frappe Framework. This is a full-stack web application with Python backend and Vue.js frontend components.

**Enhanced Camera Scanner**: Features advanced OpenCV-based image processing for superior barcode and QR code scanning with real-time image enhancement.

**Companion app — the customer rewards portal.** This app has a
customer-facing counterpart, `swan_rewards`, living in its own separate
repo (`github.com/somratsam/swan-rewards-portal`, `main` branch) and its
own separate Frappe site (`rewards.staging.local` in this dev
environment; `rewards.swan-intl.com` in production). It is *not* a
subfolder or module of this repo, and it has no ERPNext/POS Awesome
installed — deliberately bare Frappe, decoupled from this site's data
model. The only connection between the two is a one-way scheduled sync
job that lives *here*, in `posawesome/posawesome/api/rewards_sync.py`:
it computes loyalty summaries/recent invoices/receipt PDFs on this site
and pushes them over an authenticated HTTP call every 15 minutes (plus a
daily full refresh). The rewards site never queries this site's database
directly. See `PROGRESS_NOTES.md` section 20 for the original build
history, section 25 for the production rollout, and section 27 for
post-launch fixes (mobile View/Download, reload persistence); see
`swan-rewards-portal`'s own `README.md` for that app's architecture.

## Verify Against Live State Before Fixing Permissions/Settings/Roles

Before proposing a fix involving permissions, roles, POS Profile settings, or any
area where code might not reflect the actual current state of a site, verify
directly against the live database via `bench --site <site> console` first —
check for migrations already applied (`Patch Log`), deprecated/removed
fields (`Custom Field` records can be deleted while old code still references
the fieldname defensively), and patches under `posawesome/patches/` that may
have changed the intended source of truth since the code reading it was
written. Don't rely on reading code in isolation to determine current
behavior — a function can look authoritative while actually being superseded
or a stale fallback path.

Concrete example that happened in this repo: `employees.py`'s
`_is_pos_supervisor()` looked like it checked a `posa_is_pos_supervisor`
field on the User doctype. Reading only part of the function led to a wrong
diagnosis of a frontend/backend "mismatch" against a role-based check
elsewhere. The full function actually checks the role first and only falls
back to the field — and a patch (`migrate_pos_supervisor_to_role.py`) had
already migrated every user off that field and deleted the Custom Field
entirely on this site. `bench console` confirmed it in under a minute;
guessing from the code alone would have produced a fix for a problem that
didn't exist while missing the real one.

## `bench export-fixtures` Can Silently Corrupt a Large Fixture File

Before using `bench export-fixtures` to add a new entry to an existing
fixture file (e.g. `custom_field.json`), know that it has been observed to
silently truncate the file rather than append to it cleanly — even though
the live DB records it's exporting from are fully intact. Always check the
diff before trusting the result: a genuine new-field export should show a
small, purely additive change (`git diff --stat`), not a large deletion. If
it looks wrong, `git checkout` to revert immediately and hand-add the new
entry instead — copy an existing entry's exact key set and formatting from
a neighboring record in the file and insert it directly, rather than
re-running the export.

Concrete example that happened in this repo: adding a single new Custom
Field (`Customer-posa_loyalty_portal_code`) via `bench export-fixtures`
shrank `posawesome/fixtures/custom_field.json` from ~9000 lines to 139.
Caught before committing by checking the diff; reverted and hand-added the
one new JSON object instead. The same caution was applied preemptively
(hand-adding directly, never re-running the export) for every Custom
Field added since — `Customer-posa_is_generic_customer` and
`Sales Invoice-posa_receipt_synced`.

## WSL2 Dev Environment: `bench start` / Redis Can Silently Be Down

If `bench` commands in this environment start failing with Redis
connection-refused errors, or an otherwise-working `curl` against a site
suddenly connection-refuses, check whether the whole `bench start`
process stack (web server, redis_cache, redis_queue, scheduler, worker)
is actually still running — `bench doctor` or `ps aux | grep -E
"redis-server|gunicorn"` — before assuming a code change caused it. It
has gone down mid-session in this WSL2 setup with no code-related cause;
restarting cleanly resolves it. One thing to watch when restarting
manually: don't leave a bare `redis-server <config>` process running
outside of `bench start`'s own management — it'll hold the port and
make `bench start` itself fail to bind, looking like a second, different
failure. Kill any manually-started redis processes by PID first, then
let `bench start` launch its own.

## Check for Name Collisions Before Creating Standard Docs

Before creating any standard Print Format (or any standard doc — Page, Report,
Workspace, etc.) that could share a name with an existing record, always check
for a name collision first. `bench migrate`'s standard-doc sync
(`frappe/modules/import_file.py`'s `delete_old_doc()`) force-deletes any
existing record with the same name — `frappe.delete_doc(doctype, name,
force=1, for_reload=True)` — before inserting the new one. This is a delete
and recreate, not a merge or field-level update: no backup, and it bypasses
Frappe's normal Version/Trash logging even when the doctype has
`track_changes` enabled (the `for_reload=True` fast path skips it). Check via
a direct DB query for the exact name before running migrate — e.g. `bench
--site <site> mariadb -e "SELECT name FROM \`tabPrint Format\` WHERE
name='<name>'"` — not just by browsing Desk, since a record you haven't
personally seen in the current session can still exist.

Concrete example that happened in this repo: a new standard Print Format was
created at `posawesome/posawesome/print_format/z_report/z_report.json` named
"Z Report" to hold a new HTML-based report. A Print Format named "Z Report"
already existed on the site — manually created earlier, containing hand-tuned
raw ESC/POS Jinja commands (`raw_printing: 1`) that were never exported to
git. Running `bench migrate` silently deleted that original record and
replaced it with the new one. `creation == modified` on the surviving record
(both stamped to the exact migrate time) was the tell; there was no Version
row and no filesystem backup to recover from. A pre-migrate name check would
have caught this in seconds.

## A New Custom Field's `insert_after` Determines Its Section, Not Just Its Position

When adding a Custom Field, `insert_after` places it immediately after
whatever field you name — but that also determines which *section* it
lands in, since a field inherits the section of whatever it's inserted
next to. A plausible-sounding neighbor field can silently belong to an
unrelated, possibly-collapsed section. Always verify the actual landing
section before trusting the field is discoverable — `frappe.get_meta(dt)`,
walk backwards from the new field to the nearest preceding `Section
Break`, and check both its label and whether `collapsible` is set.

Concrete example that happened in this repo: `POS Profile.posa_walkin_customer`
was inserted after `posa_apply_customer_discount`, which turned out to
sit inside a collapsed **"Campaign"** section (generic ERPNext UTM/marketing
fields) — a section with zero relation to the new field and not
somewhere anyone would think to expand looking for it. Caught only
because a user reported "I can't find the button" and the actual section
was checked directly rather than assumed from the `insert_after` value
looking reasonable. Moved to an existing, correctly-labeled POS Awesome
section instead.

## Adding a Prop to a Shared Component? Verify Every Real Caller Forwards It

A prop declared and used correctly inside a component (e.g. gating a
`v-if` in its own template) proves nothing about whether the app actually
supplies it at runtime. Frappe/Vue won't error on a missing prop binding
by default — it just silently resolves to `undefined`. Before trusting a
new prop-gated feature works, grep for every real usage site of the
component (`<ComponentName\b`) and confirm each one actually forwards the
prop, not just that the component itself looks correct in isolation.

Concrete example that happened in this repo: `Customer.vue` declared and
used a `pos_profile` prop correctly (gating the new Walk-in button's
`v-if`), but neither of its two real usage sites in the whole app
(`InvoiceCustomerSection.vue`, `PayView.vue`) actually passed it down —
so the prop was `undefined` in every real session, and the button could
never have rendered regardless of database configuration. The original
test suite didn't catch this because it followed this same component's
established testing convention (source-string assertions against
`Customer.vue` in isolation, the same pattern `customerDropdownXss.spec.ts`
already used) — a pattern that verifies a component's own logic but is
structurally blind to caller-side wiring bugs. A user's live manual test
caught it; a targeted "does the parent actually forward this prop" test
was added afterward and its own effectiveness was verified by reverting
the fix and confirming the test failed before trusting it as a real
regression guard.

## Regenerating nginx/SSL Config for a New Site Can Break an Existing Site's Cert

On a shared bench serving multiple production domains, adding a new
site's nginx/SSL config (`bench setup nginx`, `bench setup
lets-encrypt`) regenerates config for the *whole* bench, not just the
new site being added. Don't assume a clean deploy just because the new
site's own cert comes up correctly — verify every existing domain still
serves over HTTPS afterward too, not only the one just added.

Concrete example that happened in this repo: adding
`rewards.swan-intl.com`'s nginx/SSL config briefly broke
`e.swan-intl.com`'s own certificate the same night. Caught and fixed
immediately, no lasting impact, but it would have gone unnoticed longer
without a deliberate post-deploy check of the *other* domain, since
nothing about adding the new site's config looked wrong in isolation.

## wkhtmltopdf's `load-error-handling` Options Don't Cover Every Failed Resource Fetch

A plausible-sounding wkhtmltopdf option name is not proof it covers the
failure mode it's being reached for. `load-error-handling` and
`load-media-error-handling` sound like they should make PDF generation
tolerate any failed resource load, but neither actually covers a failed
`<link rel="stylesheet">` fetch — confirmed empirically (15/15 failures
either way against a reproducible dropped-connection failure) before
trusting either option. They appear scoped to main-page navigation and
`<img>`/media specifically.

More generally: `frappe.get_print()`'s output isn't just the print
format's own HTML — Frappe's printview wrapper unconditionally injects
its own `<link>` to a bundled `print.bundle.css` in `<head>`, outside
whatever the print format itself declares. A scan for broken resource
references that only checks the print format's own content (`<img>`,
CSS `url()`, `background-image`) will miss this. When generating a PDF
server-side (no real browser/user session, e.g. from a scheduled job),
that stylesheet is a real self-referencing HTTP fetch back to the same
process — which can fail under real load in a way a single manual test
during development won't reproduce. If the print format has its own
complete inline `<style>` block (true for POS Awesome's thermal-receipt
formats), that fetch is usually unnecessary; read the file directly off
local disk instead (`frappe.local.sites_path` + the link's own href),
the same technique `frappe/utils/pdf.py`'s own `prepare_header_footer()`
already uses for header/footer HTML, rather than trying to make the
fetch's failure tolerable. Don't just strip the `<link>` either — verify
first that nothing it provides is actually load-bearing (in this repo,
it was the only thing hiding Frappe's own print-preview toolbar button
text from leaking into the rendered output).

## Frappe's `request.js` Can Intercept an Error Before Your Own `frappe.call()` Error Handling Ever Runs

If a frontend fix isn't behaving as expected for a specific Frappe
exception type reached via `frappe.call()`, check `request.js`'s own
`exception_handlers` map before assuming your own error-classification
code is even in the call path. It's declared as a `var` *local to*
`frappe.request.call()`'s own function body (not exposed for external
override), keyed by exception class name (`data.exception.split(".")
.at(-1).split(":").at(0)`), and its `.fail()` handler checks it
*before* falling through to `opts.error_callback` — for a matching
entry (`QueryDeadlockError`, `QueryTimeoutError`), it shows Frappe's own
native `msgprint` dialog and `return`s immediately, so custom
`error:`/`error_callback` handling for that exact exception type never
runs at all. Confirm this by reading `request.js`'s `.fail()` handler
line by line for the specific exception type in question, not by
assuming a generic "extend the error classifier" fix will reach every
call path — it won't reach this one.

Concrete example that happened in this repo: a fix intended to make a
deadlock-related error show a calmer message extended
`classifyBusinessCode()` (`api.ts`) to recognize deadlock text, feeding
an existing recovery path in `usePaymentSubmission.ts`. Traced
precisely (not assumed) that this specific dialog is Frappe's own
native one, shown before that classification code ever runs — the
frontend change was still worth keeping as low-risk defense-in-depth
for other call paths, but the actual fix that mattered was a backend
retry that prevents the deadlock from reaching the client at all.

## Mobile Chrome Doesn't Reliably Render a `blob:` URL PDF Inline — Use a Real Navigation Instead

Desktop Chrome renders any `blob:` URL typed `application/pdf` inline
when a tab is navigated to it, regardless of any HTTP header (there's
no real HTTP response involved at all for a `blob:` URL — it's an
in-memory object). Chrome for Android does not reliably do this,
falling back to a download instead — a platform gap, not something
fixable by changing what the *server* sends, since a `blob:`-URL
navigation never involves the server's response headers in the first
place.

If a `fetch()` + `.blob()` + `URL.createObjectURL()` pattern is being
used specifically to achieve inline PDF viewing (a common reason: the
endpoint needs a POST body carrying auth credentials that can't go in a
bare `<a href>` GET), and mobile behaves differently from desktop,
suspect this exact platform gap first. The fix is a real top-level
navigation — e.g. a hidden `<form method="POST" target="_blank">`
submission — so the browser's native inline-PDF handling can act on the
server's *actual* `Content-Disposition: inline` header, which is
meaningless to a `blob:`-URL-based approach no matter how correctly the
server sets it.

Concrete example that happened in this repo (`swan_rewards`'s receipt
"View" button): confirmed via `curl` that the server was already
sending the correct, different `Content-Disposition` header for view
vs. download — the header was never the problem. The actual client-side
code discarded the server's response entirely and rebuilt a fresh
`Blob` before deciding view-vs-download purely in JS, meaning no HTTP
header from either mode ever reached the browser's own decision logic.

## Every Change Needs a Full, Professional-Standard Check Before It's "Done"

Don't treat a change as complete once it merely works. Every implementation —
not just the ones where the user explicitly asks for verification — needs a
**"final regression check"** before it's done. That phrase (or any equivalent
instruction — "run the regression check", "make sure nothing broke", "run the
final checks") is not a vague vibe, it is this exact fixed checklist, every
single time, with no items silently skipped:

1. **Full frontend test suite.** `vitest run` — the whole suite, never scoped
   to one spec file, even if the change looks frontend-only. Report the exact
   pass count (e.g. "217/217 files, 1054/1054 tests").
2. **Relevant backend test modules, run in isolation.** Identify which
   modules are relevant based on what the change actually touched (not a
   generic default list), run each via `bench --site <site> run-tests
   --module <module>` (isolation is required given the known pre-existing
   `run-tests` full-suite environment crash — see `PROGRESS_NOTES.md` for
   that crash's signature and how it was confirmed pre-existing), and report
   the exact pass/fail count per module.
3. **`bench build --app posawesome`** — required whenever any frontend,
   `.vue`, or `.ts` file was touched. Confirm a clean exit 0. If no such file
   was touched, say so explicitly ("N/A — no frontend files touched") instead
   of silently omitting this step.
4. **`bench --site <site> migrate`** — required whenever any doctype,
   fixture, or print-format file was touched. Confirm a clean exit 0. If a
   new field or document was involved, run migrate a **second time** and
   confirm it's idempotent (no drift, no reapplication side effects — this
   caught a real field-ordering bug that only showed up on a second run). If
   nothing doctype/fixture/print-format-shaped was touched, say so explicitly
   instead of silently omitting this step.
5. **Genuine security review** for anything touching user input,
   authorization, or data access. Trace how the input is actually handled —
   don't assert it's safe, prove it by reading the actual code path, and
   **restate explicitly what was checked** (which input, which query, which
   permission boundary), not just "looks fine": is a filter/query
   parameterized or escaped (trace it into the ORM/driver, e.g.
   `frappe/model/db_query.py`'s `prepare_filter_condition` and
   `frappe.db.escape`) versus string-interpolated into raw SQL? Is there an
   injection surface? Does the frontend use `v-html` anywhere near
   user-controlled data (XSS)? Are there missing bounds/limits on anything a
   whitelisted method exposes (a whitelisted method is callable directly by
   any authenticated session, not just through whatever UI currently calls
   it)? Is authorization actually re-validated server-side, or does the code
   trust a client-supplied identifier (a profile name, a doctype name, a
   user id) without re-checking it belongs to the requesting user? If none of
   this applies, say so explicitly ("N/A — no user input/auth/data-access
   surface touched") instead of silently omitting this step.
6. **Explicit confirmation of what was NOT touched or broken.** Name the
   specific adjacent features/flows actually checked (e.g. "confirmed
   receipt printing and the automatic Z Report print-on-close still work,
   since this touched `usePosShift.ts`, a shared file both depend on") — a
   vague "nothing else affected" does not satisfy this item.

Report all six items explicitly, in order, every time a final regression
check is run — this is the authoritative definition and supersedes any
looser or partial version used in earlier sessions. A "looks fine" scan is
not the same as tracing the actual code path — see the Z Report History
feature's `list_closing_shifts` for a worked example: the `search`
parameter's safety was confirmed by reading `db_query.py` and the MariaDB
driver's `escape()` down to the actual `escape_string()` call, not by
assuming Frappe's ORM is safe in general.

## Layout Fixes on Vuetify Tables Need Real Browser Measurement

Reading CSS files and computing expected column widths/padding by hand is not
reliable for this codebase's Vuetify data tables — trust real measurement
(a real running build in a real headless browser) over arithmetic before
claiming a layout fix works, especially anything involving column widths.
Three concrete, previously-hidden gotchas made arithmetic-only fixes wrong:

1. Vuetify ships its own default cell styles (e.g. `.v-table >
   .v-table__wrapper > table > tbody > tr > td { padding: 0 16px; }`) that
   can out-specificity a hand-written app rule — a CSS variable can look
   fully wired up (defined, referenced, computed correctly) while never
   actually winning the cascade. Confirm with the browser's own matched-rules
   inspection (Chrome DevTools' "Computed" panel, or CDP's
   `CSS.getMatchedStylesForNode` when scripting it), not by reading the rule
   in isolation.
2. The default `table-layout: auto` sizes each column from whichever is
   wider — the header **label text** or the cell content — ignoring any
   configured `width`/`min-width` entirely. A long label can single-handedly
   force a column wide no matter what the JS config says. `table-layout:
   fixed` is required before a width config becomes authoritative.
3. Vuetify's data-table header content wrapper is `display: flex`, and CSS
   `text-overflow: ellipsis` does not reliably render inside a flex
   container — a narrow column with a long label can show garbled, cut-off
   text instead of a clean "…".

Concrete example that happened in this repo: a POS Invoice Items table
overflow fix went through three rounds before it actually worked (see
`PROGRESS_NOTES.md` section 28 for the full story). Rounds 1-2 computed a
required-column floor of 768px by reading `min-width`/`padding` values out
of the CSS source. A real headless browser (Playwright) measuring the actual
rendered table found the true floor was 1007px — the padding fix had never
applied (bug #1 above) and long column labels were forcing extra width
regardless of config (bug #2). Only after fixing both, plus a third
(unrelated) discovery that ellipsis wasn't rendering cleanly on the
now-narrower columns (bug #3, fixed by shortening the labels), did a fresh
measurement sweep from 1100-1920px window width show zero overflow anywhere.

## A Rebalance/Auto-Correct Function Needs Both Directions Tested, Not Just the One You Designed For

When adding logic that automatically corrects one value against another (a
payment box against an invoice total, a quantity against a limit, etc.),
explicitly design and test BOTH directions it can be wrong in -- too much
and too little -- even if the feature request or bug report only describes
one of them. A function that only handles "the total is now too high, shrink
something" is not a general rebalance; it's half of one, and the missing
half won't show up in testing unless someone deliberately exercises the
opposite direction.

Concrete example that happened in this repo: `autoBalancePayments()`
(`usePaymentMethods.ts`) was built to fix a specific reported gap --
directly editing the POS payment screen's preferred payment box didn't
rebalance the other boxes. The fix added a working `if (excess > 0)` branch
that shrinks other payment boxes when an edit creates an overpayment. It
shipped, passed its own tests, was promoted to `stable`, and deployed to
production -- where the user found it only half-worked: decreasing the
preferred box (creating a shortfall, not an excess) left the other box
"stuck," since there was no corresponding branch to grow another box to
cover a deficit. Every test written for the fix, and the live/manual
verification done before promoting it, exercised only the excess direction
-- the one the original bug report described -- so nothing caught the
missing half until a real cashier hit it in production. See
`PROGRESS_NOTES.md` section 30 for the full incident, root-cause trace, and
the corrected fix (a symmetric deficit branch, plus tests for both
directions this time).

## Playwright E2E Against This POS App: Time-Box Terminal-Lock/Login Friction, Don't Fight It

Live browser reproduction against this app's real POS screens (staging or
production) is valuable and sometimes necessary to actually prove a bug or a
fix -- but the terminal-lock/cashier-PIN unlock dialog, POS Opening Shift
dialog, and item-search/cart interaction mechanics have repeatedly eaten
30+ minutes of a session on script/selector mechanics rather than the actual
bug under investigation, across separate sessions and separate bugs. Set an
explicit time box (10-15 minutes is reasonable) before attempting a live
Playwright repro of a specific hypothesis, and if it's not through by then,
stop and report what a careful code read found instead of continuing to
fight the harness -- a precise code-level diagnosis, clearly labeled as
"not yet live-verified," is more useful than another 30 minutes of ETIMEDOUT/
overlay-scrim/re-locked-terminal retries. A user manually testing in their
own browser has repeatedly resolved these faster than automating around the
friction.

Concrete example that happened in this repo: both the credit-eligibility
gap investigation (`PROGRESS_NOTES.md` section 29) and the payment-box
deficit-direction regression (section 30) hit this same friction --
`ensureAuthoritativeTerminalUnlock()`'s cashier-matching logic failing
against a freshly-provisioned test user, a `Terminal Locked` dialog
reappearing after an unrelated click landed on the wrong element, and a
"Maximum available quantity is 0.00" stock clamp on a non-stock item
blocking an unrelated qty-edit step. In both cases, stopping to report a
precise code-level trace (later confirmed correct by the user's own manual
testing) got to a decision faster than continuing to debug the automation.

## Vitest Bundles Its Own (Older) Vite — `.js`-Importing-`.ts` Files Fail to Resolve

This app writes store/composable imports with an explicit `.js` extension
even though the real file is `.ts` (e.g. `import { useUIStore } from
"../../../stores/uiStore.js"` when only `uiStore.ts` exists) — a deliberate,
working TypeScript/bundler-resolution convention used **pervasively**, in
20+ files including `Payments.vue`, `Invoice.vue`, and `Pos.vue`. The root
Vite (`frontend/node_modules/vite`) resolves this correctly. But Vitest
ships its own bundled, separate copy of Vite
(`frontend/node_modules/vitest/node_modules/vite`) which can be a full
major version behind (5.4.21 vs. the root's 6.3.5, confirmed in this repo)
— and the older version does not resolve `.js`-suffixed imports against
`.ts` files, failing with `Failed to resolve import "....js". Does the
file exist?` at Vite's SFC-transform stage, before any `vi.mock()` call
can intervene (mocking the module doesn't help — the failure happens
during static resolution, not module execution).

This only surfaces the first time any Vitest spec tries to mount/import a
component using the `.js`-suffixed style — most existing specs happen to
mount components that (coincidentally) use the bare-specifier style
instead, so this had never been hit before. Before concluding a component
"can't be unit tested" or trying to work around a resolution error for a
component import, check `node_modules/vitest/node_modules/vite/package.json`
vs. `node_modules/vite/package.json` for a version mismatch first.

Not a two-line fix: aligning Vitest's transitive Vite version is a
dependency change with blast radius across the whole test suite, and
normalizing one file's import style away from this codebase's own
dominant `.js`-suffixed convention just to make it testable is the wrong
direction. Concrete example that happened in this repo: adding a
generic-customer-credit guard to both `Returns.vue` and
`InvoiceManagement.vue` (identical logic, two call sites — see
`PROGRESS_NOTES.md` section 31), `InvoiceManagement.vue` got a real
component test immediately (it uses bare-specifier imports), but the
identical `Returns.vue` test failed on this resolution error. Resolved by
accepting the coverage gap for `Returns.vue` specifically (relying on the
already-proven-identical `InvoiceManagement.vue` test plus a clean
`bench build` as evidence) rather than forcing a fix in either direction.

## A Deep-Watched Reactive Object Passed By Reference Can Make a Watcher Re-Fire on Itself

When a Vue component's `data()` property is assigned directly from a nested
property of another deeply-watched (`deep: true`) reactive source — e.g.
`this.parentItem = data.item` inside a `watch: { "someStore.someRef": {
handler(data) { this.parentItem = data.item }, deep: true } }` — `this.parentItem`
becomes the *same* object as `data.item`, not a copy (Vue does not re-wrap an
already-reactive value in a new proxy). If any other code path later mutates
that shared object in place (e.g. `this.parentItem.someField = [...]` from a
completely separate watcher), the deep watcher on the *original* source fires
again, because the mutation is visible through both references. If that
watcher's own handler does anything conditional on state that never gets
updated back onto the original source object (e.g. re-fetching because a
locally-tracked array is empty, when only a *local* copy of that array — not
the shared source's own copy — actually gets populated), the re-fire re-enters
the same "not populated yet" branch every time, causing an unbounded
loop bounded only by whatever async work is inside it (e.g. network latency),
not a synchronous infinite loop and so not always obvious from a quick glance
at the code. Confirm this class of bug only by tracing the exact object
identity through the *actual* watcher code (does the assignment share a
reference, does the mutation happen on that shared reference, does the
re-fired handler's exit condition ever actually change) — not by reasoning
about "reactive coupling" in the abstract, since a plausible-looking fix (e.g.
stripping reactivity off an unrelated prop) can miss the real shared-reference
chain entirely.

Concrete example that happened in this repo: a new "view sibling variants"
entry point (`ItemsSelector.vue`'s `viewScanVariantHint()`) opened the
pre-existing `Variants.vue` dialog by calling `uiStore.openVariants({ item,
items: [], profile, ... })` with an empty `items` array, intending to let
`Variants.vue`'s own on-demand `fetchVariants()` populate it. `Variants.vue`'s
`"uiStore.variantsData"` watcher (`deep: true`) sets `this.parentItem =
data.item` (the same object as the store's own nested `item`, not a copy);
its separate `attributes_meta` watcher mutates `this.parentItem.attributes` in
place after every fetch, which — because `parentItem` IS that shared object —
re-fires the `variantsData` watcher on itself. Because `fetchVariants()` only
ever reassigns the component's own *local* `this.items` (via `.concat()`),
never the store's own `data.items`, every re-fire still saw an empty stored
array and re-triggered a fresh fetch — an unbounded wipe-and-refetch loop,
visible to the user as the dialog blinking, confirmed live via network-request
interception (7+ calls to the same endpoint within ~4 seconds, still
climbing). A first fix attempt (`toRaw()` on an unrelated `profile` object
also being passed into the same call) was plausible-looking (real reactive
coupling, same deep-watched destination) but traced and found to be the wrong
object entirely — the actual fix was to pre-fetch and pass a *populated*
`items` array from the start (matching the pre-existing, already-stable
template-item trigger's contract exactly), so the "not populated yet" branch
inside `Variants.vue` is never entered and the loop can't start. See
`PROGRESS_NOTES.md` section 33 for the full trace.

## Vuetify 2 Class-Name Props (`green--text`, `foo--bar`) Silently Do Nothing Under This App's Vuetify 3

This app runs Vuetify 3 (confirmed: `node_modules/vuetify/package.json`), which
renamed its utility classes (`green--text` → `text-green`, etc.) and dropped the
old double-dash naming entirely. A component prop that takes a raw class-name
string (e.g. `v-chip-group`'s `selected-class`) will silently accept a Vuetify-2-style
value with zero error and zero visible effect — Vue just adds a CSS class that
matches nothing, and nothing in the UI looks wrong enough to draw attention,
since the *absence* of a style is easy to miss versus a broken one. Before
trusting that a `selected-class`/`active-class`/similar prop is doing anything,
grep the exact class string against Vuetify's own bundled CSS
(`node_modules/vuetify/dist/vuetify.css`) — if it's not there, the prop has
never worked, no matter how long the code has existed or how correct it looks.
Prefer this app's own established pattern for a selected/active visual state
instead: flip the element's own `variant`/`color` props between an unselected
and selected value (e.g. `DocumentSourceSelector.vue`'s
`variant="isActive ? 'flat' : 'tonal'"`), not a raw CSS class name.

Concrete example that happened in this repo: `Variants.vue`'s size/color
filter `v-chip-group` had `selected-class="green--text text--accent-4"` since
before this session — dead code, confirmed via a direct grep against
Vuetify 3's bundled CSS turning up zero matches for either class. Found only
because a user reported "no visual indication of which chip is selected" while
testing an unrelated new feature that reuses this same dialog — the dead prop
predated that feature and had silently never worked in the *pre-existing*
template-item "choose a variant" flow either. Fixed with an explicit
`:variant`/`:color` binding on each chip instead. See `PROGRESS_NOTES.md`
section 33.

## A Shape-Based Heuristic (Length, Charset) Can't Reliably Separate Two Real, Legitimate Inputs — Classify by Confidence/Outcome Instead

When a client-side heuristic decides "this input is probably an X" purely
from its shape (length, character set) in order to short-circuit into a
different, more consequential code path (auto-submitting a barcode lookup
instead of running a normal search), check whether the real data actually
supports that separation before trusting the heuristic — and if it doesn't,
don't try to tune the heuristic harder; redesign around *what happens after*
the guess turns out wrong; a wrong guess should be silently reversible, not
alarming.

Concrete example that happened in this repo: barcode-scan detection used
digits-only charset + a length threshold to decide "auto-submit this as a
barcode lookup, and show an error dialog if it's not found." Real catalog
data confirmed this can never work reliably: a legitimate numeric style code
(`"4524019703"`) is literally a *character-for-character prefix* of one of
its own product variant's real registered barcode
(`"45240197030024"`) — the two are indistinguishable by shape at any given
moment while typing. No amount of length/charset tuning fixes this since the
ambiguity is structural, not a calibration problem. The fix was to stop
trying to classify better and instead tag *why* the system believes this
might be a scan (verified hardware-scanner keystroke timing = high
confidence; a value that merely looks barcode-shaped by charset/length,
e.g. idle-settle typing or paste = low confidence), always attempt the
(cheap, already-fast) lookup regardless, but only surface a user-facing
error on a miss for high confidence — a low-confidence miss stays silent
and normal search proceeds undisturbed, since the lookup was a harmless,
fire-and-forget side attempt rather than something the UI had already
committed to. See `PROGRESS_NOTES.md` section 34 for the full investigation,
including a second, related finding: a parallel detection path with no
timing awareness at all (built for virtual/scripted input) can misfire on
an *incomplete* value during ordinary human typing pauses — the fix there
was the same principle applied one level down: a premature low-confidence
guess is fine to let through as long as its failure mode is silent, not
that it needs to never fire at all.

## `<script setup>`'s Public Instance Proxy Only Exposes What's in `defineExpose` — Code Reading `vm = getCurrentInstance()?.proxy` Can Silently No-Op

A composable or helper function that takes a `getVM: () => vmInstance?.proxy`
callback and reads/writes properties on that `vm` (e.g. `vm.first_search`,
`vm.items`, `vm.clearLimitSearchResults`) is only reading/writing real
component state if every one of those properties is listed in the
component's own `defineExpose({...})` call. `<script setup>` components do
NOT automatically expose their top-level `const`/`ref` bindings to the
public instance the way Options API components expose `data()`/`methods` --
only `defineExpose`'d names are reachable through it. A property not listed
there resolves to `undefined` on read and creates a stray, disconnected
property on write (no error, no warning) — the function can look completely
correct in isolation while being fully inert against the real, live
component state used everywhere else.

Before trusting that a `vm.*`-based function actually does anything, grep
the component's `defineExpose({...})` block for every property that
function reads or writes. If even one is missing, don't assume the others
work either — check each one, since a partially-correct function (some
properties bridged via other override callbacks, some not) is exactly the
trap: it can appear to work for its main path while being silently broken
for a different branch.

Concrete example that happened in this repo: `ItemsSelector.vue` (`<script
setup>`) has a `useItemsSelectorSearch({ getVM: () => vmInstance?.proxy,
... })` call whose `_performSearch`/`onEnter` functions mostly work because
they were *also* given explicit override callbacks (`getSearchInput`,
`isLimitSearchEnabled`, `runLimitSearch`) that bypass the broken `vm.*`
reads for their main path — but that same composable's `clearSearch()`
function has no such overrides and depends entirely on `vm.first_search`,
`vm.items`, `vm.clearLimitSearchResults`, `vm.resetBarcodeIndex`, and
`vm.eventBus` — none of which are in `ItemsSelector.vue`'s `defineExpose`
block. The function was correctly designed (including a proper
`usesLimitSearch`-aware branch) and was never even the reason it went
unused — it was simply never wired to the UI at all, and tracing precisely
confirmed it wouldn't have worked regardless. The real fix used state
already directly in scope in `ItemsSelector.vue` instead of trying to
rescue the `vm`-based function. See `PROGRESS_NOTES.md` sections 34-35.

## Build Commands

### Main Build Commands
```bash
# Build frontend assets for production
bench build --app posawesome


# Force rebuild (cleans cache first)
bench build --app posawesome --force

# Build all apps in the bench
bench build
```

### Development Server
```bash
# Start development server
bench start

# Start with specific port
bench start --port 8000
```

## Project Structure

```
posawesome/
├── frontend/                 # Vue.js frontend
│   ├── src/
│   │   ├── posapp/
│   │   │   ├── components/   # Vue components
│   │   │   └── pages/        # Vue pages
│   │   └── main.js           # Frontend entry point
│   └── package.json          # Frontend dependencies
├── posawesome/               # Python backend
│   ├── public/               # Static assets
│   ├── posawesome/           # Main module
│   │   ├── doctype/         # DocType definitions
│   │   ├── api/             # API endpoints
│   │   └── hooks.py         # App hooks
├── CLAUDE.md                 # This file
└── pyproject.toml           # Python dependencies
```

## Common Development Commands

### Site Management
```bash
# Create new site
bench new-site mysite.local

# Install app on site
bench --site mysite.local install-app posawesome

# Migrate database
bench --site mysite.local migrate

# Access site console
bench --site mysite.local console

# Backup site
bench --site mysite.local backup
```

### Database Operations
```bash
# Run migrations
bench migrate

# Reload specific doctype
bench --site mysite.local console
>>> frappe.reload_doc('posawesome', 'doctype', 'pos_invoice')

# Clear cache
bench --site mysite.local clear-cache
```

### Code Quality & Testing
```bash
# Run tests
bench --site mysite.local run-tests --app posawesome

# Run specific module tests
bench --site mysite.local run-tests --module posawesome.tests.test_pos

# Check Python syntax issues
cd ~/frappe-bench/sites
../env/bin/python ../apps/frappe/frappe/utils/bench_helper.py
```

## Frontend Development

### Vue.js Components
- Built with Vue 3 and Vuetify
- Components located in `frontend/src/posapp/components/`
- Use composition API where possible
- Follow Frappe UI patterns and conventions

### Asset Building
- Uses Vite as build tool
- Automatic compilation on `bench build --app posawesome`
- Watch mode available with `--dev` flag

### Styling
- Uses Vuetify components and Material Design
- Custom SCSS in component `<style>` blocks
- RTL support implemented for Arabic/Hebrew

## Backend Development

### Frappe Framework Patterns
```python
# Get document
doc = frappe.get_doc("POS Invoice", invoice_name)

# Create new document
new_doc = frappe.new_doc("POS Invoice")
new_doc.update(data)
new_doc.insert()

# Database queries
invoices = frappe.get_list("POS Invoice", 
    filters={"status": "Draft"}, 
    fields=["name", "total"]
)

# Utilities
from frappe.utils import cint, flt, getdate, today
```

### API Development
```python
# In posawesome/api/pos.py
@frappe.whitelist()
def get_pos_data():
    return frappe.get_list("POS Invoice", limit=10)
```

### Hooks Configuration
Located in `posawesome/hooks.py`:
```python
# Document events
doc_events = {
    "POS Invoice": {
        "on_submit": "posawesome.api.pos.on_pos_invoice_submit"
    }
}
```

## Git Workflow

### Working with Forks
```bash
# Add your fork as remote
cd apps/posawesome
git remote add origin https://github.com/[username]/posawesome

# Create feature branch
git checkout -b feature/my-new-feature

# Stage and commit changes
git add .
git commit -m "Add new POS feature"

# Push to your fork
git push origin feature/my-new-feature
```

### Staying Updated
```bash
# Add upstream remote (original repo)
git remote add upstream https://github.com/yrestom/POS-Awesome

# Pull latest changes
git pull upstream develop

# Rebase your branch
git rebase upstream/develop
```

## Debugging Tips

### Common Issues
1. **Build Failures**: Clear cache with `bench clear-cache`
2. **Frontend Issues**: Check browser console and network tab
3. **Python Errors**: Check `bench start` output and error logs
4. **Database Issues**: Run `bench migrate` and check DocType definitions

### Development Tools
```bash
# Access Python console
bench --site mysite.local console

# Enable developer mode
bench --site mysite.local set-config developer_mode 1

# Show configuration
bench show-config

# List installed apps
bench list-apps --format json
```

## Key Dependencies

### Frontend
- Vue 3 - Frontend framework
- Vuetify - UI component library
- Vite - Build tool and dev server

### Backend  
- Frappe Framework - Full-stack web framework
- Python 3.8+ - Programming language
- MariaDB/MySQL - Database
- Redis - Caching and queuing

## Production Deployment

```bash
# Production build
bench build --app posawesome

# Setup production
bench setup production

# Restart services
bench restart

# Update app
bench update --app posawesome
```

## Useful Frappe APIs

```python
# Common utilities
from frappe.utils import cint, flt, cstr, getdate, add_days, today, now_datetime

# Database operations
frappe.db.get_value("DocType", "name", "field")
frappe.db.set_value("DocType", "name", "field", "value")
frappe.db.commit()

# User interactions
frappe.msgprint("Message")
frappe.throw("Error message")

# Translations
_("Text to translate")
```

## Configuration Notes

- This project uses the new esbuild-based build system (Frappe v14+)
- Frontend assets are compiled to `posawesome/public/dist/`
- Development mode enables auto-reloading and debugging features
- Production builds are optimized and minified