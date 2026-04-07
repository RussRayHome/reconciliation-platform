# PostgreSQL Persistence Architecture

## Purpose

This document captures the PostgreSQL persistence model added for reconciliation lifecycle durability.

The design persists explicit workflow state for:

- reconciliation job creation
- source file registration
- raw row import batches
- canonical normalized rows
- match and grouped-match artifacts
- exception and review-ready artifacts
- export metadata
- audit history
- reviewer decisions

## Why PostgreSQL

PostgreSQL is a strong fit for this application because the workflow is transactional, auditable, and relational.

The application processes medium-volume datasets rather than true large-scale analytics workloads. For 10K-row files, PostgreSQL supports:

- transactional state transitions
- batch inserts without row-by-row ORM chatter
- strong indexing on job, source, category, and review queries
- JSONB where trace payloads are semi-structured
- advisory locking for per-job serialization

## Lifecycle Model

The persistence layer models reconciliation state explicitly.

Primary job states:

- CREATED
- FILE_REGISTERED
- IMPORTING
- IMPORTED
- NORMALIZING
- NORMALIZED
- MATCHING
- MATCHED
- EXCEPTIONS_IDENTIFIED
- REVIEW_READY
- FINALIZED
- FAILED
- RETRY_PENDING
- CANCELLED

Each transition is validated in code and written transactionally with an audit event.

## Core Tables

### reconciliation_job

Top-level workflow entity containing correlation data, period context, current lifecycle state, retry count, failure details, and timing metadata.

### reconciliation_source_file

One row per source input file with checksum, format, size, source system, and parsed worksheet metadata.

### reconciliation_import_batch

Tracks chunked raw-row ingest batches so partial import progress is visible and auditable.

### reconciliation_raw_row

Stores raw imported row identity, source lineage, raw value payload, exclusion flags, and parsing issues.

### reconciliation_canonical_row

Stores normalized row data used by matching and reporting. Queryable fields stay relational; semi-structured source payloads remain JSONB.

### reconciliation_match_result

Stores pairwise confirmed and probable matches.

### reconciliation_match_group

Stores grouped-match artifacts separately because grouped results naturally carry variable-size member collections.

### reconciliation_rule_result

Stores persisted rule lineage for matches, grouped matches, and exceptions.

### reconciliation_exception

Stores final exception rows and their trace metadata.

### reconciliation_review_observation

Stores review-oriented observations produced by the classification/reporting flow.

### reconciliation_job_summary

Stores final summary metrics and chart payloads for fast report retrieval.

### reconciliation_export

Stores generated export metadata, checksum, and tab names.

### reconciliation_review_decision

Stores durable reviewer decisions as upserts keyed by run + target type + target id.

### reconciliation_audit_event

Stores state transitions and lifecycle events for traceability.

## Batch Persistence Strategy

Raw rows, canonical rows, and match artifacts are inserted in bounded batches.

Current defaults:

- raw rows: 500
- canonical rows: 500
- result artifacts: 500

This is sized for 10K-row workloads without over-fragmenting transactions.

## Locking and Idempotency

The lifecycle store takes a PostgreSQL advisory transaction lock per job id before mutating workflow state.

This prevents concurrent workers from racing the same reconciliation job through incompatible states.

Current idempotency coverage:

- source files are unique per job and source system
- raw rows are unique per source file and line number
- reviewer decisions are unique per job and review target

Future enhancement:

- promote input fingerprint handling into a first-class API idempotency contract for duplicate job submission reuse

## Recovery Model

The current implementation persists every major stage so a restart does not lose the durable record of work already completed.

Failure handling currently marks the job FAILED and records audit context.

Recommended next step:

- add explicit resumable retry orchestration that restarts from the latest durable completed stage rather than rerunning the full pipeline

## Testing Model

Two layers are provided:

- unit test for lifecycle state transitions
- real PostgreSQL integration test using Testcontainers for schema creation, batch persistence, finalization, and rollback on uniqueness failure

The dedicated command is:

```bash
npm run test:postgres
```

This keeps Docker-dependent database tests out of the default unit/integration suite while still making them executable in CI and local verification.

## Current Rollout Shape

The PostgreSQL lifecycle store is wired into the API server when `DATABASE_URL` is configured.

Current compatibility behavior remains in place:

- the API now returns a lean reconciliation report read model to the UI instead of the full execution graph
- the file-backed run repository still powers latest-run compatibility snapshots for local restart recovery
- the PostgreSQL store is the durable lifecycle ledger for production-grade persistence

Recommended next rollout step:

- move read models for summaries, exceptions, and reviewer decisions onto PostgreSQL-backed query services so the JSON snapshot path can be retired
