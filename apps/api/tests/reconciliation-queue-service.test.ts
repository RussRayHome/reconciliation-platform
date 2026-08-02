import { beforeEach, describe, expect, it, vi } from 'vitest';

const bullmqState = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  queueClose: vi.fn(() => Promise.resolve(undefined)),
  workerClose: vi.fn(() => Promise.resolve(undefined)),
  handlers: new Map<string, (...args: unknown[]) => void>(),
  processor: null as
    | ((job: { id: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>)
    | null,
}));

vi.mock('bullmq', () => {
  class Queue {
    add = bullmqState.add;
    getJob = bullmqState.getJob;
    close = bullmqState.queueClose;
  }

  class Worker {
    close = bullmqState.workerClose;

    constructor(
      _name: string,
      processor: (job: {
        id: string;
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>,
    ) {
      bullmqState.processor = processor;
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

import { createReconciliationQueue } from '../src/services/reconciliationQueue';

const samplePayload = {
  requestId: 'req-1',
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

describe('reconciliationQueue service', () => {
  beforeEach(() => {
    bullmqState.add.mockReset();
    bullmqState.getJob.mockReset();
    bullmqState.queueClose.mockReset();
    bullmqState.workerClose.mockReset();
    bullmqState.queueClose.mockResolvedValue(undefined);
    bullmqState.workerClose.mockResolvedValue(undefined);
    bullmqState.handlers.clear();
    bullmqState.processor = null;
  });

  it('returns disabled queue behavior when queue feature flag is off', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const queue = createReconciliationQueue({
      enabled: false,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      concurrency: 1,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(queue.enabled).toBe(false);
    await expect(queue.enqueue(samplePayload)).rejects.toThrow('disabled');
    await expect(queue.getStatus('job-1')).resolves.toBeUndefined();
    await expect(queue.close()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it('returns disabled queue behavior when redis URL is missing', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const queue = createReconciliationQueue({
      enabled: true,
      redisUrl: null,
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      concurrency: 1,
      logger: logger as never,
      processJob: vi.fn(),
    });

    expect(queue.enabled).toBe(false);
    await expect(queue.enqueue(samplePayload)).rejects.toThrow('RECONCILIATION_QUEUE_REDIS_URL');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('handles queue/job states, worker handlers, and close cleanup for enabled queue mode', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const processJob = vi
      .fn()
      .mockResolvedValueOnce({ status: 'completed', runId: 'run-success' })
      .mockRejectedValueOnce(new Error('processor boom'));

    bullmqState.add.mockResolvedValue({ id: 'job-7' });

    const queue = createReconciliationQueue({
      enabled: true,
      redisUrl: 'rediss://user:pass@localhost:6380/2',
      queueName: 'reconciliation-runs',
      prefix: 'recon',
      concurrency: 2,
      logger: logger as never,
      processJob,
    });

    expect(queue.enabled).toBe(true);
    expect(logger.info).toHaveBeenCalled();

    await expect(queue.enqueue(samplePayload)).resolves.toEqual({
      jobId: 'job-7',
      status: 'queued',
    });
    expect(bullmqState.add).toHaveBeenCalledWith(
      'reconciliation-run',
      samplePayload,
      expect.objectContaining({
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      }),
    );

    bullmqState.getJob.mockResolvedValueOnce(undefined);
    await expect(queue.getStatus('job-7')).resolves.toEqual({ status: 'queued' });

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
    });
    await expect(queue.getStatus('job-7')).resolves.toEqual({ status: 'processing' });

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: 'worker failed',
    });
    await expect(queue.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'failed', reason: 'worker failed' }),
    );

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      returnvalue: { runId: 'run-77' },
    });
    await expect(queue.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'completed', runId: 'run-77' }),
    );

    bullmqState.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('waiting'),
    });
    await expect(queue.getStatus('job-7')).resolves.toEqual(
      expect.objectContaining({ status: 'queued' }),
    );

    const workerProcessor = bullmqState.processor;
    expect(workerProcessor).not.toBeNull();

    const persistedSuccess = await workerProcessor?.({ id: 'job-success', data: samplePayload });
    expect(persistedSuccess).toEqual(
      expect.objectContaining({
        status: 'completed',
        runId: 'run-success',
      }),
    );

    await expect(workerProcessor?.({ id: 'job-fail', data: samplePayload })).rejects.toThrow(
      'processor boom',
    );

    bullmqState.getJob.mockResolvedValueOnce(undefined);
    await expect(queue.getStatus('job-fail')).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'processor boom',
      }),
    );

    const errorHandler = bullmqState.handlers.get('error');
    errorHandler?.(new Error('worker error'));
    expect(logger.error).toHaveBeenCalled();

    const failedHandler = bullmqState.handlers.get('failed');
    failedHandler?.({ id: 'job-handler' }, new Error('handler-failure'));
    failedHandler?.(undefined, new Error('unknown-failure'));

    bullmqState.getJob.mockResolvedValueOnce(undefined);
    await expect(queue.getStatus('job-handler')).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'handler-failure',
      }),
    );

    bullmqState.workerClose.mockRejectedValueOnce(new Error('close worker failed'));
    bullmqState.queueClose.mockRejectedValueOnce(new Error('close queue failed'));
    await expect(queue.close()).resolves.toBeUndefined();
  });
});
