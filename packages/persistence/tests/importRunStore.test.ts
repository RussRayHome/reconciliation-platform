import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import {
  createPostgresPool,
  PostgresImportRunStore,
  type CreateImportRunInput,
} from '../src';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

let database: TestDatabase | undefined;
let pool: Pool;
let runtimePool: Pool;
let startupError: Error | null = null;
let defaultOrganizationId: string;

const bankBytes = Buffer.from('transaction_id,amount\nTXN-1,100.00\n', 'utf8');
const glBytes = Buffer.from('entry_id,line_number\nJE-1,1\n', 'utf8');

const buildRunInput = (
  overrides: Partial<CreateImportRunInput> = {},
): CreateImportRunInput => ({
  organizationId: defaultOrganizationId,
  label: 'Monthly Recon for August 2026',
  accountIdentifier: 'OPERATING-001',
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 8,
  files: [
    { role: 'BANK_MERGED', sourceType: 'BANK', originalFilename: 'bank.csv', fileFormat: 'CSV', bytes: bankBytes },
    { role: 'GL', sourceType: 'GL', originalFilename: 'gl.csv', fileFormat: 'CSV', bytes: glBytes },
  ],
  ...overrides,
});

describe('PostgresImportRunStore', () => {
  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_import_run_store');
      pool = database.pool;
      const harness = postgresHarness();
      runtimePool = createPostgresPool({
        connectionString: `postgresql://app_user:P%40ssw0rd@${harness.host}:${harness.port}/${database.name}`,
      });
      const organizationResult = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const organizationId = organizationResult.rows[0]?.id;
      if (!organizationId) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      defaultOrganizationId = organizationId;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
    if (database) {
      await database.drop();
    }
  });

  it('creates a DRAFT run with both files stored and linked via run_source_file', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const summary = await store.createRun(buildRunInput());

    expect(summary.status).toBe('DRAFT');
    expect(summary.label).toBe('Monthly Recon for August 2026');
    expect(summary.files).toHaveLength(2);

    const bankFile = summary.files.find((file) => file.role === 'BANK_MERGED');
    const glFile = summary.files.find((file) => file.role === 'GL');
    expect(bankFile).toMatchObject({
      sourceType: 'BANK',
      originalFilename: 'bank.csv',
      fileFormat: 'CSV',
      validationStatus: 'PENDING',
      byteSize: bankBytes.byteLength,
    });
    expect(glFile).toMatchObject({ sourceType: 'GL', originalFilename: 'gl.csv' });

    const runRow = await pool.query('SELECT status FROM reconciliation_run WHERE id = $1', [summary.id]);
    expect(runRow.rows[0]?.status).toBe('DRAFT');

    const linkRows = await pool.query(
      'SELECT role FROM run_source_file WHERE reconciliation_run_id = $1 ORDER BY role',
      [summary.id],
    );
    expect(linkRows.rows.map((row: { role: string }) => row.role)).toEqual(['BANK_MERGED', 'GL']);
  });

  it('stores each file\'s bytes exactly as received, retrievable via the content table', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const summary = await store.createRun(buildRunInput());
    const bankFile = summary.files.find((file) => file.role === 'BANK_MERGED')!;

    const content = await pool.query<{ content: Buffer }>(
      'SELECT content FROM import_file_content WHERE import_file_id = $1',
      [bankFile.importFileId],
    );
    expect(Buffer.compare(content.rows[0]!.content, bankBytes)).toBe(0);
  });

  it('dedupes identical bytes for the same source_type across separate runs', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const first = await store.createRun(buildRunInput({ label: 'Run A' }));
    const second = await store.createRun(buildRunInput({ label: 'Run B' }));

    const firstBank = first.files.find((file) => file.role === 'BANK_MERGED')!;
    const secondBank = second.files.find((file) => file.role === 'BANK_MERGED')!;
    expect(secondBank.importFileId).toBe(firstBank.importFileId);

    const importFileRows = await pool.query(
      'SELECT COUNT(*)::int AS count FROM import_file WHERE content_sha256 = $1',
      [firstBank.contentSha256],
    );
    expect(importFileRows.rows[0]?.count).toBe(1);

    const contentRows = await pool.query(
      'SELECT COUNT(*)::int AS count FROM import_file_content WHERE import_file_id = $1',
      [firstBank.importFileId],
    );
    expect(contentRows.rows[0]?.count).toBe(1);
  });

  it('does not dedupe the same bytes uploaded under a different source_type', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const sameBytesForBoth: CreateImportRunInput = buildRunInput({
      files: [
        { role: 'BANK_MERGED', sourceType: 'BANK', originalFilename: 'a.csv', fileFormat: 'CSV', bytes: bankBytes },
        { role: 'GL', sourceType: 'GL', originalFilename: 'b.csv', fileFormat: 'CSV', bytes: bankBytes },
      ],
    });

    const summary = await store.createRun(sameBytesForBoth);
    const bankFile = summary.files.find((file) => file.role === 'BANK_MERGED')!;
    const glFile = summary.files.find((file) => file.role === 'GL')!;

    expect(bankFile.importFileId).not.toBe(glFile.importFileId);
  });

  it('leaves nothing behind when the transaction fails partway through', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    // frequency CHECK only allows MONTHLY/ANNUAL -- this fails the reconciliation_run insert
    // after both import_file rows have already been written earlier in the same transaction.
    const invalidInput = buildRunInput({
      label: 'Should Not Persist',
      frequency: 'WEEKLY' as unknown as 'MONTHLY',
    });

    await expect(store.createRun(invalidInput)).rejects.toThrow();

    const orphanedFiles = await pool.query(
      'SELECT COUNT(*)::int AS count FROM import_file WHERE original_filename = $1',
      ['bank.csv'],
    );
    // Dedupe means a prior successful test may have already created a bank.csv row with this
    // exact content -- what this test actually proves is the run itself never got created.
    expect(orphanedFiles.rows[0]?.count).toBeLessThanOrEqual(1);

    const runRows = await pool.query(
      'SELECT COUNT(*)::int AS count FROM reconciliation_run WHERE label = $1',
      ['Should Not Persist'],
    );
    expect(runRows.rows[0]?.count).toBe(0);
  });

  it('getRunSummary returns the full run with its files', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const created = await store.createRun(buildRunInput({ label: 'Fetch Me' }));

    const fetched = await store.getRunSummary(defaultOrganizationId, created.id);
    expect(fetched).toMatchObject({ id: created.id, label: 'Fetch Me', status: 'DRAFT' });
    expect(fetched?.files).toHaveLength(2);
    // Issue #154: a fresh DRAFT run has no matching job or validation job yet.
    expect(fetched?.matchingJobId).toBeNull();
    expect(fetched?.matchingJob).toBeNull();
    expect(fetched?.validationJob).toBeNull();
  });

  it('getRunSummary returns null for a nonexistent run', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const fetched = await store.getRunSummary(defaultOrganizationId, '00000000-0000-0000-0000-000000000000');
    expect(fetched).toBeNull();
  });

  it('does not leak another organization\'s run across the tenant boundary', async () => {
    if (startupError) throw startupError;

    const otherOrganization = await pool.query<{ id: string }>(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Import Run Store Test Org') RETURNING id",
    );
    const otherOrganizationId = otherOrganization.rows[0]!.id;

    const adminStore = new PostgresImportRunStore(pool);
    const created = await adminStore.createRun(buildRunInput({ label: 'Tenant A Run' }));

    const runtimeStore = new PostgresImportRunStore(runtimePool);
    const ownRead = await runtimeStore.getRunSummary(defaultOrganizationId, created.id);
    expect(ownRead?.id).toBe(created.id);

    const crossTenantRead = await runtimeStore.getRunSummary(otherOrganizationId, created.id);
    expect(crossTenantRead).toBeNull();
  });

  describe('getLatestRunSummary (Issue #154)', () => {
    it('returns the most recently created run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      await store.createRun(buildRunInput({ label: 'Latest Run Older' }));
      const newer = await store.createRun(buildRunInput({ label: 'Latest Run Newer' }));

      const latest = await store.getLatestRunSummary(defaultOrganizationId);
      expect(latest?.id).toBe(newer.id);
      expect(latest?.label).toBe('Latest Run Newer');
    });

    it('returns null for an organization with no runs', async () => {
      if (startupError) throw startupError;

      const otherOrganization = await pool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Latest Run Empty Org') RETURNING id",
      );
      const otherOrganizationId = otherOrganization.rows[0]!.id;

      const store = new PostgresImportRunStore(pool);
      const latest = await store.getLatestRunSummary(otherOrganizationId);
      expect(latest).toBeNull();
    });

    it('returns a VALIDATION_FAILED run with per-file counts', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'Validation Failed Run' }));
      const bankFile = created.files.find((file) => file.role === 'BANK_MERGED')!;

      await pool.query("UPDATE reconciliation_run SET status = 'VALIDATION_FAILED' WHERE id = $1", [
        created.id,
      ]);
      await pool.query(
        "UPDATE import_file SET validation_status = 'INVALID', error_count = 3, warning_count = 1 WHERE id = $1",
        [bankFile.importFileId],
      );

      const latest = await store.getLatestRunSummary(defaultOrganizationId);
      expect(latest?.id).toBe(created.id);
      expect(latest?.status).toBe('VALIDATION_FAILED');
      const latestBankFile = latest?.files.find((file) => file.role === 'BANK_MERGED');
      expect(latestBankFile).toMatchObject({ validationStatus: 'INVALID', errorCount: 3, warningCount: 1 });
    });

    it("carries the linked reconciliation_job's failure_code/failure_message", async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'Matching Failed Run' }));

      const jobResult = await pool.query<{ id: string }>(
        `INSERT INTO reconciliation_job
           (id, organization_id, correlation_id, current_state, rulepack_version, started_at,
            completed_at, failure_code, failure_message)
         VALUES (gen_random_uuid(), $1, $2, 'FAILED', 'v1', NOW(), NOW(), 'MATCH_ENGINE_ERROR',
                 'Matching engine crashed while grouping split payments.')
         RETURNING id`,
        [defaultOrganizationId, created.id],
      );
      const jobId = jobResult.rows[0]!.id;
      await pool.query('UPDATE reconciliation_run SET matching_job_id = $1 WHERE id = $2', [
        jobId,
        created.id,
      ]);

      const latest = await store.getLatestRunSummary(defaultOrganizationId);
      expect(latest?.matchingJobId).toBe(jobId);
      expect(latest?.matchingJob).toMatchObject({
        id: jobId,
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: 'Matching engine crashed while grouping split payments.',
      });
    });

    it('returns the newest import_job when a run was withdrawn and resubmitted', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'Withdraw Resubmit Run' }));

      await pool.query(
        `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status, error_summary, queued_at, finished_at)
         VALUES (gen_random_uuid(), $1, $2, 'FAILED', 'first attempt failed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '55 minutes')`,
        [defaultOrganizationId, created.id],
      );
      const newerJob = await pool.query<{ id: string }>(
        `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status, queued_at)
         VALUES (gen_random_uuid(), $1, $2, 'SUCCEEDED', NOW())
         RETURNING id`,
        [defaultOrganizationId, created.id],
      );

      const latest = await store.getLatestRunSummary(defaultOrganizationId);
      expect(latest?.validationJob?.id).toBe(newerJob.rows[0]!.id);
      expect(latest?.validationJob?.status).toBe('SUCCEEDED');
    });

    it("carries a FAILED import_job's error_summary (the live Stage-2-failure shape)", async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'Import Job Failed Run' }));
      await pool.query(
        `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status, error_summary, queued_at)
         VALUES (gen_random_uuid(), $1, $2, 'FAILED', 'Matching engine crashed mid-run.', NOW())`,
        [defaultOrganizationId, created.id],
      );

      const latest = await store.getLatestRunSummary(defaultOrganizationId);
      expect(latest?.validationJob).toMatchObject({
        status: 'FAILED',
        errorSummary: 'Matching engine crashed mid-run.',
      });
    });

    it('is tenant-scoped', async () => {
      if (startupError) throw startupError;

      const otherOrganization = await pool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Latest Run Tenant Org') RETURNING id",
      );
      const otherOrganizationId = otherOrganization.rows[0]!.id;

      const adminStore = new PostgresImportRunStore(pool);
      await adminStore.createRun(buildRunInput({ label: 'Default Org Latest Run' }));

      const runtimeStore = new PostgresImportRunStore(runtimePool);
      const crossTenantRead = await runtimeStore.getLatestRunSummary(otherOrganizationId);
      expect(crossTenantRead).toBeNull();
    });
  });

  describe('getFileWithBytes (Phase 11 failure detail)', () => {
    it('returns the file metadata and raw bytes exactly as stored', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'Failure Detail Fetch' }));
      const bankFile = created.files.find((file) => file.role === 'BANK_MERGED')!;

      const fetched = await store.getFileWithBytes(defaultOrganizationId, created.id, bankFile.importFileId);

      expect(fetched).toMatchObject({
        importFileId: bankFile.importFileId,
        sourceType: 'BANK',
        originalFilename: 'bank.csv',
        fileFormat: 'CSV',
      });
      expect(Buffer.compare(fetched!.bytes, bankBytes)).toBe(0);
    });

    it('returns null when the file is not part of the given run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const runA = await store.createRun(buildRunInput({ label: 'Run A For Cross-Run Check' }));
      const runB = await store.createRun(
        buildRunInput({
          label: 'Run B For Cross-Run Check',
          files: [
            { role: 'BANK_MERGED', sourceType: 'BANK', originalFilename: 'other-bank.csv', fileFormat: 'CSV', bytes: Buffer.from('x') },
            { role: 'GL', sourceType: 'GL', originalFilename: 'other-gl.csv', fileFormat: 'CSV', bytes: Buffer.from('y') },
          ],
        }),
      );
      const runAFile = runA.files.find((file) => file.role === 'BANK_MERGED')!;

      const fetched = await store.getFileWithBytes(defaultOrganizationId, runB.id, runAFile.importFileId);
      expect(fetched).toBeNull();
    });

    it('returns null for a nonexistent run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportRunStore(pool);
      const created = await store.createRun(buildRunInput({ label: 'For Nonexistent Run Check' }));
      const bankFile = created.files.find((file) => file.role === 'BANK_MERGED')!;

      const fetched = await store.getFileWithBytes(
        defaultOrganizationId,
        '00000000-0000-0000-0000-000000000000',
        bankFile.importFileId,
      );
      expect(fetched).toBeNull();
    });

    it('does not leak another organization\'s file bytes across the tenant boundary', async () => {
      if (startupError) throw startupError;

      const otherOrganization = await pool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Import Run Store Bytes Test Org') RETURNING id",
      );
      const otherOrganizationId = otherOrganization.rows[0]!.id;

      const adminStore = new PostgresImportRunStore(pool);
      const created = await adminStore.createRun(buildRunInput({ label: 'Tenant Bytes Run' }));
      const bankFile = created.files.find((file) => file.role === 'BANK_MERGED')!;

      const runtimeStore = new PostgresImportRunStore(runtimePool);
      const crossTenantRead = await runtimeStore.getFileWithBytes(
        otherOrganizationId,
        created.id,
        bankFile.importFileId,
      );
      expect(crossTenantRead).toBeNull();
    });
  });
});
