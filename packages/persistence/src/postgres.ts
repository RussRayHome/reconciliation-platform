import { Pool, type PoolConfig } from 'pg';

import { postgresMigrations } from './schema';

export type PostgresPersistenceConfig = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
};

export const isPostgresPersistenceEnabled = (): boolean =>
  process.env.RECON_PERSISTENCE_BACKEND === 'postgres' || Boolean(process.env.DATABASE_URL);

export const loadPostgresPersistenceConfigFromEnv = (): PostgresPersistenceConfig | null => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  return {
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? '10'),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? '30000'),
    statementTimeoutMillis: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? '60000'),
  };
};

export const createPostgresPool = (config: PostgresPersistenceConfig): Pool => {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
  };

  return new Pool(poolConfig);
};

export const runPostgresMigrations = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );

    const appliedVersionsResult = await client.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    const appliedVersions = new Set(appliedVersionsResult.rows.map((row) => row.version));

    for (const migration of postgresMigrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
