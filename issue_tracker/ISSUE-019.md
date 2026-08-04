# ISSUE-019: `docker:db:preflight:dev` reports 13 passed / 1 failed

**Status:** Open · **Severity:** Carried over · **Area:** Database / Operations
**Source:** 2026-08-03

## Problem
The DB preflight — which is what the Developer Dashboard's "Postgres DB tests" panel actually runs
(`test:postgres:dashboard` → `docker:db:preflight:dev`) — reports one failing check. Nobody has
identified which one.

Note this is a shell preflight script, **not** the Vitest postgres suite; the "13 passed" number is
unrelated to the 33 tests in `npm run test:postgres`.

## Fix
Run `npm run docker:db:preflight:dev` and read the output to identify the failing check.
