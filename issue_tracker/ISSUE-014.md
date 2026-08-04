# ISSUE-014: FIXIT — finish or revert the background E2E dashboard change

**Status:** Open · **Severity:** Carried over · **Area:** Developer Dashboard
**Source:** 2026-08-03. See memory note `dev-dashboard-e2e-panel`. Committed as a **draft**.

## Problem
The E2E panel was permanently empty because the check ran inline with a hard 240s budget while the
suite is 49 specs at `workers: 1` — Playwright writes its JSON report only at the end, so a killed run
produced no report. A partial fix was committed but **never confirmed working**.

Two gaps remain:

1. The running placeholder only reaches the cache when the force refresh **returns**, and that request
   still blocks ~7 minutes on coverage + security. If E2E finishes first, the running state is never
   observable. `startE2eBackgroundRun()` must write the placeholder into `developerStatusCache` at
   **start**, not at completion.
2. The deployed bundle contained the new 30-minute timeout (the `240000` literal was absent) yet a run
   still ended at 240017ms. Never root-caused — something else caps it at 240s.

## Acceptance
Force refresh returns promptly, the panel shows the running state while the suite runs, and fills with
per-spec rows on completion. **Reverting the change entirely and keeping only the selector fixes is an
equally acceptable outcome.**
