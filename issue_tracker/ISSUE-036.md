# ISSUE-036: Dependency licenses have never been audited for copyleft exposure

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Legal
**Location:** repo-wide (`package-lock.json`, `packages/infra`)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
No `license-checker`, `licensee`, or equivalent tooling is present, and no license inventory exists.
Nobody has established what licenses the transitive tree carries.

The risk is narrow but severe: a single AGPL or SSPL dependency reachable from shipped server code
can, depending on the license, create an obligation to release source — which for a product being
sold is a direct hit to the asset being bought. Buyers' counsel checks this specifically, and an
unresolved copyleft finding routinely becomes an escrow or indemnity term rather than a fix.

The npm tree here is deep (React, Express, CDK, Playwright, Liquibase tooling), so the answer is
almost certainly fine — but "almost certainly" is not the standard, and the check costs an
afternoon.

## Fix
Run a license inventory over the production dependency set (dev-only dependencies are a separate
and much lower-risk category — distinguish them), record the result, and add a CI gate that fails on
any license outside an approved allowlist. Keep the generated inventory in the repo so its date is
visible.

Related: ISSUE-035 (SBOM is the natural input), ISSUE-037.
