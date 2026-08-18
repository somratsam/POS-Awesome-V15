# Claude Code Configuration for POSAwesome

## About This Project

POSAwesome is a Frappe application - a Point of Sale (POS) system built on the Frappe Framework. This is a full-stack web application with Python backend and Vue.js frontend components.

**Enhanced Camera Scanner**: Features advanced OpenCV-based image processing for superior barcode and QR code scanning with real-time image enhancement.

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
one new JSON object instead. The same caution applied again shortly after
for `Customer-posa_is_generic_customer`.

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