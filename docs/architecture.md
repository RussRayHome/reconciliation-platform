# Architecture

## Goals

The platform is designed for repeatable finance operations work rather than a one-off data-cleaning script. The architecture prioritizes auditability, explicit rule evaluation, maintainability, and clean separation between the UI, HTTP boundary, and reconciliation engine.

It is also designed to support two parallel operator needs:

- an analyst-facing reconciliation workflow for reviewing a single run
- a developer-facing health workflow for validating repository quality gates from one place

## Layers

### `packages/domain`

Canonical contracts for transactions, runs, matches, exceptions, summaries, workbook outputs, reviewer observations, and configuration. This package is the shared language of the system.

### `packages/config`

Default parsing and matching configuration plus account-level override support. This layer keeps header mapping, exclusion logic, tolerances, and severity rules out of route handlers and UI code.

### `packages/core`

The business engine.

- `parsers/`: workbook ingestion and dynamic column detection
- `normalization/`: dates, amounts, references, text tokens, and fingerprints
- `matching/`: duplicate detection, candidate scoring, exact-match consumption, grouped reservation, and advisory review handling
- `reporting/`: exception classification, reviewer observations, summary metrics, and chart data
- `export/`: audit-ready workbook creation

### `apps/api`

The HTTP boundary.

- Validates file uploads and accepted file types
- Creates correlation IDs and structured logs
- Resolves run configuration and calls shared reconciliation services
- Persists lifecycle state to PostgreSQL when configured
- Maintains a compatibility latest-run snapshot for restart-safe local reporting
- Exposes health, reconciliation, summary, exception, workbook download, and developer-status endpoints
- Caches developer-status results and keeps a short in-memory history of recent check runs

### `apps/web`

The local analyst and reviewer interface.

- Uploads source files
- Captures account identifier, reconciliation frequency, and period labeling context
- Renders summary metrics and charts
- Surfaces probable matches separately from hard exceptions
- Provides workbook and JSON export actions

The web app also ships a standalone developer dashboard that reads from the API developer-status endpoint and summarizes repository health checks, coverage, security results, cache state, and recent failing areas.

## Reconciliation Runtime Flow

The runtime flow is:

1. The browser uploads bank and QBO workbooks and collects run metadata such as account identifier, reconciliation frequency, and reconciliation label.
2. The API validates upload type and size, creates a correlation ID, and resolves configuration from shared defaults plus account overrides.
3. The parser ingests both workbooks in parallel and preserves row lineage.
4. The core pipeline normalizes transactions, detects duplicates, consumes exact matches, reserves grouped residual candidates, emits advisory non-exact review suggestions, classifies residual exceptions in stages, builds summary metrics, and produces reviewer observations.
5. The exporter creates a multi-sheet workbook containing summary, charts, exception reporting, probable-match review, and normalized transaction views.
6. The API persists lifecycle data durably when PostgreSQL is enabled and returns a lean report read model to the UI.

The current user flow supports both `Monthly` and `Annual` reconciliation runs. Monthly runs use a month selector tied to the current year, while annual runs select from prior completed years.

## Trust Boundaries

1. Browser to API: untrusted file input, validated by type/extension and request limits.
2. API to core: typed input only, no direct browser concerns.
3. Core to export: workbook generation only from normalized and classified data, not raw arbitrary user macros or scripts.
4. Developer dashboard to API: repository-health execution stays on the server side; the browser only receives summarized check results and stored history.

## Observability

- Pino HTTP logging with correlation ID propagation
- Service-level reconciliation logging outside the HTTP route layer
- Audit events emitted by the reconciliation pipeline for major stages
- Developer-status snapshots covering unit tests, integration tests, e2e tests, lint, typecheck, coverage, and security audit
- Recent developer-status history including failing check names
- Summary metrics available through both HTTP and workbook export

The developer-status endpoint is intentionally operational rather than domain-facing. It exists to reduce the gap between code changes and repository-health visibility during local development.

## Special-Case Behavior

Most reconciliation behavior is driven by the shared default configuration and optional account overrides.

The matcher-classifier handoff is intentionally staged. Exact matches are consumed inside the matcher. Non-exact one-to-one suggestions remain advisory, and grouped, timing, miscoding, stale, and missing classifications are finalized in the reporting layer against the residual pool.

Grouped matching is currently still transitional rather than first-class. The matcher reserves grouped candidates to protect them from one-to-one advisory consumption, while the classifier re-derives grouped residual relationships as exception outputs. The planned target state is documented in `docs/first-class-grouped-matching.md`.

## Extensibility

The current design supports future work without architectural churn:

- `.csv` parsing alongside `.xlsx`
- PostgreSQL-backed read models for run history, summaries, exceptions, and reviewer decisions
- reviewer approval workflows for probable matches
- first-class grouped match results and grouped review workflows
- account-specific rule packs
- scheduled or batch reconciliation automation
- parameterized golden-standard workbook comparison tooling
- richer entity resolution for merchants and payees

## Class and Method Documentation

Class and method documentation is centralized in `docs/class-method-reference.md` and includes:

- explicit method inputs
- explicit method outputs
- state object before method execution
- state object after method execution

Use this reference as the execution-level companion to this architecture document.
