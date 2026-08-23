import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for a real bug found while adding queue retry/dead-letter support: every
 * reconciliation failure past `registerLifecycleJob` (app.ts) previously left its Postgres
 * lifecycle row stuck "in progress" forever, because `persistenceJobId` was only ever assigned
 * from a *successful* `runReconciliationWorkflow` return -- a failure never reached that `return`,
 * so `handleFailedReconciliationRun`'s `markFailed` call was silently a no-op. Fixed by having
 * `runReconciliationWorkflow` throw `ReconciliationWorkflowError` (carrying the row's id) instead
 * of a bare error for any failure after the row is created. These tests exercise the actual
 * `worker.ts` consumer closure (not a stand-in), asserting the closure both (a) extracts
 * `persistenceJobId` from that error correctly and (b) rethrows so BullMQ can retry.
 */

const bullmqConsumerState = vi.hoisted(() => ({
  reconciliationProcessJob: null as
    | ((payload: unknown, onStep: (message: string, details?: unknown) => Promise<void>) => Promise<unknown>)
    | null,
}));

vi.mock('@recon/persistence', () => ({
  isPostgresPersistenceEnabled: () => false,
  loadPostgresPersistenceConfigFromEnv: vi.fn(),
  createPostgresPool: vi.fn(),
  PostgresReconciliationLifecycleStore: class {},
}));

class FakeReconciliationFileValidationError extends Error {
  bankIssues: unknown[] = [];
  glIssues: unknown[] = [];
  constructor() {
    super('Uploaded files failed File Validation.');
    this.name = 'ReconciliationFileValidationError';
  }
}

class FakeReconciliationWorkflowError extends Error {
  constructor(
    message: string,
    public readonly persistenceJobId: string,
  ) {
    super(message);
    this.name = 'ReconciliationWorkflowError';
  }
}

const appMocks = vi.hoisted(() => ({
  runReconciliationWorkflow: vi.fn(),
  handleFailedReconciliationRun: vi.fn().mockResolvedValue(undefined),
  recordSuccessfulReconciliationRun: vi.fn(),
  processImportValidationJob: vi.fn(),
  sanitizeRun: vi.fn((run: unknown) => run),
  resolveReconciliationQueueConfiguration: vi.fn(() => ({
    enabled: true,
    redisUrl: 'redis://localhost:6379/1',
    queueName: 'reconciliation-runs',
    prefix: 'recon',
    concurrency: 1,
    maxAttempts: 5,
    backoffDelayMs: 5000,
  })),
  resolveImportValidationQueueConfiguration: vi.fn(() => ({
    enabled: false,
    redisUrl: null,
    queueName: 'import-validation-runs',
    prefix: 'recon',
    concurrency: 1,
    maxAttempts: 5,
    backoffDelayMs: 5000,
  })),
}));

vi.mock('../src/app', () => ({
  ...appMocks,
  ReconciliationFileValidationError: FakeReconciliationFileValidationError,
  ReconciliationWorkflowError: FakeReconciliationWorkflowError,
  fromQueuedReconciliationFiles: (files: unknown) => files,
}));

vi.mock('../src/server', () => ({
  assertRuntimeRoleIsNotPrivileged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/telemetry', () => ({
  startTelemetry: vi.fn(),
  stopTelemetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/sentry', () => ({
  captureApiException: vi.fn(),
  flushApiSentry: vi.fn().mockResolvedValue(undefined),
  initializeApiSentry: vi.fn(),
}));

vi.mock('../src/services/runRepository', () => ({
  FileBackedRunRepository: class {
    save = vi.fn();
  },
}));

vi.mock('../src/services/reconciliationQueue', () => ({
  createReconciliationConsumer: vi.fn((options: { processJob: typeof bullmqConsumerState.reconciliationProcessJob }) => {
    bullmqConsumerState.reconciliationProcessJob = options.processJob;
    return { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../src/services/importValidationQueue', () => ({
  createImportValidationConsumer: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

const samplePayload = {
  requestId: 'req-1',
  organizationId: 'org-1',
  body: { accountIdentifier: 'OPERATING-001' },
  files: {
    bankFile: { originalname: 'bank.xlsx', mimetype: 'application/vnd.ms-excel', buffer: 'YmFuaw==' },
    glFile: { originalname: 'gl.xlsx', mimetype: 'application/vnd.ms-excel', buffer: 'cWJv' },
  },
};

describe('worker.ts reconciliation processJob', () => {
  beforeEach(() => {
    bullmqConsumerState.reconciliationProcessJob = null;
    appMocks.runReconciliationWorkflow.mockReset();
    appMocks.handleFailedReconciliationRun.mockReset().mockResolvedValue(undefined);
    appMocks.recordSuccessfulReconciliationRun.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('marks the correct lifecycle row failed and rethrows when the workflow fails after the row was created', async () => {
    const { createWorkerRuntime } = await import('../src/worker');
    appMocks.runReconciliationWorkflow.mockRejectedValue(
      new FakeReconciliationWorkflowError('DB connection refused', 'run-abc-123'),
    );

    await createWorkerRuntime();
    expect(bullmqConsumerState.reconciliationProcessJob).toBeTypeOf('function');

    await expect(
      bullmqConsumerState.reconciliationProcessJob?.(samplePayload, vi.fn()),
    ).rejects.toThrow('DB connection refused');

    // The load-bearing assertion: persistenceJobId must be the real row id from the thrown error,
    // not undefined -- this is exactly the bug that left rows stuck "in progress" forever.
    expect(appMocks.handleFailedReconciliationRun).toHaveBeenCalledWith(
      expect.objectContaining({ persistenceJobId: 'run-abc-123' }),
    );
  });

  it('does not call handleFailedReconciliationRun or rethrow for an expected File Validation failure', async () => {
    const { createWorkerRuntime } = await import('../src/worker');
    appMocks.runReconciliationWorkflow.mockRejectedValue(new FakeReconciliationFileValidationError());

    await createWorkerRuntime();

    const result = await bullmqConsumerState.reconciliationProcessJob?.(samplePayload, vi.fn());
    expect(result).toEqual(
      expect.objectContaining({ status: 'failed', reason: expect.stringContaining('File Validation') }),
    );
    expect(appMocks.handleFailedReconciliationRun).not.toHaveBeenCalled();
  });

  it('passes persistenceJobId: undefined (not a stale value) when the thrown error carries none', async () => {
    const { createWorkerRuntime } = await import('../src/worker');
    appMocks.runReconciliationWorkflow.mockRejectedValue(new Error('totally unexpected crash'));

    await createWorkerRuntime();

    await expect(
      bullmqConsumerState.reconciliationProcessJob?.(samplePayload, vi.fn()),
    ).rejects.toThrow('totally unexpected crash');

    expect(appMocks.handleFailedReconciliationRun).toHaveBeenCalledWith(
      expect.objectContaining({ persistenceJobId: undefined }),
    );
  });
});
