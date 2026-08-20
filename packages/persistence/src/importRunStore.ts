import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import { computeSha256Hex } from './reconciliationLifecycleStore';
import { runInTenantScope } from './postgres';
import { PostgresBlobStorage, type BlobStorage } from './blobStorage';

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
  sourceType: 'BANK' | 'GL';
  originalFilename: string;
  fileFormat: 'CSV' | 'XLSX';
  bytes: Buffer;
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

export interface ImportRunSummary {
  id: string;
  organizationId: string;
  label: string;
  accountIdentifier: string | null;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth: number | null;
  status: string;
  createdAt: string;
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

      const runId = randomUUID();
      const runResult = await client.query<{ created_at: string; status: string }>(
        `INSERT INTO reconciliation_run
           (id, organization_id, label, account_identifier, frequency, period_year, period_month)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING created_at, status`,
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
          `INSERT INTO run_source_file (id, organization_id, reconciliation_run_id, import_file_id, role)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), input.organizationId, runId, file.importFileId, inputFile.role],
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
        status: runRow.status,
        createdAt: runRow.created_at,
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

  /** Reads back a run and its files (with per-file row/error/warning counts once validated), or
   * `null` if `runId` doesn't exist in this organization. */
  async getRunSummary(organizationId: string, runId: string): Promise<ImportRunSummary | null> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const runResult = await client.query<{
        id: string;
        label: string;
        account_identifier: string | null;
        frequency: 'MONTHLY' | 'ANNUAL';
        period_year: number;
        period_month: number | null;
        status: string;
        created_at: string;
      }>(
        `SELECT id, label, account_identifier, frequency, period_year, period_month, status, created_at
           FROM reconciliation_run
          WHERE id = $1`,
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

      return {
        id: runRow.id,
        organizationId,
        label: runRow.label,
        accountIdentifier: runRow.account_identifier,
        frequency: runRow.frequency,
        periodYear: runRow.period_year,
        periodMonth: runRow.period_month,
        status: runRow.status,
        createdAt: runRow.created_at,
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
        sourceType: 'BANK' | 'GL';
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
        sourceType: row.source_type as 'BANK' | 'GL',
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
