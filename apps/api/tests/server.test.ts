import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createAppMock = vi.fn(() => ({ listen: vi.fn() })); // sync on purpose: no async needed in mock factory
const poolQueryMock = vi.fn(() =>
  Promise.resolve({ rows: [{ rolsuper: false, rolbypassrls: false }] }),
);
const createPostgresPoolMock = vi.fn(() => ({ end: vi.fn(), query: poolQueryMock }));
const loadPostgresPersistenceConfigFromEnvMock = vi.fn();
const isPostgresPersistenceEnabledMock = vi.fn();
const markServerStartedMock = vi.fn();

const lifecycleStoreInstances: unknown[] = [];
const readModelStoreInstances: unknown[] = [];

vi.mock('../src/app', () => ({
  createApp: createAppMock,
}));

vi.mock('../src/services/runtimeDiagnostics', () => ({
  markServerStarted: markServerStartedMock,
}));

vi.mock('@recon/persistence', () => ({
  PostgresReconciliationLifecycleStore: vi.fn().mockImplementation(function (
    this: unknown,
    pool: unknown,
  ) {
    const instance = { pool, kind: 'lifecycle' };
    lifecycleStoreInstances.push(instance);
    return instance;
  }),
  PostgresReconciliationReadModelStore: vi.fn().mockImplementation(function (
    this: unknown,
    pool: unknown,
  ) {
    const instance = { pool, kind: 'read-model' };
    readModelStoreInstances.push(instance);
    return instance;
  }),
  createPostgresPool: createPostgresPoolMock,
  loadPostgresPersistenceConfigFromEnv: loadPostgresPersistenceConfigFromEnvMock,
  isPostgresPersistenceEnabled: isPostgresPersistenceEnabledMock,
}));

vi.mock('pino', () => {
  const pinoMock = vi.fn(() => ({
    info: vi.fn(),
  }));

  Object.assign(pinoMock, {
    multistream: vi.fn(() => ({})),
    transport: vi.fn(() => ({ write: vi.fn() })),
  });

  return {
    default: pinoMock,
  };
});

describe('server runtime', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createAppMock.mockClear();
    createPostgresPoolMock.mockClear();
    poolQueryMock.mockClear();
    poolQueryMock.mockResolvedValue({ rows: [{ rolsuper: false, rolbypassrls: false }] });
    loadPostgresPersistenceConfigFromEnvMock.mockReset();
    isPostgresPersistenceEnabledMock.mockReset();
    markServerStartedMock.mockClear();
    lifecycleStoreInstances.length = 0;
    readModelStoreInstances.length = 0;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails fast when PostgreSQL persistence is enabled without a database URL', async () => {
    isPostgresPersistenceEnabledMock.mockReturnValue(true);
    loadPostgresPersistenceConfigFromEnvMock.mockReturnValue(null);

    const { createServerRuntime } = await import('../src/server');

    await expect(createServerRuntime()).rejects.toThrow(
      'DATABASE_URL is required when PostgreSQL persistence is enabled.',
    );
  });

  it('initializes both PostgreSQL stores when persistence is enabled', async () => {
    isPostgresPersistenceEnabledMock.mockReturnValue(true);
    loadPostgresPersistenceConfigFromEnvMock.mockReturnValue({
      connectionString: 'postgresql://recon:recon@localhost:5432/reconciliation_platform',
      max: 5,
      idleTimeoutMillis: 1000,
      statementTimeoutMillis: 2000,
    });

    const { createServerRuntime } = await import('../src/server');
    const runtime = await createServerRuntime();

    expect(createPostgresPoolMock).toHaveBeenCalledTimes(1);
    expect(lifecycleStoreInstances).toHaveLength(1);
    expect(readModelStoreInstances).toHaveLength(1);
    expect(createAppMock).toHaveBeenCalledTimes(1);
    const firstCall = createAppMock.mock.calls[0] as unknown as [unknown, unknown, unknown];
    expect(firstCall[1]).toBe(lifecycleStoreInstances[0]);
    expect(firstCall[2]).toBe(readModelStoreInstances[0]);
    expect(runtime.lifecycleStore).toBe(lifecycleStoreInstances[0]);
    expect(runtime.readModelStore).toBe(readModelStoreInstances[0]);
  });

  // ISSUE-006: DATABASE_URL being required (not defaulted) doesn't stop it from being pointed at
  // the wrong role by mistake -- this is the backstop that catches the role itself being wrong.
  it('refuses to start when the connected database role is a superuser', async () => {
    isPostgresPersistenceEnabledMock.mockReturnValue(true);
    loadPostgresPersistenceConfigFromEnvMock.mockReturnValue({
      connectionString: 'postgresql://recon:recon@localhost:5432/reconciliation_platform',
      max: 5,
      idleTimeoutMillis: 1000,
      statementTimeoutMillis: 2000,
    });
    poolQueryMock.mockResolvedValue({ rows: [{ rolsuper: true, rolbypassrls: false }] });

    const { createServerRuntime } = await import('../src/server');

    await expect(createServerRuntime()).rejects.toThrow(/bypasses row-level security/);
  });

  it('refuses to start when the connected database role bypasses row-level security', async () => {
    isPostgresPersistenceEnabledMock.mockReturnValue(true);
    loadPostgresPersistenceConfigFromEnvMock.mockReturnValue({
      connectionString: 'postgresql://recon:recon@localhost:5432/reconciliation_platform',
      max: 5,
      idleTimeoutMillis: 1000,
      statementTimeoutMillis: 2000,
    });
    poolQueryMock.mockResolvedValue({ rows: [{ rolsuper: false, rolbypassrls: true }] });

    const { createServerRuntime } = await import('../src/server');

    await expect(createServerRuntime()).rejects.toThrow(/bypasses row-level security/);
  });
});
