# ISSUE-002: In-memory fallback routes around RLS

**Status:** Open · **Severity:** Blocker · **Area:** Tenancy / API
**Location:** `apps/api/src/app.ts:1243` (`loadFromReadModelOrRepository`)
**Source:** Silent-failure review, 2026-08-03. **Verified by hand.**

## Problem
The helper falls back to a global in-memory `Map` when the read model returns `undefined`. Under RLS,
"row belongs to another tenant" and "row does not exist" are the **same signal**, so a cross-tenant
miss falls through and returns another tenant's run.

Affects `/api/reconciliation/latest`, `/:id`, summary, and exceptions.

## Fix
When `readModelStore` is configured it is authoritative — do not fall back. Copy the pattern already
used correctly by `loadRunExceptionPage` and `loadReviewerDecisions`, which gate on `readModelHasRun`.
Longer term, give the in-memory repository an `organizationId` so the no-Postgres dev path is not a
tenancy hole either.

## Verify
As tenant B with no runs, `GET /api/reconciliation/latest` must return 404, not tenant A's run.
