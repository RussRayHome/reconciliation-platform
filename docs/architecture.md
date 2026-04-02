# Architecture

## Goals

The platform is designed for repeatable finance operations work rather than a one-off data-cleaning script. The architecture prioritizes auditability, explicit rule evaluation, maintainability, and clean separation between the UI, HTTP boundary, and reconciliation engine.

## Layers

### `packages/domain`

Canonical contracts for transactions, runs, matches, exceptions, summaries, workbook outputs, reviewer observations, and configuration. This package is the shared language of the system.

### `packages/config`

Default parsing and matching configuration plus account-level override support. This layer keeps header mapping, exclusion logic, tolerances, and severity rules out of route handlers and UI code.

### `packages/core`

The business engine.

- `parsers/`: workbook ingestion and dynamic column detection
- `normalization/`: dates, amounts, references, text tokens, and fingerprints
- `matching/`: duplicate detection, candidate scoring, and layered reconciliation rules
- `reporting/`: exception classification, reviewer observations, summary metrics, and chart data
- `export/`: audit-ready workbook creation

### `apps/api`

The HTTP boundary.

- Validates file uploads and accepted file types
- Creates correlation IDs and structured logs
- Calls shared reconciliation services
- Stores runs in an in-memory repository
- Exposes summary, exception, and workbook download endpoints

### `apps/web`

The local analyst and reviewer interface.

- Uploads source files
- Displays account and period context
- Renders summary metrics and charts
- Surfaces probable matches separately from hard exceptions
- Provides workbook and JSON export actions

## Trust Boundaries

1. Browser to API: untrusted file input, validated by type/extension and request limits.
2. API to core: typed input only, no direct browser concerns.
3. Core to export: workbook generation only from normalized and classified data, not raw arbitrary user macros or scripts.

## Observability

- Pino HTTP logging with correlation ID propagation
- Audit events emitted by the reconciliation pipeline for major stages
- Human-readable dev logging via `pino-pretty`
- Summary metrics available through both HTTP and workbook export

## Extensibility

The current design supports future work without architectural churn:

- `.csv` parsing alongside `.xlsx`
- persistence for run history and reviewer decisions
- reviewer approval workflows for probable matches
- account-specific rule packs
- scheduled or batch reconciliation automation
- richer entity resolution for merchants and payees

## Class and Method Documentation

Class and method documentation is centralized in `docs/class-method-reference.md` and includes:

- explicit method inputs
- explicit method outputs
- state object before method execution
- state object after method execution

Use this reference as the execution-level companion to this architecture document.
