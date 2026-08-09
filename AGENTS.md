# AGENTS.md

## Project Rule

This repository contains deeply linked ERPNext / Frappe / POS Awesome features.

No feature should be changed as an isolated patch.

Before making any code change, Codex must read and follow:

1. `docs/ARCHITECTURE.md`
2. `docs/FEATURE_CONTRACTS.md`
3. `docs/CODEX_WORKFLOW.md`
4. `docs/TESTING_AND_VERIFICATION.md`

If any of these files are missing, Codex must report that first before coding.

---

## Mandatory Working Method

Before editing files:

1. Understand the requested bug or feature.
2. Identify all linked modules affected by the change.
3. Read the current implementation before modifying it.
3a. If the change involves permissions, roles, POS Profile settings, or any
    area where reading code alone can't confirm current behavior, verify
    directly against a live site via `bench --site <site> console` first —
    check `Patch Log` for migrations already applied and check whether
    fields referenced defensively in code (`getattr(doc, "field", default)`)
    still actually exist. Code can look authoritative while it's actually a
    stale fallback superseded by a later migration.
3b. Before creating any standard doc (Print Format, Page, Report, Workspace,
    etc.) under an app's module folder, check the target site for an existing
    record with the same name first, e.g. `bench --site <site> mariadb -e
    "SELECT name FROM \`tab<DocType>\` WHERE name='<name>'"`. `bench
    migrate`'s standard-doc sync force-deletes any existing record with that
    name (no backup, bypasses version history) before inserting the new one.
    Browsing Desk is not sufficient — check the database directly.
4. Find the single source of truth for the logic.
5. Avoid local one-file patches when the logic is shared.
6. Align frontend, backend, cache, sync, print, and reports where relevant.
7. Preserve existing ERPNext / POS Awesome behavior unless the task explicitly asks to change it.
8. After coding, explain:
   - Files changed
   - Why each file changed
   - Linked features affected
   - What was verified
   - Remaining risks
   - Suggested commit message

---

## Linked Feature Rule

When changing any POS feature, always check impact on:

- Item search
- Cart item row
- Pricing rules
- Discount percentage
- Discount amount
- UOM conversion
- Customer price list
- POS Profile configuration
- POS Profile price list
- POS Profile warehouse
- POS Profile payment methods
- POS Profile tax settings
- POS Profile print settings
- Stock validation
- Cart totals
- Payment screen
- Sales Invoice payload
- Backend API methods
- Offline IndexedDB/cache
- Sync logic
- Print format
- QZ Tray receipt
- Reports/dashboards

Never fix only the visible screen if the same logic is used elsewhere.

---

## POS Profile Configuration Rule

POS Profile is a central configuration source for POS behavior.

Before changing any POS feature, Codex must check whether the requested change depends on POS Profile settings.

Always consider POS Profile impact on:

- Company
- Warehouse
- Customer
- Price List
- Currency
- Taxes and Charges
- Payment Methods
- Stock validation
- Item filters
- Customer filters
- Sales Invoice defaults
- Print format
- Offline cache loading
- Opening and closing flows
- Any custom POS Profile fields

Do not hardcode behavior that should come from POS Profile.

Do not change pricing, stock, payment, printing, offline cache, or invoice payload logic without checking whether POS Profile controls that behavior.

---

## Single Source of Truth Rule

Business logic must not be duplicated across multiple components.

Prefer shared services, composables, utilities, or stores for:

- Price calculation
- Discount calculation
- UOM conversion
- Tax calculation
- Cart totals
- Customer price list resolution
- Stock validation
- Invoice payload preparation
- Offline sync transformation

If duplicated logic exists, refactor it carefully instead of adding another copy.

---

## Code Quality Rules

- Keep changes minimal only when minimal is correct.
- Full refactoring is allowed when required for correctness and long-term maintainability.
- Do not add new dependencies unless necessary.
- Do not remove existing behavior without explaining why.
- Do not silently ignore errors.
- Add safe fallbacks for offline/cache data.
- Avoid breaking existing POS flows.

---

## Done Definition

A task is complete only when:

1. The requested issue is fixed.
2. Linked features are checked.
3. Existing behavior is not broken.
4. Build/lint/test commands are run where available.
5. Risks are documented.
6. **Every implementation gets a full, professional-standard check, not just
   "does it work" — this is standard practice for every change, not
   something that only happens when explicitly asked:**
   - Confirm nothing else broke: run the relevant tests (frontend `vitest`,
     backend module tests in isolation given the known pre-existing
     `run-tests` environment crash), and check for regressions in shared
     files/composables/stores the change touches.
   - For anything touching user input, authorization, or data access, do a
     genuine security review — trace the actual code path rather than
     asserting it's safe: parameterized/escaped queries vs. string
     interpolation (trace into the ORM/driver, don't just assume the
     framework handles it), injection surfaces, XSS via `v-html` near
     user-controlled data, missing bounds/limits on anything a whitelisted
     method exposes (whitelisted methods are callable directly by any
     authenticated session, not just through whatever UI calls them today),
     and whether authorization is actually re-validated server-side or just
     trusts a client-supplied identifier.
