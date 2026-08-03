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

    it('actually changes the schema, proving the rollback SQL ran', () => {
      expect(rolledBackSchema).not.toEqual(migratedSchema);
    });

    it('restores the exact original schema when the changeset is re-applied', () => {
      expect(reappliedSchema.split('\n')).toEqual(migratedSchema.split('\n'));
    });

    it('reverses changeset 0025 by narrowing the mapping profile uniqueness constraint', () => {
      // 0025 widened UNIQUE (organization_id, name) to include source_type; its rollback puts
      // the two-column form back. Asserting on the constraint itself rather than just "the
      // schema differs" is what proves the rollback did the right thing, not merely something.
      expect(migratedSchema).toContain('UNIQUE (organization_id, name, source_type)');
      expect(rolledBackSchema).toContain('UNIQUE (organization_id, name)');
      expect(rolledBackSchema).not.toContain('UNIQUE (organization_id, name, source_type)');
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
