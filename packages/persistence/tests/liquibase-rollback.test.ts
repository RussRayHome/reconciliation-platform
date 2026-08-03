import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { countChangesetFiles, runLiquibase } from './testHelpers/liquibase';
import { createEmptyDatabase, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';
import { generateSchemaBaseline } from './testHelpers/schemaBaseline';

/**
 * Every changeset under packages/persistence/liquibase/changesets carries a `--rollback`
 * directive, and until this suite existed not one of them had ever been executed. Untested
 * rollback SQL is worse than none: it creates the belief that a bad production migration can be
 * reversed at 2am, and the failure mode is discovering otherwise while the system is down.
 *
 * Uses its own empty databases rather than the migrated template — these tests are what prove
 * `update` and `rollback` compose, so they have to drive both themselves.
 */
describe('Liquibase rollback', () => {
  const changesetFileCount = countChangesetFiles();
  // `rollback --tag=X` unwinds the tag changeset itself along with everything after it, leaving
  // changesets 0001-0009 — the pre-Liquibase baseline — and not the 0009b tag row.
  const changesetsAfterRollbackToBaselineTag = 9;
  const baselineTag = 'v1-v9-baseline';

  const changelogCount = async (pool: Pool): Promise<number> => {
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM databasechangelog',
    );
    return Number(result.rows[0]?.count ?? '0');
  };

  const tableExists = async (pool: Pool, table: string): Promise<boolean> => {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table],
    );
    return result.rows[0]?.exists === true;
  };

  describe('rolling back the most recent changeset', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackSchema: string;
    let reappliedSchema: string;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_one');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);

      runLiquibase(containerId, database.name, 'rollback-count', '--count=1');
      rolledBackSchema = await generateSchemaBaseline(database.pool);

      runLiquibase(containerId, database.name, 'update');
      reappliedSchema = await generateSchemaBaseline(database.pool);
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('removes the changeset from the tracking table', async () => {
      expect(await changelogCount(database!.pool)).toBe(changesetFileCount);
    });

    it('restores the exact original schema when the changeset is re-applied', () => {
      expect(reappliedSchema.split('\n')).toEqual(migratedSchema.split('\n'));
    });

    it('changeset 0027 is a verify-only no-op, so its rollback leaves the schema unchanged', () => {
      // 0027 (the most recent changeset as of this test) only checks that pgaudit is actually
      // installed when shared_preload_libraries says it should be -- it makes no schema change,
      // so unlike every other changeset here, "rollback changes nothing" IS the correct
      // assertion, not a sign the rollback SQL didn't run. When a future changeset lands on top
      // of 0027 (most of which DO change schema), swap this back to asserting the rolled-back
      // schema differs from the migrated one, describing whatever that changeset actually did --
      // this block is intentionally pinned to "whatever is currently the most recent changeset".
      expect(rolledBackSchema).toEqual(migratedSchema);
    });

  });

  describe('rolling back two changesets (0027 verify-only, then 0026 schema-changing)', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackTwoSchema: string;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_two');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);

      runLiquibase(containerId, database.name, 'rollback-count', '--count=2');
      rolledBackTwoSchema = await generateSchemaBaseline(database.pool);
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('reverses changeset 0026 by dropping the auth/tenancy columns from reconciliation_user', () => {
      // 0026 added password_hash/role/organization_id and dropped password; its rollback puts
      // password back and drops the three new columns. Two changesets deep because 0027 (the
      // one directly on top of it) is a verify-only no-op with nothing to reverse.
      expect(migratedSchema).toContain(
        "col_type_is('public', 'reconciliation_user', 'password_hash', 'text'",
      );
      expect(migratedSchema).not.toContain(
        "col_type_is('public', 'reconciliation_user', 'password', 'text'",
      );

      expect(rolledBackTwoSchema).toContain(
        "col_type_is('public', 'reconciliation_user', 'password', 'text'",
      );
      expect(rolledBackTwoSchema).not.toContain(
        "col_type_is('public', 'reconciliation_user', 'password_hash', 'text'",
      );
      expect(rolledBackTwoSchema).not.toContain(
        "col_type_is('public', 'reconciliation_user', 'role', 'text'",
      );
    });
  });

  describe('rolling back to the pre-Liquibase baseline tag', () => {
    let database: TestDatabase | undefined;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_tag');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      runLiquibase(containerId, database.name, 'rollback', `--tag=${baselineTag}`);
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('leaves only the changesets applied before the tag', async () => {
      expect(await changelogCount(database!.pool)).toBe(changesetsAfterRollbackToBaselineTag);
    });

    it('drops the tables introduced after the tag', async () => {
      expect(await tableExists(database!.pool, 'reconciliation_organization')).toBe(false);
      expect(await tableExists(database!.pool, 'reconciliation_mapping_profile')).toBe(false);
      expect(await tableExists(database!.pool, 'reconciliation_import_approval')).toBe(false);
    });

    it('keeps the tables created before the tag', async () => {
      expect(await tableExists(database!.pool, 'reconciliation_job')).toBe(true);
      expect(await tableExists(database!.pool, 'reconciliation_source_file')).toBe(true);
      expect(await tableExists(database!.pool, 'reconciliation_user')).toBe(true);
    });

    it('can migrate forward again to the full schema after unwinding', async () => {
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database!.name, 'update');

      expect(await changelogCount(database!.pool)).toBe(changesetFileCount);
      expect(await tableExists(database!.pool, 'reconciliation_organization')).toBe(true);
    });
  });

  describe('re-running update', () => {
    let database: TestDatabase | undefined;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_idempotent');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('applies no further changesets and leaves the schema untouched', async () => {
      const { containerId } = postgresHarness();
      const beforeSchema = await generateSchemaBaseline(database!.pool);

      runLiquibase(containerId, database!.name, 'update');

      expect(await changelogCount(database!.pool)).toBe(changesetFileCount);
      expect((await generateSchemaBaseline(database!.pool)).split('\n')).toEqual(
        beforeSchema.split('\n'),
      );
    });
  });
});
