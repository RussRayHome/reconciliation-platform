# ISSUE-051: Global branch coverage below the 75% CI threshold

**Status:** Open · **Severity:** Non-blocking (tracked, not gating) · **Area:** Testing
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
Write real branch-coverage tests for the specific under-covered paths above — verification-status
transitions (pending/verified/failed), signup form branches, and mapping-canvas conditional
rendering — not a blanket test-everything pass. Re-run `npm run coverage` after each file to track
convergence toward 75%. Until then, the CI `coverage` job's threshold check is expected to stay red;
that is accurate signal, not noise, so resist the temptation to lower the threshold to make it green
without the underlying tests.

Related: ISSUE-044 (traceability matrix would have made this gap visible sooner).
