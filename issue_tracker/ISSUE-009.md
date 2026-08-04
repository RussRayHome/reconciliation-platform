# ISSUE-009: Developer dashboard runtime request swallows every error

**Status:** Open · **Severity:** Ship with branch · **Area:** Developer Dashboard
**Location:** `apps/web/src/components/DeveloperDashboard.tsx:762`
**Source:** Silent-failure review, 2026-08-03

## Problem
`.catch(() => undefined)` on the `/api/developer/runtime` request hides 401, 403 and 500 alike. The
header renders `— @ —` for branch and commit and the "results from the latest check run on ___" line
goes blank, with no indication of what failed. The sibling status request handles this correctly via
`setStatusError`.

This nearly shipped as a hard break: on the committed tree both calls used bare `fetch`, so both would
have 401'd against the new deny-by-default middleware — and this catch would have hidden half of it.

## Fix
Surface runtime failures the way status failures are surfaced.
