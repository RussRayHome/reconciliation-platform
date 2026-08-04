# ISSUE-012: E2E overview card renders green "Pass" while the suite is still running

**Status:** Open · **Severity:** Follow-up · **Area:** Developer Dashboard
**Location:** `apps/web/src/components/DeveloperDashboard.tsx:980`
**Source:** Silent-failure review, 2026-08-03

## Problem
`e2eVerdict` correctly returns `'neutral'` while a detached run is in progress (`:205-210`), and the
E2E detail panel handles it. The overview card's ternary has no `neutral` arm, so it falls through to
**"Pass"** with a `—%` headline and `0 passed / 0 failed`. A developer glancing at the overview sees a
green E2E card before a single spec has reported.

## Fix
Add a `neutral → 'Running'` arm to the verdict label.

## Related
`applyE2eResultToCache` (`apps/api/src/services/developerStatusService.ts:1204`) returns early with no
log when the cache is null. Benign — `lastCompletedE2eCheck` is assigned first — but a one-line
`logger.debug` would make the intent obvious.
