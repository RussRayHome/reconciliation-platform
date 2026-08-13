# Changelog

<!-- markdownlint-configure-file {"MD024": {"siblings_only": true}} -->

All notable changes to this repository should be recorded in this file.

The format is inspired by Keep a Changelog and adapted for a versionless internal application where dated entries may be more useful than semantic version tags.

## [Unreleased]

### Added

- `bray2` / senior-analyst seeded as a permanent dev/stage login account (`scripts/db/dev-stage/create-users.psql`, `apps/api/src/app.ts`'s local-login fallback) -- the only role besides admin/superuser that can submit an import run, needed for E2E coverage of the File Imports & Validation upload flow.
- New changeset `0049_grant_app_user_file_import_sequences.sql` grants `app_user` `USAGE, SELECT` on the `validation_issue`/`normalized_record` BIGSERIAL sequences and adds the missing `ALTER DEFAULT PRIVILEGES ... ON SEQUENCES` clause for future tables.
- E2E: `apps/web/tests/e2e/functional/file-import-screens.spec.ts` covers Screen 02's network-interruption/retry state and Screen 06's partial-import flow.
- E2E: `apps/web/tests/e2e/fileValidationWorkbooks.ts` provides File-Validation-compliant bank/GL fixture builders for E2E specs, separate from `packages/test-fixtures`'s pre-File-Validation row sets.

### Changed

- `LIQUIBASE_IMAGE` default (`compose.yaml`, `packages/persistence/liquibase/Dockerfile`) pinned to `4.31`, matching `packages/persistence/tests/testHelpers/liquibase.ts`'s existing pin.

### Fixed

- `app_user` could not insert into `validation_issue` or `normalized_record` ("permission denied for sequence ..._id_seq") on any freshly migrated database: changeset `0031`'s default-privilege grant covered future tables but not sequences, so the BIGSERIAL `id` columns changeset `0042` added were never granted. This blocked every import run past the upload step. Fixed by changeset `0049`.
- Liquibase `4.33.0`+ rejects this project's `includeAll`-loaded formatted-SQL changesets with a Pro-license error; pinning to `4.31` (already proven by the Testcontainers-based Postgres-integration suite) fixes migrations on any freshly created database.
- E2E specs (`reconciliation.spec.ts`, `reconciliation-edge-cases.spec.ts`, `route-sweep.spec.ts`, `visual-baseline.spec.ts`, `auth.ts`) updated for Phase 9's "Run reconciliation" → "Submit run" button rename, and for the File Validation Engine's structural header requirements -- the shared `packages/test-fixtures` row sets use the pre-File-Validation header convention and no longer pass Step 1 on their own.

## [2026-06-18]

### Added

- `splitAmount` added as a first-class `BusinessField`. `RawTransactionRow` gains `splitAmountRaw`, `NormalizedTransaction` gains `splitAmount: number | null`, the Excel parser maps it via configurable column aliases (`split amount`, `split amt`, `line amount`, `line amt`, `distribution amount`), and `normalizeTransactions` parses it with the same signed-currency logic as `amount`. This field carries the individual line amount from GL split transactions, enabling Fee Netting and deep Split Expense rule implementations.
- Targeted TSDoc on the main backend entry points to improve near-code maintainability.
- Release documentation artifacts through `CHANGELOG.md` and `RELEASE.md`.
- Stage PostgreSQL pgAudit enablement for test-stage deployments, including dedicated stage DB preflight command support (`docker:db:preflight:test-stage`).
- `git` and `ca-certificates` installed in the `dev-base` Dockerfile stage, enabling the tools container to read repository context and make verified TLS connections.
- `Trivy 0.70.0` binary added to the tools image via multi-stage copy from `aquasec/trivy:0.70.0`; the tools container now runs full CVE scans for all four security components (API, Database, Container, Web Server) without requiring host execution.
- Developer Dashboard Environment Promotion Matrix now shows live git data: current branch, commit SHA, sync state, and baseline tag comparison. Requires the `.git` directory mounted read-only into the API container.
- `DEVELOPER_SKIP_DIRTY_CHECK` env var support in `developerRuntimeService.ts`; set to `true` in the API container (which holds only dist artifacts) so dirty-state detection does not produce false ATTENTION status.
- `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` env vars added to both API and tools services in `compose.dev.yaml` to satisfy Git's safe-directory ownership check when the host `.git` directory is mounted into Linux containers.
- `packages/infra` CDK package excluded from root ESLint config and `tsconfig.typecheck.json`; the package uses its own `tsconfig.json` and `aws-cdk-lib` dependencies not available in the monorepo root.
- Playwright upgraded from `1.53.0` to `1.59.1` (chromium revision 1217); pre-downloaded Linux browser binaries updated in `playwright-browsers/` to match.

### Changed

- Docker runbooks were consolidated under `scripts/pre-flight/` and `scripts/in-flight/`, replacing the previous Bash scripts under `scripts/ops/`.
- Dev/stage compose overlays now include both auxiliary admin services (`pgweb` and `nginx-ui`) with explicit resource limits and stop grace periods.
- Base compose now defaults `ENABLE_PGAUDIT=false` for production-safe behavior; dev/stage overlays and env files explicitly enable pgAudit.
- Testcontainers PostgreSQL integration tests now use `postgres:16.13` to align with the compose stack version.
- `docker:build`, `docker:up`, `docker:down`, and `docker:logs` scripts now resolve env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`) to prevent compose interpolation failures when local env files are absent.
- `nginx-config.test.ts` switched from `docker run -v` volume mount to `docker run -i` stdin pipe; the previous approach failed inside the tools container because temp paths created in the container are not accessible by the host Docker daemon.
- `tools` service now joins the `default` compose network in addition to `app` and `data`; external connectivity is required for Trivy database downloads and npm audit registry access.

### Fixed

- Stage tools container was missing the `default` network, causing all four security-scan components to report SKIPPED in the Stage Developer Dashboard; Trivy could not download its vulnerability DB and npm audit could not reach the registry. `compose.stage.yaml` now includes `default` in the tools service network list, matching `compose.dev.yaml`.
- Stage tools container was missing `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` env vars, causing git safe-directory failures when the host `.git` directory is mounted. These vars are now set in `compose.stage.yaml` to match the dev overlay.
- Stage E2E tests failed with `browserType.launch: Executable doesn't exist` because the stage tools container was running a stale image (built before the playwright 1.53.0 → 1.59.1 upgrade) that contained `chromium_headless_shell-1178` instead of revision 1217. Force-recreating the stage tools service pulled the current `reconciliation-platform-tools:latest` image.

- NGINX configuration test (`nginx-config.test.ts`) failed when executed inside the tools container because the container-local temp file path was invisible to the host Docker daemon. Stdin piping (`-i` + `execSync input:`) resolves this without any volume mount, and works identically on host and in container.
- Static analysis (`lint` + `typecheck`) produced 242 errors from `packages/infra` CDK code that references `aws-cdk-lib`, which is not hoisted to the monorepo root. Both `eslint.config.mjs` and `tsconfig.typecheck.json` now exclude `packages/infra/**`.
- All four security-scan components (API, Database, Container Component, Web Server) reported SKIPPED because Trivy was not present in the tools image. The `dev` Dockerfile stage now copies the binary from an `aquasec/trivy:0.70.0` build stage.
- Trivy database downloads failed with x509 certificate errors because `node:bookworm-slim` does not include CA certificates. `ca-certificates` is now installed alongside `git` in the `dev-base` stage.
- Developer Dashboard Environment Promotion Matrix showed PENDING for all git fields because `git` was not installed in the `dev-base` stage and the `.git` directory was not mounted into the API container.
- E2E tests completed in 3–4 ms (all skipped) due to a Playwright/browser version mismatch: the `tools-node-modules` volume held `@playwright/test@1.59.1` (requiring chromium revision 1217) while the image contained chromium-1178 (built for 1.53.0). Updating `PLAYWRIGHT_VERSION` to `1.59.1` and providing matching Linux binaries in `playwright-browsers/` restored real browser execution.

### Documentation

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
