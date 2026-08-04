# ISSUE-018: ZAP scanning is passive, unauthenticated, and covers 6 endpoints

**Status:** Open · **Severity:** Carried over · **Area:** Security testing
**Location:** `scripts/pre-flight/zap-api-scan.sh:251`, `scripts/pre-flight/zap-web-scan.sh:166`,
`scripts/ops/zap-api-stage-targets.txt`
**Source:** 2026-08-03

## Problem
Three compounding limitations:

1. **Passive only.** Both scripts call `zap-baseline.py`, which observes spider traffic and reports on
   headers/cookies/information disclosure. It sends **no attack payloads**. `zap-full-scan.py` is the
   mode that actually attacks.
2. **Unauthenticated.** Zero occurrences of `Authorization`, `Bearer`, `jwt` or `token` in either
   script. With JWT and deny-by-default middleware now in place, a scan gets 401 on everything behind
   the guard and reports a clean result for an application it never entered.
3. **Six endpoints**, four of them `/api/developer/runtime` variants. Nothing covers alias CRUD,
   mapping profiles, reviewer decisions, workbook export, or any tenant-scoped route.

Last run **18 June 2026**; the job triggers only on push to `main`, so it has not run against any of
this work.

## Fix
Switch to (or add) `zap-full-scan.py`; wire a JWT via a ZAP replacer rule; expand the target list to
real business endpoints; add a cross-tenant probe (authenticate as tenant A, request tenant B's
resources, expect nothing).
