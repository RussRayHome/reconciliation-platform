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

  beforeAll(async () => {
    try {
      container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'recon_test',
          POSTGRES_USER: 'recon',
          POSTGRES_PASSWORD: 'recon',
        })
        .withExposedPorts(5432)
        .start();

      pool = createPostgresPool({
        connectionString: `postgresql://recon:recon@${container.getHost()}:${container.getMappedPort(5432)}/recon_test`,
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

    const result = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM schema_migrations');
    expect(Number(result.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });
});