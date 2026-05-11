import { Pool, type PoolConfig } from 'pg';

import { postgresMigrations } from './schema';

/** Connection pool settings loaded from environment variables. */
export type PostgresPersistenceConfig = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
};

/**
 * Returns true when the API is configured to use PostgreSQL persistence.
 * Checks for `RECON_PERSISTENCE_BACKEND=postgres` or a bare `DATABASE_URL` variable.
 * When false the API falls back to in-memory run storage.
 */
export const isPostgresPersistenceEnabled = (): boolean =>
  process.env.RECON_PERSISTENCE_BACKEND === 'postgres' || Boolean(process.env.DATABASE_URL);

/**
 * Reads PostgreSQL connection settings from environment variables and returns a config object,
 * or null if `DATABASE_URL` is not set (i.e. Postgres persistence is not configured).
 * Reads: `DATABASE_URL`, `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`.
 */
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

/** Creates a `pg.Pool` from the given config. Call once at process start and share the instance. */
export const createPostgresPool = (config: PostgresPersistenceConfig): Pool => {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
  };

  return new Pool(poolConfig);
};

/**
 * Applies all pending schema migrations in a single transaction.
 * Creates `schema_migrations` if it does not exist, then runs each migration in
 * `postgresMigrations` that has not been recorded there yet.
 * Safe to call on every process start — already-applied migrations are skipped.
 */
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
