# API Reference

## Health

### `GET /api/health`

Returns service status and timestamp.

## Developer Status

### `GET /api/developer/status`

Runs or returns a cached repository-health snapshot for the developer dashboard.

Query parameters:

- `force=1` or `force=true`: bypass the cache and rerun all checks

Response includes:

- `generatedAt`
- `repositoryPath`
- `overallStatus`
- `failedChecks`
- `passedChecks`
- `totalChecks`
- `totalDurationMs`
- `checks[]` with `name`, `command`, `ok`, `exitCode`, `durationMs`, `summary`, `details`, and optional `highlights`
- `history[]` with recent snapshots, including `failingCheckNames`
- `cache` with `ttlMs`, `ageMs`, and `fromCache`

Current checks:

- `Unit tests`
- `Integration tests`
- `E2E tests`
- `Static analysis (lint)`
- `Static analysis (typecheck)`
- `Coverage`
- `Security vulnerabilities`

Coverage highlights are summarized as `S`, `B`, `F`, and `L`. Security highlights are summarized by severity counts.

## Run Reconciliation

### `POST /api/reconciliation/run`

Multipart form-data endpoint.

Required fields:

- `bankFile`: `.xlsx`
- `qboFile`: `.xlsx`

Optional fields:

- `accountIdentifier`
- `periodLabel`
- `reconciliationFrequency`

Response includes:

- run metadata
- source file metadata
- normalized transactions
- match results
- grouped match results
- probable matches
- exceptions with category, severity, category-specific recommended next actions, optional `priorRuleTraces`, and a nested `ruleTrace` object containing rule metadata, evidence, counterpart traceability, and grouped counterpart arrays when available
- summary metrics
- reviewer observations
- reviewer decisions
- workbook metadata
- audit events

## Fetch Run

### `GET /api/reconciliation/latest`

Returns the most recently stored reconciliation run payload without the raw workbook binary.

Returns `404` when no completed run has been stored yet.

### `GET /api/reconciliation/:id`

Returns the stored run payload without the raw workbook binary.

The run payload includes any persisted `reviewerDecisions` attached to probable-match, ambiguous-review, or exception targets.
It now also includes additive `groupedMatchResults` emitted by the matcher for balanced grouped candidates, even while grouped exception classification remains on the compatibility path.

## Fetch Summary

### `GET /api/reconciliation/:id/summary`

Returns `SummaryMetrics` only.

## Fetch Exceptions

### `GET /api/reconciliation/:id/exceptions`

Returns the typed exception list, including `recommendedNextActions`, optional `priorRuleTraces`, plus a nested `ruleTrace` object with `ruleId`, `ruleName`, `reason`, `evidence`, primary counterpart source references, and grouped `counterparts` when those were available during classification.

## Reviewer Decisions

### `GET /api/reconciliation/:id/reviewer-decisions`

Returns the persisted reviewer decisions for the specified run.

### `POST /api/reconciliation/:id/reviewer-decisions`

Persists or updates a reviewer decision for a single review target on the specified run.

Request body:

- `targetType`: `ProbableMatch`, `AmbiguousReview`, or `ExceptionItem`
- `targetId`: target identifier within the run
- `outcome`: `ApprovedMatch`, `RejectedMatch`, `ConfirmedException`, or `ReclassifiedException`
- `finalCategory`: required when `outcome` is `ReclassifiedException`
- `notes`: optional reviewer rationale
- `reviewerId`: optional reviewer identifier
- `reviewerName`: optional reviewer display name

Validation rules:

- target must exist on the run
- probable and ambiguous targets accept only `ApprovedMatch` or `RejectedMatch`
- exception targets accept only `ConfirmedException` or `ReclassifiedException`
- `finalCategory` must be a valid exception category when reclassifying

## Download Workbook

### `GET /api/reconciliation/:id/export/workbook`

Returns the generated `.xlsx` workbook as an attachment.

## Error Behavior

- `400` for missing required uploads
- `400` for invalid upload type
- `413` for files that exceed the configured upload limit
- `404` for unknown run IDs
- `500` for unexpected parse or processing failures

## Observability

Each response includes an `x-correlation-id` header for log tracing across a reconciliation run.

## Class and Method Documentation

For implementation-level API behavior (class and method signatures, inputs, outputs, and state before/after), see `docs/class-method-reference.md`.

Key API-layer entries documented there include:

- `InMemoryRunRepository.save`
- `InMemoryRunRepository.findById`
- `executeReconciliation`
- `createApp`
- `startServer`
