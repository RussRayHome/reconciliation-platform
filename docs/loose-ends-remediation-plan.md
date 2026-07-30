# Loose Ends & Polish Remediation Plan

Produced from a full-repository sweep (frontend, backend, docs, tests, tooling) on 2026-07-30. Converts the findings into concrete, file-targeted work items, ordered by severity/impact. Each tier is independently shippable.

## Context

The sweep covered `apps/web`, `apps/api`, `packages/*`, `scripts/`, and `docs/`. The headline result: **the application has no real authentication or authorization boundary.** Login is a plaintext-password check that returns a display name with no token or session, and every other API route — including the ones that run reconciliations and return financial exception data — accepts requests from anyone, from any origin, with no credential at all. That is the first thing to fix. Everything else in this document is real but lower stakes.

Verified directly against the current code (not just reported secondhand):

- [apps/api/src/app.ts](apps/api/src/app.ts) line 1148 — `app.use(cors());` with no options, open to any origin.
- [apps/api/src/app.ts](apps/api/src/app.ts) line 1135 — `app.set('trust proxy', true)`, which trusts a client-supplied `X-Forwarded-For` unconditionally, defeating IP-based rate limiting.
- [apps/api/src/app.ts](apps/api/src/app.ts) line 1146 — the only middleware gating all routes is the rate limiter; there is no `Authorization`/session check anywhere in the file.
- [apps/api/src/app.ts](apps/api/src/app.ts) lines 1348-1360 — login does `SELECT ... WHERE user_name = $1 AND password = $2`, a raw plaintext comparison.
- [packages/persistence/src/schema.ts](packages/persistence/src/schema.ts) lines 531-555 — the `reconciliation_user` table has a plain `password TEXT` column, no hash/salt, and the associated trigger only tracks a `last_changed` timestamp.
- Every `/api/reconciliation/*` route (starting at [apps/api/src/app.ts](apps/api/src/app.ts) line 1492) runs with no auth check before it.

## Critical — Authentication & authorization

### 1. No password hashing

- Problem: passwords are stored and compared in plaintext, both in Postgres (`reconciliation_user.password`) and in the in-memory dev fallback (`localLoginUsers` in `app.ts` lines 202-292).
- Why it matters: a database read, backup leak, or log exposure directly exposes every user's real login credential.
- Fix: add `bcrypt`, extend the `postgresMigrations` array in [packages/persistence/src/schema.ts](packages/persistence/src/schema.ts) (same pattern as `create_reconciliation_user_table`) to add a hashed-password column plus a backfill for the existing rows, and update the login query in [apps/api/src/app.ts](apps/api/src/app.ts) line 1348 to use `bcrypt.compare`. Update `authenticateWithLocalUsers` (`app.ts` lines 277-292) to match.

### 2. No session or token

- Problem: `POST /api/auth/login` returns `{ username, firstName, lastName }` with nothing else. The frontend ([apps/web/src/App.tsx](apps/web/src/App.tsx) lines 156-192, `loadAuthenticatedUserSession`/`persistAuthenticatedUserSession`) just caches that response in `localStorage`. No subsequent request carries any credential.
- Why it matters: "login" is a UI convenience, not a security boundary — anyone who can reach the API at all is already authenticated to it.
- Fix: issue a signed, `httpOnly` session cookie on login, backed by a new `reconciliation_session` table (same migration pattern as above) or a short-lived signed JWT. Add a `requireAuth` Express middleware and a logout endpoint (none exists today).

### 3. Every route except login is unauthenticated

- Problem: no auth-check middleware exists anywhere in `app.ts`. `/api/developer/*` is gated only by the `developerDiagnosticsEnabled` feature flag ([apps/api/src/app.ts](apps/api/src/app.ts) line 1379), which defaults on outside production — that's a feature flag, not an authorization check.
- Fix: apply the new `requireAuth` middleware to everything under `/api/reconciliation`, `/api/aliases`, and `/api/developer`. Leave `/api/health`, `/api/metrics`, and `/api/auth/login` public.

### 4. Open CORS and spoofable rate limiting

- Problem: `app.use(cors())` ([apps/api/src/app.ts](apps/api/src/app.ts) line 1148) allows any origin. `app.set('trust proxy', true)` (line 1135) lets a client forge `X-Forwarded-For` to bypass IP-based rate limiting on the login endpoint, which currently shares the generic global limiter (`createApiRateLimiter`, lines 758-838) with no per-endpoint tightening or lockout.
- Fix: replace `cors()` with an explicit origin allowlist driven by an env var (same convention as the existing `DOCKER_ENV_FILE` config). Change `trust proxy` to a specific hop count or trusted-IP list matching the real Docker/nginx topology. Add a second, stricter rate limiter (e.g. 5 attempts/15 min, keyed by username+IP) mounted only on `POST /api/auth/login`.

**Verification:** add Supertest integration tests under `apps/api/tests/` asserting `/api/reconciliation/run` returns 401 without a session and succeeds with one. Manually confirm via `npm run docker:deploy` plus `curl` without a cookie.

## High — UX

### 5. 2.6MB logo rendered at 34-64px

- Problem: [apps/web/src/assets/kinney-highlander.png](apps/web/src/assets/kinney-highlander.png) (1024×1536, 2.66MB) is fetched on the login page and persistent header ([apps/web/src/App.tsx](apps/web/src/App.tsx) lines 1265, 1344) but rendered at 34-64px everywhere. An unused SVG of the same illustration already exists at [apps/web/src/assets/kinney-highlander.svg](apps/web/src/assets/kinney-highlander.svg) (3.6KB). A second byte-identical copy at [apps/web/public/kinney-highlander.png](apps/web/public/kinney-highlander.png) bypasses the Vite build pipeline entirely (used by `apps/web/public/developer-dashboard.html` line 23).
- Fix: swap both `<img>` sources to the SVG.

### 6. No focus management on the two real modal/drawer surfaces

- Problem: the docs image zoom dialog ([apps/web/src/components/DocsOverview.tsx](apps/web/src/components/DocsOverview.tsx) line 466) and the mobile exception drawer ([apps/web/src/components/ExceptionTriage.tsx](apps/web/src/components/ExceptionTriage.tsx) lines 436-459) don't trap focus or restore it to the triggering element on close; the drawer also has no Escape handler (the docs modal does, lines 217-233 — copy that pattern over).
- Why it matters: the drawer is the primary triage workflow on mobile — prioritize it over the docs modal if time is limited.

### 7. Developer Dashboard spins forever on a runtime-fetch failure

- Problem: `RuntimeHealthModule` and `RuntimeEventsModule` in [apps/web/src/components/DeveloperDashboard.tsx](apps/web/src/components/DeveloperDashboard.tsx) lines 358-430 never render `runtimeError`, unlike `RepositoryHealthModule`/`EnvironmentPromotionModule` two components over. If `/api/developer/runtime` fails, two of the four dashboard panels show "Loading…" indefinitely.
- Fix: thread `runtimeError` through to both modules, matching the existing pattern.

### 8. Inconsistent empty states

- Problem: `ChartsPanel.tsx` renders an axis-only empty chart with no message when there's no data; `DocsOverview.tsx` line 459 uses a bare, unstyled `<p>` for its no-results case, unlike the accessible `EmptyStateCard` pattern already established in `AppWorkspacePanels.tsx` line 547 and `ExceptionTriage.tsx` line 394 (`role="status" aria-live="polite"`).
- Fix: standardize all three on the existing `EmptyStateCard` pattern.

### 9. Color-only severity indicator

- Problem: [apps/web/src/components/ExceptionRow.tsx](apps/web/src/components/ExceptionRow.tsx) lines 59-64 conveys severity only via a CSS-colored dot marked `aria-hidden="true"`; the text label only appears once a row is expanded.
- Fix: add a visible/accessible severity label at the row level, reusing the `Pill` component already used the same way in `ExceptionEvidencePanel.tsx` line 88.

## Medium — Backend hardening & consistency

### 10. `zod` declared but never used

- Problem: `zod` is a dependency in `apps/api`, `packages/domain`, `packages/core`, and `packages/persistence` `package.json` files but never imported. All request validation in `app.ts` is ad hoc `typeof` checks.
- Fix: wire it up for real schemas (best fit: define them in `packages/domain`, already the shared-types package both `apps/api` and `apps/web` import from) or drop the dependency from all four.

### 11. Upload validation trusts client-supplied metadata

- Problem: `createUploadMiddleware` ([apps/api/src/app.ts](apps/api/src/app.ts) lines 610-624) checks `file.mimetype`/`file.originalname`, both attacker-controlled.
- Fix: add a magic-byte/structure check ahead of the ExcelJS parse.

### 12. Global error handler leaks raw driver error text

- Problem: [apps/api/src/app.ts](apps/api/src/app.ts) lines 1882-1917 forwards raw `error.message` (including from the Postgres driver) to unclassified 500 responses. Stack traces are correctly kept server-side; the message text isn't.
- Fix: map unknown errors to a generic client-facing message; keep full detail in the server log as today.

### 13. Expensive/sensitive routes share the generic rate limit

- Problem: `/api/reconciliation/run` (CPU-heavy) and `/api/developer/*` share the same global limiter as trivial GETs.
- Fix: a second limiter tier in the existing `createApiRateLimiter` factory. Becomes much more meaningful once item 3 (auth) lands.

### 14. CVE allowlist expires 2026-08-19

- Problem: [scripts/ops/db-cve-allowlist.txt](scripts/ops/db-cve-allowlist.txt) has 10 active exceptions, all expiring in about 3 weeks from the date of this sweep. Expired entries are silently ignored, so the next CVE/preflight scan after that date will start failing builds on all 10 unless re-triaged.
- Fix: calendar this before the expiry, not after a build breaks.

### 15. Dead files and unused dependency

- Problem: `apps/api/Dockerfile.bak` sits alongside the live `Dockerfile`; `lodash` is declared in `apps/web/package.json` but unused.
- Fix: delete both.

## Lower urgency — Docs, dead code, consolidation

### 16. Env-file setup instructions are wrong

- Problem: `README.md`, `docs/developer-setup.md`, and `docs/local-docker-platform.md` all say to `cp .env.docker.dev.fallback .env.docker`, but every `docker:*` npm script resolves `.env.docker.dev`. The documented step produces a file nothing reads.
- Why it matters: real onboarding trap for a new developer.

### 17. `docs/api.md` is stale

- Problem: missing 9 live routes (`/api/openapi.json`, `/api/metrics`, `/api/auth/login`, job-polling, reviewer-decision `DELETE`, the entire `/api/aliases` CRUD surface), doesn't document the async `202`/job-polling flow for `POST /api/reconciliation/run`, and lists 4 of 6 real `ReviewerDecisionOutcome` values.

### 18. `CHANGELOG.md` is ~6 weeks stale

- Problem: `[Unreleased]` says "no notable changes" despite a fully-merged CSS architecture refactor (18+ commits) and other backend work landing since the last dated entry.

### 19. Dead component

- Problem: [apps/web/src/components/RovingTabList.tsx](apps/web/src/components/RovingTabList.tsx) is not imported or rendered anywhere in the app.
- Fix: delete it (confirmed dead by two independent passes this session).

### 20. Duplicated formatting and storage-access helpers

- Problem: at least three independent duration/time formatters exist — `App.tsx` lines 297-303 (`formatElapsedLabel`, mm:ss), `DeveloperDashboard.tsx` lines 99-124 (`formatDuration`/`formatClock`, "Xm Ys" style), `SourceDropZone.tsx` lines 19-27 (`formatFileSize`) — none living in [apps/web/src/lib/format.ts](apps/web/src/lib/format.ts), which already exists for this purpose. Similarly, a "safe localStorage read/write with try/catch" pattern is hand-rolled independently in `useDensity.ts`, `useWatchlist.ts`, `exceptionTriage.ts`, `NavRail.tsx`, `App.tsx` (6+ call sites), and `main.tsx`.
- Fix: consolidate into `lib/format.ts` and a new `lib/storage.ts`.

### 21. Two untested core-value-prop functions

- Problem: `packages/core/src/reporting/chartData.ts` (`buildChartSeries`) and `packages/core/src/export/chartImage.ts` (`createBarChartPng`) have zero test coverage anywhere in the repo, despite feeding both the UI charts and the audit-facing workbook export. (The matching engine, similarity utilities, and exception classifier are all already thoroughly tested — this is a narrow gap, not a broad one.)

### 22. Orphaned payee-alias feature

- Problem: `/api/aliases*` in `app.ts` has persistence-layer tests but no route-level integration test and no frontend usage at all.
- Fix: either finish it (wire up a UI) or remove it.

## Verification summary

- **Critical tier:** new Supertest auth integration tests; manual session/logout check against the Docker dev stack.
- **High tier:** `npm run build` bundle-size diff; manual keyboard walkthrough of the docs modal and mobile drawer; `npm run test:e2e`.
- **Medium tier:** `npm run docker:preflight`; a Supertest case uploading a renamed non-xlsx file.
- **Lower-urgency tier:** `npm run lint`, `npm run typecheck`, `npm run analyze:unused-exports` after each removal; `npm run coverage` after adding the two new core test files (branch coverage is currently 75.21%, just over the 75% gate).
