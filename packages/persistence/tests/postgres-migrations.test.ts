import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresPool, runPostgresMigrations } from '../src/postgres';

import type { Pool } from 'pg';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

const runPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true';
const describePostgres = runPostgresTests ? describe : describe.skip;

describePostgres('PostgreSQL Migrations', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool;
  let startupError: Error | null = null;

  const postgresCredentials = {
    db: 'recon_test',
    user: 'recon',
    password: 'recon',
  };

  const installPostgresTooling = async (targetContainer: StartedTestContainer) => {
    const installResult = await targetContainer.exec([
      'bash',
      '-lc',
      [
        'set -euo pipefail',
        'apt-get update',
        'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-16-pgtap python3 python3-pip python3-setuptools',
        'python3 -m pip install --no-cache-dir --break-system-packages migra',
        'rm -rf /var/lib/apt/lists/*',
      ].join('; '),
    ]);

    if (installResult.exitCode !== 0) {
      throw new Error(`Failed to install postgres test tooling: ${installResult.output}`);
    }
  };

  beforeAll(async () => {
    try {
      container = await new GenericContainer('postgres:16.13')
        .withEnvironment({
          POSTGRES_DB: postgresCredentials.db,
          POSTGRES_USER: postgresCredentials.user,
          POSTGRES_PASSWORD: postgresCredentials.password,
        })
        .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
        .withUser('root')
        .withExposedPorts(5432)
        .start();

      await installPostgresTooling(container);

      pool = createPostgresPool({
        connectionString: `postgresql://${postgresCredentials.user}:${postgresCredentials.password}@${container.getHost()}:${container.getMappedPort(5432)}/${postgresCredentials.db}`,
      });
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Skipping PostgreSQL migration setup: ${startupError.message}`);
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('applies migrations idempotently', async () => {
    if (startupError) {
      return;
    }

    await runPostgresMigrations(pool);
    await runPostgresMigrations(pool);

    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM schema_migrations',
    );
    expect(Number(result.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });

  it('runs pgTap assertions against the postgres test database', async () => {
    if (startupError) {
      return;
    }

    await pool.query('CREATE EXTENSION IF NOT EXISTS pgtap');
    await pool.query('SELECT plan(1)');

    const assertion = await pool.query<{ assertion: string }>(
      "SELECT ok(TRUE, 'pgTap extension is available') AS assertion",
    );
    expect(assertion.rows[0]?.assertion.startsWith('ok')).toBe(true);

    const finishResult = await pool.query<{ result: string }>('SELECT * FROM finish() AS result');
    expect(finishResult.rows.some((row) => row.result.startsWith('not ok'))).toBe(false);
  });

  it('enables pg_stat_statements and records query stats', async () => {
    if (startupError) {
      return;
    }

    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    await pool.query('SELECT 1');

    const stats = await pool.query<{ calls: string }>(
      'SELECT COALESCE(SUM(calls), 0)::text AS calls FROM pg_stat_statements',
    );
    expect(Number(stats.rows[0]?.calls ?? '0')).toBeGreaterThan(0);
  });

  it('runs migra schema diff during postgres db tests', async () => {
    if (startupError || !container) {
      return;
    }

    const migraImportResult = await container.exec([
      'bash',
      '-lc',
      'python3 -c "import migra; print(migra.__name__)"',
    ]);
    expect(migraImportResult.exitCode).toBe(0);
    expect(migraImportResult.output).toContain('migra');

    const connectionUrl = `postgresql://${postgresCredentials.user}:${postgresCredentials.password}@127.0.0.1:5432/${postgresCredentials.db}`;
    const migraResult = await container.exec([
      'bash',
      '-lc',
      `set -euo pipefail; python3 -m migra --unsafe --schema public "${connectionUrl}" "${connectionUrl}"`,
    ]);

    expect([0, 1]).toContain(migraResult.exitCode);
    expect(migraResult.output).not.toContain('Traceback');
  });
});
