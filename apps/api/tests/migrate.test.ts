import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flushEntryPoint = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

describe('migrate entrypoint', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('@recon/persistence');
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('runs migrations and closes the pool when config is available', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const createPostgresPool = vi.fn(() => ({ end }));
    const runPostgresMigrations = vi.fn().mockResolvedValue(undefined);
    const loadPostgresPersistenceConfigFromEnv = vi
      .fn()
      .mockReturnValue({ connectionString: 'postgres://localhost/test' });

    vi.doMock('@recon/persistence', () => ({
      createPostgresPool,
      runPostgresMigrations,
      loadPostgresPersistenceConfigFromEnv,
    }));

    await import('../src/migrate');
    await flushEntryPoint();

    expect(loadPostgresPersistenceConfigFromEnv).toHaveBeenCalledTimes(1);
    expect(createPostgresPool).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost/test',
    });
    expect(runPostgresMigrations).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(process.exitCode).not.toBe(1);
  });

  it('sets process exit code when DATABASE_URL is missing', async () => {
    const createPostgresPool = vi.fn();
    const runPostgresMigrations = vi.fn();
    const loadPostgresPersistenceConfigFromEnv = vi.fn().mockReturnValue(null);

    vi.doMock('@recon/persistence', () => ({
      createPostgresPool,
      runPostgresMigrations,
      loadPostgresPersistenceConfigFromEnv,
    }));

    await import('../src/migrate');
    await flushEntryPoint();

    expect(loadPostgresPersistenceConfigFromEnv).toHaveBeenCalledTimes(1);
    expect(createPostgresPool).not.toHaveBeenCalled();
    expect(runPostgresMigrations).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('still closes the pool and sets exit code when migration execution fails', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const createPostgresPool = vi.fn(() => ({ end }));
    const runPostgresMigrations = vi.fn().mockRejectedValue(new Error('migration failure'));
    const loadPostgresPersistenceConfigFromEnv = vi
      .fn()
      .mockReturnValue({ connectionString: 'postgres://localhost/test' });

    vi.doMock('@recon/persistence', () => ({
      createPostgresPool,
      runPostgresMigrations,
      loadPostgresPersistenceConfigFromEnv,
    }));

    await import('../src/migrate');
    await flushEntryPoint();

    expect(runPostgresMigrations).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
