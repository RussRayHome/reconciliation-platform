import { beforeEach, describe, expect, it, vi } from 'vitest';

const bullmqState = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  queueClose: vi.fn(() => Promise.resolve(undefined)),
  workerRun: vi.fn(() => Promise.resolve(undefined)),
  workerClose: vi.fn(() => Promise.resolve(undefined)),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  processor: null as
    | ((job: { id: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>)
    | null,
  lastWorkerOptions: null as Record<string, unknown> | null,
  // Tracks every `new Queue(name, ...)` call, in construction order -- lets tests assert the
  // dead-letter queue was actually constructed with the expected `${queueName}-dlq` name, without
  // needing separate mock instances per queue (each describe block below only ever exercises one
  // queue "role" at a time -- the producer's primary queue, or the consumer's DLQ -- so the single
  // shared `add`/`getJob` mocks stay unambiguous).
  queueNames: [] as string[],
}));

vi.mock('bullmq', () => {
  class Queue {
    add = bullmqState.add;
    getJob = bullmqState.getJob;
    close = bullmqState.queueClose;

    constructor(name: string) {
      bullmqState.queueNames.push(name);
    }
  }

  class Worker {
    run = bullmqState.workerRun;
    close = bullmqState.workerClose;

    constructor(
      _name: string,
      processor: (job: {
        id: string;
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>,
      options: Record<string, unknown>,
    ) {
      bullmqState.processor = processor;
      bullmqState.lastWorkerOptions = options;
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      bullmqState.handlers.set(event, handler);
      return this;
    }
  }

  return {
    Queue,
    Worker,
  };
});

import {
  createReconciliationConsumer,
  createReconciliationProducer,
} from '../src/services/reconciliationQueue';

const samplePayload = {
  requestId: 'req-1',
  organizationId: 'org-1',
  body: { accountIdentifier: 'OPERATING-001' },
  files: {
    bankFile: {
      originalname: 'bank.xlsx',
      mimetype: 'application/vnd.ms-excel',
      buffer: 'YmFuaw==',
    },
    glFile: { originalname: 'gl.xlsx', mimetype: 'application/vnd.ms-excel', buffer: 'cWJv' },
  },
};

describe('reconciliationQueue producer', () => {
  beforeEach(() => {
    bullmqState.add.mockReset();
    bullmqState.getJob.mockReset();
    bullmqState.queueClose.mockReset();
    bullmqState.queueClose.mockResolvedValue(undefined);
    bullmqState.queueNames.length = 0;
  });

  it('returns disabled producer behavior when queue feature flag is off', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const producer = createReconciliationProducer({
      enabled: false,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      logger: logger as never,
      maxAttempts: 5,
      backoffDelayMs: 5000,
    });

    expect(producer.enabled).toBe(false);
    await expect(producer.enqueue(samplePayload)).rejects.toThrow('disabled');
    await expect(producer.getStatus('job-1')).resolves.toBeUndefined();
    await expect(producer.close()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it('returns disabled producer behavior when redis URL is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const producer = createReconciliationProducer({
      enabled: true,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      logger: logger as never,
      maxAttempts: 5,
      backoffDelayMs: 5000,
    });

    expect(producer.enabled).toBe(false);
    await expect(producer.enqueue(samplePayload)).rejects.toThrow('RECONCILIATION_QUEUE_REDIS_URL');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('enqueues jobs with the configured retry/backoff policy and resolves status purely from BullMQ-reported job state', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bullmqState.add.mockResolvedValue({ id: 'job-7' });

    const producer = createReconciliationProducer({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/2',
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      logger: logger as never,
      maxAttempts: 5,
      backoffDelayMs: 5000,
    });

    expect(producer.enabled).toBe(true);
    expect(logger.info).toHaveBeenCalled();

    await expect(producer.enqueue(samplePayload)).resolves.toEqual({
      jobId: 'job-7',
      status: 'queued',
    });
    expect(bullmqState.add).toHaveBeenCalledWith(
      'reconciliation-run',
      samplePayload,
      expect.objectContaining({
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );

    // No in-process result cache (Issue #134 phase 1): status resolves purely from what
    // `queue.getJob` reports. Real BullMQ's `add()` persists to Redis synchronously, so a
    // just-enqueued job is immediately visible as `waiting`, not absent -- unlike this mock,
    // which only returns whatever the test tells it to per call.
    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('waiting'),
    });
    await expect(producer.getStatus('job-7')).resolves.toEqual({ status: 'queued' });

    bullmqState.getJob.mockResolvedValueOnce(undefined);
    await expect(producer.getStatus('job-missing')).resolves.toBeUndefined();

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
    });
    await expect(producer.getStatus('job-7')).resolves.toEqual({ status: 'processing' });

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: 'worker failed',
    });
    await expect(producer.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'failed', reason: 'worker failed' }),
    );

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { runId: 'run-77' },
    });
    await expect(producer.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'completed', runId: 'run-77' }),
    );

    bullmqState.queueClose.mockRejectedValueOnce(new Error('close queue failed'));
    await expect(producer.close()).resolves.toBeUndefined();
  });
});

describe('reconciliationQueue consumer', () => {
  beforeEach(() => {
    bullmqState.workerRun.mockReset();
    bullmqState.workerClose.mockReset();
    bullmqState.workerRun.mockResolvedValue(undefined);
    bullmqState.workerClose.mockResolvedValue(undefined);
    bullmqState.add.mockReset();
    bullmqState.add.mockResolvedValue({ id: 'dlq-job' });
    bullmqState.queueClose.mockReset();
    bullmqState.queueClose.mockResolvedValue(undefined);
    bullmqState.queueNames.length = 0;
    bullmqState.handlers.clear();
    bullmqState.processor = null;
    bullmqState.lastWorkerOptions = null;
  });

  const baseConsumerOptions = {
    enabled: true,
    redisUrl: 'rediss://user:pass@localhost:6380/2',
    queueName: 'reconciliation-runs',
    prefix: 'recon',
    concurrency: 2,
    maxAttempts: 5,
    backoffDelayMs: 5000,
  };

  it('returns a no-op consumer when the queue feature flag is off', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const consumer = createReconciliationConsumer({
      enabled: false,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      concurrency: 1,
      maxAttempts: 5,
      backoffDelayMs: 5000,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(() => consumer.start()).not.toThrow();
    await expect(consumer.stop()).resolves.toBeUndefined();
    expect(bullmqState.processor).toBeNull();
  });

  it('returns a no-op consumer when the redis URL is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const consumer = createReconciliationConsumer({
      enabled: true,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      concurrency: 1,
      maxAttempts: 5,
      backoffDelayMs: 5000,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(() => consumer.start()).not.toThrow();
    await expect(consumer.stop()).resolves.toBeUndefined();
    expect(bullmqState.processor).toBeNull();
  });

  it('constructs a dead-letter queue named `${queueName}-dlq` alongside the Worker', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(bullmqState.queueNames).toContain('reconciliation-runs-dlq');
  });

  it('builds the Worker with autorun disabled, processes jobs, and logs worker/job errors', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const processJob = vi
      .fn()
      .mockResolvedValueOnce({ status: 'completed', runId: 'run-success' })
      .mockRejectedValueOnce(new Error('processor boom'));

    const consumer = createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob,
    });

    expect(bullmqState.lastWorkerOptions).toEqual(
      expect.objectContaining({ concurrency: 2, autorun: false }),
    );

    consumer.start();
    expect(bullmqState.workerRun).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalled();

    const workerProcessor = bullmqState.processor;
    expect(workerProcessor).not.toBeNull();

    const persistedSuccess = await workerProcessor?.({ id: 'job-success', data: samplePayload });
    expect(persistedSuccess).toEqual(
      expect.objectContaining({ status: 'completed', runId: 'run-success' }),
    );

    await expect(workerProcessor?.({ id: 'job-fail', data: samplePayload })).rejects.toThrow(
      'processor boom',
    );

    const errorHandler = bullmqState.handlers.get('error');
    errorHandler?.(new Error('worker error'));
    expect(logger.error).toHaveBeenCalled();

    logger.error.mockClear();
    const failedHandler = bullmqState.handlers.get('failed');
    failedHandler?.(
      { id: 'job-handler', data: samplePayload, isFailed: vi.fn().mockResolvedValue(false) },
      new Error('handler-failure'),
    );
    failedHandler?.(undefined, new Error('unknown-failure'));
    expect(logger.error).toHaveBeenCalledTimes(2);

    bullmqState.workerClose.mockRejectedValueOnce(new Error('close worker failed'));
    await expect(consumer.stop()).resolves.toBeUndefined();
    // stop() closes both the Worker and the dead-letter Queue.
    expect(bullmqState.queueClose).toHaveBeenCalled();
  });

  it('moves a job to the dead-letter queue once BullMQ reports it as genuinely, terminally failed', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob: vi.fn(),
    });

    const failedHandler = bullmqState.handlers.get('failed');
    const job = {
      id: 'job-exhausted',
      data: samplePayload,
      attemptsMade: 5,
      failedReason: 'DB connection refused',
      isFailed: vi.fn().mockResolvedValue(true),
    };

    failedHandler?.(job, new Error('DB connection refused'));
    // isFailed() resolves asynchronously -- let its .then() chain run before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(bullmqState.add).toHaveBeenCalledWith(
      'dead-letter',
      expect.objectContaining({
        originalPayload: samplePayload,
        originalJobId: 'job-exhausted',
        failedReason: 'DB connection refused',
        attemptsMade: 5,
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reconciliation.queue.job.dead-lettered' }),
      expect.any(String),
    );
  });

  it('does not dead-letter a job that failed an attempt but still has retries remaining', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob: vi.fn(),
    });

    const failedHandler = bullmqState.handlers.get('failed');
    const job = {
      id: 'job-retrying',
      data: samplePayload,
      attemptsMade: 2,
      failedReason: 'transient error',
      isFailed: vi.fn().mockResolvedValue(false),
    };

    failedHandler?.(job, new Error('transient error'));
    await Promise.resolve();
    await Promise.resolve();

    expect(bullmqState.add).not.toHaveBeenCalled();
  });

  it('logs a warning when BullMQ reports a stalled job', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob: vi.fn(),
    });

    const stalledHandler = bullmqState.handlers.get('stalled');
    stalledHandler?.('job-stalled');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reconciliation.queue.job.stalled', jobId: 'job-stalled' }),
      expect.any(String),
    );
  });

  it('Issue #154: passes an onStep to processJob that publishes via Job.updateProgress', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let capturedOnStep:
      ((message: string, details?: Record<string, unknown>) => Promise<void>) | undefined;
    const processJob = vi.fn().mockImplementation((_payload, onStep) => {
      capturedOnStep = onStep;
      return Promise.resolve({ status: 'completed', runId: 'run-success' });
    });

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob,
    });

    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const workerProcessor = bullmqState.processor;
    await workerProcessor?.({ id: 'job-progress', data: samplePayload, updateProgress } as never);

    expect(capturedOnStep).toBeTypeOf('function');
    await capturedOnStep?.('Reconciliation started', { step: 1 });

    expect(updateProgress).toHaveBeenCalledWith({
      organizationId: samplePayload.organizationId,
      processId: samplePayload.requestId,
      queueType: 'reconciliation',
      statusMessage: 'Reconciliation started',
      details: { step: 1 },
    });
  });

  it('Issue #154: onStep never rejects even if Job.updateProgress fails', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let capturedOnStep:
      ((message: string, details?: Record<string, unknown>) => Promise<void>) | undefined;
    const processJob = vi.fn().mockImplementation((_payload, onStep) => {
      capturedOnStep = onStep;
      return Promise.resolve({ status: 'completed', runId: 'run-success' });
    });

    createReconciliationConsumer({
      ...baseConsumerOptions,
      logger: logger as never,
      processJob,
    });

    const updateProgress = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const workerProcessor = bullmqState.processor;
    await workerProcessor?.({ id: 'job-progress', data: samplePayload, updateProgress } as never);

    await expect(capturedOnStep?.('Reconciliation started')).resolves.toBeUndefined();
  });
});
