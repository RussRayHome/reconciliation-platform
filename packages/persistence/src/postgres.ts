import { Pool, type PoolClient, type PoolConfig } from 'pg';

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
 * ADR-0001 step 6: checks out a client, sets `app.current_organization_id` for this transaction
 * only (`set_config(..., true)` == SET LOCAL), runs `callback`, then commits/rolls back and
 * releases. This is the only place that GUC should be set -- `pg.Pool` reuses connections, so
 * setting it anywhere else (or per-query on a pooled connection outside a transaction) risks a
 * later request inheriting the previous request's tenant. Every read or write that touches an
 * RLS-protected table must go through this rather than `pool.query` directly.
 *
 * Uses `set_config` (a regular function call) rather than `SET LOCAL app.current_organization_id
 * = $1` because `SET` does not accept bind parameters -- this is also what keeps the tenant id
 * out of the SQL text.
 */
export const runInTenantScope = async <T>(
  pool: Pool,
  organizationId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [
      organizationId,
    ]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
