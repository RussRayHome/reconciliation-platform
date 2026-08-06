# ISSUE-032: E2E parallelism is capped by a 3-file suite

**Status:** Open · **Severity:** Follow-up · **Area:** Testing / CI
**Location:** `.github/workflows/dashboard-status.yml` (`e2e` job, `strategy.matrix.shard`)
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
The e2e job was sharded 4-way (`0d284c1`) and then trimmed to 3 (`7355269`, "to match spec file
count"). Playwright shards at file granularity, so the shard count is bounded by the three spec
files that exist — the trim was correct, but it records that the suite is thin rather than that the
sharding was wrong.

Two consequences:

- Adding coverage means adding spec *files*, not just tests, or shard balance degrades as one file
  grows.
- The 3-way split was adopted partly to work around an unexplained single-worker hang. That
  workaround is load-bearing and undiagnosed; if the underlying cause is a real
  concurrency/teardown bug it will resurface as the suite grows.

## Fix
When adding the coverage tracked in ISSUE-026/027/029/030, split it into separate spec files by
area (navigation, routes, accessibility, account, approvals, mappings) so shard count can grow with
it. Separately, note the single-worker hang as an unresolved cause worth revisiting rather than a
closed item.

Related: ISSUE-017 (CI now does run these tiers), ISSUE-026.
