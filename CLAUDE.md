# POSAwesome — rules and must-know facts

Frappe POS app (Python backend, Vue 3 + Vuetify frontend, Vite). Enhanced camera scanner (OpenCV).
History: PROGRESS_NOTES.md. Root causes, examples and long explanations: docs/claude-lessons.md
(read the matching section when a rule below applies; rule numbers match).
Production deploy steps: docs/claude-lessons.md

## Sites, branches, environments
- Production site is `site1.local` (NOT e.swan-intl.com). Staging: `staging.local` (Asia/Muscat,
  currency precision 3, same as production). Rewards portal: separate repo
  `github.com/somratsam/swan-rewards-portal` (`main`), own bare-Frappe site `rewards.staging.local`
  (dev) / `rewards.swan-intl.com` (prod), no ERPNext/POS Awesome. Only link: one-way sync job
  `posawesome/posawesome/api/rewards_sync.py` (every 15 min + daily full refresh). Notes: PROGRESS_NOTES sections 20, 25, 27.
- Work on develop-swan. Never touch stable unless I say to deploy; then cherry-pick only the tested commits to stable.
- WSL2 dev: if bench/redis/curl suddenly refuse connections, check the `bench start` stack
  (`bench doctor`, `ps aux | grep -E "redis-server|gunicorn"`) before blaming code. Kill any manually
  started `redis-server` PIDs first, then let `bench start` launch its own.

## Final regression check (every change; report all 6 items, in order, none skipped)
1. Full frontend suite, never scoped to one spec: `PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH npx vitest run`
   (default Node 18 fails). Report exact counts (e.g. "217/217 files, 1054/1054 tests").
2. Backend modules relevant to what the change touched, each in isolation:
   `bench --site <site> run-tests --module <module>`; never the full suite (known pre-existing
   env crash, see PROGRESS_NOTES). Report pass/fail count per module.
3. `bench build --app posawesome` if any frontend/.vue/.ts file touched; confirm exit 0.
   Otherwise say "N/A — no frontend files touched".
4. `bench --site <site> migrate` if any doctype/fixture/print-format file touched; confirm exit 0.
   New field/doc involved: run it a second time and confirm idempotent. Otherwise say so explicitly.
5. Security review for anything touching user input, authorization or data access: trace the real
   code path, don't assert. Parameterized vs interpolated SQL (down into `db_query.py` /
   `frappe.db.escape`); `v-html` near user data; limits on whitelisted methods; server-side
   re-validation of client-supplied ids (profile, doctype, user). Restate exactly what was checked.
   If none applies, say "N/A — no user input/auth/data-access surface touched".
6. Name the specific adjacent features/flows actually checked as not broken (e.g. receipt printing
   and the automatic Z Report print-on-close after touching `usePosShift.ts`). "Nothing else affected" is not enough.

## Backend tests on staging reset System Settings — restore every time
`run-tests` on staging.local sets currency/float precision 2, time zone Asia/Kolkata, language en, and commits.
After the last backend module: restore precision 3 and Asia/Muscat with a real System Settings save (or
`frappe.db.set_default(...)`), clear cache, confirm `frappe.get_doc("Sales Invoice", x).precision("grand_total") == 3`.
A direct `tabSingles` update does not change `doc.precision()` (it reads `tabDefaultValue`).
Before testing any money logic (totals, payments, change, VAT, rounding) compare on staging and production:
`SELECT field, value FROM tabSingles WHERE doctype='System Settings' AND field IN ('currency_precision','float_precision','rounding_method')`
plus POS Profile `posa_decimal_precision`.

## Standing rules
1. Permissions/roles/POS Profile settings: verify against the live DB first (`bench --site <site> console`: Patch Log,
   deleted Custom Fields, `posawesome/patches/`). Code alone can be a superseded fallback.
2. Never run `bench export-fixtures` on a large fixture (it truncated custom_field.json from ~9000 to 139 lines).
   Hand-add entries copying a neighbour's key set; check `git diff --stat` is purely additive; revert if not.
3. Redis/bench down: see Sites section above.
4. Before adding any standard doc (Print Format, Page, Report, Workspace), query the DB for the same name
   (`bench --site <site> mariadb -e "SELECT name FROM \`tabPrint Format\` WHERE name='<name>'"`). Migrate force-deletes
   and recreates a same-named record, no backup.
5. A Custom Field's `insert_after` sets its section: verify the landing section/collapsible via `frappe.get_meta`.
   Correct the fixture JSON by hand too (migrate overwrites from it), never re-run export; confirm with two migrates.
6. New prop on a shared component: grep every `<Component` usage and confirm each forwards it.
7. After `bench setup nginx` / `lets-encrypt`, verify HTTPS on every existing domain, not just the new one.
8. wkhtmltopdf `load-error-handling` does not cover failed stylesheet fetches; `frappe.get_print()` injects
   `print.bundle.css`. For server-side PDFs read it from local disk (`frappe.local.sites_path` + href); don't just strip the link.
9. `request.js` exception_handlers (QueryDeadlock/QueryTimeout) show Frappe's dialog and return before your
   `frappe.call()` error handler runs; read its `.fail()` before assuming your classifier is reached.
10. Inline PDF on mobile needs a real navigation (hidden `<form method="POST" target="_blank">`), not a `blob:` URL.
11. Vuetify table layout fixes: measure in a real headless browser (Vuetify default cell padding, `table-layout: fixed`,
    no ellipsis in flex headers), not CSS arithmetic.
12. Auto-correct/rebalance logic: design and test BOTH directions (too much and too little).
13. Playwright against POS screens: time-box 10-15 min (terminal lock/PIN, opening shift, cart mechanics); if it
    isn't through, stop and report a code-level trace labelled "not yet live-verified".
14. Vitest bundles an older Vite that can't resolve `.js` imports of `.ts` files; don't normalise imports, accept the
    coverage gap. `wrapper.emitted()` records nothing here (NODE_ENV production): assert emits via listener props (`onFoo: vi.fn()`).
15. A `data()` property assigned from a deep-watched reactive object shares the reference; in-place mutation re-fires the
    watcher. Pass populated data to Variants.vue (`items` never empty).
16. Vuetify 3 here: Vuetify 2 class strings (`green--text`) do nothing. Use `variant`/`color` bindings; grep vuetify.css to confirm a class exists.
17. Don't classify scan vs typing by shape (length/charset). Tag confidence (hardware-timing = high), always attempt the
    lookup, show an error only on a high-confidence miss.
18. `<script setup>`: `getCurrentInstance()?.proxy` sees only `defineExpose`d names; grep the block for every `vm.*` property used.
19. `toastStore`: different keys queue one after another and add delay; give same-event toasts a shared key, drop pointless progress toasts.
20. Every `@frappe.whitelist()` method is callable by any logged-in user; add a server-side role check
    (`frappe.only_for("System Manager")` for infra data; `pos_access.py` `user_is_pos_supervisor()` for POS business actions).
    A `v-if` is not security.
21. Money: sum raw values and round once; use Frappe's `flt()`, never a `.toFixed()` reimplementation; no per-line rounding before summing.
22. Before trusting a feature works, grep for real call sites of its function (debounced handlers can have zero callers).
23. Key handlers: check every interception site for the same key, including capture-phase listeners on ancestors; use one shared predicate.
24. `Payments.vue` is rebuilt on every open: state that must survive belongs in a store, re-applied each opening; test the reopen path.
25. `onscan.js` is never loaded (`useScannerInput.ts` onScan path is dead); hardware scanners arrive as plain keystrokes.

## Commands
`bench build --app posawesome` · `bench --site <site> migrate` · `bench --site <site> console` ·
`bench --site <site> run-tests --module <module>` · `bench --site <site> clear-cache`
