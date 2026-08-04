# ISSUE-001: Workbook export has no tenant check

**Status:** Open · **Severity:** Blocker · **Area:** Tenancy / API
**Location:** `apps/api/src/app.ts:2014`
**Source:** Silent-failure review of `origin/dev...security-hardening`, 2026-08-03. **Verified by hand.**

## Problem
`GET /api/reconciliation/:id/export/workbook` calls `repository.findById(request.params.id)` and never
consults `request.auth`. Any authenticated user from any tenant can download another tenant's full
output workbook (bank + GL rows) given a run id. It reads the in-memory map rather than Postgres, so
RLS is no backstop. Every other reconciliation route in this branch was threaded with
`organizationId`; this one was missed.

## Fix
Resolve the run through the same tenant-scoped path as the sibling routes and 404 on a cross-tenant id.

## Verify
Authenticate as tenant A, request a run id belonging to tenant B, expect 404.
