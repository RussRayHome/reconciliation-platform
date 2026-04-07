# Bank-to-QBO Reconciliation Platform

A production-style monorepo for reconciling bank transaction exports against QuickBooks Online exports. The platform parses source workbooks, preserves row-level lineage, normalizes accounting data, applies evidence-based matching rules, classifies exceptions, produces accountant-friendly review outputs, and exports a multi-tab workpaper workbook.

## Stack

- Frontend: React, TypeScript, Vite, TanStack Query, Recharts
- API: Node.js, Express, TypeScript, Pino, Multer
- Shared validation and typing: TypeScript-first domain packages
- Workbook parsing/export: ExcelJS
- Testing: Vitest, Supertest, Playwright
- Tooling: npm workspaces, ESLint, Prettier, VS Code tasks/launch settings

## Workspace Layout

```text
reconciliation-platform/
  apps/
    api/
    web/
  packages/
    config/
    core/
    domain/
    test-fixtures/
    ui/
  docs/
  scripts/
```

## What It Does

- Ingests bank and QBO `.xlsx` exports
- Dynamically maps source columns using configurable aliases
- Preserves original file names and spreadsheet row numbers
- Excludes QBO beginning-balance rows from matching
- Normalizes dates, amounts, references, descriptions, merchants, and payees
- Applies layered matching rules with exact, advisory review, and grouped-residual behavior
- Separates exact matches from probable matches and exceptions
- Classifies explicit exception categories including missing-in-bank, missing-in-QBO, amount mismatch, duplicate bank/QBO entries, date variance, timing difference, stale outstanding checks, likely miscoding, grouped split/combine issues, grouped deposit issues, check/reference variance, description variance, and ambiguous review cases
- Preserves rule traces, grouped counterparts, prior rule lineage, and category-specific recommended next actions for accountant review
- Exports an Excel workpaper with summary, assumptions, error report, probable matches, reviewer observations, and normalized views
- Returns JSON summaries for local automation or integration

## Quick Start

```bash
npm install
npm run dev
```

- API: `http://localhost:4000`
- Web: `http://127.0.0.1:5173`
- Developer dashboard: `http://127.0.0.1:5173/developer-dashboard.html`

## Docker Desktop Quick Start

```bash
cp .env.docker.example .env.docker
npm run docker:deploy
```

- Gateway and UI: `http://127.0.0.1:4173`
- API health through NGINX: `http://127.0.0.1:4173/api/health`
- PostgreSQL stays internal to Docker Compose

To stop the stack:

```bash
npm run docker:cleanup
```

To use a non-default Docker env file for the runbooks and TypeScript helpers, set `DOCKER_ENV_FILE=./path/to/file` before running the command. `DOCKER_COMPOSE_ENV_FILE` is still accepted as a legacy alias.

## Scripts

- `npm run dev`
- `npm run dev:web`
- `npm run dev:api`
- `npm run ops:web:start`
- `npm run ops:web:stop`
- `npm run ops:db:start`
- `npm run ops:db:stop`
- `npm run ops:docker:stop`
- `npm run ops:docker:restart`
- `npm run ops:startup`
- `npm run ops:shutdown`
- `npm run runtime:status`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:postgres`
- `npm run coverage`
- `npm run security:scan`
- `npm run docker:validate-env`
- `npm run docker:build`
- `npm run docker:migrate`
- `npm run docker:health`
- `npm run docker:deploy`
- `npm run docker:redeploy`
- `npm run docker:smoke`
- `npm run docker:up`
- `npm run docker:cleanup`
- `npm run docker:down`
- `npm run docker:logs`
- `npm run fixtures:generate`
- `npm run analyze:reconciliation -- --account <accountId> --bank <bank.xlsx> --qbo <qbo.xlsx> [--windows 0,1,3,5,10,21] [--thresholds 0,0.05,0.1,0.2] [--similarity-days 5] [--hybrid-thresholds 0.1,0.15] [--hybrid-occurrences 1,2]`
- `npm run compare:workbooks -- --mode parity --baseline <baseline.xlsx> --candidate <candidate.xlsx>`

## Local Platform Operations

The repository now includes focused command-line wrappers for the hardened local Docker platform:

- `npm run docker:validate-env`: validates `.env.docker` before container startup
- `npm run docker:migrate`: runs the one-shot migration service
- `npm run docker:health`: verifies gateway, proxied API health, and PostgreSQL readiness
- `npm run docker:deploy`: starts PostgreSQL, runs migrations, then starts `api` and `web`
- `npm run docker:redeploy`: performs a clean restart of the full stack
- `npm run docker:cleanup`: stops the stack without pruning volumes

Use `docker:deploy`, `docker:health`, and `docker:cleanup` as the supported runbook path. Keep `docker:up` and `docker:down` for low-level Compose troubleshooting only.

- `npm run ops:web:start`: starts the containerized web service and any required dependencies
- `npm run ops:web:stop`: stops the containerized web service
- `npm run ops:db:start`: starts the PostgreSQL container
- `npm run ops:db:stop`: stops the PostgreSQL container
- `npm run ops:docker:stop`: quits Docker Desktop on macOS
- `npm run ops:docker:restart`: restarts Docker Desktop on macOS and waits for the daemon to become ready
- `npm run ops:startup`: starts Docker Desktop if needed, then starts `postgres`, `api`, and `web`
- `npm run ops:shutdown`: stops `web`, `api`, and `postgres`, then quits Docker Desktop

These commands can be run from the repository root and are backed by the typed `scripts/docker-ops.ts` entrypoint.

`npm run runtime:status` reports whether the web runtime is currently the local Vite server or the containerized Nginx path, along with the matching API mode.

The detailed gateway/app/db runbook is documented in `docs/local-docker-platform.md`.

## Core Flow

1. Upload bank and QBO workbooks from the web UI.
2. Optionally provide an account identifier, select a reconciliation frequency, and confirm the generated reconciliation label.
3. API validates file types, assigns a correlation ID, parses both workbooks, and resolves account-specific config.
4. Shared core logic normalizes source rows, detects duplicates, runs the matching engine, and reserves grouped residual candidates before weak one-to-one review suggestions.
5. Exception classification and summary metrics are generated for accounting review, including rule traces, evidence, counterpart references, and recommended next actions.
6. The API persists lifecycle state to PostgreSQL when `DATABASE_URL` is configured and still keeps a compatibility latest-run snapshot for restart-safe local report recovery.
7. The API returns a lean report read model to the UI rather than the full execution graph.
8. The web UI renders dashboard metrics, charts, probable matches, and filterable exceptions with category, rule, evidence, counterparts, and lineage.

For monthly runs, the web app uses `Monthly reconciliation month` plus an editable `Reconciliation label`. For annual runs, it switches to `Annual reconciliation year`.

## Developer Dashboard

The developer dashboard provides a single-page health view for the repository:

- route: `http://127.0.0.1:5173/developer-dashboard.html`
- API source: `GET /api/developer/status`
- checks: unit tests, integration tests, e2e tests, static analysis (lint), static analysis (typecheck), coverage, and security vulnerabilities
- recent history: stores the most recent status runs and identifies which check areas failed
- cache behavior: standard refresh uses the cached payload when it is still within TTL, and force refresh reruns all checks immediately

Coverage is summarized as `S/B/F/L` and security results are summarized by severity (`Critical`, `High`, `Moderate`, `Low`, `Info`).

## Workbook Comparison Utilities

The repository includes workbook comparison helpers under `scripts/`, including `workbook-parity.py` and `compare-attached-workbooks.py`.

These utilities are useful for golden-standard comparisons and now accept explicit workbook paths. They still assume specific workbook sheet names and column layouts, so validate the expected format before relying on their output.

See `scripts/README.md` for the current script inventory, supported commands, and guidance on which files are reusable versus ad hoc.

## Documentation

- `docs/architecture.md`
- `docs/reconciliation-rules.md`
- `docs/developer-setup.md`
- `docs/test-strategy.md`
- `docs/sample-config.md`
- `docs/api.md`
- `docs/first-class-grouped-matching.md`
- `docs/reviewer-decision-persistence.md`
- `docs/class-method-reference.md`
- `scripts/README.md`
- `CHANGELOG.md`
- `RELEASE.md`

## Class and Method Documentation

Complete class and method documentation, including method inputs, outputs, and before/after state objects, is maintained in `docs/class-method-reference.md`.

## Current Persistence Model

The platform now supports a PostgreSQL-backed lifecycle store for durable reconciliation workflow state.

- when `DATABASE_URL` is configured, the API initializes PostgreSQL persistence and records workflow stages, source files, raw rows, canonical rows, match artifacts, exceptions, summaries, exports, reviewer decisions, and audit history
- API responses sent to the UI are lean report read models rather than the full execution graph
- the compatibility repository still persists the latest report-capable run snapshot to `test-results/latest-reconciliation-run.json` so the latest report remains available after a local restart

See [docs/postgresql-persistence-architecture.md](docs/postgresql-persistence-architecture.md) for the current rollout shape and remaining migration steps.

## Release Tracking

- `CHANGELOG.md` records noteworthy repository changes and documentation-facing release notes.
- `RELEASE.md` defines how to prepare release notes, validation evidence, and rollback metadata for future releases.
