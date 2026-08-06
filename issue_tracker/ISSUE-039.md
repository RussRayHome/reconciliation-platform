# ISSUE-039: No authenticated third-party penetration test exists

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Security
**Location:** security evidence (none on file)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
The only application security testing performed is the ZAP scan, which ISSUE-018 already records as
passive, unauthenticated, and covering 6 endpoints. No independent penetration test has been
commissioned.

A current (within 12 months) authenticated pen test report, with a remediation log and a retest
confirming closure, is the single most commonly requested security artifact in diligence for
financial software. It is requested by name, and its absence is recorded as a gap regardless of how
good the internal tooling is.

The specific hazard is presenting the ZAP results as though they answer the question. An
unauthenticated passive scan cannot reach the tenancy, authorization, or business-logic flaws that
matter most here — which are exactly the areas with open blockers (ISSUE-001, ISSUE-002, ISSUE-003).
A reviewer who spots that substitution discounts the rest of the security narrative.

## Fix
Close the open tenancy and auth blockers first — paying a firm to find ISSUE-001 is wasteful — then
commission an authenticated, multi-role, multi-tenant test scoped to include cross-tenant access
attempts, authorization bypass, and the file-upload path. Budget for a retest; the closure evidence
is worth as much as the original report.

Related: ISSUE-018, ISSUE-001, ISSUE-002, ISSUE-003, ISSUE-040.
