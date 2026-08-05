# Architecture

This document explains how the reconciliation platform is structured, how data flows through it, and where to make changes safely.

## 1. System context

The platform reconciles two accounting data sources:

- bank workbook export
- QuickBooks Online workbook export

It produces:

- summary metrics
- probable match review queue
- categorized exceptions with rule trace
- workbook export for downstream accounting workflows

## 2. Runtime modes

The same codebase supports two main runtime shapes.

### Local development mode

- Web app served by Vite (`apps/web`)
- API served by Node/Express (`apps/api`)
- Optional PostgreSQL depending on env configuration

### Production-like Docker mode

- Public NGINX gateway (`web`)
- Internal Express API (`api`)
- Internal PostgreSQL (`postgres`)
- One-shot migration service (`migrate`) that runs before API startup
- Auxiliary admin services in dev/stage (`pgweb`, `nginx-ui`)

## 3. High-level component architecture

```text
[Web UI: apps/web]
        |
        | HTTP /api/*
        v
[API: apps/api]
        |
        | uses
        v
[Core pipeline: packages/core]
        |
        | persists (when enabled)
        v
[Persistence: packages/persistence -> PostgreSQL]

Shared contracts: packages/domain
Runtime/default configuration: packages/config
Shared fixtures: packages/test-fixtures
```

## 4. Package responsibilities

### `apps/web`

- Upload workflow for source files
- Run metadata capture (account, frequency, period label)
- Rendering for summary, probable matches, grouped artifacts, exceptions, and reviewer decisions
- Workbook export trigger via API
- Optional developer dashboard surface

### `apps/api`

- Multipart upload handling and validation
- Reconciliation workflow orchestration
- Read endpoints for latest/by-id report, summary, exceptions, reviewer decisions
- Reviewer decision validation + persistence
- Developer diagnostics endpoints
- Health and workbook export endpoints

### `packages/core`

- Workbook parse and row lineage capture
- Normalization and text/token processing
- Candidate generation and reconciliation matching
- Exception classification and severity mapping
- Summary/chart generation
- Workbook export assembly

### `packages/persistence`

- PostgreSQL migrations
- Lifecycle write model store
- Read model projections for run report, summary, exceptions, and reviewer decisions
- Connection/pool configuration via environment

### `packages/domain`

- Shared type system (`ReconciliationRunReport`, `SummaryMetrics`, `ExceptionItem`, `ReviewerDecision`, etc.)

### `packages/config`

- Default reconciliation behavior
- Account-specific override examples

## 5. End-to-end data flow

1. **Submission**
   - Web posts multipart form data (`bankFile`, `qboFile`) to `POST /api/reconciliation/run`.

2. **Input processing**
   - API validates files and request metadata.
   - Core parser loads workbook rows and source lineage.

3. **Normalization and matching**
   - Core normalizes text/date/amount/reference fields.
   - Matching computes exact/probable/grouped/variance outcomes.

4. **Exception classification**
   - Residual and matched-review outcomes are categorized into accountant-facing exceptions.

5. **Summary and export artifacts**
   - Summary metrics and chart series are produced.
   - Workbook export binary and manifest metadata are produced.

6. **Persistence and read model**
   - If PostgreSQL is enabled, lifecycle and read model records are persisted.
   - API returns a sanitized `ReconciliationRunReport` payload.

7. **Review lifecycle**
   - Reviewer decisions are submitted through `POST /api/reconciliation/:id/reviewer-decisions`.
   - Decisions are validated against target type and allowed outcome combinations.

## 6. Data ownership and storage

## Durable storage

When `RECON_PERSISTENCE_BACKEND=postgres` and DB connectivity are configured:

- lifecycle stages and audit events are durable
- read-model queries power run report, summary, exceptions, and decisions

Database DDL and bootstrap assets are maintained under `database/postgresql/ddl`; the repository does not keep parallel MSSQL scaffolding.

## Compatibility snapshot

API still keeps a file-backed latest-run snapshot (`RECONCILIATION_RUN_STORE_PATH`) for restart compatibility and local run continuity.

## 7. API architecture notes

- Express app sets `trust proxy` to support gateway forwarding.
- Correlation IDs are propagated in response headers.
- Diagnostics middleware tracks failed requests and exceptions.
- Developer endpoints are policy-gated by environment.

See `docs/api.md` for full contract details.

## 8. Diagnostics and quality architecture

## Developer status diagnostics

Quality-gate checks (`test:unit`, `test:integration`, `test:e2e`, `test:postgres`, `lint`,
`typecheck`, `coverage`, `security:scan`) run nightly via GitHub Actions
(`.github/workflows/dashboard-status.yml`), never against a live product instance. Each check runs
as its own parallel job; an `aggregate` job combines their results and publishes one JSON payload
to the repo's `status-data` branch (`scripts/ci/aggregate-dashboard-status.ts`).

A fully separate application -- `apps/developer-dashboard-api` (GitHub OAuth login, reads the
published payload) and `apps/developer-dashboard-web` -- reads and displays that payload. It shares
no runtime, login, or execution surface with the product; the product cannot trigger a check run or
see live diagnostics about itself.

## 9. Deployment safety architecture

Deployment-related guardrails are intentionally externalized to scripts:

- `scripts/pre-flight/preflight-build-checks.sh`
- `scripts/pre-flight/predeploy-stack-checks.sh`
- `scripts/pre-flight/db-preflight-checks.sh`
- `scripts/in-flight/in-flight-url-check.sh`
- `scripts/in-flight/in-flight-db-user-check.sh`

This keeps operational risk checks explicit and repeatable outside the request path.

## 10. Change impact guide

When changing these areas, expect these follow-up updates:

- matching/classification logic -> update `docs/reconciliation-rules.md` and tests
- endpoint contracts -> update `docs/api.md` and integration tests
- persistence schema/stores -> update `docs/postgresql-persistence-architecture.md` and DB tests
- deployment behavior/scripts -> update `docs/local-docker-platform.md` and preflight checks
- setup workflows -> update `docs/developer-setup.md`

## 11. Related references

- `docs/api.md`
- `docs/reconciliation-rules.md`
- `docs/postgresql-persistence-architecture.md`
- `docs/local-docker-platform.md`
- `docs/test-strategy.md`
- `docs/class-method-reference.md`
