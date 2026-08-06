# ISSUE-026: E2E navigates to 3 of 21 declared routes

**Status:** Open · **Severity:** Follow-up · **Area:** Testing
**Location:** `apps/web/src/routes/routePaths.ts`, `apps/web/tests/e2e/`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
`routePaths` declares 21 destinations. Across all three Playwright spec files the only navigations
performed are `goto('/')`, `goto('/docs')` and `goto('/probable-matches')`. Every other route is
reached incidentally or not at all.

Never exercised by any e2e test:

- `approvalsPending`, `approvalsApproved`, `approvalsRejected`
- `accountProfile`, `accountSecurity`, `accountBilling`, `accountNotification`, `accountPreferences`
- `mappingProfiles`, `mappingCreate`, `mappingHistory`
- `forgotPassword`, `signup`, `support`, `documentationRunBook`

A route can 500, render an empty shell, or throw on mount and the suite stays green. The
reconciliation flow itself is well covered; nothing else is.

## Fix
A data-driven spec that iterates `routePaths` and, for each entry, asserts the route renders its
expected landmark heading and does not fall through to the `path="*"` login redirect
(`apps/web/src/App.tsx:459`). Keeping it driven off the exported `routePaths` object means new
routes are covered on the day they are added rather than opted in by hand.

Related: ISSUE-027 (the rail that links these routes is untested), ISSUE-033 (signup/support are
placeholders about to become real).
