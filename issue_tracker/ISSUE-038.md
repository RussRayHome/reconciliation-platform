# ISSUE-038: Key-person risk is undocumented and unmitigated

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / People
**Location:** repo-wide (no onboarding or ownership documentation)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
The platform is single-authored. That is an asset for IP provenance (clean, uncontested ownership —
see ISSUE-037) and a liability for operational continuity, and diligence scores both.

The specific finding a reviewer records is not "one developer" — that is expected at this stage —
but "one developer, and nothing written down that would let a second person operate the system."
There is no onboarding guide, no ownership map, no description of which parts are subtle. `CLAUDE.md`
documents commands but not reasoning; the ADRs cover two decisions, not the system.

This typically converts into deal *structure* rather than deal *price*: retention terms, earn-outs,
or a transition-services commitment. Reducing it is one of the higher-leverage things a solo seller
can do.

## Fix
Write an onboarding document that gets a competent engineer to a running local stack and a first
merged change — and then test it by following it literally from a clean machine. Add a short
"subtle parts of this system" section covering the matching engine's confidence model, the tenancy/
RLS mechanism, and the Liquibase rollback conventions. These are the three areas where a newcomer
would most plausibly cause damage.

Related: ISSUE-037, ISSUE-045.
