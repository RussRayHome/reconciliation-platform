# API Reference (Generated)

Generated at 2026-09-07T22:26:29.378Z.

## Coverage Summary

- Exported classes scanned: 24
- Class members scanned: 98
- Missing documentation items: 0

## Exported Classes

### ReconciliationFileValidationError

- Source: `apps/api/src/app.ts:582`
- Summary: Thrown by `runReconciliationWorkflow` when either uploaded file fails File Validation (Issue #137, Phase 7). This route has no partial-import/review screen the way the Import flow does, so the decided behavior is to fail the request outright with the validation issues rather than silently degrading or falling back to the old lenient pathway -- callers catch this specifically (before the generic error handler) to respond with the issues instead of a bare 500. No lifecycle job is registered when this throws, so a rejected upload never creates an orphaned CREATED-status reconciliation_job row.

#### ReconciliationFileValidationError Constructors

- `constructor(bankIssues: ValidationIssue[], glIssues: ValidationIssue[]): ReconciliationFileValidationError` — @param bankIssues Validation issues found in the uploaded bank file. @param glIssues Validation issues found in the uploaded GL file.

#### ReconciliationFileValidationError Methods

- None

#### ReconciliationFileValidationError Properties

- None

### ReconciliationWorkflowError

- Source: `apps/api/src/app.ts:604`
- Summary: Thrown by `runReconciliationWorkflow` for any failure *after* `registerLifecycleJob` has already created a Postgres lifecycle row (i.e. everything past the File Validation check above). Carries that row's id so both callers (`handleFailedReconciliationRun`'s call sites, in the synchronous route and the queue consumer) can actually mark it failed. Without this, `persistenceJobId` is only ever assigned from a *successful* `runReconciliationWorkflow` return -- a failure never reaches that `return` statement, so the row this run created would otherwise be silently left in its initial in-progress state forever, regardless of whether the failure came from the synchronous route or a queued/retried run.

#### ReconciliationWorkflowError Constructors

- `constructor(message: string, persistenceJobId: string, options?: ErrorOptions): ReconciliationWorkflowError` — @param message Human-readable failure reason, surfaced as-is via `Error.message`. @param persistenceJobId Id of the Postgres lifecycle row this run had already created. @param options Standard `ErrorOptions` -- used to attach the original error as `cause`.

#### ReconciliationWorkflowError Methods

- None

#### ReconciliationWorkflowError Properties

- None

### BankAccountAssignmentConflictError

- Source: `apps/api/src/services/accountAssignmentService.ts:40`
- Summary: One or more assignments disagree with their filename and have not been confirmed (A-D1). The caller surfaces these for confirmation or reassignment; it must never resolve them itself.

#### BankAccountAssignmentConflictError Constructors

- `constructor(conflicts: AccountAssignmentConflict[]): BankAccountAssignmentConflictError` — @param conflicts Every disagreement in the set, not just the first: a multi-file upload must be able to prompt per file rather than surfacing them one round trip at a time.

#### BankAccountAssignmentConflictError Methods

- None

#### BankAccountAssignmentConflictError Properties

- None

### BankAccountAssignmentError

- Source: `apps/api/src/services/accountAssignmentService.ts:29`
- Summary: A rejection the operator can fix by re-picking, rather than a conflict they can confirm past.

#### BankAccountAssignmentError Constructors

- `constructor(message: string): BankAccountAssignmentError` — @param message What the operator has to change -- a duplicate assignment or a deactivated account. Unlike a conflict, there is nothing here to confirm past.

#### BankAccountAssignmentError Methods

- None

#### BankAccountAssignmentError Properties

- None

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

### ImportValidationFailedError

- Source: `apps/web/src/hooks/useImportRunSubmit.ts:27`
- Summary: Thrown instead of a plain `Error` when the run was created and submitted but failed validation -- carries the run summary (already returned inline by `submitImportRunRequest`) so the UI can show Screen 05/07's failure detail for the invalid file(s) rather than just a generic error banner.

#### ImportValidationFailedError Constructors

- `constructor(run: ImportRunSummary): ImportValidationFailedError` — @param run The run summary from the failed submit response.

#### ImportValidationFailedError Methods

- None

#### ImportValidationFailedError Properties

- `run: ImportRunSummary` — The run summary `submitImportRunRequest` already returned inline, carrying per-file validation status so the UI can render Screen 05/06/07 without a second round trip.

### ApiError

- Source: `apps/web/src/lib/api.ts:112`
- Summary: Error-handling-build-plan.md EH4: thrown for a non-2xx API response instead of a plain `Error`, so callers can branch on `code`/`retryable` rather than parsing `message` text. `code` and `reference` are only present once the API's global error handler starts sending them (EH1/EH3) -- older/uncovered responses still parse fine, just without those fields.

#### ApiError Constructors

- `constructor(message: string, httpStatus: number, options?: { code?: ErrorCode; reference?: string; retryable?: boolean; conflicts?: AccountAssignmentConflict[]; }): ApiError` — @param message Authored, user-facing text from the response body. @param httpStatus The HTTP status the server responded with. @param options Optional `code`/`reference`/`retryable` from the response envelope.

#### ApiError Methods

- None

#### ApiError Properties

- `code: ErrorCode` — Registry key from the response body, when the server classified the failure.
- `reference: string` — Correlation id for this occurrence, for a support/log lookup.
- `httpStatus: number` — The HTTP status the server responded with.
- `retryable: boolean` — Whether retrying the same request could plausibly succeed.
- `conflicts: AccountAssignmentConflict[]` — A-D1 (Issue #338): on a 409 from `POST /api/imports/runs`, the per-file assignment disagreements the operator must confirm or correct. Present only for that case -- everywhere else this stays undefined, and a caller that ignores it loses nothing.

### BankFileCountError

- Source: `packages/core/src/fileValidation/bankFileMerge.ts:23`
- Summary: Raised when `mergeBankFiles` is called with fewer than 1 or more than {@link MAX_BANK_ACCOUNTS} raw files -- a caller-contract violation (the HTTP layer's own multer config and upload-count check should normally prevent this from ever reaching here), not a per-file content problem, so it's a distinct error from {@link BankFileStructuralError} below.

#### BankFileCountError Constructors

- `constructor(fileCount: number): BankFileCountError` — @param fileCount The number of raw bank files actually passed, named back in the message so the caller can see what was rejected.

#### BankFileCountError Methods

- None

#### BankFileCountError Properties

- None

### BankFileStructuralError

- Source: `packages/core/src/fileValidation/bankFileMerge.ts:42`
- Summary: Raised when a raw per-account bank file fails Step 1/Step 2 (header present, column order) on its own, before it ever reaches the merge. Checked per-file, pre-merge, specifically so a malformed raw file still produces a clear, attributable structural error -- the merge step always re-serializes the merged output with the canonical `BANKING_HEADERS` header row (regardless of either input file's own header shape), so once merged, a raw file's structural problem could otherwise only resurface as a confusing wall of per-row CELL_VALUES errors (every column blank because none of that file's column names matched anything) instead of one clear "missing column" finding.

#### BankFileStructuralError Constructors

- `constructor(originalFilename: string, issues: ValidationIssue[]): BankFileStructuralError` — @param originalFilename The specific raw bank file that failed, so the caller can attribute the failure to one of the two per-account uploads rather than the merged output. @param issues The Step 1/Step 2 structural issues raised against this file on its own.

#### BankFileStructuralError Methods

- None

#### BankFileStructuralError Properties

- None

### CsvParser

- Source: `packages/core/src/fileValidation/parsers/csvParser.ts:122`
- Summary: Hand-rolled RFC 4180 CSV parser for the File Validation Engine (no `csv-parse` dependency -- see the File Imports & Validation plan's own note on this tradeoff).

#### CsvParser Constructors

- None

#### CsvParser Methods

- `parse(bytes: Buffer<ArrayBufferLike>): Promise<ParsedFile>` — Parses raw CSV bytes into the shared {headers, rows} shape (row 1 is the header row).

#### CsvParser Properties

- None

### XlsxParser

- Source: `packages/core/src/fileValidation/parsers/xlsxParser.ts:52`
- Summary: Reads the first worksheet's header row (row 1) and every following row into the shared {headers, rows} shape (transaction-csv-spec.md §0.2: one data worksheet, header in row 1). Deliberately independent of `packages/core/src/parsers/excelParser.ts` -- that parser fuzzy-matches header aliases for the existing reconciliation pipeline's own column-mapping config and excludes rows by configured pattern, neither of which applies here. This one preserves headers and column order exactly, unresolved, so the File Validation Engine's own structural gates (header-present, column-order) can compare them directly against the expected banking/GL header lists.

#### XlsxParser Constructors

- None

#### XlsxParser Methods

- `parse(bytes: Buffer<ArrayBufferLike>): Promise<ParsedFile>` — Parses the first worksheet's raw bytes into the shared {headers, rows} shape.

#### XlsxParser Properties

- None

### AppError

- Source: `packages/domain/src/errors.ts:117`
- Summary: Thrown anywhere an operation fails in a classified way. `message` is always `ERROR_DEFINITIONS[code].publicMessage` -- authored, never derived from whatever caused the failure. `cause` carries the original error for logs/Sentry and must never be serialized into an HTTP response body (see the global error handler in `apps/api/src/app.ts`).

#### AppError Constructors

- `constructor(code: "RCN-DB-001" | "RCN-DB-002" | "RCN-DB-003" | "RCN-DB-004" | "RCN-DB-005" | "RCN-SUB-001" | "RCN-SUB-002" | "RCN-SUB-003" | "RCN-SUB-004" | "RCN-INT-001", context?: { [key: string]: unknown; operation?: "RECONCILIATION_RUNS_LIST" | ... 31 more ... | "APPROVAL_CLAIM"; stage?: string; }, options?: { ...; }): AppError` — @param code Registry key; determines `message`, `httpStatus`, and `retryable`. @param context Structured detail (operation, stage, etc.) for logs/Sentry only. @param options Standard `Error` cause option; the original failure, kept off the response.

#### AppError Methods

- None

#### AppError Properties

- `code: "RCN-DB-001" | "RCN-DB-002" | "RCN-DB-003" | "RCN-DB-004" | "RCN-DB-005" | "RCN-SUB-001" | "RCN-SUB-002" | "RCN-SUB-003" | "RCN-SUB-004" | "RCN-INT-001"` — The registry key this error was thrown as -- `message`/`httpStatus`/`retryable` all derive from `ERROR_DEFINITIONS[code]`.
- `context: { [key: string]: unknown; operation?: "RECONCILIATION_RUNS_LIST" | "RECONCILIATION_RUN_ROLLFORWARD" | "RECONCILIATION_OPEN_ITEMS_LIST" | "IMPORT_RUN_CREATE" | "IMPORT_RUN_LATEST" | ... 27 more ... | "APPROVAL_CLAIM"; stage?: string; }` — Structured detail for logs/Sentry only -- never serialized into an HTTP response body.

### DuplicateReconciliationAccountError

- Source: `packages/persistence/src/accountStore.ts:30`
- Summary: Raised when registering an account whose `accountIdentifier` this organization already uses. Distinct from the last-four ambiguity A-D1 explicitly permits: two accounts may share their last four, but the same full identifier twice is a duplicate registration, not a legitimate pair.

#### DuplicateReconciliationAccountError Constructors

- `constructor(accountIdentifier: string): DuplicateReconciliationAccountError` — @param accountIdentifier The already-registered identifier, named back so the UI can point at the field the operator must change.

#### DuplicateReconciliationAccountError Methods

- None

#### DuplicateReconciliationAccountError Properties

- None

### PostgresAccountStore

- Source: `packages/persistence/src/accountStore.ts:82`
- Summary: The registry behind A-D1 (Issue #338): bank accounts exist because an operator registered them, not because a filename mentioned one. Every method is tenant-scoped through `runInTenantScope` so RLS -- not a WHERE clause anyone could forget -- is what confines reads and writes to the caller's organization (see `postgres.ts`; writing without that scope matches zero rows and reports success).

#### PostgresAccountStore Constructors

- `constructor(pool: Pool): PostgresAccountStore` — @param pool The application pool. Every method routes through `runInTenantScope`, so this is never queried directly -- see the class doc comment.

#### PostgresAccountStore Methods

- `listAccounts(organizationId: string, options?: { includeInactive?: boolean; }): Promise<ReconciliationAccount[]>` — The organization's registered accounts, active first and then by label.
- `getAccount(organizationId: string, accountId: string): Promise<ReconciliationAccount>` — One account, asserted to belong to this organization.
- `resolveAccounts(organizationId: string, accountIds: readonly string[]): Promise<Map<string, ReconciliationAccount>>` — Resolves several account ids in one round trip, asserting every one belongs to this organization. Used by the upload path, which must validate an entire multi-file assignment set before merging any of it -- resolving them one at a time would let the first two files' work happen before the third turned out to be someone else's account.
- `findByLastFour(organizationId: string, lastFour: string): Promise<ReconciliationAccount[]>` — Every active account sharing `lastFour`. A-D1: when more than one matches, the operator must choose explicitly -- the caller never picks the first.
- `registerAccount(organizationId: string, input: RegisterReconciliationAccountInput): Promise<ReconciliationAccount>` — Registers a bank account -- the only way one comes into existence (A-D1, Issue #338).
- `updateAccount(organizationId: string, accountId: string, input: UpdateReconciliationAccountInput): Promise<ReconciliationAccount>` — `accountIdentifier` is intentionally not updatable -- see `UpdateReconciliationAccountInput`. Undefined fields are left as they are rather than nulled, so a partial update from the UI cannot silently erase the institution name or the GL binding.

#### PostgresAccountStore Properties

- None

### UnknownReconciliationAccountError

- Source: `packages/persistence/src/accountStore.ts:18`
- Summary: Raised when an account id does not resolve to a row this organization owns -- a deliberately indistinguishable outcome for "no such account" and "another tenant's account", so this never becomes a probe for the existence of other organizations' rows. RLS already makes the SELECT return nothing in the cross-tenant case; this is the error that carries that to the caller instead of letting a missing row read as an empty assignment.

#### UnknownReconciliationAccountError Constructors

- `constructor(accountId: string): UnknownReconciliationAccountError` — @param accountId The unresolvable account id, carried so the caller can attribute the failure to one statement of several without re-deriving which assignment was at fault.

#### UnknownReconciliationAccountError Methods

- None

#### UnknownReconciliationAccountError Properties

- None

### PostgresBlobStorage

- Source: `packages/persistence/src/blobStorage.ts:58`
- Summary: BYTEA-backed `BlobStorage`. Appropriate at the volumes this feature expects (files capped at 50MB) -- keeps bytes in the same transaction and backup as the metadata describing them, matching the reasoning `reconciliation_source_file_content`'s own changeset (0019) already established for the older import path.

#### PostgresBlobStorage Constructors

- `constructor(pool: Pool): PostgresBlobStorage` — @param pool Used when a call site doesn't already hold a transaction's `client`.

#### PostgresBlobStorage Methods

- `put(input: PutBlobInput, client?: PoolClient): Promise<PutBlobResult>` — Stores `input.bytes` in `import_file_content`, keyed by `input.importFileId`. Fails on a duplicate id rather than overwriting -- see the insert's own comment for why.
- `get(importFileId: string, organizationId: string, client?: PoolClient): Promise<Buffer<ArrayBufferLike>>` — Returns the stored bytes for a given import_file, scoped to its organization.

#### PostgresBlobStorage Properties

- None

### PostgresImportRunStore

- Source: `packages/persistence/src/importRunStore.ts:131`
- Summary: Persists a new `reconciliation_run` and its source files (implementation-spec.md v2 §6 step 1, adjusted for `run_source_file`). One method, one transaction: creates or reuses each `import_file` row (SHA-256 dedupe, scoped to organization + source_type -- see below), stores each file's bytes, creates the run (`DRAFT`), and links every file via `run_source_file` -- all inside a single `runInTenantScope` block so a failure partway through leaves nothing half-created.

#### PostgresImportRunStore Constructors

- `constructor(pool: Pool, blobStorage?: BlobStorage): PostgresImportRunStore` — @param blobStorage Defaults to a `PostgresBlobStorage` over the same pool; injectable for tests.

#### PostgresImportRunStore Methods

- `createRun(input: CreateImportRunInput): Promise<ImportRunSummary>` — Creates a DRAFT `reconciliation_run` and its `run_source_file` links, deduping each file's `import_file` row by content hash -- see the class's own doc comment for the full shape.
- `getRunSummary(organizationId: string, runId: string): Promise<ImportRunSummary>` — Reads back a run and its files (with per-file row/error/warning counts once validated), or `null` if `runId` doesn't exist in this organization.
- `getLatestRunSummary(organizationId: string): Promise<ImportRunSummary>` — The organization's most recent `reconciliation_run` regardless of status -- the durable "where is my process right now" answer the RunBar needs across a reload, covering VALIDATION_FAILED and mid-flight runs that `findLatestRunReport` (readModelStore.ts, backing GET /api/reconciliation/latest) structurally cannot represent. Null when the organization has no runs at all (Issue #154).
- `listRuns(organizationId: string, filters: { accountIdentifier?: string; periodYear?: number; periodMonth?: number; }): Promise<{ id: string; label: string; accountIdentifier: string; frequency: "MONTHLY" | "ANNUAL"; ... 4 more ...; createdAt: string; }[]>` — Lightweight row for `listRuns` -- deliberately not the full `ImportRunSummary` (no files/ matchingJob/validationJob joins), since a filtered list can return many rows and the caller (PR F.1's prior-runs endpoint) only needs enough to pick a run and link to its detail.
- `getFileWithBytes(organizationId: string, runId: string, importFileId: string): Promise<Omit<ImportRunFileSummary, "sourceType"> & { sourceType: "BANK" | "GL"; bytes: Buffer<...>; }>` — Metadata + raw bytes for one file within a run (Phase 11's structure-failure/all-rows- invalid screens re-parse the original to recover the header row, since it isn't persisted anywhere -- see `ValidationIssue`'s own comment). Scoped through `run_source_file` so a file ID from a different run can't be read this way. Null when the run doesn't exist/isn't RLS-visible, or the file isn't part of this run.

#### PostgresImportRunStore Properties

- None

### PostgresImportValidationStore

- Source: `packages/persistence/src/importValidationStore.ts:194`
- Summary: Persistence for Phase 6 (submit & async validation): the DRAFT -> VALIDATING -> (VALIDATION_ FAILED | PENDING_APPROVAL) transition, `import_job` lifecycle, and the `validation_issue`/ `canonical_record` rows the File Validation Engine's output becomes. Deliberately split into small, independently-committed transactions per method rather than one transaction spanning an entire validation run -- the worker calling this does real CPU work (parsing, validation) and calls out to the existing GL<->Bank matching pipeline (which manages its own transactions) between these calls, and holding one DB transaction open across all of that would tie up a pool connection for the worker's full run time for no atomicity benefit: each file's outcome is already independent (fileValidationEngine.ts's own doc comment), and import_job.attempts exists specifically so a failure partway through is retryable rather than needing all-or-nothing.

#### PostgresImportValidationStore Constructors

- `constructor(pool: Pool): PostgresImportValidationStore` — @param pool Postgres pool shared with the rest of the request/worker's persistence calls.

#### PostgresImportValidationStore Methods

- `submitRun(organizationId: string, runId: string, submittedByUserName: string): Promise<SubmitRunResult>` — DRAFT -> VALIDATING, stamps submitted_by/submitted_at, creates the QUEUED import_job. submittedByUserName resolves to reconciliation_user.id for submitted_by (a UUID FK, changeset 0042/0024 -- not the user_name primary key) -- left NULL if it doesn't resolve to a real row (e.g. the local-login-fallback dev users, which aren't real DB rows), matching how recordLoginEvent already tolerates that case elsewhere rather than failing the request. Row-locks the run first (FOR UPDATE) so a state check and its subsequent update can't race against a second concurrent submit.
- `markJobRunning(organizationId: string, importJobId: string, workerId: string): Promise<void>` — QUEUED -> RUNNING, stamps worker_id/started_at, bumps attempts (see the class's own doc comment for why retryable-per-attempt beats one spanning transaction).
- `markJobFailed(organizationId: string, importJobId: string, errorSummary: string): Promise<void>` — -> FAILED, stamps finished_at and a truncated diagnostic error_summary (see below for why it's truncated -- diagnostic text, not an audit record).
- `loadActiveValidationRuleVersionIds(organizationId: string): Promise<Map<string, string>>` — validation_rule_version (changeset 0047) has no organization_id -- it's a global platform catalog, not tenant data -- so the tenant GUC this sets doesn't gate anything here. Still routed through runInTenantScope rather than a bare pool.query so every query goes through the same least-privilege connection path, and so this keeps working unchanged if the table is ever made tenant-scoped later.
- `recordFileValidationOutcome(organizationId: string, input: RecordFileValidationOutcomeInput, ruleVersionIdsByCode: Map<string, string>): Promise<RecordFileValidationOutcomeResult>` — Persists one file's validation_issue rows + canonical_record rows (one per row that individually passed Step 3, regardless of the file's overall pass/fail -- this is what makes partial import possible, matching fileValidationEngine.ts's own doc comment) and updates that file's import_file status/counts/date range. ruleVersionIdsByCode should come from loadActiveValidationRuleVersionIds, loaded once per job and reused across both files rather than re-queried per issue.
- `finalizeRun(organizationId: string, runId: string, importJobId: string, input: { passed: boolean; }): Promise<void>` — Marks the run VALIDATION_FAILED or PENDING_APPROVAL (never gates the matching pipeline -- see reconciliation_run's own table comment, changeset 0042) and the job SUCCEEDED: the worker did its job correctly either way, whether or not the files themselves turned out valid.
- `recordMatchingJobId(organizationId: string, runId: string, matchingJobId: string): Promise<void>` — Links reconciliation_run to the id the existing matching pipeline produced (see changeset 0048's own comment: that id doubles as both the ReconciliationRun.id returned to the caller and the reconciliation_job.id it registers under). Called after finalizeRun, once matching has actually fired -- kept as its own update rather than folded into finalizeRun since matching only ever runs when input.passed was true there.
- `acceptPartialImport(organizationId: string, runId: string, actorUsername: string): Promise<{ outcome: "not_found"; } | { outcome: "invalid_state"; currentStatus: string; } | { outcome: "structural_failure"; importFileId: string; } | { ...; } | { ...; }>` — Phase 12 (Screen 06): accepts a VALIDATION_FAILED run's already-passing rows and moves it to PENDING_APPROVAL -- the caller triggers matching afterward, same as a run that passed outright (recordMatchingJobId is still the right next call). Guarded here, atomically with the FOR UPDATE lock, against the two cases Screen 06 doesn't apply to: a structural (HEADER/ COLUMN_ORDER) gate failure has no per-row detail to accept, and a file with zero importable rows has nothing to accept either -- both are Screen 05/07's territory, not this one's. Records `actorUsername` and the current time onto skip_invalid_rows_by/_at (changeset 0054) -- a real Dev-stack trace-through surfaced that this override had no record of who made it.
- `listRunIssues(organizationId: string, runId: string, limit: number, offset: number, filters?: RunIssuesFilter): Promise<PaginatedRunIssuesResult>` — Paginated validation_issue rows for a run's review drilldown (Phase 8). validation_issue has no reconciliation_run_id column of its own (only import_job_id/import_file_id, changeset 0042) -- submitRun only ever creates one import_job per run today (DRAFT -> VALIDATING is a one-way gate, no resubmit path exists), but the subquery scopes by run rather than assuming that 1:1 shape, so it stays correct if a retry path is added later. Returns null when the run itself doesn't exist/isn't visible under this tenant's RLS scope, so the route can 404 instead of silently returning an empty page.
- `listRunRecords(organizationId: string, runId: string, limit: number, offset: number, filters?: RunRecordsFilter): Promise<PaginatedRunRecordsResult>` — Paginated canonical_record rows for a run's review drilldown (Phase 8). Unlike validation_issue, canonical_record denormalizes reconciliation_run_id directly (changeset 0042's own comment: "purely for query convenience"), so this filters on it straight rather than going through import_job. Returns null when the run doesn't exist/isn't visible, same as listRunIssues.
- `listRunApprovals(organizationId: string, filter: ListRunApprovalsFilter): Promise<RunApprovalListItem[]>` — Lists reconciliation_run rows that have reached the Approvals surface (PENDING_APPROVAL/ APPROVED/REJECTED only -- DRAFT/VALIDATING/VALIDATION_FAILED/RECONCILING/RECONCILED never show up here, same "only decided-relevant statuses" scoping as listImportApprovals).
- `getRunApprovalCounts(organizationId: string, username: string, canApprove: boolean): Promise<RunApprovalCounts>` — Mirrors getImportApprovalCounts exactly: an approver's pending count only shows unclaimed-or -mine, but their approved/rejected counts are org-wide; a non-approver only ever sees their own submissions.
- `claimRunApproval(organizationId: string, runId: string, actorUsername: string): Promise<ClaimRunApprovalResult>` — Assigns actor as decided_by on an unclaimed PENDING_APPROVAL run, without deciding it -- mirrors claimImportApproval/claimApprovalRequest, both of which reuse their own "decider" column the exact same way rather than adding a separate claimed_by column. A later recordRunApprovalDecision overwrites decided_by with whoever actually decides (usually, but not necessarily, the same claimer), identical to how the other two claim/decide pairs behave today. Throws if actorUsername has no matching reconciliation_user row -- unlike submitRun's submitter, the decider's identity is integrity-critical here (segregation of duty), so this must fail loudly rather than silently record a NULL decider.
- `recordRunApprovalDecision(organizationId: string, input: RecordRunApprovalDecisionInput): Promise<RunApprovalDecisionResult>` — Decides a PENDING_APPROVAL run. The segregation-of-duty CHECK constraint (reconciliation_run_segregation_of_duty_check, changeset 0042: decided_by IS NULL OR submitted_by IS DISTINCT FROM decided_by) can reject this UPDATE with a Postgres 23514 violation when the actor is also the run's own submitter -- deliberately left uncaught here, same convention as createApprovalRequest's unique-violation (23505, readModelStore.ts's own doc comment): the route layer catches the raw error code, this layer doesn't guess at HTTP semantics. Throws (rather than returning a result variant) if actorUsername has no matching reconciliation_user row, same reasoning as claimRunApproval. input.allowSelfApproval (changeset 0056) sets a transaction-local GUC that relaxes the constraint for this UPDATE only -- see the field's own doc comment for who's allowed to set it.
- `withdrawRunApproval(organizationId: string, runId: string, actorUsername: string): Promise<{ outcome: "not_found"; } | { outcome: "invalid_state"; currentStatus: string; } | { outcome: "not_submitter"; } | { ...; }>` — README §7 item 7: "an analyst... may withdraw a submission" -- pulls a PENDING_APPROVAL run (already validated, matching already fired per this build's immediate-execution decision) back to DRAFT so the analyst can fix and resubmit. Only the run's own submitter may withdraw it -- checked here, not just at the route's role gate, since any senior-analyst passes that gate but this is a self-service action on one's own submission, not a general capability.

#### PostgresImportValidationStore Properties

- None

### PostgresOpenItemStore

- Source: `packages/persistence/src/openItemStore.ts:108`
- Summary: Write path for the Unreconciled Item Roll-Forward's open-item entity (PR C.4). Called once per successful run, right after the reconciliation pipeline's export/finalize step (`PostgresReconciliationLifecycleStore.persistExportAndFinalize`) -- see `reconciliation_job.current_state = 'FINALIZED'`'s doc comment for why that event, not `reconciliation_run.status = 'RECONCILED'`, is the real "this run is done" signal this projection hooks on (the latter is set immediately afterward, in the same call, specifically to stop being a dead status).

#### PostgresOpenItemStore Constructors

- `constructor(pool: Pool): PostgresOpenItemStore` — @param pool Tenant-agnostic pool; every method scopes its own queries via `runInTenantScope` (or, for `reconciliation_organization`, the plain pool -- see `getCarryForwardEnabled`'s own doc comment for why).

#### PostgresOpenItemStore Methods

- `projectOpenItems(organizationId: string, input: ProjectOpenItemsInput): Promise<ProjectOpenItemsResult>` — Projects this run's carry-eligible exceptions (`input.candidates`, already reduced by `buildOpenItemCandidates`) into open items: an existing OPEN row for the same `(organization_id, account_id, natural_key)` gets a `CARRIED_FORWARD` event; anything new is inserted and gets an `OPENED` event. See the class's own doc comment for when this runs.
- `markRunReconciled(organizationId: string, reconciliationRunId: string): Promise<void>` — Flips `reconciliation_run.status` to `RECONCILED` once its linked job has finalized -- RECONCILING/RECONCILED existed in the CHECK constraint since changeset 0042 but nothing ever set either one; PENDING_APPROVAL/APPROVED/REJECTED (the Comptroller review trail) don't gate this, matching 0042's own "matching still fires immediately once validation passes" note. Idempotent: re-running this against an already-RECONCILED run is a harmless no-op UPDATE.
- `getCarryForwardEnabled(organizationId: string): Promise<boolean>` — Reads `reconciliation_organization.carry_forward_enabled` (changeset 0066) -- the org half of `resolveCarryForwardDecision`'s input (`@recon/domain`). Uses the plain pool, not `runInTenantScope`: `reconciliation_organization` is the tenant table itself and carries no RLS policy (changeset 0030's own documented exclusion, matching ADR-0001's scope), so a session-scoped query would add nothing here. Returns `false` (never carry-forward) for an organization id that doesn't resolve, rather than throwing -- a caller mid-request already knows the organization exists from auth; this is a defensive default, not an expected path.
- `stampCarryForwardDecision(organizationId: string, reconciliationRunId: string, decision: CarryForwardDecision): Promise<void>` — Persists the resolver's outcome on the run itself (changeset 0067) -- see that changeset's own doc comment for why NULL (never evaluated) is kept distinct from `false` (evaluated, declined, with a reason). No-op when `reconciliationRunId` is undefined -- the standalone atomic route has no `reconciliation_run` row to stamp.
- `loadOpenItems(organizationId: string, accountIds: string[]): Promise<OpenItemRecord[]>` — Loads every still-`OPEN` item for the given accounts (PR D.1) -- the read side of `projectOpenItems`. `accountIds` are `reconciliation_account.id` values, which since A-D1 (Issue #338) is what `NormalizedTransaction.accountIdentifier` carries. The returned `accountIdentifier` is the account *id*, not `reconciliation_account. account_identifier`, and that is deliberate: these records are seeded straight back into the run's transaction list by `seedCarriedForwardTransactions`, where they must share one account identity with this run's fresh transactions. Handing back the human identifier here would give a carried item a different natural key than the transaction it is meant to pair with, so it would re-open every period instead of matching. The UI-facing listings further down this file still return the human identifier -- they are read for display, not fed back into matching. `amount`/`original_transaction_date` get the same `::text`/`Number()` treatment as every other numeric/date column this store touches -- `pg` returns NUMERIC as a string and DATE as a `Date` object by default, neither of which matches `OpenItemRecord`'s declared shape without an explicit cast.
- `clearOpenItems(organizationId: string, input: { reconciliationRunId?: string; clearances: { openItemId: string; matchResultId?: string; }[]; }): Promise<{ cleared: number; }>` — Marks carried-forward items that found their counterpart this run as `CLEARED` (PR D.5). `matchResultId` is optional per clearance, not required: it's only safe to write when this run's `MatchResult`s were actually persisted into `reconciliation_match_result` (the column's FK target) -- the caller passes it only when a `lifecycleStore` did that persisting this run, and NULL otherwise, rather than this store guessing. Silently no-ops (zero rows affected) for an item that isn't `OPEN` any more -- re-running finalize twice against the same clearance must not double-write or throw.
- `linkRunAccounts(organizationId: string, input: { reconciliationRunId: string; accountIds: string[]; }): Promise<void>` — Links a run to the real accounts its own normalized transactions touch (PR E.1's prerequisite fix, not a plan work item by name -- see this method's own investigation note below). Asserts each account is one this organization has registered (same `requireAccountId` used by `projectOpenItems`) and links it via `reconciliation_run_account` (PR A.2, changeset 0060). `reconciliation_run_account` was created "unused on landing" in PR A -- its own changeset backfilled one row per *existing* run at migration time, but nothing in the application ever wrote a new row for a run created afterward. PR E's close operation needs a reliable way to enumerate a run's accounts (§3.8: "recomputes the roll-forward snapshot per account"), and the per-transaction `accountIdentifier` values aren't known until normalization runs -- well after `PostgresImportRunStore.createRun` -- so this is called from the reconciliation pipeline itself (`reconciliationService.ts`), the same place PR D.1 already computes the run's distinct account identifiers for carry-forward seeding.
- `closeRun(organizationId: string, input: { runId: string; actorUsername: string; }): Promise<CloseRunResult>` — Closes a period (PR E.2, plan §3.8): for every account linked to this run (`reconciliation_run_account`), recomputes the roll-forward snapshot, asserts the control equation against an independently-counted current OPEN balance, and only if every account ties does it freeze the snapshots and flip the run to CLOSED. All in one transaction -- a partial close (some accounts frozen, others not) would defeat the point of a tie-out gate. Only a `RECONCILED` run can close -- period close is the last step after reconciliation finishes, not a substitute for it.
- `reopenRun(organizationId: string, input: { runId: string; actorUsername: string; }): Promise<ReopenRunResult>` — Reopens a closed period (PR E.3, plan §3.8): puts the run back to `RECONCILED`, increments `reopen_count`, writes a `REOPENED` event, and -- the part that actually protects downstream audit trails -- marks every *later* closed period's own snapshot for the same accounts `is_stale = true` rather than silently recomputing it. A later period's own numbers are only suspect, not wrong, until someone re-closes it deliberately.
- `writeOffOpenItem(organizationId: string, input: { openItemId: string; reconciliationRunId?: string; actorUsername: string; dispositionCode: string; dispositionNote?: string; }): Promise<WriteOffOpenItemResult>` — Writes off an open item (PR E.4): sets it to `WRITTEN_OFF` with a required disposition code/note, and logs the transition -- same append-only event trail as every other status change on this entity. Never deletes the row. Two approval controls, added by Issue #283 (B5), which this method previously had none of: 1. DOLLAR BANDS, enforced here. The actor's role is read from the database rather than taken from the caller -- the API layer knows the authenticated role, but a store that trusts a caller-supplied role is one internal call away from being bypassed, and the role is a single column on a row this method already has to load. 2. SEGREGATION OF DUTY, enforced by the database (changeset 0075). Whoever submitted the run that opened this item may not write it off. This method does not re-implement that check: it performs the UPDATE and translates the trigger's rejection, so the control holds for every write path including psql, not just this one. The ordering is deliberate. The band check runs first and returns without writing, so an under-authorised actor gets a specific answer rather than a generic constraint failure; the segregation check can only be evaluated by the database, so it necessarily surfaces as a caught error rather than a pre-check. Age bands were part of the same policy question and are NOT implemented -- Issue #283 settled dollar thresholds only. `original_transaction_date` is on the row when that answer arrives.
- `getRunRollforward(organizationId: string, runId: string): Promise<{ snapshots: PeriodRollforwardSnapshot[]; openedThisRun: OpenItemRecord[]; clearedThisRun: OpenItemRecord[]; }>` — PR F.2: what backs `GET /api/reconciliation/runs/:id/rollforward` -- the frozen snapshot(s) a CLOSED run produced (empty array for a run that was never closed, since `reconciliation_period_rollforward` rows only exist post-close), plus this run's own contribution to the ledger: which items it opened and which it cleared. `null` only when the run itself doesn't exist (or isn't RLS-visible) -- a real run with no snapshot yet still returns a result, just with an empty `snapshots` array.
- `listOpenItemsSchedule(organizationId: string, filters: { accountIdentifier?: string; status?: string; }): Promise<{ id: string; accountIdentifier: string; sourceSystem: SourceSystem; category: ErrorCategory; status: string; naturalKey: string; ... 10 more ...; dispositionNote?: string; }[]>` — PR F.4: what backs the open-items schedule view -- the read-only replacement for the spreadsheet support schedule `packages/domain/src/messages.ts` currently tells reviewers to keep by hand. Every item regardless of status by default (a reviewer needs to see what cleared/was written off, not just what's still open), narrowable by account and/or status. `ageInDays` is computed here (CURRENT_DATE - original_transaction_date), not carried from any run's own anchor date -- this view has no single run to anchor to, it spans every period. `ownerUsername` is resolved via the same bounded, already-scoped join `resolveUsernamesByIds`/`resolveUserId` use elsewhere in this store -- always null today since nothing yet assigns `owner_user_id` (no write path exists; this is a read-only view).

#### PostgresOpenItemStore Properties

- None

### PostgresReconciliationReadModelStore

- Source: `packages/persistence/src/readModelStore.ts:618`
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

- Source: `packages/persistence/src/reconciliationLifecycleStore.ts:412`
- Summary: Writes all reconciliation artifacts to PostgreSQL, advancing the job state machine at each step. Every public method wraps its writes in a single transaction, acquires an advisory lock on the job row, validates the state transition, performs the inserts/updates, and records an audit event. This ensures the job can never skip a state and that partial writes are rolled back on error. Typical call sequence: 1. `createJob` — insert job + source file registrations → CREATED → FILE_REGISTERED 2. `persistParsedRows` — bulk-insert raw rows → IMPORTING → IMPORTED 3. `persistNormalizedRows` — bulk-insert canonical rows → NORMALIZING → NORMALIZED 4. `persistMatchingArtifacts` — insert match results + rule evaluations → MATCHING → MATCHED 5. `persistReviewArtifacts` — insert exceptions, observations, summary → EXCEPTIONS_IDENTIFIED → REVIEW_READY 6. `persistExportAndFinalize` — insert export record + audit events → FINALIZED

#### PostgresReconciliationLifecycleStore Constructors

- `constructor(pool: Pool, options?: { rawRowBatchSize?: number; canonicalRowBatchSize?: number; resultBatchSize?: number; rulepackVersion?: string; }): PostgresReconciliationLifecycleStore` — Creates a lifecycle store with optional batch-size tuning for bulk inserts.

#### PostgresReconciliationLifecycleStore Methods

- `createJob(input: CreateReconciliationJobInput): Promise<void>` — Persists a new reconciliation job and its registered source files.
- `persistParsedRows(organizationId: string, jobId: string, sourceFiles: SourceFile[], rawRows: RawTransactionRow[]): Promise<void>` — Persists parsed raw spreadsheet rows and source-file import batch metadata.
- `persistNormalizedRows(organizationId: string, jobId: string, normalizedTransactions: NormalizedTransaction[]): Promise<void>` — Persists normalized canonical transactions derived from raw imported rows.
- `persistMatchingArtifacts(organizationId: string, input: PersistMatchingArtifactsInput): Promise<void>` — Persists grouped and pairwise match artifacts plus derived rule-evaluation records.
- `persistReviewArtifacts(organizationId: string, input: PersistReviewArtifactsInput): Promise<void>` — Persists exception/review artifacts and upserts run summary metrics.
- `persistExportAndFinalize(organizationId: string, input: PersistExportArtifactsInput): Promise<void>` — Persists export metadata and finalizes the reconciliation job. Issue #154: no longer also writes audit events here -- see `recordAuditEvent`, called by the pipeline as each step actually completes.
- `recordAuditEvent(organizationId: string, jobId: string, eventType: string, details: Record<string, string | number | boolean>): Promise<void>` — Records one audit-trail event immediately (Issue #154) -- unlike the old `persistExportAndFinalize`-bundled batch write (only reached once a run fully succeeds), this is meant to be called by the pipeline as each step actually completes, so a mid-run failure still leaves a durable, chronologically-ordered trail of what happened before it. Verifies the job belongs to `organizationId` first, the same defense-in-depth `persistReviewerDecision` and `persistExportAndFinalize` already apply, rather than trusting the caller's own scoping.
- `getLatestAuditEvent(organizationId: string, jobId: string): Promise<{ eventType: string; details: Record<string, unknown>; createdAt: string; }>` — Reads the single most recent audit event for a job (Issue #154's SSE catch-up-on-connect) -- a client that opens the live-status stream after an earlier progress message was already published (a page reload mid-run, a dropped connection, a second tab) would otherwise see a blank stream until the next live message, since `QueueEvents`'s `'progress'` event is a live broadcast only with no replay. This reads `recordAuditEvent`'s own prior writes back, so the catch-up message is exactly what would have been published live had the connection been open at the time. Returns `null` when the job has no audit events yet (nothing published, or matching hasn't reached its first checkpoint), never throws for that case.
- `persistReviewerDecision(organizationId: string, decision: ReviewerDecision): Promise<void>` — Persists or updates a reviewer decision for a run target and records an audit event.
- `deleteReviewerDecision(organizationId: string, runId: string, targetType: ReviewerDecision, targetId: string): Promise<void>` — Removes a reviewer decision for a run/target, returning the target to an undecided state. Idempotent: a no-op when no matching decision exists.
- `markFailed(organizationId: string, input: MarkJobFailedInput): Promise<void>` — Marks a reconciliation job as failed (or retry-pending) with failure diagnostics.

#### PostgresReconciliationLifecycleStore Properties

- None
