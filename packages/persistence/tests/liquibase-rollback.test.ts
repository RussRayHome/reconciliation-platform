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

      // 0050 adds reconciliation_login_event.session_id -- a column/index addition, checked via
      // the same schema-baseline text diff the rest of this file uses. 0049 (sequence grants),
      // 0051 (re-seeds validation_rule_version rows -- data only, no DDL), 0052 (adds the
      // reconciliation_run_timeline reporting function), 0053 (adds set_updated_at() triggers to
      // five other tables), 0054 (reconciliation_run.skip_invalid_rows_by/_at columns), 0055
      // (reconciliation_run_timeline function replacement, same signature), 0056 (relaxes
      // reconciliation_run_segregation_of_duty_check with a session-GUC OR clause -- a constraint
      // redefinition, not a column change), 0057 (widens reconciliation_exception/
      // reconciliation_match_result's category CHECK constraints to add WeakDescriptionMatch --
      // also a constraint redefinition, not a column change), and 0058 (adds
      // reconciliation_exception.age_in_days -- a column addition, but on a different column than
      // this test observes), 0059/0060 (create reconciliation_account/reconciliation_run_account,
      // new tables), 0061/0062 (declared period_start/period_end and the terminal-good unique
      // index, both on reconciliation_run/reconciliation_run_account), 0063/0064/0065 (create
      // reconciliation_open_item/reconciliation_open_item_event/reconciliation_period_rollforward,
      // new tables), 0066 (reconciliation_organization.carry_forward_enabled/_at + updated_at, a
      // different table), 0067 (reconciliation_run.carry_forward_applied/_skip_reason, a
      // different table's columns), 0068 (reconciliation_run.closed_at/closed_by/reopen_count plus
      // a status CHECK constraint redefinition adding CLOSED -- still reconciliation_run, but none
      // of the columns/index this test observes), 0069 (creates reconciliation_run_event, a
      // new table), 0070 (widens canonical_record's source_type CHECK constraint to add BILLING,
      // a constraint redefinition on a different table), and 0071 (seeds validation_rule_version
      // with BILLING rule rows and widens its own source_type CHECK -- data plus a constraint
      // redefinition, still a different table) all sit on top of it without touching the schema
      // this test cares about, so rolling back 22 changesets (0071 down through 0050) lands on the
      // same DDL diff a --count=1 rollback used to produce when 0050 was HEAD. When a future
      // changeset lands here, extend the count again rather than re-pinning this test to a single
      // changeset number.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=22');
      rolledBackSchema = await generateSchemaBaseline(database.pool);

      runLiquibase(containerId, database.name, 'update');
      reappliedSchema = await generateSchemaBaseline(database.pool);
    }, 180000);

    afterAll(async () => {
      if (database) {
        await database.drop();
      }
    });

    it('removes the changesets from the tracking table and restores it on reapply', async () => {
      // Checked after beforeAll's final `update` call re-applies everything -- this asserts the
      // round trip (update -> rollback-count=20 -> update) lands back on the full changelog count,
      // not the count immediately after the rollback step (which beforeAll never captures).
      expect(await changelogCount(database!.pool)).toBe(changesetFileCount);
    });

    it('restores the exact original schema when the changesets are re-applied', () => {
      expect(reappliedSchema.split('\n')).toEqual(migratedSchema.split('\n'));
    });

    it('reverses 0050 by dropping reconciliation_login_event.session_id and its index', () => {
      // Pinned to 0050 specifically, not "whatever changeset is currently HEAD" -- 0049/0051 are
      // grant/data-only (no DDL), 0052/0053 add a function and triggers, 0054 adds columns to a
      // different table (reconciliation_run), 0055 replaces the same function as 0052, 0056
      // redefines a CHECK constraint, 0057 widens a different CHECK constraint, 0058 adds a
      // column to reconciliation_exception, 0059/0060 create new tables, 0061/0062 touch
      // reconciliation_run/reconciliation_run_account, 0063/0064/0065 create new tables, 0066
      // touches reconciliation_organization, 0067 touches reconciliation_run, 0068 adds more
      // reconciliation_run columns and redefines its status CHECK constraint, 0069 creates
      // reconciliation_run_event, 0070 redefines canonical_record's source_type CHECK, and 0071
      // seeds validation_rule_version plus redefines its own source_type CHECK -- none touch
      // reconciliation_login_event, so 0050 remains the most recent changeset with a schema diff
      // this test's col_type_is approach can observe. See the --count=22 comment above.
      expect(migratedSchema).toContain(
        "col_type_is('public', 'reconciliation_login_event', 'session_id', 'uuid'",
      );
      expect(migratedSchema).toContain('reconciliation_login_event_session_idx');

      expect(rolledBackSchema).not.toContain(
        "col_type_is('public', 'reconciliation_login_event', 'session_id', 'uuid'",
      );
      expect(rolledBackSchema).not.toContain('reconciliation_login_event_session_idx');

      expect(reappliedSchema).toContain(
        "col_type_is('public', 'reconciliation_login_event', 'session_id', 'uuid'",
      );
      expect(reappliedSchema).toContain('reconciliation_login_event_session_idx');
      expect(rolledBackSchema).not.toEqual(migratedSchema);
    });
  });

  describe('rolling back forty-six changesets (0071 down through 0026 schema-changing)', () => {
    let database: TestDatabase | undefined;
    let migratedSchema: string;
    let rolledBackTwoSchema: string;

    beforeAll(async () => {
      database = await createEmptyDatabase('recon_rollback_two');
      const { containerId } = postgresHarness();

      runLiquibase(containerId, database.name, 'update');
      migratedSchema = await generateSchemaBaseline(database.pool);

      // 0026 is now forty-six changesets back from HEAD (0071): 0027 (verify-only), 0028 (adds
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
      // reconciliation_user changes), 0049 (app_user sequence grants, no reconciliation_user
      // changes), 0050 (reconciliation_login_event.session_id, no reconciliation_user changes),
      // 0051 (re-seeds validation_rule_version rows -- data only, no reconciliation_user
      // changes), 0052 (adds the reconciliation_run_timeline reporting function, no
      // reconciliation_user changes), 0053 (adds set_updated_at() triggers to five other tables,
      // no reconciliation_user changes), 0054 (reconciliation_run.skip_invalid_rows_by/_at
      // columns, no reconciliation_user changes), 0055 (replaces the reconciliation_run_timeline
      // function again, no reconciliation_user changes), 0056 (redefines
      // reconciliation_run_segregation_of_duty_check, a reconciliation_run constraint, no
      // reconciliation_user changes), 0057 (widens reconciliation_exception/
      // reconciliation_match_result's category CHECK constraints, no reconciliation_user changes),
      // 0058 (adds reconciliation_exception.age_in_days, no reconciliation_user changes), 0059/
      // 0060 (create reconciliation_account/reconciliation_run_account, new tables, no
      // reconciliation_user changes), 0061/0062 (reconciliation_run period_start/period_end
      // and the terminal-good unique index, no reconciliation_user changes), 0063/0064/0065
      // (create reconciliation_open_item/reconciliation_open_item_event/
      // reconciliation_period_rollforward, new tables, no reconciliation_user changes), and
      // 0066/0067 (reconciliation_organization.carry_forward_enabled/_at + updated_at, and
      // reconciliation_run.carry_forward_applied/_skip_reason -- neither touches
      // reconciliation_user), 0068 (reconciliation_run.closed_at/closed_by/reopen_count plus a
      // status CHECK constraint redefinition, no reconciliation_user changes), 0069 (creates
      // reconciliation_run_event, a new table, no reconciliation_user changes), 0070 (widens
      // canonical_record's source_type CHECK to add BILLING, no reconciliation_user changes), and
      // 0071 (seeds validation_rule_version with BILLING rows and widens its own source_type
      // CHECK, no reconciliation_user changes) all sit on top of it without reversing anything
      // this test cares about.
      runLiquibase(containerId, database.name, 'rollback-count', '--count=46');
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
