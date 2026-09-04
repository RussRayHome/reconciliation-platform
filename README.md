# Bank-to-GL Reconciliation Platform

The reconciliation platform compares bank and GL workbooks, classifies accounting exceptions, and produces an auditor-friendly workbook export with traceable source lineage.

> **Start here:** Analysts and reviewers should begin with `docs/user-quickstart.md`. Developers and maintainers should begin with `docs/developer-setup.md`.

## What this repository provides

- A React web workspace for upload, review, and export.
- An Express API that parses workbooks, runs reconciliation, and returns structured results.
- Shared domain, matching, normalization, and persistence packages used by both apps.
- PostgreSQL-backed lifecycle persistence for durable reconciliation runs.
- Local Docker deployment runbooks and preflight gates for safer delivery.

## Audience and starting point

### For analysts and reviewers

Use this repo to run reconciliation and review results:

1. Start the app (`npm run dev` for local, or `npm run docker:deploy` for Docker).
2. Upload `bankFile` and `glFile` in the Upload tab.
3. Set account identifier, reconciliation frequency, and period label.
4. Run reconciliation.
5. Review summary metrics, probable matches, and exceptions.
6. Download the workbook export for handoff and audit trail.

Primary docs:

- `docs/user-quickstart.md`
- `docs/reconciliation-rules.md`
- `docs/sample-config.md`
- `docs/api.md`

### For developers and maintainers

Use this repo to build, test, and deploy the platform safely.

Primary docs:

- `docs/developer-setup.md`
- `docs/architecture.md`
- `docs/local-docker-platform.md`
- `docs/test-strategy.md`
- `design/persistence/postgresql-persistence-architecture.md`

## Monorepo layout

```text
apps/
  api/     Express API and reconciliation workflow orchestration
  web/     React + Vite analyst workspace
packages/
  config/       Reconciliation defaults and account overrides
  core/         Parse, normalize, match, classify, summarize, export
  domain/       Shared types and domain contracts
  persistence/  PostgreSQL lifecycle/read-model stores and migrations
  test-fixtures Shared workbook fixtures used by unit/integration/e2e tests
  ui/           Shared UI models and utilities
scripts/
  ops/          Deploy, health, preflight, cleanup runbooks
database/
   postgresql/   PostgreSQL DDL/bootstrap assets (source-of-truth DB artifacts)
docs/           Architecture, API, rules, testing, and operations guides
```

The repository intentionally uses PostgreSQL only; no MSSQL scaffold is maintained.

## End-to-end workflow

1. **Upload and ingest**
   - API accepts multipart `.xlsx` uploads (`bankFile`, `glFile`).
   - Parser preserves source lineage (file, sheet, row, raw values).

2. **Normalize and validate**
   - Text, amounts, dates, and references are normalized.
   - Invalid rows are marked with data-quality issues and excluded from matching.

3. **Match and classify**
   - Candidate pairs are scored using amount/date/text/reference logic.
   - Exact, probable, grouped, timing, and mismatch outcomes are produced.
   - Residual rows are mapped into accountant-facing exception categories.

4. **Summarize and report**
   - Summary metrics and category exposure are generated.
   - Exception report includes severity, rule trace, and suggested next actions.

5. **Persist and export**
   - Reconciliation lifecycle artifacts are persisted in PostgreSQL when enabled.
   - Workbook export is generated for downstream review and archival.

## Quick start

### Prerequisites

- Node.js >= 20
- npm
- Docker Desktop (for containerized stack and PostgreSQL tests)
- Optional Python + `openpyxl` for workbook diagnostics scripts

### Install dependencies

```bash
npm install
```

### Start local development (API + web)

```bash
cp .env.example .env
npm run dev
```

Default local endpoints:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/api/health`

### Run production-like Docker stack

```bash
cp .env.docker.dev.fallback .env.docker.dev
npm run docker:validate-env
npm run docker:deploy
npm run docker:health
```

Default containerized endpoints (dev is HTTPS-only, using a locally-trusted mkcert cert):

- Gateway: `https://127.0.0.1:4174`
- Environment docs: `https://127.0.0.1:4174/<environment>/docs` (for example `dev/docs`)
- Environment pgweb: `https://127.0.0.1:4174/<environment>/pgweb` (for example `dev/pgweb`)
- API health via gateway: `https://127.0.0.1:4174/api/health`
- NGINX health: `https://127.0.0.1:4174/healthz`
- pgweb (database viewer): `http://127.0.0.1:8081`

## Daily developer commands

### Build and test

```bash
npm run test
npm run test:postgres
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm run coverage
```

### Security and static quality

```bash
npm run security:scan
npm run analyze:static
```

### Runtime harness utilities

```bash
npm run harness:start
npm run harness:status
npm run harness:stop
npm run runtime:status
```

### Docker safety gates

```bash
npm run docker:preflight
npm run docker:predeploy
npm run docker:db:preflight
```

## Configuration model

Core runtime variables are documented in these templates:

- `.env.example` for local Node/Vite development
- `.env.docker.dev.fallback` for Docker Compose runtime

Important flags:

- `RECON_PERSISTENCE_BACKEND=postgres` enables PostgreSQL-backed persistence.
- `DATABASE_URL` (local) / `API_DATABASE_URL` (compose) controls DB connection.
- `RUN_DB_MIGRATIONS_ON_BOOT` controls API boot-time migration behavior.

## Documentation map

### Product and behavior

- `docs/user-quickstart.md`: plain-language runbook for analysts and reviewers.
- `docs/reconciliation-rules.md`: matching and exception logic currently implemented.
- `docs/sample-config.md`: account-level configuration levers.
- `docs/api.md`: endpoint contracts and payload behavior.

### Engineering and operations

- `docs/developer-setup.md`: setup, workflows, troubleshooting, and validation.
- `docs/architecture.md`: system flow, module boundaries, and data movement.
- `docs/local-docker-platform.md`: container topology and preflight runbooks.
- `design/persistence/postgresql-persistence-architecture.md`: durable lifecycle model.
- `docs/test-strategy.md`: unit/integration/e2e and quality-gate strategy.
- `design/github_design/branch-protection.md`: recommended required checks.
- `docs/class-method-reference.md`: method-level behavioral reference.

## Release and change tracking

- `CHANGELOG.md` tracks release-level changes.
- `RELEASE.md` captures release workflow details.
