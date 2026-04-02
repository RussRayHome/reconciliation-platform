# Test Strategy

## Objectives

The tests are intended to protect accounting logic, workbook ingestion behavior, API safety, and the primary analyst workflow.

## Test Layers

### Unit tests

Located in shared packages and focused on deterministic business logic.

- normalization of text, dates, and signed amounts
- duplicate and reconciliation outcomes from fixture data
- workbook export smoke coverage
- performance smoke for a representative local workload

### Integration tests

Located in `apps/api/tests`.

- multipart upload handling
- reconciliation execution via HTTP
- summary endpoint
- exceptions endpoint
- workbook download endpoint
- validation failures for missing uploads

### UI tests

Located in `apps/web/src`.

- upload form behavior
- mutation flow and result rendering
- summary metrics visibility
- exception display rendering

### End-to-end tests

Located in `apps/web/tests/e2e`.

- real browser upload path using generated workbook buffers
- reconciliation run from UI to API
- monthly reconciliation path using the current month selector and reconciliation label inputs
- visibility of summary, review, and exception sections

The primary browser regression covers the current monthly flow by selecting `Monthly reconciliation month`, filling `Reconciliation label`, submitting the run, and asserting that `Exception Report`, `Probable Match Review`, and summary content are visible.

## Fixture Strategy

Fixtures are centralized in `packages/test-fixtures` so unit, integration, and e2e tests all exercise the same workbook shapes and accounting scenarios.

## Current Coverage Scope

The current suite covers:

- beginning-balance exclusion
- duplicate detection
- data-quality flagging
- summary generation
- export workbook creation
- API round-trip behavior
- browser upload smoke path
- monthly reconciliation UI behavior
- negative-path API validation for missing uploads

## Operational Checks

The repository also exposes a developer dashboard backed by `GET /api/developer/status`.

That endpoint runs and summarizes the same quality gates used during local verification:

- unit tests
- integration tests
- e2e tests
- lint
- typecheck
- coverage
- security audit

Use it as a quick repository-health snapshot, not as a replacement for targeted test debugging.

## Future Additions

Recommended next regression additions:

- account-specific overrides by account/year
- grouped or split transactions
- check-number mismatch classification
- reference-number mismatch classification
- persistence-backed reviewer workflow

## Class and Method Documentation Coverage

The test suite maps directly to methods documented in `docs/class-method-reference.md`.

Every method reference entry includes:

- input contract
- output contract
- state object before execution
- state object after execution

Use this mapping to add regression tests whenever method state transitions change.
