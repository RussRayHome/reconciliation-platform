# Implementation Backlog

This backlog converts the current compliance review into concrete implementation work items with exact file targets.

## Critical

### 1. Complete read-model separation

- Problem: the product still carried whole-run execution data through the API, disk snapshot, and browser cache.
- Why it matters: this increases payload size, browser memory pressure, stale-state risk, and rollout confusion between legacy snapshots and PostgreSQL-backed lifecycle persistence.
- Current implementation step completed:
  - API responses now return a lean report model.
  - Browser persistence now stores the lean report model rather than the full run graph.
  - File-backed latest-run snapshots now omit raw rows, normalized rows, match-results, and audit-event arrays.
- Remaining work:
  - Move `/api/reconciliation/latest`, `/api/reconciliation/:id`, `/api/reconciliation/:id/summary`, `/api/reconciliation/:id/exceptions`, and reviewer decision reads onto PostgreSQL query services.
  - Add pagination and filtering for exception retrieval.
- Affected files:
  - [apps/api/src/app.ts](apps/api/src/app.ts)
  - [apps/api/src/services/runRepository.ts](apps/api/src/services/runRepository.ts)
  - [apps/web/src/App.tsx](apps/web/src/App.tsx)
  - [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts)
  - [packages/domain/src/types.ts](packages/domain/src/types.ts)

### 2. Harden relational integrity in PostgreSQL

- Problem: some persisted cross-record links are UUID fields without foreign-key enforcement.
- Why it matters: orphaned match and exception records can accumulate and weaken confidence in the audit trail.
- Exact fixes:
  - Add foreign keys or documented integrity guards for `reconciliation_match_result.bank_transaction_id`, `reconciliation_match_result.qbo_transaction_id`, and `reconciliation_exception.canonical_row_id`.
  - Add migration coverage to validate legacy-safe rollout.
- Affected files:
  - [packages/persistence/src/schema.ts](packages/persistence/src/schema.ts)
  - [packages/persistence/src/reconciliationLifecycleStore.ts](packages/persistence/src/reconciliationLifecycleStore.ts)
  - [packages/persistence/tests/postgresLifecycleStore.test.ts](packages/persistence/tests/postgresLifecycleStore.test.ts)

### 3. Add operational PostgreSQL wiring tests

- Problem: the production startup path with PostgreSQL enabled was not directly exercised.
- Why it matters: migrations, pool creation, and lifecycle-store injection can regress without failing the default suite.
- Exact fixes:
  - Add startup-focused tests for `DATABASE_URL` handling, migration execution, and failure behavior.
  - Add route-level integration coverage for PostgreSQL-enabled reviewer decision persistence.
- Affected files:
  - [apps/api/src/server.ts](apps/api/src/server.ts)
  - [apps/api/src/app.ts](apps/api/src/app.ts)
  - [apps/api/tests/reconciliation.test.ts](apps/api/tests/reconciliation.test.ts)

### 4. Adopt Docker/Desktop as a first-class local stack

- Problem: the repository had no app containerization assets.
- Why it matters: reproducible local setup and deployment parity were missing.
- Current implementation step completed:
  - Added API and web Dockerfiles, an nginx reverse-proxy config, `.dockerignore`, and `compose.yaml` for web + API + PostgreSQL.
  - Added Docker helper scripts in the root package manifest.
- Remaining work:
  - Validate image builds in CI.
  - Add image scanning and push workflow if containers will be shipped.
- Affected files:
  - [apps/api/Dockerfile](apps/api/Dockerfile)
  - [apps/web/Dockerfile](apps/web/Dockerfile)
  - [apps/web/nginx.conf](apps/web/nginx.conf)
  - [compose.yaml](compose.yaml)
  - [.dockerignore](.dockerignore)
  - [package.json](package.json)

## High

### 5. Align docs and environment templates with the actual persistence model

- Problem: repository documentation still described an in-memory-first persistence model.
- Why it matters: maintainers will configure and reason about the system incorrectly.
- Exact fixes:
  - Update persistence, Docker, and environment documentation in the root README and developer setup docs.
  - Add PostgreSQL-related env vars to `.env.example`.
- Affected files:
  - [README.md](README.md)
  - [docs/architecture.md](docs/architecture.md)
  - [docs/developer-setup.md](docs/developer-setup.md)
  - [docs/postgresql-persistence-architecture.md](docs/postgresql-persistence-architecture.md)
  - [.env.example](.env.example)

### 6. Add missing indexes for report and review access paths

- Problem: write-path indexes are decent, but the future PostgreSQL read model will need more targeted support.
- Why it matters: switching reads to PostgreSQL without those indexes will create avoidable latency and scan risk.
- Exact fixes:
  - Add indexes for transaction-id match lookups, reviewer decision ordering, and exception access patterns used by UI filters.
- Affected files:
  - [packages/persistence/src/schema.ts](packages/persistence/src/schema.ts)
  - [packages/persistence/tests/postgresLifecycleStore.test.ts](packages/persistence/tests/postgresLifecycleStore.test.ts)

### 7. Expand UI and browser regression coverage around failure and responsive behavior

- Problem: the UI has good baseline tests, but many important flows still rely on indirect or single-path coverage.
- Why it matters: regressions in hydration, export, and mobile layouts are still likely.
- Exact fixes:
  - Add UI tests for lean-report hydration and JSON export behavior.
  - Add Playwright coverage for mobile viewport, upload failure, latest-run hydration, and workbook download flow.
- Affected files:
  - [apps/web/src/App.test.tsx](apps/web/src/App.test.tsx)
  - [apps/web/tests/e2e/reconciliation.spec.ts](apps/web/tests/e2e/reconciliation.spec.ts)

## Medium

### 8. Decompose the monolithic frontend shell

- Problem: `App.tsx` still contains too much orchestration, rendering, and view-state logic.
- Why it matters: maintenance cost and regression risk rise with every new feature.
- Exact fixes:
  - Extract report-shell, latest-run hydration, upload-workflow, and export-actions modules into focused components/hooks.
- Affected files:
  - [apps/web/src/App.tsx](apps/web/src/App.tsx)
  - [apps/web/src/hooks/useReconciliationRun.ts](apps/web/src/hooks/useReconciliationRun.ts)

### 9. Tighten coverage gates

- Problem: current repository coverage thresholds are low enough that weak coverage can still pass.
- Why it matters: passing coverage overstates test confidence.
- Exact fixes:
  - Raise thresholds progressively and add per-project minimums for API and persistence layers.
- Affected files:
  - [vitest.config.ts](vitest.config.ts)

## FIXME Reminders

Use this format for production gating items:

- `FIXME(prod-gate): <summary> | owner=<name-or-team> | tracking=<ticket-or-link> | exit=<clear-remediation-criteria>`

### 10. FIXME(prod-gate): Remove temporary npm-audit exception for ExcelJS and UUID

- Problem: Developer Dashboard currently reports two moderate vulnerabilities from `exceljs@4.4.0` pulling `uuid@8.3.2` (GHSA-w5hq-g745-h8pq).
- Temporary decision: allow this risk during local development only while core feature work is in flight.
- Exit criteria:
  - Upgrade to a dependency path that no longer includes the vulnerable UUID range, or replace the workbook library path if needed.
  - Re-run dashboard and workspace audit checks; security scan should no longer report these two findings.
  - Remove this FIXME entry once the dependency risk is remediated.
- Affected files:
  - [apps/api/package.json](apps/api/package.json)
  - [packages/core/package.json](packages/core/package.json)
  - [packages/test-fixtures/package.json](packages/test-fixtures/package.json)
  - [package-lock.json](package-lock.json)
