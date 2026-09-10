import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import { computeSha256Hex } from './reconciliationLifecycleStore';
import { runInTenantScope } from './postgres';
import { PostgresBlobStorage, type BlobStorage } from './blobStorage';
import type { ImportFileSourceType } from '@recon/domain';

/** One uploaded source file for a new run. `role` and `sourceType` diverge as of Issue #141:
 * `run_source_file.role` is deliberately not FK'd to `import_file.source_type` (changeset 0045,
 * "a future run could plausibly want two files of the same source_type distinguished by role")
 * -- exactly this case, and `role` itself is plain unconstrained TEXT at the DB layer (no
 * enum/CHECK), so widening it here is a pure TypeScript change with no migration. A run now
 * carries between 1+2 and 4+2 files (Issue #153: 1-4 bank accounts): the raw per-account bank
 * uploads (`BANK_ACCOUNT_1`..`BANK_ACCOUNT_4`, `sourceType: 'BANK'`, kept for audit/re-download
 * only, never individually validated), the merged bank dataset that actually flows through File
 * Validation and matching (`BANK_MERGED`, `sourceType: 'BANK'`), and `GL` (role and sourceType
 * still equal, unaffected by this change). `role` stays a plain `string` rather than a template
 * literal type (`` `BANK_ACCOUNT_${number}` ``) since the read-back type (`ImportRunFileSummary`
 * below) is already untyped `string` -- narrowing only the write side wouldn't add real safety. */
export interface CreateImportRunFileInput {
  role: string;
  sourceType: ImportFileSourceType;
  originalFilename: string;
  fileFormat: 'CSV' | 'XLSX';
  bytes: Buffer;
  /**
   * The `reconciliation_account.id` this statement was explicitly assigned to (A-D1, Issue #338),
   * recorded on the `run_source_file` link so the assignment stays auditable next to the original
   * filename it may have disagreed with. Set on the raw `BANK_ACCOUNT_n` uploads, which are the
   * per-account statements; absent on `GL` and on `BANK_MERGED`, which spans every account in the
   * run and is attributed per row by the merged dataset's own Interface ID column instead.
   */
  accountId?: string;
}

export interface CreateImportRunInput {
  organizationId: string;
  label: string;
  accountIdentifier?: string;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth?: number;
  files: CreateImportRunFileInput[];
}

export interface ImportRunFileSummary {
  importFileId: string;
  role: string;
  sourceType: string;
  originalFilename: string;
  fileFormat: 'CSV' | 'XLSX';
  validationStatus: string;
  byteSize: number;
  contentSha256: string;
  /** Set once validation has run for this file (Phase 6's `recordFileValidationOutcome`); null
   * beforehand. `rowCount` is every data row the parser found, `errorCount`/`warningCount` count
   * `validation_issue` rows by severity -- these were already persisted but not exposed until
   * Phase 11 needed them for the structure-failure/all-rows-invalid screens. */
  rowCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
}

/** The linked `reconciliation_job`'s terminal state -- Stage 2 (matching) status, reached via
 * `reconciliation_run.matching_job_id`. Null until matching has been linked; the live import-run
 * path only sets `matching_job_id` after `triggerMatching` resolves successfully (Issue #154's
 * investigation), so a Stage-2 failure on that path never populates this -- see
 * `ImportRunValidationJobSummary` for where that failure actually lands today. */
export interface ImportRunMatchingJobSummary {
  id: string;
  currentState: string;
  failureCode: string | null;
  failureMessage: string | null;
  completedAt: string | null;
}

/** The run's newest `import_job` row -- File Validation's own work unit (Stage 1). Carries the
 * durable Stage-2 failure reason today on the live import-run path (Issue #154): that path's
 * catch marks `import_job` FAILED with `error_summary` rather than reaching
 * `reconciliation_job`/`ImportRunMatchingJobSummary` at all. */
export interface ImportRunValidationJobSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorSummary: string | null;
  queuedAt: string;
  finishedAt: string | null;
}

export interface ImportRunSummary {
  id: string;
  organizationId: string;
  label: string;
  accountIdentifier: string | null;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth: number | null;
  /** Declared period end (`reconciliation_run.period_end`, changeset 0061), ISO date string --
   * the reconciliation anchor date the matching engine ages every exception against, in
   * preference to the derived max(transactionDate) fallback. Null only for a run created before
   * this column existed and never backfilled. */
  periodEnd: string | null;
  status: string;
  createdAt: string;
  matchingJobId: string | null;
  matchingJob: ImportRunMatchingJobSummary | null;
  validationJob: ImportRunValidationJobSummary | null;
  files: ImportRunFileSummary[];
}

interface ImportFileRow {
  id: string;
  source_type: string;
  original_filename: string;
  file_format: 'CSV' | 'XLSX';
  validation_status: string;
  byte_size: string;
  content_sha256: string;
  row_count: number | null;
  error_count: number | null;
  warning_count: number | null;
}

/**
 * Persists a new `reconciliation_run` and its source files (implementation-spec.md v2 §6 step 1,
 * adjusted for `run_source_file`). One method, one transaction: creates or reuses each
 * `import_file` row (SHA-256 dedupe, scoped to organization + source_type -- see below), stores
 * each file's bytes, creates the run (`DRAFT`), and links every file via `run_source_file` --
 * all inside a single `runInTenantScope` block so a failure partway through leaves nothing
 * half-created.
 */
export class PostgresImportRunStore {
  private readonly blobStorage: BlobStorage;

  /** @param blobStorage Defaults to a `PostgresBlobStorage` over the same pool; injectable for tests. */
  constructor(
    private readonly pool: Pool,
    blobStorage?: BlobStorage,
  ) {
    this.blobStorage = blobStorage ?? new PostgresBlobStorage(pool);
  }

  /** Creates a DRAFT `reconciliation_run` and its `run_source_file` links, deduping each file's
   * `import_file` row by content hash -- see the class's own doc comment for the full shape. */
  async createRun(input: CreateImportRunInput): Promise<ImportRunSummary> {
    return runInTenantScope(this.pool, input.organizationId, async (client) => {
      const files: ImportRunFileSummary[] = [];

      for (const file of input.files) {
        const importFileRow = await this.findOrCreateImportFile(client, input.organizationId, file);
        files.push({
          importFileId: importFileRow.id,
          role: file.role,
          sourceType: importFileRow.source_type,
          originalFilename: importFileRow.original_filename,
          fileFormat: importFileRow.file_format,
          validationStatus: importFileRow.validation_status,
          byteSize: Number(importFileRow.byte_size),
          contentSha256: importFileRow.content_sha256,
          rowCount: null,
          errorCount: null,
          warningCount: null,
        });
      }

      // Unreconciled Item Roll-Forward PR E.2/§3.8 point 4: a closed period blocks further runs
      // for that account + period without an explicit reopen. Matched on the scalar
      // account_identifier (still populated at creation time, unlike the real per-transaction
      // identifiers PR E.1's reconciliation_run_account link only learns once normalization runs
      // later in the pipeline) -- a best-effort, single-account check, not the full multi-account
      // enforcement the close/tie-out mechanism itself provides. Skipped entirely when no
      // accountIdentifier is supplied, matching how every other account-scoped feature in this
      // file treats an absent identifier as "nothing to check against."
      if (input.accountIdentifier) {
        const closedResult = await client.query<{ id: string }>(
          `SELECT id FROM reconciliation_run
            WHERE organization_id = $1 AND account_identifier = $2 AND period_year = $3
              AND period_month IS NOT DISTINCT FROM $4 AND status = 'CLOSED'
            LIMIT 1`,
          [input.organizationId, input.accountIdentifier, input.periodYear, input.periodMonth ?? null],
        );
        if (closedResult.rows[0]) {
          const periodLabel = input.periodMonth
            ? `${input.periodYear}-${input.periodMonth}`
            : `${input.periodYear}`;
          throw new Error(
            `createRun: period ${periodLabel} for account "${input.accountIdentifier}" is already closed (run ${closedResult.rows[0].id}). Reopen it before submitting a new run.`,
          );
        }
      }

      const runId = randomUUID();
      // period_start/period_end are computed here with the exact same derivation changeset 0061's
      // backfill used (first/last calendar day of the month for MONTHLY, Jan 1/Dec 31 for ANNUAL)
      // -- new runs get a declared period end from day one rather than relying on a later
      // backfill pass, since this is what the matching engine's reconciliation anchor date now
      // prefers over the derived max(transactionDate) fallback (Unreconciled Item Roll-Forward
      // PR A, exceptionClassifierStages.ts's buildReconciliationAnchorDate).
      const runResult = await client.query<{ created_at: string; status: string; period_end: string }>(
        `INSERT INTO reconciliation_run
           (id, organization_id, label, account_identifier, frequency, period_year, period_month,
            period_start, period_end)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           CASE WHEN $5 = 'ANNUAL' THEN make_date($6, 1, 1) ELSE make_date($6, $7, 1) END,
           CASE
             WHEN $5 = 'ANNUAL' THEN make_date($6, 12, 31)
             ELSE (make_date($6, $7, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date
           END
         )
         RETURNING created_at, status, period_end::text`,
        [
          runId,
          input.organizationId,
          input.label,
          input.accountIdentifier ?? null,
          input.frequency,
          input.periodYear,
          input.periodMonth ?? null,
        ],
      );
      const runRow = runResult.rows[0]!;

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const inputFile = input.files[index]!;
        await client.query(
          `INSERT INTO run_source_file
             (id, organization_id, reconciliation_run_id, import_file_id, role, account_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            input.organizationId,
            runId,
            file.importFileId,
            inputFile.role,
            inputFile.accountId ?? null,
          ],
        );
      }

      return {
        id: runId,
        organizationId: input.organizationId,
        label: input.label,
        accountIdentifier: input.accountIdentifier ?? null,
        frequency: input.frequency,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth ?? null,
        periodEnd: runRow.period_end,
        status: runRow.status,
        createdAt: runRow.created_at,
        matchingJobId: null,
        matchingJob: null,
        validationJob: null,
        files,
      };
    });
  }

  /** Dedupes by (organization, content hash, source_type) -- the same bytes uploaded again for
   * the same role reuse the existing import_file row (and its already-stored blob) rather than
   * creating a duplicate. Scoped by source_type, not just the hash, so identical bytes uploaded
   * once as BANK and once as GL (contrived, but not impossible) don't collide. */
  private async findOrCreateImportFile(
    client: PoolClient,
    organizationId: string,
    file: CreateImportRunFileInput,
  ): Promise<ImportFileRow> {
    const sha256 = computeSha256Hex(file.bytes);

    const existing = await client.query<ImportFileRow>(
      `SELECT id, source_type, original_filename, file_format, validation_status, byte_size, content_sha256
         FROM import_file
        WHERE organization_id = $1 AND content_sha256 = $2 AND source_type = $3`,
      [organizationId, sha256, file.sourceType],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return existingRow;
    }

    const importFileId = randomUUID();
    const byteSize = file.bytes.byteLength;

    const inserted = await client.query<ImportFileRow>(
      `INSERT INTO import_file
         (id, organization_id, original_filename, file_format, source_type, content_sha256, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, source_type, original_filename, file_format, validation_status, byte_size, content_sha256`,
      [importFileId, organizationId, file.originalFilename, file.fileFormat, file.sourceType, sha256, byteSize],
    );
    const insertedRow = inserted.rows[0]!;

    // Composes into this same transaction (passes `client`) rather than opening its own -- see
    // BlobStorage's own doc comment for why: import_file_content's FK couldn't yet see this
    // import_file row if the blob write were a separate, independently-committed transaction.
    await this.blobStorage.put({ importFileId, organizationId, bytes: file.bytes }, client);

    return insertedRow;
  }

  /** Shared by `getRunSummary` (by id) and `getLatestRunSummary` (pick-then-load) so the
   * `run_source_file`/`import_file` join and the `reconciliation_job`/`import_job` lookups exist
   * in exactly one place (Issue #154). Runs on an already-open `PoolClient` so a caller that just
   * resolved `runId` from its own query can reuse the same transaction/tenant scope. */
  private async loadRunSummaryWithClient(
    client: PoolClient,
    organizationId: string,
    runId: string,
  ): Promise<ImportRunSummary | null> {
    const runResult = await client.query<{
      id: string;
      label: string;
      account_identifier: string | null;
      frequency: 'MONTHLY' | 'ANNUAL';
      period_year: number;
      period_month: number | null;
      period_end: string | null;
      status: string;
      created_at: string;
      matching_job_id: string | null;
      job_current_state: string | null;
      job_failure_code: string | null;
      job_failure_message: string | null;
      job_completed_at: string | null;
    }>(
      `SELECT r.id, r.label, r.account_identifier, r.frequency, r.period_year, r.period_month,
              r.period_end::text, r.status, r.created_at, r.matching_job_id,
              j.current_state AS job_current_state, j.failure_code AS job_failure_code,
              j.failure_message AS job_failure_message, j.completed_at AS job_completed_at
         FROM reconciliation_run r
         LEFT JOIN reconciliation_job j ON j.id = r.matching_job_id
        WHERE r.id = $1`,
      [runId],
    );
    const runRow = runResult.rows[0];
    if (!runRow) {
      return null;
    }

    const filesResult = await client.query<
      ImportFileRow & { role: string }
    >(
      `SELECT f.id, f.source_type, f.original_filename, f.file_format, f.validation_status,
              f.byte_size, f.content_sha256, f.row_count, f.error_count, f.warning_count,
              rsf.role
         FROM run_source_file rsf
         JOIN import_file f ON f.id = rsf.import_file_id
        WHERE rsf.reconciliation_run_id = $1
        ORDER BY rsf.created_at`,
      [runId],
    );

    // Newest first, not just "the" import_job -- a withdraw+resubmit (POST .../withdraw then
    // .../submit again) creates a second row for the same run, and the older one must never
    // shadow the newer one's outcome.
    const validationJobResult = await client.query<{
      id: string;
      status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      error_summary: string | null;
      queued_at: string;
      finished_at: string | null;
    }>(
      `SELECT id, status, error_summary, queued_at, finished_at
         FROM import_job
        WHERE reconciliation_run_id = $1
        ORDER BY queued_at DESC, id DESC
        LIMIT 1`,
      [runId],
    );
    const validationJobRow = validationJobResult.rows[0];

    return {
      id: runRow.id,
      organizationId,
      label: runRow.label,
      accountIdentifier: runRow.account_identifier,
      frequency: runRow.frequency,
      periodYear: runRow.period_year,
      periodMonth: runRow.period_month,
      periodEnd: runRow.period_end,
      status: runRow.status,
      createdAt: runRow.created_at,
      matchingJobId: runRow.matching_job_id,
      matchingJob: runRow.matching_job_id
        ? {
            id: runRow.matching_job_id,
            currentState: runRow.job_current_state!,
            failureCode: runRow.job_failure_code,
            failureMessage: runRow.job_failure_message,
            completedAt: runRow.job_completed_at,
          }
        : null,
      validationJob: validationJobRow
        ? {
            id: validationJobRow.id,
            status: validationJobRow.status,
            errorSummary: validationJobRow.error_summary,
            queuedAt: validationJobRow.queued_at,
            finishedAt: validationJobRow.finished_at,
          }
        : null,
      files: filesResult.rows.map((row) => ({
        importFileId: row.id,
        role: row.role,
        sourceType: row.source_type,
        originalFilename: row.original_filename,
        fileFormat: row.file_format,
        validationStatus: row.validation_status,
        byteSize: Number(row.byte_size),
        contentSha256: row.content_sha256,
        rowCount: row.row_count,
        errorCount: row.error_count,
        warningCount: row.warning_count,
      })),
    };
  }

  /** Reads back a run and its files (with per-file row/error/warning counts once validated), or
   * `null` if `runId` doesn't exist in this organization. */
  async getRunSummary(organizationId: string, runId: string): Promise<ImportRunSummary | null> {
    return runInTenantScope(this.pool, organizationId, (client) =>
      this.loadRunSummaryWithClient(client, organizationId, runId),
    );
  }

  /** The organization's most recent `reconciliation_run` regardless of status -- the durable
   * "where is my process right now" answer the RunBar needs across a reload, covering
   * VALIDATION_FAILED and mid-flight runs that `findLatestRunReport` (readModelStore.ts, backing
   * GET /api/reconciliation/latest) structurally cannot represent. Null when the organization has
   * no runs at all (Issue #154).
   * @param organizationId The tenant to look up the latest run for. */
  async getLatestRunSummary(organizationId: string): Promise<ImportRunSummary | null> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      // Explicit predicate even though RLS already scopes every row read here -- this is a
      // "pick one of many" query, not a by-primary-key lookup, so it doesn't get RLS's usual
      // wrong-tenant-id-becomes-not-found guard for free; worth the defense in depth.
      const result = await client.query<{ id: string }>(
        `SELECT id
           FROM reconciliation_run
          WHERE organization_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [organizationId],
      );
      const runId = result.rows[0]?.id;
      return runId ? this.loadRunSummaryWithClient(client, organizationId, runId) : null;
    });
  }

  /** Lightweight row for `listRuns` -- deliberately not the full `ImportRunSummary` (no files/
   * matchingJob/validationJob joins), since a filtered list can return many rows and the caller
   * (PR F.1's prior-runs endpoint) only needs enough to pick a run and link to its detail. */
  async listRuns(
    organizationId: string,
    filters: { accountIdentifier?: string; periodYear?: number; periodMonth?: number },
  ): Promise<
    Array<{
      id: string;
      label: string;
      accountIdentifier: string | null;
      frequency: 'MONTHLY' | 'ANNUAL';
      periodYear: number;
      periodMonth: number | null;
      periodEnd: string | null;
      status: string;
      createdAt: string;
    }>
  > {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const conditions = ['organization_id = $1'];
      const params: unknown[] = [organizationId];

      if (filters.accountIdentifier !== undefined) {
        params.push(filters.accountIdentifier);
        conditions.push(`account_identifier = $${params.length}`);
      }
      if (filters.periodYear !== undefined) {
        params.push(filters.periodYear);
        conditions.push(`period_year = $${params.length}`);
      }
      if (filters.periodMonth !== undefined) {
        params.push(filters.periodMonth);
        conditions.push(`period_month = $${params.length}`);
      }

      const result = await client.query<{
        id: string;
        label: string;
        account_identifier: string | null;
        frequency: 'MONTHLY' | 'ANNUAL';
        period_year: number;
        period_month: number | null;
        period_end: string | null;
        status: string;
        created_at: string;
      }>(
        `SELECT id, label, account_identifier, frequency, period_year, period_month,
                period_end::text, status, created_at
           FROM reconciliation_run
          WHERE ${conditions.join(' AND ')}
          ORDER BY period_year DESC, period_month DESC NULLS LAST, created_at DESC`,
        params,
      );

      return result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        accountIdentifier: row.account_identifier,
        frequency: row.frequency,
        periodYear: row.period_year,
        periodMonth: row.period_month,
        periodEnd: row.period_end,
        status: row.status,
        createdAt: row.created_at,
      }));
    });
  }

  /** Metadata + raw bytes for one file within a run (Phase 11's structure-failure/all-rows-
   * invalid screens re-parse the original to recover the header row, since it isn't persisted
   * anywhere -- see `ValidationIssue`'s own comment). Scoped through `run_source_file` so a file
   * ID from a different run can't be read this way. Null when the run doesn't exist/isn't
   * RLS-visible, or the file isn't part of this run. */
  async getFileWithBytes(
    organizationId: string,
    runId: string,
    importFileId: string,
  ): Promise<
    | (Omit<ImportRunFileSummary, 'sourceType'> & {
        sourceType: ImportFileSourceType;
        bytes: Buffer;
      })
    | null
  > {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<ImportFileRow & { role: string }>(
        `SELECT f.id, f.source_type, f.original_filename, f.file_format, f.validation_status,
                f.byte_size, f.content_sha256, f.row_count, f.error_count, f.warning_count,
                rsf.role
           FROM run_source_file rsf
           JOIN import_file f ON f.id = rsf.import_file_id
          WHERE rsf.reconciliation_run_id = $1 AND f.id = $2`,
        [runId, importFileId],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      const bytes = await this.blobStorage.get(importFileId, organizationId, client);

      return {
        importFileId: row.id,
        role: row.role,
        sourceType: row.source_type as ImportFileSourceType,
        originalFilename: row.original_filename,
        fileFormat: row.file_format,
        validationStatus: row.validation_status,
        byteSize: Number(row.byte_size),
        contentSha256: row.content_sha256,
        rowCount: row.row_count,
        errorCount: row.error_count,
        warningCount: row.warning_count,
        bytes,
      };
    });
  }
}
