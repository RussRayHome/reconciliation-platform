import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPostgresPersistenceEnabled, loadPostgresPersistenceConfigFromEnv } from './postgres';

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
