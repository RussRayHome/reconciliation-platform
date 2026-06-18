# API Reference (Generated)

Generated at 2026-06-18T18:59:19.198Z.

## Coverage Summary

- Exported classes scanned: 6
- Class members scanned: 33
- Missing documentation items: 0

## Exported Classes

### FileBackedRunRepository

- Source: `apps/api/src/services/runRepository.ts:177`
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

- Source: `apps/api/src/services/runRepository.ts:86`
- Summary: Stores completed reconciliation runs in process memory for local development and short-lived diagnostic workflows. This repository is intentionally simple and non-durable. It provides a narrow seam that can be replaced later with a persistent implementation.

#### InMemoryRunRepository Constructors

- None

#### InMemoryRunRepository Methods

- `save(run: ReconciliationRun): ReconciliationRun` — Persists a reconciliation run in memory under its run identifier.
- `findById(id: string): any` — Looks up a previously stored reconciliation run by identifier.
- `findLatest(): any` — Returns the most recently saved reconciliation run.
- `saveReviewerDecision(runId: string, decision: ReviewerDecision): ReviewerDecision` — Upserts a reviewer decision for a run and returns the persisted decision payload. Existing decisions for the same target are replaced while preserving original identity fields.
- `listReviewerDecisions(runId: string): ReviewerDecision[]` — Lists reviewer decisions for a run, or an empty array when the run is not found.

#### InMemoryRunRepository Properties

- None

### EphemeralStack

- Source: `packages/infra/lib/ephemeral-stack.ts:21`
- Summary: Ephemeral runtime infrastructure stack for deployable API/Web services and database compute. This stack depends on `PersistentStack` for shared resources while allowing the runtime environment to be safely recreated or restored from snapshots.

#### EphemeralStack Constructors

- `constructor(scope: Construct, id: string, props: EphemeralStackProps): EphemeralStack` — Creates runtime networking, database, ECS services, and load-balancer routing.

#### EphemeralStack Methods

- None

#### EphemeralStack Properties

- None

### PersistentStack

- Source: `packages/infra/lib/persistent-stack.ts:15`
- Summary: Long-lived infrastructure resources shared across ephemeral environment deployments. This stack provisions durable repositories, storage, IAM roles, and database credentials that are referenced by runtime stacks and retained across teardown/recreate cycles.

#### PersistentStack Constructors

- `constructor(scope: Construct, id: string, props?: StackProps): PersistentStack` — Creates the persistent baseline infrastructure resources for the platform.

#### PersistentStack Methods

- None

#### PersistentStack Properties

- `apiRepo: Repository` — ECR repository used for API image pushes and deployments.
- `webRepo: Repository` — ECR repository used for web image pushes and deployments.
- `uploadsBucket: Bucket` — S3 bucket for uploaded source workbooks and related artifacts.
- `executionRole: Role` — ECS execution role used for pulling images and publishing container logs.
- `taskRole: Role` — ECS task role used by application containers for runtime AWS permissions.
- `dbSecret: Secret` — Secret containing persisted database credentials used by runtime stacks.

### PostgresReconciliationReadModelStore

- Source: `packages/persistence/src/readModelStore.ts:351`
- Summary: PostgreSQL-backed read-model store for reconciliation runs, exceptions, exports, and reviewer decisions. Used by the API to serve report and dashboard queries.

#### PostgresReconciliationReadModelStore Constructors

- `constructor(pool: Pool): PostgresReconciliationReadModelStore` — Creates a read-model store backed by a PostgreSQL connection pool.

#### PostgresReconciliationReadModelStore Methods

- `findLatestRunReport(): Promise<any>` — Returns the most recently completed reconciliation run report.
- `findRunReportById(runId: string): Promise<any>` — Loads a full reconciliation report, including files, matches, exceptions, and summary.
- `findRunSummaryById(runId: string): Promise<any>` — Loads summary metrics for a specific reconciliation run.
- `listRunExceptions(runId: string): Promise<ExceptionItem[]>` — Lists all exceptions captured for the given run in deterministic line/id order.
- `listRunExceptionsPage(runId: string, limit: number, offset: number): Promise<PaginatedExceptionsResult>` — Lists a paginated slice of exceptions and total count metadata.
- `listReviewerDecisions(runId: string): Promise<ReviewerDecision[]>` — Lists reviewer decisions for the given run ordered by creation time.

#### PostgresReconciliationReadModelStore Properties

- None

### PostgresReconciliationLifecycleStore

- Source: `packages/persistence/src/reconciliationLifecycleStore.ts:320`
- Summary: Writes all reconciliation artifacts to PostgreSQL, advancing the job state machine at each step. Every public method wraps its writes in a single transaction, acquires an advisory lock on the job row, validates the state transition, performs the inserts/updates, and records an audit event. This ensures the job can never skip a state and that partial writes are rolled back on error. Typical call sequence: 1. `createJob` — insert job + source file registrations → CREATED → FILE_REGISTERED 2. `persistParsedRows` — bulk-insert raw rows → IMPORTING → IMPORTED 3. `persistNormalizedRows` — bulk-insert canonical rows → NORMALIZING → NORMALIZED 4. `persistMatchingArtifacts` — insert match results + rule evaluations → MATCHING → MATCHED 5. `persistReviewArtifacts` — insert exceptions, observations, summary → EXCEPTIONS_IDENTIFIED → REVIEW_READY 6. `persistExportAndFinalize` — insert export record + audit events → FINALIZED

#### PostgresReconciliationLifecycleStore Constructors

- `constructor(pool: Pool, options?: { rawRowBatchSize?: number; canonicalRowBatchSize?: number; resultBatchSize?: number; rulepackVersion?: string; }): PostgresReconciliationLifecycleStore` — Creates a lifecycle store with optional batch-size tuning for bulk inserts.

#### PostgresReconciliationLifecycleStore Methods

- `createJob(input: CreateReconciliationJobInput): Promise<void>` — Persists a new reconciliation job and its registered source files.
- `persistParsedRows(jobId: string, sourceFiles: SourceFile[], rawRows: RawTransactionRow[]): Promise<void>` — Persists parsed raw spreadsheet rows and source-file import batch metadata.
- `persistNormalizedRows(jobId: string, normalizedTransactions: NormalizedTransaction[]): Promise<void>` — Persists normalized canonical transactions derived from raw imported rows.
- `persistMatchingArtifacts(input: PersistMatchingArtifactsInput): Promise<void>` — Persists grouped and pairwise match artifacts plus derived rule-evaluation records.
- `persistReviewArtifacts(input: PersistReviewArtifactsInput): Promise<void>` — Persists exception/review artifacts and upserts run summary metrics.
- `persistExportAndFinalize(input: PersistExportArtifactsInput): Promise<void>` — Persists export metadata, appends audit events, and finalizes the reconciliation job.
- `persistReviewerDecision(decision: ReviewerDecision): Promise<void>` — Persists or updates a reviewer decision for a run target and records an audit event.
- `markFailed(input: MarkJobFailedInput): Promise<void>` — Marks a reconciliation job as failed (or retry-pending) with failure diagnostics.

#### PostgresReconciliationLifecycleStore Properties

- None
