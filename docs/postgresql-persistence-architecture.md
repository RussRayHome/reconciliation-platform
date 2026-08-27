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
- v4 conditional pgAudit extension activation (enabled in dev and stage; no-op if not preloaded)

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

### Persistence behavior

- each lifecycle stage is durably persisted in a single SQL transaction
- failures are recorded with transition-safe failure metadata and audit events
- read-model queries can recover finalized outputs from DB state

### Privilege model: app roles vs. DB roles

These are two independent layers — settle any confusion between them by asking which layer a
question is about, not by trying to unify them:

- **App-level authorization**: every human user is a row in `reconciliation_user`, with a `role`
  (`financial-analyst` … `superuser`, see `packages/domain/src/enums.ts`) that drives permission
  checks in the API and UI (`rolePermissionsByRole`). This is where "who can do what" lives.
- **DB-level identity**: every one of those users, regardless of app role, reaches Postgres through
  the *same* shared connection — `app_user` (changeset `0031`). `app_user` is deliberately
  low-privilege (`NOSUPERUSER`, `NOBYPASSRLS`, explicit per-table grants) and subject to every RLS
  policy, so tenant isolation is enforced at the DB layer no matter what the connecting app user's
  role is. `apps/api/src/server.ts`'s `assertRuntimeRoleIsNotPrivileged` refuses to serve traffic if
  the API is ever connected as anything other than a role like this.
- **`rray` / `prod_rray` / `prod_rray_admin`** are a third, unrelated thing: manual, DBA-only
  bootstrap/superuser roles (dev+stage / production respectively) for schema migrations and
  break-glass operations. No service ever connects as these — see below and
  [ISSUE-006](../issue_tracker/ISSUE-006.md) for the compose-side guard that keeps it that way.
  **Naming caveat**: the seeded app-level demo login also named `rray` (a `reconciliation_user` row
  with app-role `superuser`, used in local logins/tests/E2E fixtures) is a coincidence of naming,
  not the same identity as the `rray` DB role — an app user named `rray` still authenticates to
  Postgres as `app_user` like everyone else.

### Database user management

The `rray` database user (dev/stage) is created automatically by `docker:deploy` immediately after the migration service completes. Manual invocation:

```bash
npm run db:users:dev
npm run db:users:stage
```

Production user creation (`prod_rray`, `prod_rray_admin`) is intentionally excluded from automated pipelines and must be run manually by a DBA.

### Backup and restore

Backups use `pg_dump -Fc` (custom compressed format). Restores use `pg_restore -j 4` (parallel, 4 workers).

```bash
npm run db:backup:dev          # → .backups/recon-dev-<timestamp>.dump
npm run db:backup:stage        # → .backups/recon-stage-<timestamp>.dump
npm run db:restore:dev         # restores from most recent dev backup
npm run db:restore:stage       # restores from most recent stage backup
npm run db:restore:dev -- .backups/recon-dev-20260512-090000.dump   # restore specific file
```

Restore sequence (automated by `restore.sh`):

1. Stop api, web, pgweb
2. Terminate active DB connections
3. Copy dump into postgres container
4. `pg_restore --clean --if-exists -j 4`
5. Re-apply user grants
6. Restart api, web, pgweb

Backup files are written to `.backups/` (gitignored). Take a backup before any destructive schema operation.

### Seed data

A representative baseline dataset is available for development environments. It contains two reconciliation jobs (one FINALIZED with a matched pair and exception, one FAILED) spanning all 14 tables.

```bash
npm run db:seed:dev
npm run db:seed:stage
```

The seed is idempotent (`ON CONFLICT DO NOTHING`) and safe to re-run.

### Full recovery sequence after complete data loss

```bash
npm run docker:deploy       # fresh postgres + all migrations + rray user
npm run db:restore:dev      # restore from most recent snapshot
# — if no snapshot exists:
npm run db:seed:dev
```

## 11. Related references

- `docs/erd.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/developer-setup.md`
- `docs/local-docker-platform.md`
- `docs/reviewer-decision-persistence.md`
