# ISSUE-034: A green "e2e" card overstates how much of the application was swept

**Status:** Open · **Severity:** Follow-up · **Area:** Developer Dashboard
**Location:** `apps/developer-dashboard-web` (testing cards), `.github/workflows/dashboard-status.yml`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
The dashboard renders eight check cards (unit, integration, postgres, lint, typecheck, coverage,
security, e2e). Presented as a row of green tiles, this reads as *the application was swept end to
end*. For the e2e card it means three spec files passed, covering the reconciliation flow, three
route URLs, and four screenshot scenarios.

This is a reporting-fidelity problem rather than a test-quality one, and it is the second of its
kind on this surface — ISSUE-012 recorded the E2E card rendering green "Pass" while the suite was
still running.

It matters most in exactly the setting the dashboard exists for. Under acquisition due diligence a
green board is treated as an assurance claim; the gap between what it implies and what it verifies
is the kind of thing a technical reviewer finds and then discounts everything else on the board.

## Fix
Show the denominator on each card, not just pass/fail — spec/test counts for e2e, line and branch
percentages for coverage, endpoint count for the security scan. A card reading "e2e — 3 files, 46
tests" is honest and costs nothing; the aggregate already has the data in the merged shard report
(`scripts/ci/merge-e2e-shards.ts`).

For reference, the suite declares 2 + 32 + 4 tests, the last parameterised across three viewport
widths — 46 at runtime, of which 12 are screenshot comparisons.

Related: ISSUE-012, ISSUE-018 (ZAP covers 6 endpoints — same denominator problem), ISSUE-026.
