# API Reference (Generated)

Generated at 2026-08-08T22:35:13.510Z.

## Coverage Summary

- Exported classes scanned: 6
- Class members scanned: 30
- Missing documentation items: 0

## Exported Classes

### MockEntityVerificationProvider

- Source: `apps/api/src/services/entityVerificationService.ts:28`
- Summary: Stands in for a real Secretary-of-State lookup vendor. Deterministic so the whole account-created -> pending -> verified/failed path is exercisable without any external dependency: an all-zero or '9999'-containing filing number fails (mirrors the design mockup's own fake SoS logic), anything else passes.

#### MockEntityVerificationProvider Constructors

- None

#### MockEntityVerificationProvider Methods

- `verify(request: EntityVerificationRequest): Promise<EntityVerificationResult>` — Fails on an all-zero or '9999'-containing filing number; verifies everything else.

#### MockEntityVerificationProvider Properties

- None

### MockNotificationChannel

- Source: `apps/api/src/services/identityVerificationService.ts:47`
- Summary: The `NotificationChannel` implementation used until a real email/SMS vendor is wired in -- see the interface doc above for why logging stands in for sending.

#### MockNotificationChannel Constructors

- `constructor(logger?: Logger<never, boolean>): MockNotificationChannel` — @param logger Optional; when omitted the code is generated but never surfaced anywhere.

#### MockNotificationChannel Methods

- `send(target: string, code: string): Promise<void>` — Logs `code` instead of delivering it to `target` -- see the class doc for why.

#### MockNotificationChannel Properties

- None

### FileBackedRunRepository

- Source: `apps/api/src/services/runRepository.ts:209`
- Summary: Stores reconciliation runs in memory while also persisting the latest completed run to disk so it survives API restarts.

#### FileBackedRunRepository Constructors

- `constructor(filePath: string): FileBackedRunRepository` — Creates a file-backed repository that persists the latest run snapshot to disk.

#### FileBackedRunRepository Methods

- `save(run: ReconciliationRun): ReconciliationRun` — Persists a reconciliation run in memory under its run identifier.
- `findById(id: string): any` — Looks up a previously stored reconciliation run by identifier.
- `findLatest(): any` — Returns the most recently saved reconciliation run.

#### FileBackedRunRepository Properties

- None

### InMemoryRunRepository

- Source: `apps/api/src/services/runRepository.ts:91`
- Summary: Stores completed reconciliation runs in process memory for local development and short-lived diagnostic workflows. This repository is intentionally simple and non-durable. It provides a narrow seam that can be replaced later with a persistent implementation.

#### InMemoryRunRepository Constructors

- None

#### InMemoryRunRepository Methods

- `save(run: ReconciliationRun): ReconciliationRun` — Persists a reconciliation run in memory under its run identifier.
- `findById(id: string): any` — Looks up a previously stored reconciliation run by identifier.
- `findLatest(): any` — Returns the most recently saved reconciliation run.
- `saveReviewerDecision(runId: string, decision: ReviewerDecision): ReviewerDecision` — Upserts a reviewer decision for a run and returns the persisted decision payload. Existing decisions for the same target are replaced while preserving original identity fields.
- `listReviewerDecisions(runId: string): ReviewerDecision[]` — Lists reviewer decisions for a run, or an empty array when the run is not found.
- `deleteReviewerDecision(runId: string, targetType: ReviewerDecision, targetId: string): boolean` — Removes the reviewer decision for a run/target, returning `true` when one was removed. Clearing a decision returns the target to an undecided state (idempotent).

#### InMemoryRunRepository Properties

- None

### PostgresReconciliationReadModelStore

- Source: `packages/persistence/src/readModelStore.ts:578`
- Summary: PostgreSQL-backed read-model store for reconciliation runs, exceptions, exports, and reviewer decisions. Used by the API to serve report and dashboard queries. ADR-0001 step 6: every method takes `organizationId` and runs through `runInTenantScope`, which sets `app.current_organization_id` for the transaction before issuing any query -- RLS policies (changeset 0030) key off that GUC, so a runId belonging to a different tenant than `organizationId` resolves as "not found" rather than leaking another customer's data.

#### PostgresReconciliationReadModelStore Constructors

- `constructor(pool: Pool): PostgresReconciliationReadModelStore` — Creates a read-model store backed by a PostgreSQL connection pool.

#### PostgresReconciliationReadModelStore Methods

- `findLatestRunReport(organizationId: string): Promise<any>` — Returns the most recently completed reconciliation run report.
- `findRunReportById(organizationId: string, runId: string): Promise<any>` — Loads a full reconciliation report, including files, matches, exceptions, and summary.
- `findRunSummaryById(organizationId: string, runId: string): Promise<any>` — Loads summary metrics for a specific reconciliation run.
- `listRunExceptions(organizationId: string, runId: string): Promise<ExceptionItem[]>` — Lists all exceptions captured for the given run in deterministic line/id order.
- `listRunExceptionsPage(organizationId: string, runId: string, limit: number, offset: number, filters?: ExceptionPageFilters): Promise<PaginatedExceptionsResult>` — Lists a paginated slice of exceptions and total count metadata. Optional category/severity filters narrow both the page and the total count.
- `listReviewerDecisions(organizationId: string, runId: string): Promise<ReviewerDecision[]>` — Lists reviewer decisions for the given run ordered by creation time.

#### PostgresReconciliationReadModelStore Properties

- None

### PostgresReconciliationLifecycleStore

- Source: `packages/persistence/src/reconciliationLifecycleStore.ts:415`
- Summary: Writes all reconciliation artifacts to PostgreSQL, advancing the job state machine at each step. Every public method wraps its writes in a single transaction, acquires an advisory lock on the job row, validates the state transition, performs the inserts/updates, and records an audit event. This ensures the job can never skip a state and that partial writes are rolled back on error. Typical call sequence: 1. `createJob` — insert job + source file registrations → CREATED → FILE_REGISTERED 2. `persistParsedRows` — bulk-insert raw rows → IMPORTING → IMPORTED 3. `persistNormalizedRows` — bulk-insert canonical rows → NORMALIZING → NORMALIZED 4. `persistMatchingArtifacts` — insert match results + rule evaluations → MATCHING → MATCHED 5. `persistReviewArtifacts` — insert exceptions, observations, summary → EXCEPTIONS_IDENTIFIED → REVIEW_READY 6. `persistExportAndFinalize` — insert export record + audit events → FINALIZED

#### PostgresReconciliationLifecycleStore Constructors

- `constructor(pool: Pool, options?: { rawRowBatchSize?: number; canonicalRowBatchSize?: number; resultBatchSize?: number; rulepackVersion?: string; }): PostgresReconciliationLifecycleStore` — Creates a lifecycle store with optional batch-size tuning for bulk inserts.

#### PostgresReconciliationLifecycleStore Methods

- `createJob(input: CreateReconciliationJobInput): Promise<void>` — Persists a new reconciliation job and its registered source files.
- `persistParsedRows(organizationId: string, jobId: string, sourceFiles: SourceFile[], rawRows: RawTransactionRow[]): Promise<void>` — Persists parsed raw spreadsheet rows and source-file import batch metadata.
- `persistNormalizedRows(organizationId: string, jobId: string, normalizedTransactions: NormalizedTransaction[]): Promise<void>` — Persists normalized canonical transactions derived from raw imported rows.
- `persistMatchingArtifacts(organizationId: string, input: PersistMatchingArtifactsInput): Promise<void>` — Persists grouped and pairwise match artifacts plus derived rule-evaluation records.
- `persistReviewArtifacts(organizationId: string, input: PersistReviewArtifactsInput): Promise<void>` — Persists exception/review artifacts and upserts run summary metrics.
- `persistExportAndFinalize(organizationId: string, input: PersistExportArtifactsInput): Promise<void>` — Persists export metadata, appends audit events, and finalizes the reconciliation job.
- `persistReviewerDecision(organizationId: string, decision: ReviewerDecision): Promise<void>` — Persists or updates a reviewer decision for a run target and records an audit event.
- `deleteReviewerDecision(organizationId: string, runId: string, targetType: ReviewerDecision, targetId: string): Promise<void>` — Removes a reviewer decision for a run/target, returning the target to an undecided state. Idempotent: a no-op when no matching decision exists.
- `markFailed(organizationId: string, input: MarkJobFailedInput): Promise<void>` — Marks a reconciliation job as failed (or retry-pending) with failure diagnostics.

#### PostgresReconciliationLifecycleStore Properties

- None
