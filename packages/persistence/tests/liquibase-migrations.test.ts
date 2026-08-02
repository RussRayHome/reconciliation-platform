import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../src/postgres';
import {
  createImportApproval,
  createMappingProfileVersion,
  loadApprovalHistory,
  recordApprovalDecision,
} from '../src/readModelStore';
import { countChangesetFiles, replayPreLiquibaseBaseline, runLiquibase } from './testHelpers/liquibase';

import type { Pool } from 'pg';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

/**
 * Verifies the Liquibase changelog under packages/persistence/liquibase/ (the replacement for
 * the old `postgresMigrations` array) actually applies to a real PostgreSQL instance, and that
 * the new approval-pipeline tables it adds behave as designed.
 *
 * Liquibase itself runs via a sibling `docker run --network container:<id>` invocation of the
 * official `liquibase/liquibase` image (see packages/persistence/liquibase/Dockerfile) against
 * the Testcontainers-managed postgres instance's own network namespace — this requires a Docker
 * CLI on the host running the test, same as the Testcontainers postgres container itself.
 *
 * NOTE: the `changelog-sync-to-tag` cutover path (see packages/persistence/liquibase/README.md)
 * is exercised below with a hard subprocess timeout. In one development sandbox, Docker itself
 * was observed to intermittently hang starting containers (including Testcontainers' unrelated
 * "Ryuk" cleanup sidecar, and a raw `docker run` invoking `changelog-sync-to-tag --help` with no
 * database involved at all) — environment flakiness unrelated to this repo's changesets. If this
 * test times out, re-run it; a persistent failure specifically on `changelog-sync-to-tag` (not
 * `update`) is the signal to re-verify the cutover procedure manually before a real deployment.
 */
describe('Liquibase migrations', () => {
  let container: StartedTestContainer | undefined;
  let freshPool: Pool;
  let startupError: Error | null = null;

  const credentials = { db: 'postgres', user: 'recon', password: 'recon' };
  const changesetFileCount = countChangesetFiles();

  beforeAll(async () => {
    try {
      container = await new GenericContainer('postgres:16.13')
        .withEnvironment({
          POSTGRES_DB: credentials.db,
          POSTGRES_USER: credentials.user,
          POSTGRES_PASSWORD: credentials.password,
        })
        .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
        .withUser('root')
        .withExposedPorts(5432)
        .start();

      const pgtapInstall = await container.exec([
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          'apt-get update',
          'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-16-pgtap',
        ].join('; '),
      ]);
      if (pgtapInstall.exitCode !== 0) {
        throw new Error(`Failed to install pgTap: ${pgtapInstall.output}`);
      }

      const adminPool = createPostgresPool({
        connectionString: `postgresql://${credentials.user}:${credentials.password}@${container.getHost()}:${container.getMappedPort(5432)}/${credentials.db}`,
      });
      await adminPool.query('CREATE DATABASE recon_fresh');
      await adminPool.query('CREATE DATABASE recon_synced');
      await adminPool.end();

      freshPool = createPostgresPool({
        connectionString: `postgresql://${credentials.user}:${credentials.password}@${container.getHost()}:${container.getMappedPort(5432)}/recon_fresh`,
      });
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Liquibase migration test setup failed: ${startupError.message}`);
      throw startupError;
    }
  }, 180000);

  afterAll(async () => {
    if (freshPool) {
      await freshPool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it(
    'applies every changeset to an empty database via a fresh `liquibase update`',
    async () => {
      if (startupError || !container) {
        throw startupError ?? new Error('container not initialized');
      }

      runLiquibase(container.getId(), 'recon_fresh', 'update');

      const changelogCount = await freshPool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM databasechangelog',
      );
      expect(Number(changelogCount.rows[0]?.count ?? '0')).toBe(changesetFileCount);

      const tables = await freshPool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tableNames = new Set(tables.rows.map((row) => row.table_name));

      // Ported legacy tables plus the new approval-pipeline tables from changesets 0011-0018.
      for (const expected of [
        'reconciliation_job',
        'reconciliation_source_file',
        'reconciliation_user',
        'reconciliation_organization',
        'reconciliation_mapping_profile',
        'reconciliation_mapping_profile_version',
        'reconciliation_template_definition',
        'reconciliation_staged_transaction',
        'reconciliation_validation_rule_version',
        'reconciliation_validation_result',
        'reconciliation_import_approval',
        'reconciliation_approval_history',
      ]) {
        expect(tableNames.has(expected)).toBe(true);
      }

      // The old hand-rolled tracking table must not survive (dropped by changeset 0010).
      expect(tableNames.has('schema_migrations')).toBe(false);
    },
    120000,
  );

  it('runs pgTap assertions against the Liquibase-migrated database', async () => {
    if (startupError) {
      throw startupError;
    }

    await freshPool.query('CREATE EXTENSION IF NOT EXISTS pgtap');
    await freshPool.query('SELECT plan(1)');

    const assertion = await freshPool.query<{ assertion: string }>(
      "SELECT ok(TRUE, 'pgTap extension is available') AS assertion",
    );
    expect(assertion.rows[0]?.assertion.startsWith('ok')).toBe(true);

    const finishResult = await freshPool.query<{ result: string }>('SELECT * FROM finish() AS result');
    expect(finishResult.rows.some((row) => row.result.startsWith('not ok'))).toBe(false);
  });

  it('enables pg_stat_statements and records query stats', async () => {
    if (startupError) {
      throw startupError;
    }

    await freshPool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    await freshPool.query('SELECT 1');

    const stats = await freshPool.query<{ calls: string }>(
      'SELECT COALESCE(SUM(calls), 0)::text AS calls FROM pg_stat_statements',
    );
    expect(Number(stats.rows[0]?.calls ?? '0')).toBeGreaterThan(0);
  });

  it(
    'changelog-sync-to-tag converges an already-migrated environment to the same schema as a fresh update',
    async () => {
      if (startupError || !container) {
        throw startupError ?? new Error('container not initialized');
      }

      const syncedPool = createPostgresPool({
        connectionString: `postgresql://${credentials.user}:${credentials.password}@${container.getHost()}:${container.getMappedPort(5432)}/recon_synced`,
      });

      try {
        // Simulate an environment already migrated by the pre-Liquibase mechanism.
        await replayPreLiquibaseBaseline(syncedPool);

        runLiquibase(container.getId(), 'recon_synced', 'changelog-sync-to-tag', '--tag=v1-v9-baseline');
        runLiquibase(container.getId(), 'recon_synced', 'update');

        // The pgTap and pg_stat_statements checks elsewhere in this file install those
        // extensions into recon_fresh to verify the tooling itself works; neither extension
        // is part of the Liquibase-managed application schema. Mirror them onto recon_synced
        // so the migra diff below compares only Liquibase-managed schema objects instead of
        // flagging this incidental test-harness setup as schema drift.
        await syncedPool.query('CREATE EXTENSION IF NOT EXISTS pgtap');
        await syncedPool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');

        const installResult = await container.exec([
          'bash',
          '-lc',
          [
            'set -euo pipefail',
            'apt-get update',
            'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 python3-pip python3-setuptools',
            'python3 -m pip install --no-cache-dir --break-system-packages migra psycopg2-binary',
          ].join('; '),
        ]);
        expect(installResult.exitCode).toBe(0);

        const freshUrl = `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:5432/recon_fresh`;
        const syncedUrl = `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:5432/recon_synced`;
        const diffResult = await container.exec([
          'bash',
          '-lc',
          `set -euo pipefail; migra --unsafe --schema public "${syncedUrl}" "${freshUrl}"`,
        ]);

        // migra exits 0 with empty output when the two schemas are identical; exit 2 means it
        // found differences and printed the SQL to reconcile them.
        expect(diffResult.exitCode).toBe(0);
        expect(diffResult.output.trim()).toBe('');
      } finally {
        await syncedPool.end();
      }
    },
    150000,
  );
});

describe('Approval-pipeline schema constraints (against the Liquibase-migrated database)', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool;
  let startupError: Error | null = null;

  beforeAll(async () => {
    try {
      container = await new GenericContainer('postgres:16.13')
        .withEnvironment({ POSTGRES_DB: 'recon_test', POSTGRES_USER: 'recon', POSTGRES_PASSWORD: 'recon' })
        .withUser('root')
        .withExposedPorts(5432)
        .start();

      runLiquibase(container.getId(), 'recon_test', 'update');

      pool = createPostgresPool({
        connectionString: `postgresql://recon:recon@${container.getHost()}:${container.getMappedPort(5432)}/recon_test`,
      });
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      throw startupError;
    }
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('rejects a duplicate mapping profile version (immutability)', async () => {
    if (startupError) throw startupError;

    await pool.query(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Acme Co') ON CONFLICT DO NOTHING",
    );
    const org = await pool.query<{ id: string }>(
      "SELECT id FROM reconciliation_organization WHERE name = 'Acme Co'",
    );
    const organizationId = org.rows[0]!.id;

    await pool.query(
      "INSERT INTO reconciliation_user (user_name, first_name, last_name, password) VALUES ('alice', 'Alice', 'Smith', 'hash') ON CONFLICT DO NOTHING",
    );

    const profileResult = await pool.query<{ id: string }>(
      `INSERT INTO reconciliation_mapping_profile (id, organization_id, name, source_type)
       VALUES (gen_random_uuid(), $1, 'Chase Bank CSV', 'bank') RETURNING id`,
      [organizationId],
    );
    const profileId = profileResult.rows[0]!.id;

    await createMappingProfileVersion(pool, {
      id: crypto.randomUUID(),
      profileId,
      versionNumber: 1,
      columnMapping: { Date: 'transactionDate' },
      transformationRules: [],
      createdBy: 'alice',
    });

    await expect(
      createMappingProfileVersion(pool, {
        id: crypto.randomUUID(),
        profileId,
        versionNumber: 1,
        columnMapping: { Date: 'postingDate' },
        transformationRules: [],
        createdBy: 'alice',
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('rejects a staged transaction that references a nonexistent source file (FK ownership)', async () => {
    if (startupError) throw startupError;

    // ingestion_mode is stated explicitly as MAPPED because changeset 0020 pairs it with
    // mapping_profile_version_id: leaving it at the 'DIRECT' default alongside a non-NULL profile
    // version would trip the pairing CHECK first and this test would stop exercising the FK it is
    // named for.
    await expect(
      pool.query(
        `INSERT INTO reconciliation_staged_transaction
           (id, raw_row_id, source_file_id, mapping_profile_version_id, ingestion_mode, normalized_fields_json)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'MAPPED', '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('rejects a direct-import staged transaction that names a mapping profile version', async () => {
    if (startupError) throw startupError;

    // The inverse of the pairing invariant from changeset 0020: a DIRECT import did not go through
    // a mapping profile, so claiming one would misrepresent how the row was normalized.
    await expect(
      pool.query(
        `INSERT INTO reconciliation_staged_transaction
           (id, raw_row_id, source_file_id, mapping_profile_version_id, ingestion_mode, normalized_fields_json)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'DIRECT', '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/reconciliation_staged_transaction_mapping_pairing_check/);
  });

  it('still rejects a duplicate (job_id, source_system) source file after the approval-pipeline extension (regression)', async () => {
    if (startupError) throw startupError;

    const jobId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_job (id, correlation_id, current_state, rulepack_version, started_at)
       VALUES ($1, 'corr-1', 'CREATED', 'v1', NOW())`,
      [jobId],
    );

    const insertSourceFile = () =>
      pool.query(
        `INSERT INTO reconciliation_source_file
           (id, job_id, source_system, source_format, file_name, mime_type, size_bytes, sha256, uploaded_at)
         VALUES (gen_random_uuid(), $1, 'bank', 'csv', 'a.csv', 'text/csv', 10, 'hash', NOW())`,
        [jobId],
      );

    await insertSourceFile();
    await expect(insertSourceFile()).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('records an approval decision and its append-only history via the persistence-layer helpers', async () => {
    if (startupError) throw startupError;

    await pool.query(
      "INSERT INTO reconciliation_user (user_name, first_name, last_name, password) VALUES ('bob', 'Bob', 'Jones', 'hash') ON CONFLICT DO NOTHING",
    );

    const jobId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_job (id, correlation_id, current_state, rulepack_version, started_at)
       VALUES ($1, 'corr-2', 'CREATED', 'v1', NOW())`,
      [jobId],
    );
    const sourceFile = await pool.query<{ id: string }>(
      `INSERT INTO reconciliation_source_file
         (id, job_id, source_system, source_format, file_name, mime_type, size_bytes, sha256, uploaded_at)
       VALUES (gen_random_uuid(), $1, 'bank', 'csv', 'b.csv', 'text/csv', 10, 'hash2', NOW())
       RETURNING id`,
      [jobId],
    );
    const sourceFileId = sourceFile.rows[0]!.id;

    const approval = await createImportApproval(pool, {
      id: crypto.randomUUID(),
      sourceFileId,
      uploadedBy: 'bob',
    });
    expect(approval.status).toBe('PENDING');

    const decided = await recordApprovalDecision(pool, {
      approvalId: approval.id,
      toStatus: 'APPROVED',
      actor: 'bob',
      rationale: 'Looks correct',
    });
    expect(decided.status).toBe('APPROVED');
    expect(decided.approvedBy).toBe('bob');

    const history = await loadApprovalHistory(pool, approval.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'PENDING', toStatus: 'APPROVED', actor: 'bob' });
  });
});
