# ISSUE-003: `runInTenantScope` rollback path masks errors and can leak tenant across the pool

**Status:** Open · **Severity:** Blocker · **Area:** Tenancy / Persistence
**Location:** `packages/persistence/src/postgres.ts:78`
**Source:** Silent-failure review, 2026-08-03

## Problem
Two defects in the same `catch`:

1. **Error masking** — if `ROLLBACK` itself rejects, that rejection propagates and *replaces* the
   original error; `throw error` is never reached. The 500 handler then logs a connection error for
   what was actually a constraint violation or a failed `set_config`.
2. **Tenant bleed** — `client.release()` with no argument returns the connection to the pool as
   healthy. If `ROLLBACK` failed, the transaction may still be open with `app.current_organization_id`
   still set. node-postgres issues no `DISCARD ALL` on checkout, so the next request can inherit it.
   This is the exact failure ADR-0001 warned about.

## Fix
Isolate the rollback in its own try/catch, log the failure, and call `client.release(err)` with a
truthy argument so pg destroys the connection instead of reusing it. Always rethrow the original error.

## Related
- `set_config`'s return value is discarded — see ISSUE-022 if split out, otherwise fix here: compare
  the applied value to `organizationId` and throw if it did not stick.
- `organizationId` is unvalidated; a pre-deploy queued job without the field yields `undefined`.
