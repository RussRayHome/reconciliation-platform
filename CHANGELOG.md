# Changelog

All notable changes to this repository should be recorded in this file.

The format is inspired by Keep a Changelog and adapted for a versionless internal application where dated entries may be more useful than semantic version tags.

## [Unreleased]

### Added

- Targeted TSDoc on the main backend entry points to improve near-code maintainability.
- Release documentation artifacts through `CHANGELOG.md` and `RELEASE.md`.
- Stage PostgreSQL pgAudit enablement for test-stage deployments, including dedicated stage DB preflight command support (`docker:db:preflight:test-stage`).

### Changed (Unreleased)

- Docker runbooks were consolidated under `scripts/pre-flight/` and `scripts/in-flight/`, replacing the previous Bash scripts under `scripts/ops/`.
- Dev/stage compose overlays now include both auxiliary admin services (`pgweb` and `nginx-ui`) with explicit resource limits and stop grace periods.
- Base compose now defaults `ENABLE_PGAUDIT=false` for production-safe behavior; dev/stage overlays and env files explicitly enable pgAudit.
- Testcontainers PostgreSQL integration tests now use `postgres:16.13` to align with the compose stack version.
- `docker:build`, `docker:up`, `docker:down`, and `docker:logs` scripts now resolve env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`) to prevent compose interpolation failures when local env files are absent.

### Documentation (Unreleased)

- Updated Docker/developer runbook docs to reflect nginx-ui service coverage, auxiliary health-check behavior, and pgAudit environment policy.

### Stage Operations

- Stage DB preflight now records pgAudit as enabled while temporarily allowlisting unresolved upstream base-image CVEs for non-blocking WARN status.
- Release gating docs now include a production follow-up marker to remove temporary DB allowlist entries once upstream fixes are available.

## [2026-04-03]

### Changed

- Improved developer status reporting, workspace tooling, and local quality visibility.
- Added developer endpoint integration coverage for health, developer status, runtime diagnostics, and guard behavior.

### Fixed

- Cleared lint failures caused by untyped Supertest response bodies in developer endpoint tests.
- Restored green repository health across lint, typecheck, tests, coverage, and security checks.

### References

- `95c4fcf` Improve developer status reporting and workspace tooling

## [2026-04-03 Earlier]

### Added Earlier

- Developer runtime diagnostics and developer dashboard health visibility.
- Recent-history health snapshots and test cleanup supporting the local dashboard workflow.

### References Earlier

- `0e97f5d` Add developer runtime diagnostics and test cleanup

## Changelog Maintenance Notes

- Add an `Unreleased` entry as part of any meaningful behavior, documentation, or operational change.
- Promote unreleased notes into a dated section when the team considers a release or milestone complete.
- Include commit references when no formal version tag exists.
