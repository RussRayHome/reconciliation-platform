import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { createPostgresPool } from '../src/postgres';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * Postgres hardening backlog item 1: the app previously had no least-privilege role at all --
 * every query ran as recon_app, which changeset 0029's own comment confirms (via \du) is a
 * superuser. These tests connect AS recon_app_runtime (not the admin pool every other test file
 * uses) to prove the role changeset actually constrains what that connection can do, rather than
 * just asserting the GRANT statements ran without error.
 */
describe('least-privilege application role (recon_app_runtime)', () => {
  let database: TestDatabase | undefined;
  let runtimePool: Pool;
  let startupError: Error | null = null;

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_least_priv');
      const harness = postgresHarness();
      const runtimeConnectionString = `postgresql://recon_app_runtime:CHANGE_ME_recon_app_runtime_dev_only@${harness.host}:${harness.port}/${database.name}`;
      runtimePool = createPostgresPool({ connectionString: runtimeConnectionString });
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      throw startupError;
    }
  }, 180000);

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
    if (database) {
      await database.drop();
    }
  });

  it('can connect and read from an application table', async () => {
    if (startupError) throw startupError;

    await expect(
      runtimePool.query('SELECT id FROM reconciliation_organization LIMIT 1'),
    ).resolves.toBeDefined();
  });

  it('can insert, update, and delete rows in an application table', async () => {
    if (startupError) throw startupError;

    await runtimePool.query(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Runtime Role Co')",
    );
    const inserted = await runtimePool.query<{ id: string }>(
      "SELECT id FROM reconciliation_organization WHERE name = 'Runtime Role Co'",
    );
    const id = inserted.rows[0]!.id;

    await runtimePool.query("UPDATE reconciliation_organization SET status = 'INACTIVE' WHERE id = $1", [
      id,
    ]);
    await runtimePool.query('DELETE FROM reconciliation_organization WHERE id = $1', [id]);
  });

  it('cannot create a new table (no DDL rights)', async () => {
    if (startupError) throw startupError;

    await expect(runtimePool.query('CREATE TABLE runtime_role_should_not_exist (id uuid)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot alter an existing application table', async () => {
    if (startupError) throw startupError;

    await expect(
      runtimePool.query('ALTER TABLE reconciliation_organization ADD COLUMN should_not_exist TEXT'),
    ).rejects.toThrow(/permission denied|must be owner/);
  });

  it('cannot drop an existing application table', async () => {
    if (startupError) throw startupError;

    // ALTER/DROP TABLE require ownership in Postgres, not just a revocable grant, so the server
    // reports "must be owner of table X" here rather than the generic "permission denied" used
    // for SELECT/INSERT/UPDATE/DELETE -- both are proof the runtime role can't do DDL.
    await expect(runtimePool.query('DROP TABLE reconciliation_organization')).rejects.toThrow(
      /permission denied|must be owner/,
    );
  });

  it('cannot truncate an application table', async () => {
    if (startupError) throw startupError;

    await expect(runtimePool.query('TRUNCATE reconciliation_organization')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot read the Liquibase changelog tracking tables', async () => {
    if (startupError) throw startupError;

    await expect(runtimePool.query('SELECT * FROM databasechangelog LIMIT 1')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot create a new role (no role-management rights)', async () => {
    if (startupError) throw startupError;

    await expect(runtimePool.query("CREATE ROLE should_not_be_creatable")).rejects.toThrow(
      /permission denied|must be superuser/,
    );
  });

  it('can read and write a table added after the role changeset, via default privileges', async () => {
    if (startupError) throw startupError;

    // reconciliation_organization already existed when 0029 ran, so it's covered by the
    // explicit GRANT list. A table created here (running as recon_app, the owner -- the same
    // role every later changeset runs as) instead exercises the ALTER DEFAULT PRIVILEGES clause,
    // standing proof nobody has to remember to extend 0029's explicit list by hand.
    const futureTableDb = await createDatabaseFromTemplate('recon_least_priv_future_table');

    try {
      await futureTableDb.pool.query('CREATE TABLE reconciliation_future_example (id UUID PRIMARY KEY)');

      const harness = postgresHarness();
      const futureRuntimePool = createPostgresPool({
        connectionString: `postgresql://recon_app_runtime:CHANGE_ME_recon_app_runtime_dev_only@${harness.host}:${harness.port}/${futureTableDb.name}`,
      });

      try {
        await expect(
          futureRuntimePool.query(
            'INSERT INTO reconciliation_future_example (id) VALUES (gen_random_uuid())',
          ),
        ).resolves.toBeDefined();
      } finally {
        await futureRuntimePool.end();
      }
    } finally {
      await futureTableDb.drop();
    }
  });
});
