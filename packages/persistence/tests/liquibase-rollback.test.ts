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

  describe('rolling back the two most recent changesets', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackSchema: string;
    let reappliedSchema: string;
    let migratedTableExists: boolean;
    let rolledBackTableExists: boolean;
    let reappliedTableExists: boolean;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_one');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);
      migratedTableExists = await tableExists(database.pool, 'reconciliation_run');

      // count=2, not 1: 0043 (the current HEAD) only enables RLS/adds policies on the tables 0042
      // creates -- like 0038's grant-only rollback, that has no visible effect on the generated
      // schema-baseline TEXT, since the RLS assertion the generator emits is driven purely by
      // "does this table have an organization_id column", not by whether RLS is actually enabled
      // right now (see schemaBaseline.ts). Rolling back 0043 alone would leave rolledBackSchema
      // textually identical to migratedSchema, defeating this test's own "genuinely differs"
      // assertion below. Rolling back both together exercises 0042's table-creation, which *is*
      // visible in the diff.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=2');
      rolledBackSchema = await generateSchemaBaseline(database.pool);
      rolledBackTableExists = await tableExists(database.pool, 'reconciliation_run');

      runLiquibase(containerId, database.name, 'update');
      reappliedSchema = await generateSchemaBaseline(database.pool);
      reappliedTableExists = await tableExists(database.pool, 'reconciliation_run');
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('removes both changesets from the tracking table', async () => {
      expect(await changelogCount(database!.pool)).toBe(changesetFileCount);
    });

    it('restores the exact original schema when both changesets are re-applied', () => {
      expect(reappliedSchema.split('\n')).toEqual(migratedSchema.split('\n'));
    });

    it('reverses 0042/0043 by dropping the File Imports & Validation tables', () => {
      // 0042 (the most recent table-creating changeset as of this test) creates
      // reconciliation_run and its five sibling tables from scratch; 0043 layered RLS on top.
      // Rolling back both drops them (CASCADE). Table creation/removal shows up directly in
      // schema-baseline.sql's table listing, so migratedSchema/rolledBackSchema genuinely differ
      // here. When a future changeset lands on top of 0043, update this test to describe that
      // changeset instead -- it is intentionally pinned to "whatever is currently the most recent
      // changeset(s)", not to 0042/0043 forever (see 0033's git history for the last time this
      // moved).
      expect(migratedTableExists).toBe(true);
      expect(rolledBackTableExists).toBe(false);
      expect(reappliedTableExists).toBe(true);
      expect(rolledBackSchema).not.toEqual(migratedSchema);
    });
  });

  describe('rolling back eighteen changesets (0043 down through 0026 schema-changing)', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackTwoSchema: string;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_two');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);

      // 0026 is now eighteen changesets back from HEAD (0043): 0027 (verify-only), 0028 (adds
      // organization_id elsewhere, doesn't touch reconciliation_user's auth columns), 0029
      // (grants only), 0030 (RLS policies only), 0031 (app_user role, grants only), 0032
      // (disables RLS on reconciliation_user only), 0033 (role check constraint only), 0034 (adds
      // its own reconciliation_user/reconciliation_organization columns -- rolled back along with
      // everything else in this range, which is correct and untested by the assertions below
      // since they only look at password/password_hash/role), 0035-0037 (new tables, no
      // reconciliation_user changes), 0038 (grants only), 0039 (new table, no reconciliation_user
      // changes), 0040 (new table, no reconciliation_user changes), 0041 (new tables, no
      // reconciliation_user changes), and 0042/0043 (File Imports & Validation tables + RLS, no
      // reconciliation_user changes) all sit on top of it without reversing anything this test
      // cares about.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=18');
      rolledBackTwoSchema = await generateSchemaBaseline(database.pool);
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('reverses changeset 0026 by dropping the auth/tenancy columns from reconciliation_user', () => {
      // 0026 added password_hash/role/organization_id and dropped password; its rollback puts
      // password back and drops the three new columns.
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
