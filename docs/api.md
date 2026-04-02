# API Reference

## Health

### `GET /api/health`

Returns service status and timestamp.

## Run Reconciliation

### `POST /api/reconciliation/run`

Multipart form-data endpoint.

Required fields:

- `bankFile`: `.xlsx`
- `qboFile`: `.xlsx`

Optional fields:

- `accountIdentifier`
- `periodLabel`

Response includes:

- run metadata
- source file metadata
- normalized transactions
- match results
- probable matches
- exceptions
- summary metrics
- reviewer observations
- workbook metadata
- audit events

## Fetch Run

### `GET /api/reconciliation/:id`

Returns the stored run payload without the raw workbook binary.

## Fetch Summary

### `GET /api/reconciliation/:id/summary`

Returns `SummaryMetrics` only.

## Fetch Exceptions

### `GET /api/reconciliation/:id/exceptions`

Returns the typed exception list.

## Download Workbook

### `GET /api/reconciliation/:id/export/workbook`

Returns the generated `.xlsx` workbook as an attachment.

## Error Behavior

- `400` for missing required uploads
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
