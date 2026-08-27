import { DatabaseError, Pool, type PoolClient, type PoolConfig } from 'pg';

/** Re-exported so callers (e.g. the API's global error handler, EH3 in
 * error-handling-build-plan.md) can classify a caught error with `instanceof DatabaseError`
 * without taking a direct dependency on `pg` -- every other Postgres-shaped type callers need
 * already flows through `@recon/persistence` rather than straight from `pg`. `DatabaseError.code`
 * is the query's SQLSTATE, present only when Postgres actually rejected a query -- a raw
 * connection-level failure (ECONNREFUSED, connection dropped mid-request) is a plain `Error`,
 * never a `DatabaseError`, which is what makes this the right discriminator between "the database
 * responded with a rejection" and "the database was unreachable". */
export { DatabaseError };

/** Connection pool settings loaded from environment variables. */
export type PostgresPersistenceConfig = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
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
 * Reads: `DATABASE_URL`, `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`,
 * `PG_CONNECTION_TIMEOUT_MS`.
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
    // error-handling-build-plan.md EH6: `statement_timeout` already bounds a query once it's
    // running; pg's own default here is 0 (wait forever) for the connection-acquisition step
    // itself -- the exact gap that makes mode (b) (configured but unreachable) hang instead of
    // failing fast.
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? '5000'),
  };
};

/**
 * Creates a `pg.Pool` from the given config. Call once at process start and share the instance.
 *
 * @param onPoolError error-handling-build-plan.md EH6: `pg.Pool` emits `'error'` when an *idle*
 * pooled client fails (the connection dies while nothing is using it) -- every other long-lived
 * handle in this codebase (Redis, both BullMQ workers, both queue-events handles, the HTTP
 * server) already has an `'error'` listener; `pg.Pool` didn't, so this one failure mode took the
 * whole process down (Node terminates on an unhandled `EventEmitter` `'error'`). Takes a callback
 * rather than importing a logger directly -- this package has no logging dependency of its own,
 * and each real caller (server.ts, worker.ts) already has its own pino logger in scope. A second,
 * always-present internal listener (EH7) invalidates `checkDatabaseReachable`'s cache on the same
 * event, regardless of whether `onPoolError` is given -- that invalidation is this module's own
 * concern, not something every caller should have to remember to wire up.
 */
export const createPostgresPool = (
  config: PostgresPersistenceConfig,
  onPoolError?: (error: Error) => void,
): Pool => {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (error: Error) => {
    invalidateDatabaseReachableCache(pool);
    onPoolError?.(error);
  });

  return pool;
};

const LIVENESS_PROBE_TIMEOUT_MS = 2000;
const LIVENESS_CACHE_TTL_MS = 3000;

const livenessCache = new WeakMap<Pool, { reachable: boolean; checkedAt: number }>();

/**
 * error-handling-build-plan.md EH7: a cheap `SELECT 1` liveness probe, cached per pool for
 * `LIVENESS_CACHE_TTL_MS` so a burst of requests costs one round trip per cache window, not one
 * per request. Invalidated early by `createPostgresPool`'s `'error'` listener (EH6.2) so a pool
 * failure is reflected before the cache would naturally expire, not just after.
 *
 * This narrows the common case's message (mode (b): configured but unreachable) -- it does not
 * replace EH3's classifier. The database can still die in the gap between this probe returning
 * `true` and the real query that follows it; that query's own failure is still classified and
 * handled on its own terms. Anyone reading this later should not mistake a passing probe for a
 * guarantee the next query will succeed.
 */
export const checkDatabaseReachable = async (pool: Pool): Promise<boolean> => {
  const cached = livenessCache.get(pool);
  const now = Date.now();
  if (cached && now - cached.checkedAt < LIVENESS_CACHE_TTL_MS) {
    return cached.reachable;
  }

  const reachable = await probeOnce(pool);
  livenessCache.set(pool, { reachable, checkedAt: now });
  return reachable;
};

const probeOnce = async (pool: Pool): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Liveness probe timed out')),
          LIVENESS_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Exported for `createPostgresPool`'s own `'error'` listener (EH6.2) and for tests -- not
 * expected to be called from application code directly. */
export const invalidateDatabaseReachableCache = (pool: Pool): void => {
  livenessCache.delete(pool);
};

/**
 * Shared implementation behind `runInTenantScope` and `runInTenantScopeAsUser`: checks out a
 * client, sets `app.current_organization_id` (and optionally `app.current_user_name`) for this
 * transaction only (`set_config(..., true)` == SET LOCAL), runs `callback`, then commits/rolls
 * back and releases. This is the only place either GUC should be set -- `pg.Pool` reuses
 * connections, so setting one anywhere else (or per-query on a pooled connection outside a
 * transaction) risks a later request inheriting the previous request's tenant or actor.
 *
 * Uses `set_config` (a regular function call) rather than `SET LOCAL ... = $1` because `SET`
 * does not accept bind parameters -- this is also what keeps the tenant id and username out of
 * the SQL text.
 */
const runInScope = async <T>(
  pool: Pool,
  organizationId: string,
  username: string | undefined,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [
      organizationId,
    ]);
    if (username) {
      await client.query("SELECT set_config('app.current_user_name', $1, true)", [username]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // error-handling-build-plan.md EH6: when the connection is already dead, ROLLBACK itself
    // throws -- unswallowed, that replaces `error` (the actual root cause) with a secondary
    // "ROLLBACK failed" error at exactly the moment the real one matters most. app.ts:2230
    // already gets this right for its own one-off transaction; this shared helper, which every
    // RLS-scoped read and write funnels through, didn't.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/**
 * ADR-0001 step 6: every read or write that touches an RLS-protected table must go through this
 * (or `runInTenantScopeAsUser`) rather than `pool.query` directly. See `runInScope` for what it
 * actually does.
 */
export const runInTenantScope = async <T>(
  pool: Pool,
  organizationId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => runInScope(pool, organizationId, undefined, callback);

/**
 * Same as `runInTenantScope`, but additionally sets `app.current_user_name` for the transaction
 * (ISSUE-050.2) -- without it, pgaudit and any future per-user RLS policy can only ever see the
 * pooled `app_user` role running a query, never which actual person triggered it. Use this
 * instead of `runInTenantScope` for operations where DB-level "who did this" attribution matters
 * (mapping profile create/read/retire, at minimum); plain `runInTenantScope` remains correct for
 * everything else -- it isn't a required migration, just an opt-in for call sites that need it.
 */
export const runInTenantScopeAsUser = async <T>(
  pool: Pool,
  organizationId: string,
  username: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => runInScope(pool, organizationId, username, callback);
