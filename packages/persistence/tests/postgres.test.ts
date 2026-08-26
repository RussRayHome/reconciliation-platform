import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  createPostgresPool,
  loadPostgresPersistenceConfigFromEnv,
  runInTenantScope,
} from '../src/postgres';

describe('loadPostgresPersistenceConfigFromEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults connectionTimeoutMillis to 5000 when PG_CONNECTION_TIMEOUT_MS is unset (error-handling-build-plan.md EH6)', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.PG_CONNECTION_TIMEOUT_MS;

    const config = loadPostgresPersistenceConfigFromEnv();

    expect(config?.connectionTimeoutMillis).toBe(5000);
  });

  it('reads PG_CONNECTION_TIMEOUT_MS when set', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.PG_CONNECTION_TIMEOUT_MS = '1234';

    const config = loadPostgresPersistenceConfigFromEnv();

    expect(config?.connectionTimeoutMillis).toBe(1234);
  });
});

describe('createPostgresPool', () => {
  it('wires connectionTimeoutMillis into the resolved pool options (error-handling-build-plan.md EH6)', async () => {
    const pool = createPostgresPool({
      connectionString: 'postgresql://user:pass@localhost:5432/db',
      connectionTimeoutMillis: 4242,
    });

    try {
      expect(pool.options.connectionTimeoutMillis).toBe(4242);
    } finally {
      await pool.end();
    }
  });

  it("registers onPoolError as the pool's 'error' listener, and does not throw when it fires (error-handling-build-plan.md EH6, closes EH-G)", async () => {
    // pg.Pool connects lazily -- constructing one, and even emitting 'error' on it manually,
    // makes no real network attempt. Without a registered listener, this emit would throw
    // synchronously (EventEmitter's default behavior for an unhandled 'error' event) and, in the
    // real process, take the whole process down -- that's EH-G.
    const onPoolError = vi.fn();
    const pool = createPostgresPool(
      { connectionString: 'postgresql://user:pass@localhost:5432/db' },
      onPoolError,
    );

    try {
      const simulatedError = new Error('Connection terminated unexpectedly');
      expect(() => pool.emit('error', simulatedError)).not.toThrow();
      expect(onPoolError).toHaveBeenCalledWith(simulatedError);
    } finally {
      await pool.end();
    }
  });

  it('does not attach a listener (and does not throw on construction) when onPoolError is omitted', async () => {
    const pool = createPostgresPool({ connectionString: 'postgresql://user:pass@localhost:5432/db' });

    try {
      expect(pool.listenerCount('error')).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe('runInTenantScope', () => {
  /** Minimal fake `PoolClient` -- `BEGIN`/`set_config`/the callback's own query all succeed,
   * `COMMIT` is never reached (the callback throws first), and `ROLLBACK` fails the way it does
   * on an already-dead connection. Returns the raw `release` mock alongside the client (rather
   * than reading `client.release` back off the cast object) to avoid asserting on an unbound
   * method reference. */
  const createDeadConnectionClient = (
    rollbackError: Error,
  ): { client: PoolClient; release: ReturnType<typeof vi.fn> } => {
    const query = vi.fn((text: string) => {
      if (text === 'ROLLBACK') {
        return Promise.reject(rollbackError);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const release = vi.fn();

    return { client: { query, release } as unknown as PoolClient, release };
  };

  it('surfaces the original error, not the ROLLBACK error, when the connection is already dead (error-handling-build-plan.md EH6, closes EH-F)', async () => {
    const originalError = new Error('the actual query failed');
    const rollbackError = new Error('Connection terminated unexpectedly');
    const { client } = createDeadConnectionClient(rollbackError);
    const pool = { connect: () => Promise.resolve(client) } as unknown as Parameters<
      typeof runInTenantScope
    >[0];

    await expect(
      runInTenantScope(pool, 'org-1', () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);
  });

  it('still releases the client when ROLLBACK fails', async () => {
    const rollbackError = new Error('Connection terminated unexpectedly');
    const { client, release } = createDeadConnectionClient(rollbackError);
    const pool = { connect: () => Promise.resolve(client) } as unknown as Parameters<
      typeof runInTenantScope
    >[0];

    await expect(
      runInTenantScope(pool, 'org-1', () => {
        throw new Error('the actual query failed');
      }),
    ).rejects.toThrow('the actual query failed');

    expect(release).toHaveBeenCalledTimes(1);
  });
});
