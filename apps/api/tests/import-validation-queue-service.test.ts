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
}));

vi.mock('bullmq', () => {
  class Queue {
    add = bullmqState.add;
    getJob = bullmqState.getJob;
    close = bullmqState.queueClose;
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
  createImportValidationConsumer,
  createImportValidationProducer,
} from '../src/services/importValidationQueue';

const samplePayload = {
  organizationId: 'org-1',
  runId: 'run-1',
  importJobId: 'import-1',
  sessionId: 'session-1',
};

describe('importValidationQueue producer', () => {
  beforeEach(() => {
    bullmqState.add.mockReset();
    bullmqState.getJob.mockReset();
    bullmqState.queueClose.mockReset();
    bullmqState.queueClose.mockResolvedValue(undefined);
  });

  it('returns disabled producer behavior when queue feature flag is off', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const producer = createImportValidationProducer({
      enabled: false,
      redisUrl: null,
      queueName: 'import-validation-runs',
      prefix: 'import',
      logger: logger as never,
    });

    expect(producer.enabled).toBe(false);
    await expect(producer.enqueue(samplePayload)).rejects.toThrow('disabled');
    await expect(producer.getStatus('job-1')).resolves.toBeUndefined();
    await expect(producer.close()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it('returns disabled producer behavior when redis URL is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const producer = createImportValidationProducer({
      enabled: true,
      redisUrl: null,
      queueName: 'import-validation-runs',
      prefix: 'import',
      logger: logger as never,
    });

    expect(producer.enabled).toBe(false);
    await expect(producer.enqueue(samplePayload)).rejects.toThrow(
      'IMPORT_VALIDATION_QUEUE_REDIS_URL',
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('enqueues jobs and resolves status purely from BullMQ-reported job state', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    bullmqState.add.mockResolvedValue({ id: 'job-7' });

    const producer = createImportValidationProducer({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/3',
      queueName: 'import-validation-runs',
      prefix: 'import',
      logger: logger as never,
    });

    expect(producer.enabled).toBe(true);
    expect(logger.info).toHaveBeenCalled();

    await expect(producer.enqueue(samplePayload)).resolves.toEqual({
      jobId: 'job-7',
      status: 'queued',
    });
    expect(bullmqState.add).toHaveBeenCalledWith(
      'import-validation-run',
      samplePayload,
      expect.objectContaining({
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      }),
    );

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
      returnvalue: { status: 'completed', passed: true, matchingJobId: 'match-77' },
    });
    await expect(producer.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'completed', passed: true, matchingJobId: 'match-77' }),
    );

    bullmqState.queueClose.mockRejectedValueOnce(new Error('close queue failed'));
    await expect(producer.close()).resolves.toBeUndefined();
  });
});

describe('importValidationQueue consumer', () => {
  beforeEach(() => {
    bullmqState.workerRun.mockReset();
    bullmqState.workerClose.mockReset();
    bullmqState.workerRun.mockResolvedValue(undefined);
    bullmqState.workerClose.mockResolvedValue(undefined);
    bullmqState.handlers.clear();
    bullmqState.processor = null;
    bullmqState.lastWorkerOptions = null;
  });

  it('returns a no-op consumer when the queue feature flag is off', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const consumer = createImportValidationConsumer({
      enabled: false,
      redisUrl: null,
      queueName: 'import-validation-runs',
      prefix: 'import',
      concurrency: 1,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(() => consumer.start()).not.toThrow();
    await expect(consumer.stop()).resolves.toBeUndefined();
    expect(bullmqState.processor).toBeNull();
  });

  it('returns a no-op consumer when the redis URL is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const consumer = createImportValidationConsumer({
      enabled: true,
      redisUrl: null,
      queueName: 'import-validation-runs',
      prefix: 'import',
      concurrency: 1,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(() => consumer.start()).not.toThrow();
    await expect(consumer.stop()).resolves.toBeUndefined();
    expect(bullmqState.processor).toBeNull();
  });

  it('builds the Worker with autorun disabled, processes jobs, and logs worker/job errors', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const processJob = vi
      .fn()
      .mockResolvedValueOnce({ status: 'completed', passed: true, matchingJobId: 'match-1' })
      .mockRejectedValueOnce(new Error('processor boom'));

    const consumer = createImportValidationConsumer({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/3',
      queueName: 'import-validation-runs',
      prefix: 'import',
      concurrency: 2,
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
      expect.objectContaining({ status: 'completed', passed: true, matchingJobId: 'match-1' }),
    );

    await expect(workerProcessor?.({ id: 'job-fail', data: samplePayload })).rejects.toThrow(
      'processor boom',
    );

    const errorHandler = bullmqState.handlers.get('error');
    errorHandler?.(new Error('worker error'));
    expect(logger.error).toHaveBeenCalled();

    logger.error.mockClear();
    const failedHandler = bullmqState.handlers.get('failed');
    failedHandler?.({ id: 'job-handler' }, new Error('handler-failure'));
    failedHandler?.(undefined, new Error('unknown-failure'));
    expect(logger.error).toHaveBeenCalledTimes(2);

    bullmqState.workerClose.mockRejectedValueOnce(new Error('close worker failed'));
    await expect(consumer.stop()).resolves.toBeUndefined();
  });

  it('Issue #154: passes an onStep to processJob that publishes via Job.updateProgress', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let capturedOnStep:
      ((message: string, details?: Record<string, unknown>) => Promise<void>) | undefined;
    const processJob = vi.fn().mockImplementation((_payload, onStep) => {
      capturedOnStep = onStep;
      return Promise.resolve({ status: 'completed', passed: true, matchingJobId: 'match-1' });
    });

    createImportValidationConsumer({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/3',
      queueName: 'import-validation-runs',
      prefix: 'import',
      concurrency: 2,
      logger: logger as never,
      processJob,
    });

    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const workerProcessor = bullmqState.processor;
    await workerProcessor?.({ id: 'job-progress', data: samplePayload, updateProgress } as never);

    expect(capturedOnStep).toBeTypeOf('function');
    await capturedOnStep?.('Validating uploaded files…');

    expect(updateProgress).toHaveBeenCalledWith({
      organizationId: samplePayload.organizationId,
      processId: samplePayload.runId,
      queueType: 'import-validation',
      statusMessage: 'Validating uploaded files…',
      details: undefined,
    });
  });

  it('Issue #154: onStep never rejects even if Job.updateProgress fails', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let capturedOnStep:
      ((message: string, details?: Record<string, unknown>) => Promise<void>) | undefined;
    const processJob = vi.fn().mockImplementation((_payload, onStep) => {
      capturedOnStep = onStep;
      return Promise.resolve({ status: 'completed', passed: true, matchingJobId: 'match-1' });
    });

    createImportValidationConsumer({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/3',
      queueName: 'import-validation-runs',
      prefix: 'import',
      concurrency: 2,
      logger: logger as never,
      processJob,
    });

    const updateProgress = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const workerProcessor = bullmqState.processor;
    await workerProcessor?.({ id: 'job-progress', data: samplePayload, updateProgress } as never);

    await expect(capturedOnStep?.('Validating uploaded files…')).resolves.toBeUndefined();
  });
});
