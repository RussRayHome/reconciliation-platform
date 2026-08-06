# ISSUE-035: No SBOM is produced for the dependency tree

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Supply chain
**Location:** repo-wide (build tooling)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
No CycloneDX, SPDX, or Syft tooling exists anywhere in the repo. There is no generated software
bill of materials for either the npm tree or the container images.

An SBOM is now a standard data-room request rather than an advanced one, and for a product handling
bank data it is often required by the acquirer's own vendor-onboarding process before their security
team will even begin review. Absent one, the buyer generates their own and works from a list you
have never seen — which means every finding arrives as a surprise.

Trivy already scans the images (`dashboard-status.yml`, `security` job), so most of the underlying
data is being collected; it is simply not being emitted in a portable format.

## Fix
Emit a CycloneDX SBOM for the npm workspace tree and for each published container image as a CI
artifact, retained per release. Trivy can emit CycloneDX directly, which makes this close to a flag
change on the existing job rather than new tooling.

Related: ISSUE-036 (license audit consumes the same artifact), ISSUE-024, ISSUE-025.
