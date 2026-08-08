import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isPostgresPersistenceEnabled,
  loadPostgresPersistenceConfigFromEnv,
  runInTenantScope,
  runInTenantScopeAsUser,
} from './postgres';

/** Records every statement issued on the checked-out client, in order, so tests can assert
 * exactly which GUCs got set (and in what order) rather than just the callback's return value. */
const createRecordingPool = (): { pool: Pool; calls: Array<{ text: string; params?: unknown[] }> } => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  const clientQuery = (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params?.[1] }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };

  const pool = {
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;

  return { pool, calls };
};

describe('isPostgresPersistenceEnabled', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.RECON_PERSISTENCE_BACKEND;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true when RECON_PERSISTENCE_BACKEND is postgres', () => {
    process.env.RECON_PERSISTENCE_BACKEND = 'postgres';
    expect(isPostgresPersistenceEnabled()).toBe(true);
  });

  it('returns true when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/recon';
    expect(isPostgresPersistenceEnabled()).toBe(true);
  });

  it('returns false when neither variable is set', () => {
    expect(isPostgresPersistenceEnabled()).toBe(false);
  });

  it('returns false when RECON_PERSISTENCE_BACKEND is not postgres', () => {
    process.env.RECON_PERSISTENCE_BACKEND = 'memory';
    expect(isPostgresPersistenceEnabled()).toBe(false);
  });
});

describe('loadPostgresPersistenceConfigFromEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.DATABASE_URL;
    delete process.env.PG_POOL_MAX;
    delete process.env.PG_IDLE_TIMEOUT_MS;
    delete process.env.PG_STATEMENT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when DATABASE_URL is not set', () => {
    expect(loadPostgresPersistenceConfigFromEnv()).toBeNull();
  });

  it('returns config with connection string from DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/recon';
    const config = loadPostgresPersistenceConfigFromEnv();
    expect(config?.connectionString).toBe('postgresql://localhost/recon');
  });

  it('uses default pool settings when optional env vars are absent', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/recon';
    const config = loadPostgresPersistenceConfigFromEnv();
    expect(config?.max).toBe(10);
    expect(config?.idleTimeoutMillis).toBe(30000);
    expect(config?.statementTimeoutMillis).toBe(60000);
  });

  it('reads pool settings from env when set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/recon';
    process.env.PG_POOL_MAX = '20';
    process.env.PG_IDLE_TIMEOUT_MS = '60000';
    process.env.PG_STATEMENT_TIMEOUT_MS = '120000';
    const config = loadPostgresPersistenceConfigFromEnv();
    expect(config?.max).toBe(20);
    expect(config?.idleTimeoutMillis).toBe(60000);
    expect(config?.statementTimeoutMillis).toBe(120000);
  });
});

describe('runInTenantScope', () => {
  it('sets only the organization GUC, never a user GUC', async () => {
    const { pool, calls } = createRecordingPool();

    const result = await runInTenantScope(pool, 'org-1', () => Promise.resolve('ok'));

    expect(result).toBe('ok');
    const texts = calls.map((c) => c.text);
    expect(texts).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_organization_id', $1, true)",
      'COMMIT',
    ]);
    expect(calls[1]?.params).toEqual(['org-1']);
  });

  it('rolls back and rethrows when the callback throws', async () => {
    const { pool, calls } = createRecordingPool();

    await expect(
      runInTenantScope(pool, 'org-1', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_organization_id', $1, true)",
      'ROLLBACK',
    ]);
  });
});

describe('runInTenantScopeAsUser', () => {
  it('sets both the organization GUC and the user GUC, in that order', async () => {
    const { pool, calls } = createRecordingPool();

    const result = await runInTenantScopeAsUser(pool, 'org-1', 'rray', () => Promise.resolve('ok'));

    expect(result).toBe('ok');
    const texts = calls.map((c) => c.text);
    expect(texts).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_organization_id', $1, true)",
      "SELECT set_config('app.current_user_name', $1, true)",
      'COMMIT',
    ]);
    expect(calls[1]?.params).toEqual(['org-1']);
    expect(calls[2]?.params).toEqual(['rray']);
  });

  it('rolls back and rethrows when the callback throws, after both GUCs were set', async () => {
    const { pool, calls } = createRecordingPool();

    await expect(
      runInTenantScopeAsUser(pool, 'org-1', 'rray', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_organization_id', $1, true)",
      "SELECT set_config('app.current_user_name', $1, true)",
      'ROLLBACK',
    ]);
  });
});
