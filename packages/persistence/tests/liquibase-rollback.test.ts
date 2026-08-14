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

  // 0049 grants app_user privileges on two sequences -- generateSchemaBaseline only introspects
  // tables/columns/constraints/FKs/indexes, not privileges, so a grants-only changeset produces
  // no schema-baseline diff at all (same "no diff" caveat this describe block's own history
  // already flagged for an RLS-only rollback). Checked directly via has_sequence_privilege
  // instead of the text-diff approach the rest of this file uses.
  const hasSequenceSelectPrivilege = async (pool: Pool, sequence: string): Promise<boolean> => {
    const result = await pool.query<{ has_privilege: boolean }>(
      `SELECT has_sequence_privilege('app_user', $1, 'SELECT') AS has_privilege`,
      [sequence],
    );
    return result.rows[0]?.has_privilege === true;
  };

  describe('rolling back the most recent changeset', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let reappliedSchema: string;
    let migratedHasPrivilege: boolean;
    let rolledBackHasPrivilege: boolean;
    let reappliedHasPrivilege: boolean;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_one');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);
      migratedHasPrivilege = await hasSequenceSelectPrivilege(
        database.pool,
        'validation_issue_id_seq',
      );

      // 0049 (the current HEAD) grants app_user sequence privileges -- see
      // hasSequenceSelectPrivilege's own comment for why this is checked directly rather than via
      // the schema-baseline text diff the rest of this file uses.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=1');
      rolledBackHasPrivilege = await hasSequenceSelectPrivilege(
        database.pool,
        'validation_issue_id_seq',
      );

      runLiquibase(containerId, database.name, 'update');
      reappliedSchema = await generateSchemaBaseline(database.pool);
      reappliedHasPrivilege = await hasSequenceSelectPrivilege(
        database.pool,
        'validation_issue_id_seq',
      );
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

    it('reverses 0049 by revoking app_user\'s SELECT privilege on validation_issue_id_seq', () => {
      // When a future changeset lands on top of 0049, update this test to describe that changeset
      // instead -- it is intentionally pinned to "whatever is currently the most recent
      // changeset", not to 0049 forever (see 0033's git history for the last time this moved).
      expect(migratedHasPrivilege).toBe(true);
      expect(rolledBackHasPrivilege).toBe(false);
      expect(reappliedHasPrivilege).toBe(true);
    });
  });

  describe('rolling back twenty-four changesets (0049 down through 0026 schema-changing)', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackTwoSchema: string;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_two');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);

      // 0026 is now twenty-four changesets back from HEAD (0049): 0027 (verify-only), 0028 (adds
      // organization_id elsewhere, doesn't touch reconciliation_user's auth columns), 0029
      // (grants only), 0030 (RLS policies only), 0031 (app_user role, grants only), 0032
      // (disables RLS on reconciliation_user only), 0033 (role check constraint only), 0034 (adds
      // its own reconciliation_user/reconciliation_organization columns -- rolled back along with
      // everything else in this range, which is correct and untested by the assertions below
      // since they only look at password/password_hash/role), 0035-0037 (new tables, no
      // reconciliation_user changes), 0038 (grants only), 0039 (new table, no reconciliation_user
      // changes), 0040 (new table, no reconciliation_user changes), 0041 (new tables, no
      // reconciliation_user changes), 0042/0043 (File Imports & Validation tables + RLS, no
      // reconciliation_user changes), 0044/0045/0046 (source_type widening, run_source_file,
      // canonical_record rename -- none touch reconciliation_user), 0047 (rule version lineage
      // tables, no reconciliation_user changes), 0048 (reconciliation_run.matching_job_id, no
      // reconciliation_user changes), and 0049 (app_user sequence grants, no reconciliation_user
      // changes) all sit on top of it without reversing anything this test cares about.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=24');
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
