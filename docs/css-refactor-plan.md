# Handoff: CSS Monolith → Layered Per-Component Stylesheets (v3)

**For:** Claude Code, executing in `reconciliation-platform` (branch off `dev`)
**Supersedes:** `docs/css-refactor-plan.md` in the repo, which targets a 2,129-line `styles.css`. The file is now **3,336 lines** — this plan is updated to current reality. Replace the repo doc with this one when you branch.
**Scope:** `apps/web/src/styles.css` (3,336 lines) + `packages/ui/src/styles.css` (~200 lines) + the Developer Dashboard's styles.
**Goal:** Split into a hierarchical, per-component structure using CSS `@layer`, with **zero visual change**. No Tailwind — the app is Vite + plain CSS + custom properties; keep it that way.

**Developer Dashboard boundary:** the dashboard (`apps/web/public/developer-dashboard.html`) is served from the **tools server**, not the app bundle. Its CSS must stay **separate**: it gets its own `dashboard/` tree and its own entry stylesheet, and is **never** imported by `styles/index.css` (nor vice versa). The ONLY shared file is `tokens.css` (values only, no selectors) — the dashboard tree copies or references tokens per §Phase 4b; everything else is duplicated deliberately rather than coupled across servers.

## Sequencing (matters)

1. Round 2 trust-bug fixes (`design_handoff_round2/`) — assumed landed; the Run Bar and triage CSS this plan moves came from that work.
2. **This refactor** — pure relocation, zero visual change.
3. Dark system (`design_handoff_dark_system/`) — its Phase 1 then swaps `styles/tokens.css` instead of hunting through a monolith. When executing the dark plan after this one, read "the `:root` block in `styles.css`" as `styles/tokens.css`, and per-component instructions as their `styles/components/*.css` file.

Do not interleave this with either of the above. One concern per PR.

## What changed since the repo's old plan (delta)

- `styles.css`: 2,129 → 3,336 lines.
- **Five** media blocks now, not three: `max-width: 1200px` (line ~768, mid-file), `max-width: 1280px` (~1866), `max-width: 980px` (~2569), `prefers-reduced-motion` (~2633), and `max-width: 960px` (~3303). Same rule applies to all: each component's slice moves into that component's file.
- ~670 lines of rules were **appended after** the `prefers-reduced-motion` block (triage master–detail, facets, more). Today they win some cascade ties purely by source order — `@layer` makes import order irrelevant, so Phase 0 visual baselines are the only safety net. Do not skip Phase 0.
- New component groups since the old plan (add to the target tree):
  - `components/run-bar.css` — `.run-bar`, all `.run-bar__*` BEM blocks (identity, fields, copy, overflow menu, status, progress meter, result, rules-used). ~200 lines starting ~line 243.
  - `components/triage.css` — `.exception-triage`, `.exception-facets*` (incl. `__sticky`), the master–detail grid. Keep separate from `exceptions.css` (list/table styles); triage is the Round 2 workspace.
- The old plan's line references are stale; its class inventories are still mostly correct. Re-derive each component's rule set by grepping selectors, not by line ranges.

## Ground rules

1. **Move, don't fix.** Byte-for-byte relocation. Known issues (960/980/1200 breakpoint sprawl, 9-value radius scale, hard-coded `#14532d`/`#134e4a`/`#0d5c55`/`#4a5f64`) go in §Follow-ups, not in this diff. A diff that changes selectors or values is a failed step.
2. **No `className` changes.** `.tsx` files are touched only to update `import` lines.
3. **Cascade safety via `@layer`.** Every rule ends up inside `@layer tokens|base|patterns|components`. Layer order is declared once in the entry file. After migration no unlayered rules remain except the fonts `@import`, which stays first.
4. **One phase per commit**, verification green before the next.
5. **Media queries travel with their component**, inside the same layer.

## Target structure

```
apps/web/src/styles/
  index.css              # fonts @import + @layer declaration + all imports
  tokens.css             # @layer tokens   — :root variables
  base.css               # @layer base     — *, body, focus-visible, ALL keyframes, control font reset, .visually-hidden
  patterns/
    layout.css           # .app-shell, .hero-backdrop, .app-layout, .page-footer
    surface.css          # shared frosted card treatment (hero/section/stat/chart/rule/login)
    buttons.css          # button, .secondary-button, .hero-primary-cta
    badges.css           # .eyebrow, .summary-badges
    forms.css            # .field-group, input/select, .field-hint, .field-help-popover, .help-icon-button, .label-input-row
    tables.css           # .table-shell, .table-toolbar, .table-scroll, .table-results-meta, .empty-state-card
  components/
    login.css            # .login-*
    user-role.css        # .user-role-shell*
    hero.css             # .hero-* (minus the primary CTA in buttons.css)
    tabs.css             # .tab-shell, .tab-list, .tab-button*
    upload.css           # .upload-form, .upload-actions, .trust-note, .status-banner, .error-banner
    run-bar.css          # .run-bar, .run-bar__*            ← NEW
    progress.css         # .process-progress-grid, .overall-progress-*, .step-progress-*, .progress-meter
    rules.css            # .rules-*, .rule-card*, .rule-variance*
    exceptions.css       # .exception-* list/table, .category-breakdown-*
    triage.css           # .exception-triage, .exception-facets*   ← NEW
    probable-matches.css # .probable-match-*
    reports.css          # .reports-*, .report-link*, .artifacts-grid
    charts.css           # .chart-grid, .chart-card, .chart-data-details
    docs.css             # .docs-* (largest single group)
    access-denied.css    # .access-denied-actions

apps/web/public/dashboard-styles/      # Developer Dashboard ONLY — tools server
  dashboard.css          # entry: @layer decl + imports below; <link>'d from developer-dashboard.html
  tokens.css             # BUILD-COPIED from src/styles/tokens.css (see Phase 4b) — never hand-edited
  dashboard-base.css     # dashboard's own resets/keyframes
  components/
    health.css           # service-health cards / status grid
    correlation.css      # correlation view
    run-log.css          # run log table
```

App CSS never references `dashboard-styles/`; dashboard CSS never references `src/styles/`. If a rule seems needed on both sides, duplicate it into the dashboard tree with a `/* dup: src/styles/... */` comment — cross-server imports are the failure mode this boundary exists to prevent.

`packages/ui/src/styles.css` stays one file, wrapped: shared `.section-card,.stat-card` surface block → `@layer patterns`, rest → `@layer components`. Imported by the app entry after local patterns.

**Entry file:**

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

@layer tokens, base, patterns, components;

@import './tokens.css';
@import './base.css';
@import './patterns/layout.css';
/* ...remaining patterns, then all components... */
```

`App.tsx` line 1: `import './styles.css'` → `import './styles/index.css'`. Verify `packages/ui/package.json` `exports["./styles.css"]` still resolves.

## Phase 0 — Baseline snapshots (no CSS changes)

1. Branch `refactor/css-layers` off `dev`.
2. Playwright spec `apps/web/tests/e2e/visual-baseline.spec.ts`, `toHaveScreenshot({ fullPage: true, animations: 'disabled' })`, reusing the login helper in `tests/e2e/auth.ts`. Capture at **1440px, 1100px, and 900px** (the 1200px block is new — three widths now, one per breakpoint band):
   - Login (+ error state)
   - As superuser: Upload, Rules, Exceptions **including the triage master–detail with facets open and the Run Bar in running + complete states** (mock or fixture the run), Reports
   - `/docs` hub + one open document
   - Developer: Access Denied · Analyst: workspace without admin controls
3. `--update-snapshots` once to record. Commit. **These are the acceptance oracle; the diff must stay empty in every later phase.**

## Phase 1 — Scaffold + tokens + base

1. `styles/index.css`: fonts `@import`, `@layer` declaration, and temporarily `@import './legacy.css'` — the renamed old `styles.css` wrapped whole in `@layer components { ... }`.
2. `tokens.css` (`@layer tokens`): the `:root` block.
3. `base.css` (`@layer base`): `* { box-sizing }`, `body`, control font reset, `:focus-visible`, `.visually-hidden`, and **all** `@keyframes` (`fadeInUp`, `slideInLeft`, `progressFill`, `pulse`, plus any added since — grep `@keyframes` and take everything). Keyframe names aren't layer-scoped; keep them only in `base.css`. `packages/ui` references `fadeInUp` without defining it — note this in a comment.
4. Update the `App.tsx` import. Verify. Commit.

## Phase 2 — Shared patterns

Extract most-shared first: `layout.css`, `buttons.css`, `badges.css`, `forms.css`, `tables.css`, `surface.css`.
`surface.css` is the subtle one: keep only the *shared* frosted declarations (background, blur, border, shadow, transition, animation); leave per-component radius/padding/hover for Phase 3. Delete moved rules from `legacy.css` after each extraction; verify; commit per file or per phase.

## Phase 3 — Per-component files (16 files)

Per file: move rules from `legacy.css` into `components/<name>.css` in `@layer components`; move that component's slices of **all five** media blocks into the same file; add the `@import`; delete from `legacy.css`; verify; commit per file (bisectable).

Watch for the post-`prefers-reduced-motion` appendix (lines ~2663–3336): several of its rules restyle selectors defined earlier in the file and currently win by source order. Once both copies are in the same layer and the same file, later-in-file still wins — **keep intra-component rule order intact when moving**.

**Done condition:** `legacy.css` empty → delete it and its import.

## Phase 4 — packages/ui alignment

Wrap `packages/ui/src/styles.css` as described. Run `packages/ui` tests + `UiCardPrimitives.test.tsx` + full verification. Commit.

## Phase 4b — Developer Dashboard extraction (tools server)

1. Extract the `<style>` block(s) in `apps/web/public/developer-dashboard.html` into `public/dashboard-styles/` per the target tree; replace with `<link rel="stylesheet" href="/dashboard-styles/dashboard.css">`. Byte-for-byte moves, same ground rules.
2. Tokens: add a build/prebuild step (or npm script, e.g. `sync:dashboard-tokens`) that copies `src/styles/tokens.css` → `public/dashboard-styles/tokens.css`, with a `/* GENERATED — edit src/styles/tokens.css */` header. Do NOT import across the boundary — the tools server serves only `public/`.
3. Verify the dashboard renders identically when served from the tools server (its own baseline screenshot — add one Phase 0 snapshot for the dashboard at 1440px if the e2e harness can reach the tools server; otherwise a manual before/after diff, noted in the PR).
4. Confirm the tools server's static config serves `dashboard-styles/` (same directory listing/headers as the HTML). Commit separately from Phase 4.

## Phase 5 — Audit

1. Dead-rule check: grep each remaining class selector against `apps/web/src` and `packages/ui/src`; list (don't delete) orphans under §Follow-ups.
2. Zero unlayered rules: nothing outside `@layer` blocks except imports in any file.
3. Full verification; update this doc's status; PR against `dev`.

## Verification (after every phase)

```bash
npm run typecheck --workspace @recon/web
npm run build --workspace @recon/web
npx vitest run
npx playwright test visual-baseline   # ZERO snapshot diffs
```

A snapshot diff means: (a) a rule left unlayered, (b) a source-order tie re-ordered by the move — check the post-2663 appendix first, or (c) a media-query slice left in `legacy.css`. Fix the move; never regenerate snapshots after Phase 0.

## Acceptance criteria

- `styles.css` gone; `styles/` tree matches target; all rules layered.
- Dashboard CSS lives only under `public/dashboard-styles/`; no import in either direction between it and `src/styles/`; token copy step wired into the build.
- Visual baselines pass unchanged at all three widths; unit + e2e green; production build succeeds.
- No `className` or markup changes in the diff.

## Follow-ups (OUT of scope — separate PRs)

1. Collapse the breakpoint sprawl (960/980/1200/1280) to two canonical breakpoints, reconciled with the `matchMedia('(min-width: 961px)')` listener in `ExceptionTable.tsx`.
2. Promote hard-coded colors (`#14532d`, `#134e4a`, `#0d5c55`, `#4a5f64`) into `tokens.css`.
3. Collapse the 9-value radius scale to 4–5 tokens (the dark system plan specifies the target: 6/8/12/999).
4. If the dashboard ever moves onto the app server, revisit the token copy step and consider sharing `patterns/` — until then the boundary stays hard.
5. Self-host or preload fonts instead of the render-blocking `@import`.
6. Delete dead selectors found in Phase 5.
7. Then: `design_handoff_dark_system/` Phase 1 lands as a `tokens.css` swap.
