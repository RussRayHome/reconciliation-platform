# ISSUE-048: Silent coercion in the matching path is a control risk, not a defect — re-triage

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Correctness
**Location:** see ISSUE-010, ISSUE-011
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
Two open issues are currently filed at Follow-up severity:

- **ISSUE-011** — `matchConfidence` coerces invalid input to `1.0`
- **ISSUE-010** — `transform` enum `.catch(undefined)` silently discards mapping rules

Filed as code defects, that severity is defensible. Assessed as financial controls, it is not. Both
convert bad input into *confident-looking output*: the first reports maximum confidence precisely
when confidence is unknown, and the second drops a user-configured mapping rule with no signal that
it was dropped. In a reconciliation product these are the worst available failure modes, because the
system's entire value proposition is that its output can be trusted without re-checking.

A domain-expert reviewer will find both quickly — invalid-input handling in a confidence score is
something they look for specifically — and will read them as evidence about how the codebase treats
correctness generally, not as two isolated bugs. That inference then colours the review of code they
have not read.

## Fix
Re-triage both to blocker severity and fix them ahead of any diligence process. More usefully, treat
them as a class: sweep the matching, mapping, and ingest paths for other places where invalid or
unparseable input is coerced to a default rather than rejected or surfaced. `.catch()`, `??`, and
`||` on domain values are the patterns to grep for.

Related: ISSUE-010, ISSUE-011, ISSUE-044, ISSUE-039.
