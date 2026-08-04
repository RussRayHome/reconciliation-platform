# ISSUE-025: HIGH severity brace-expansion CVE via aws-cdk-lib (pre-existing)

**Status:** Open · **Severity:** Follow-up · **Area:** Security / Dependencies
**Location:** `node_modules/aws-cdk-lib/node_modules/brace-expansion` (transitive)
**Source:** Surfaced by `npm run security:scan` failing on dependabot PR #10, 2026-08-04. Predates
this branch/session — not introduced by any recent work.

## Problem
`npm audit` reports a HIGH severity finding: `brace-expansion` 4.0.0 - 5.0.8 has a DoS via
unbounded intermediate arrays that bypasses the CVE-2026-14257 mitigation
([GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)), pulled in transitively
through `aws-cdk-lib` (used by `packages/infra`). `npm audit fix` reports a fix is available
without a breaking change flag, unlike ISSUE-024.

## Fix
Run `npm audit fix` (or bump `aws-cdk-lib` far enough that its `brace-expansion` transitive
dependency resolves outside the vulnerable range) and confirm `packages/infra` still builds/type
checks afterward.
