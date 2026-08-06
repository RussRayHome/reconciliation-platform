# ISSUE-028: ISSUE-015 was closed by removing the assertion, leaving no rail-link guard

**Status:** Open · **Severity:** Follow-up · **Area:** Testing
**Location:** `apps/web/tests/e2e/reconciliation-edge-cases.spec.ts:345`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
ISSUE-015 asked whether to rewrite the failing "Probable matches is reachable from the navigation
rail" spec or delete it. It was rewritten: the test now calls `page.goto('/probable-matches')`
directly, with a comment recording that the rail link was deliberately removed in the v3 nav
restructure (`5f08130`).

The decision was reasonable, but the side effect was not accounted for. Swapping a click for a
direct `goto` removed the only test that verified a rail affordance leads anywhere. The suite no
longer detects rail-link removal — it was edited to stop asking. `App.test.tsx:1258` asserts *that
one* link is absent, which is a point fix, not a general guard.

The failure mode this leaves open: a nav restructure silently drops a link, e2e stays green because
every spec navigates by URL, and the regression ships.

## Decision needed
Decide what the suite should assert about the rail as a whole, then implement it under ISSUE-027 —
most likely a rail inventory test (every declared entry renders a link; entries deliberately absent
are listed explicitly) so that intentional removals require a visible edit to the expectation rather
than passing silently.

Related: ISSUE-015 (superseded by this), ISSUE-027.
