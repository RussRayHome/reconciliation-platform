# ISSUE-044: No requirements-to-test traceability matrix

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Testing
**Location:** repo-wide (no traceability artifact)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
Nothing maps the platform's stated capabilities to the tests that prove them. Coverage percentages
answer "how much of the code was executed"; they do not answer "is each thing this product claims to
do verified."

For financial software this distinction is the one auditors care about, and it is a standard request
in both SOC 2 work and acquisition diligence. It is also the artifact that makes the rest of the test
suite legible to a non-author — without it, a reviewer must infer intent from test names.

The matrix would also make the gaps already filed self-evident rather than requiring discovery: the
exception categories are well covered, while approvals, mapping profiles, and account management
have no e2e coverage at all (ISSUE-026).

## Fix
Build a table mapping each capability — ingest bank workbook, ingest GL workbook, match, classify
exceptions by category, triage, approve/reject, export, mapping profiles, audit trail, tenancy
isolation — to the specific tests that verify it, and mark the ones with no coverage. The empty rows
are the deliverable; they become the prioritised test backlog.

Related: ISSUE-026, ISSUE-040, ISSUE-048.
