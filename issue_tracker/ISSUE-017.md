# ISSUE-017: CI does not run postgres, coverage, or e2e suites

**Status:** Open · **Severity:** Carried over · **Area:** CI
**Location:** `.github/workflows/docker-validate.yml`
**Source:** 2026-08-03

## Problem
CI runs `npm run test` (unit + integration only), typecheck, lint, security scan and ZAP. It does not
run:

- `npm run test:postgres` — including the pgTap schema-drift baseline and the Liquibase rollback suite
- `npm run coverage` — so the 75% branch threshold is enforced nowhere
- `npm run test:e2e` — ~49 Playwright specs

The schema baseline only protects against drift if something runs it; otherwise a changeset lands with
a drifted schema and nobody finds out until deploy. A coverage threshold nothing enforces is
documentation, not a gate. ISSUE-015 exists precisely because e2e does not run in CI.

## Fix
Add jobs for the three tiers. Postgres needs Docker for Testcontainers; `globalSetup.ts` starts one
container per run, so a service container or DinD both work.
