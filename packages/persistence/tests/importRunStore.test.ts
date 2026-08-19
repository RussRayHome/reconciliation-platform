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
