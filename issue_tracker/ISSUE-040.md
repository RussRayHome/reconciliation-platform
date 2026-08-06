# ISSUE-040: No SOC 2 Type II or readiness assessment — longest lead-time item

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Compliance
**Location:** compliance evidence (none on file)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
No SOC 2 report, readiness assessment, or control documentation exists. For software that ingests
bank statements and general-ledger data, SOC 2 Type II is the default expectation of both acquirers
and their customers.

**This is the longest lead-time item on the entire readiness list and should be treated as the
scheduling constraint for a sale, not as a task.** Type II requires an observation window over which
controls are evidenced — commonly 3 to 12 months — so it cannot be compressed once diligence has
started. A seller who begins at term-sheet stage cannot produce one before closing.

The gap is narrower than it looks in practice: several Type II control families are already
partially satisfied by work that exists — access control (ADR-0002), change management (Liquibase
plus CI gates), vulnerability management (Trivy plus the CVE exception register), and encryption in
transit (ISSUE-023). What is missing is the framing, the policies, and the evidence collection, not
the underlying engineering.

## Fix
Decide now whether a sale is close enough to warrant starting. If yes, begin with a readiness
assessment to establish the control gap list, then start the observation window. If the timeline
does not permit Type II, a completed readiness assessment plus a dated remediation roadmap is the
recognised fallback and is meaningfully better than nothing.

Related: ISSUE-039, ISSUE-041, ISSUE-047.
