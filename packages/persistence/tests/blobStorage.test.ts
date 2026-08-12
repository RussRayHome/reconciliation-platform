import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { computeSha256Hex, createPostgresPool, PostgresBlobStorage } from '../src';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

let database: TestDatabase | undefined;
let pool: Pool;
let runtimePool: Pool;
let startupError: Error | null = null;
let defaultOrganizationId: string;

/** Inserts a minimal valid `import_file` row so `import_file_content`'s FK is satisfiable. */
const insertImportFile = async (organizationId: string): Promise<string> => {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO import_file
       (id, organization_id, original_filename, file_format, source_type, content_sha256, byte_size)
     VALUES ($1, $2, 'bank.csv', 'CSV', 'BANK', $3, 0)`,
    [id, organizationId, '0'.repeat(64)],
  );
  return id;
};

describe('PostgresBlobStorage', () => {
  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_blob_storage');
      pool = database.pool;
      const harness = postgresHarness();
      // app_user (not the superuser admin pool) so RLS actually applies -- matches
      // rlsTenantIsolation.test.ts's own connection pattern for exactly this reason.
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

  it('round-trips bytes exactly and reports their digest and size', async () => {
    if (startupError) throw startupError;

    const storage = new PostgresBlobStorage(pool);
    const importFileId = await insertImportFile(defaultOrganizationId);
    const bytes = Buffer.from('transaction_id,amount\nTXN-1,100.00\n', 'utf8');

    const putResult = await storage.put({
      importFileId,
      organizationId: defaultOrganizationId,
      bytes,
    });

    expect(putResult.sha256).toBe(computeSha256Hex(bytes));
    expect(putResult.byteSize).toBe(bytes.byteLength);

    const retrieved = await storage.get(importFileId, defaultOrganizationId);
    expect(Buffer.compare(retrieved, bytes)).toBe(0);
  });

  it('is idempotent when put is called twice for the same import_file', async () => {
    if (startupError) throw startupError;

    const storage = new PostgresBlobStorage(pool);
    const importFileId = await insertImportFile(defaultOrganizationId);

    await storage.put({
      importFileId,
      organizationId: defaultOrganizationId,
      bytes: Buffer.from('first version', 'utf8'),
    });
    await storage.put({
      importFileId,
      organizationId: defaultOrganizationId,
      bytes: Buffer.from('second version', 'utf8'),
    });

    const retrieved = await storage.get(importFileId, defaultOrganizationId);
    expect(retrieved.toString('utf8')).toBe('second version');

    const rowCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM import_file_content WHERE import_file_id = $1',
      [importFileId],
    );
    expect(rowCount.rows[0]?.count).toBe(1);
  });

  it('rejects a get for bytes that were never stored', async () => {
    if (startupError) throw startupError;

    const storage = new PostgresBlobStorage(pool);
    const importFileId = await insertImportFile(defaultOrganizationId);

    await expect(storage.get(importFileId, defaultOrganizationId)).rejects.toThrow(
      'import_file_content not found',
    );
  });

  it('does not leak another organization\'s blob across the tenant boundary', async () => {
    if (startupError) throw startupError;

    const otherOrganization = await pool.query<{ id: string }>(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Blob Storage Test Org') RETURNING id",
    );
    const otherOrganizationId = otherOrganization.rows[0]!.id;

    // Seeded via the admin pool (bypasses RLS, same as every other fixture setup in this suite);
    // the actual leak check below goes through app_user, which is RLS-enforced.
    const adminStorage = new PostgresBlobStorage(pool);
    const importFileId = await insertImportFile(defaultOrganizationId);
    await adminStorage.put({
      importFileId,
      organizationId: defaultOrganizationId,
      bytes: Buffer.from('tenant-a-bytes', 'utf8'),
    });

    const runtimeStorage = new PostgresBlobStorage(runtimePool);

    // Same organization: app_user can read what it just wrote.
    const ownRead = await runtimeStorage.get(importFileId, defaultOrganizationId);
    expect(ownRead.toString('utf8')).toBe('tenant-a-bytes');

    // A different organization's tenant scope cannot see this row at all -- RLS filters it out,
    // so the lookup fails closed exactly like a nonexistent import_file would.
    await expect(runtimeStorage.get(importFileId, otherOrganizationId)).rejects.toThrow(
      'import_file_content not found',
    );
  });
});
