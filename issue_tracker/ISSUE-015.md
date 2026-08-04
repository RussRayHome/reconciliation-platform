# ISSUE-015: E2E spec "Probable matches view is reachable from the navigation rail" fails

**Status:** Open · **Severity:** Carried over · **Area:** Testing
**Location:** `apps/web/tests/e2e/reconciliation-edge-cases.spec.ts:345`
**Source:** 2026-08-03

## Problem
Not a stale selector. The rail link to Probable matches was **deliberately removed** in the v3 nav
restructure (`5f08130`), and `apps/web/src/App.test.tsx:1258` asserts it is gone. The route
`/probable-matches` still exists and renders; only the rail affordance was dropped.

Three sibling specs in the same block were genuine selector renames and are already fixed
(`'Recon summary'` → `'Reconciliation'`, `'Export'` → `'Reports'`).

## Decision needed
Rewrite the spec to navigate directly to the route, or delete it as superseded by the unit test.
