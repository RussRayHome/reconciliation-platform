# PostgreSQL Persistence Architecture

This document describes the current PostgreSQL-backed durability model for reconciliation lifecycle processing.

## 1. Purpose and boundaries

The PostgreSQL layer is responsible for durable lifecycle state, artifacts, auditability, and reviewer decisions.

Durable concerns include:

- job lifecycle state and transition audit trail
- source file and raw-row ingestion history
- canonical normalized rows
- match, grouped match, and rule-trace artifacts
- exception and reviewer-observation outputs
- summary and export metadata
- reviewer decisions

Non-durable compatibility concerns still exist in API runtime for local convenience, but PostgreSQL is the source of truth for persisted reconciliation lifecycle data.

## 2. Runtime selection and startup wiring

PostgreSQL persistence is considered enabled when either condition is true:

- `RECON_PERSISTENCE_BACKEND=postgres`
- `DATABASE_URL` is set

When enabled, API startup requires `DATABASE_URL`; startup fails if it is missing.

In Docker compose, `DATABASE_URL` is derived from `API_DATABASE_URL`, so containerized runtime still satisfies the same backend contract.

Relevant wiring:

- `apps/api/src/server.ts`
- `packages/persistence/src/postgres.ts`
- `compose.yaml`

## 3. Migration behavior

Migrations are defined in `packages/persistence/src/schema.ts` and applied by `runPostgresMigrations`.

Startup migration behavior:

- `RUN_DB_MIGRATIONS_ON_BOOT=true` -> run migrations
- `RUN_DB_MIGRATIONS_ON_BOOT=false` -> skip on boot
- unset -> run on boot outside production; skip behavior is configurable

Explicit migration command path:

- `apps/api/src/migrate.ts`
- requires `DATABASE_URL`

Migration tracking table:

- `schema_migrations(version, name, applied_at)`

## 4. Lifecycle state model

State model is defined in `packages/persistence/src/stateMachine.ts`.

Primary states:

- `CREATED`
- `FILE_REGISTERED`
- `IMPORTING`
- `IMPORTED`
- `NORMALIZING`
- `NORMALIZED`
- `MATCHING`
- `MATCHED`
- `EXCEPTIONS_IDENTIFIED`
- `REVIEW_READY`
- `FINALIZED`
- `FAILED`
- `RETRY_PENDING`
- `CANCELLED`

Each transition is validated by `assertValidJobTransition` and written in the same transaction that persists the corresponding stage artifacts.

## 5. Durable write stages

`PostgresReconciliationLifecycleStore` (`packages/persistence/src/reconciliationLifecycleStore.ts`) is the write orchestrator.

### Stage 1: job creation

Method: `createJob`

Writes:

- `reconciliation_job`
- `reconciliation_source_file`

Transition:

- `CREATED` -> `FILE_REGISTERED`

### Stage 2: parsed row persistence

Method: `persistParsedRows`

Writes:

- `reconciliation_import_batch`
- `reconciliation_raw_row`
- source-file imported row counts

Transitions:

- `FILE_REGISTERED` -> `IMPORTING` -> `IMPORTED`

### Stage 3: normalized row persistence

Method: `persistNormalizedRows`

Writes:

- `reconciliation_canonical_row`

Transitions:

- `IMPORTED` -> `NORMALIZING` -> `NORMALIZED`

### Stage 4: matching artifact persistence

Method: `persistMatchingArtifacts`

Writes:

- `reconciliation_match_group`
- `reconciliation_match_result`
- `reconciliation_rule_result` (match and grouped lineage)

Transitions:

- `NORMALIZED` -> `MATCHING` -> `MATCHED`

Bucket semantics in `reconciliation_match_result`:

- exact/primary match rows are persisted with `result_bucket='MATCH'`
- review rows are persisted with `result_bucket='PROBABLE'`
- probable ids are de-duplicated so the same result is not written to both buckets

### Stage 5: exception and summary persistence

Method: `persistReviewArtifacts`

Writes:

- `reconciliation_exception`
- `reconciliation_review_observation`
- `reconciliation_rule_result` (exception lineage)
- `reconciliation_job_summary`

Transitions:

- `MATCHED` -> `EXCEPTIONS_IDENTIFIED` -> `REVIEW_READY`

### Stage 6: export finalization

Method: `persistExportAndFinalize`

Writes:

- `reconciliation_export`
- `reconciliation_audit_event`
- `reconciliation_job.completed_at`

Transition:

- `REVIEW_READY` -> `FINALIZED`

### Stage 7: reviewer decisions

Method: `persistReviewerDecision`

Writes:

- upsert in `reconciliation_review_decision`
- audit event `review.decision.persisted`

Uniqueness key:

- `(job_id, target_type, target_id)`

### Failure stage

Method: `markFailed`

Writes:

- `reconciliation_job` failure fields
- retry increment when transitioning to `RETRY_PENDING`
- failure audit event

## 6. Schema structure

Core schema is migration-backed and relational-first with selective JSONB columns for trace payloads.

Key tables:

- `reconciliation_job`: lifecycle state, period context, retry/failure metadata, versioning
- `reconciliation_source_file`: source registration and import metadata
- `reconciliation_import_batch`: ingest batching ledger
- `reconciliation_raw_row`: raw source rows
- `reconciliation_canonical_row`: normalized rows
- `reconciliation_match_result`: one-to-one match/probable rows with bucketing
- `reconciliation_match_group`: grouped residual candidates/results
- `reconciliation_rule_result`: traceable rule lineage per artifact target
- `reconciliation_exception`: final exception records and trace references
- `reconciliation_review_observation`: generated review notes
- `reconciliation_job_summary`: summary metrics and chart payloads
- `reconciliation_export`: workbook/export metadata
- `reconciliation_review_decision`: durable reviewer outcomes
- `reconciliation_audit_event`: transition and operation audit log

Migration shape currently includes:

- v1 base schema and indexes
- v2 foreign keys for scalar transaction references
- v3 read-model access indexes

## 7. Read model architecture

`PostgresReconciliationReadModelStore` (`packages/persistence/src/readModelStore.ts`) builds report payloads for API consumption.

Key read paths:

- latest completed run report lookup
- run report by id (summary, exceptions, probable matches, grouped matches, observations, reviewer decisions, export manifest)
- paged exceptions (`limit`, `offset`, `hasMore`)

The read model is designed to return `ReconciliationRunReport` shape directly without requiring the full in-memory execution graph.

## 8. Concurrency, consistency, and idempotency

### Concurrency controls

- each write stage runs in a SQL transaction
- per-job serialization uses `pg_advisory_xact_lock(hashtext(job_id))`

### Consistency controls

- legal transitions are enforced by the state graph
- write + transition + audit are co-committed
- rollback occurs on any stage failure

### Idempotency and uniqueness constraints

- source file uniqueness per `(job_id, source_system)`
- raw row uniqueness per `(source_file_id, line_number)`
- reviewer decision uniqueness per `(job_id, target_type, target_id)`

### Versioning

- `record_version` is incremented on lifecycle transitions and reviewer-decision updates

## 9. Operational quality gates

Persistence changes should be validated with both code-level and environment-level checks.

Recommended command set:

```bash
npm run test:postgres
npm run test
npm run typecheck
npm run docker:db:preflight
```

`docker:db:preflight` provides schema patch parity, table/index/constraint verification, and DB vulnerability checks before deploy-sensitive changes.

## 10. Recovery and rollout model

Current behavior:

- each lifecycle stage is durably persisted
- failures are recorded with transition-safe failure metadata and audit events
- read-model queries can recover finalized outputs from DB state

Near-term enhancement direction:

- formal resumable retry orchestration from last durable checkpoint
- fuller retirement of local file-backed compatibility paths where PostgreSQL read models already cover the consumer needs

## 11. Related references

- `docs/architecture.md`
- `docs/api.md`
- `docs/developer-setup.md`
- `docs/local-docker-platform.md`
- `docs/reviewer-decision-persistence.md`
