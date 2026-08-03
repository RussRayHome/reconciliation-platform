import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';

import type { Pool } from 'pg';
import { createPostgresPool } from '../../src/postgres';
import type { PostgresHarness } from '../globalSetup';

export type { PostgresHarness };

/** Connection details for the run-wide PostgreSQL container started by globalSetup.ts. */
export const postgresHarness = (): PostgresHarness => inject('postgresHarness');

/**
 * Runs a shell command inside the shared PostgreSQL container. globalSetup owns the
 * `StartedTestContainer` handle, so test files reach it through the container id rather than
 * testcontainers' own `exec` — `docker exec` is the same operation.
 */
export const execInPostgresContainer = (
  script: string,
  timeoutMs = 300000,
): { exitCode: number; output: string } => {
  const harness = postgresHarness();
  try {
    const output = execFileSync('docker', ['exec', harness.containerId, 'bash', '-lc', script], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeoutMs,
    });
    return { exitCode: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
};

const connectionStringFor = (harness: PostgresHarness, database: string): string =>
  `postgresql://${harness.user}:${harness.password}@${harness.host}:${harness.port}/${database}`;

const uniqueDatabaseName = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll('-', '')}`;

const withAdminPool = async <T>(
  harness: PostgresHarness,
  action: (pool: Pool) => Promise<T>,
): Promise<T> => {
  const adminPool = createPostgresPool({
    connectionString: connectionStringFor(harness, harness.maintenanceDatabase),
  });
  try {
    return await action(adminPool);
  } finally {
    await adminPool.end();
  }
};

/** A per-test-file database plus the pool bound to it. Call `drop()` from `afterAll`. */
export interface TestDatabase {
  name: string;
  pool: Pool;
  connectionString: string;
  drop: () => Promise<void>;
}

const openTestDatabase = async (
  harness: PostgresHarness,
  name: string,
  createStatement: string,
): Promise<TestDatabase> => {
  await withAdminPool(harness, (pool) => pool.query(createStatement));

  const connectionString = connectionStringFor(harness, name);
  const pool = createPostgresPool({ connectionString });

  return {
    name,
    pool,
    connectionString,
    drop: async () => {
      await pool.end();
      await withAdminPool(harness, (admin) => admin.query(`DROP DATABASE IF EXISTS ${name}`));
    },
  };
};

/**
 * Clones the fully migrated template into a fresh database for the calling test file. PostgreSQL
 * copies the template's files directly, so this costs milliseconds rather than a full Liquibase
 * run — use it for anything that just needs the schema to exist.
 */
export const createDatabaseFromTemplate = async (prefix = 'recon_test'): Promise<TestDatabase> => {
  const harness = postgresHarness();
  const name = uniqueDatabaseName(prefix);

  return openTestDatabase(
    harness,
    name,
    `CREATE DATABASE ${name} TEMPLATE ${harness.templateDatabase}`,
  );
};

/**
 * Creates an empty, unmigrated database. Only for tests that are themselves exercising migration
 * behaviour (a fresh `liquibase update`, the changelog-sync cutover, rollback) and therefore need
 * to start from nothing.
 */
export const createEmptyDatabase = async (prefix = 'recon_empty'): Promise<TestDatabase> => {
  const harness = postgresHarness();
  const name = uniqueDatabaseName(prefix);

  return openTestDatabase(harness, name, `CREATE DATABASE ${name}`);
};
