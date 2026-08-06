# ISSUE-047: No change-management or segregation-of-duties evidence for SOX/ICFR scope

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Compliance
**Location:** process (no documented change-management controls)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
If the acquirer is a public company, this platform becomes part of their internal control over
financial reporting the moment it touches customer books. Their auditors will then ask questions
this project has no answer to:

- Can a single person change production financial data without a second party's involvement?
- Is every production change traceable to an approved, reviewed source change?
- Who holds production database credentials, and is that access logged and reviewed?

For a solo-developed platform the honest answer to the first is yes, and there is currently no
compensating control documented. `pgaudit` is wired (`eb39488`) and provides the logging substrate,
but logging without review is evidence collection, not a control.

The related integrity flaw is already filed: ISSUE-008 records that mapping profile audit
attribution is client-supplied. An audit trail whose actor field the client controls will not satisfy
an ICFR reviewer, because it cannot establish who did what.

## Fix
Two tracks. Engineering: close ISSUE-008 so attribution is server-derived, and confirm `pgaudit`
captures privileged data changes. Process: document the change-management path from commit to
production, state which CI gates are mandatory, and record how production credentials are held and
reviewed. Where segregation of duties is genuinely impossible at current headcount, say so
explicitly and name the compensating control — an acknowledged limitation is treatable, an undetected
one is not.

Related: ISSUE-008, ISSUE-040, ISSUE-006, ISSUE-022.
