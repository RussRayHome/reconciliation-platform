# ISSUE-051: Global branch coverage below the 75% CI threshold

**Status:** Fixed 2026-08-07 (75.34%, was 73.29%) · **Severity:** Was non-blocking · **Area:** Testing
**Location:** `vitest.config.ts` coverage thresholds; primarily `apps/web/src/components/SignupScreen.tsx`,
`apps/web/src/components/MappingCanvas.tsx` (or equivalent), `apps/api/src/services/entityVerificationService.ts`
**Source:** `npm run coverage` CI job investigation, 2026-08-07.

## Problem
`npm run coverage` fails its own branch-coverage gate: 73.29% against a 75% global threshold
(statements 84.67%, functions 81.85%, lines 85.47% all clear their own bars fine — only branches
is short). This is not new: the same job failed identically at 73.07% before any of the Secret
Integrity / Developer Dashboard work in this branch's history, and none of that work's files
(`apps/developer-dashboard-api`, `apps/developer-dashboard-web`, `scripts/security-scan-secrets.mjs`)
are even inside this coverage run's tracked package list — the shortfall is entirely pre-existing.

By file, the worst offenders in the coverage report:
- `entityVerificationService.ts` — 0% branches
- `MappingCanvas`-equivalent component — ~10% branches
- `SignupScreen.tsx` — ~23% branches
- `authMiddleware`/verification-gate paths generally under-covered relative to the rest of `apps/api`

All from the signup/entity-verification work (`4a66b81`, `07077d3`, `2a724e1`) landing without the
test coverage to match — consistent with the other gaps already found nearby (ISSUE traceability
matrix, the stale rollback-test assumptions, the `reconciliation_user` access-guard miss).

## Fix

Closed by writing real branch tests for the highest-uncovered-count pure-logic files in `apps/api`,
rather than the React components originally called out above (equivalent branch count, far cheaper
to test directly with no render/interaction setup):

- `entityVerificationService.ts` (0% → 100%): every `MockEntityVerificationProvider.verify` branch
  (empty/all-zero/`9999`-marker/real filing numbers) and every `resolveEntityVerificationProvider`
  branch (unset/empty/`mock`/unknown provider name).
- `identityVerificationService.ts` (0% → 100%): `verifyIdentityCode`'s four guard branches
  (missing hash, missing expiry, expired, wrong code) plus the logger-present/absent branches in
  `MockNotificationChannel`.
- `apps/api/src/services/developerStatusParsing.ts` (80.68% → 92.41%, 84 → 33 uncovered):
  `parseSecretMetadata` had zero tests despite being new code from this same work session: full
  occurrence-parsing, verified tri-state, tools-flag coverage, plus `parseSecurityMetadata`'s
  invalid-severity/path/status branches and `parseTestHighlights`'s partial-match branches.
- `apps/api/src/validation.ts` (73.68% → 93.42%): direct `.safeParse()`/`.parse()` tests against the
  zod schemas' `superRefine` branches (password rules, username/email shape, verification-channel
  phone requirement, reviewer-decision target/outcome pairing) rather than going through full
  supertest route calls.
- `apps/api/src/telemetry.ts` (15% → 100%): mocked the three `@opentelemetry/*` packages
  (same pattern as the existing `sentry-service.test.ts`) to cover the enabled/disabled flag check
  and both branches of the trace-endpoint URL normalization.

Global branches: 73.29% → 75.34% (3552 → 3651 of 4846), a 16-branch margin above the 75.0%/3634.5
cutoff rather than the 75.01% this would have landed on with just the first four files — deliberately
not left razor-thin, since a single unrelated future change could otherwise flip it back to failing.

Not touched: the React components originally flagged (`SignupScreen.tsx`, `CreateMappingCanvas.tsx`,
`app.ts`'s many small route branches) remain under-tested. They weren't necessary to clear the
global threshold and are a legitimately larger, separate effort (render/interaction test setup) —
worth its own pass if branch coverage on those specific files matters later.

Related: ISSUE-044 (traceability matrix would have made this gap visible sooner).
