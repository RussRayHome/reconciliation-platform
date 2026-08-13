import { Queue, Worker, type Job } from 'bullmq';
import type pino from 'pino';

/**
 * Own queue, deliberately separate from reconciliationQueue.ts's `createReconciliationQueue`
 * (File Imports & Validation product decision: "we should use the best queuing tool" resolved to
 * BullMQ, but as its own queue rather than sharing the existing reconciliation queue's job type/
 * connection config) -- same shape as that factory (enabled/redisUrl fallback, a resultCache for
 * polling, worker concurrency), duplicated rather than genericized so this feature's queue can
 * evolve independently without risking the existing, already-relied-upon reconciliation queue.
 */
export type QueuedImportValidationJobPayload = {
  organizationId: string;
  runId: string;
  importJobId: string;
};

export type QueuedImportValidationResult = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  passed?: boolean;
  matchingJobId?: string;
  failedAt?: string;
  reason?: string;
};

type BullMqConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
};

type ImportValidationQueueOptions = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  concurrency: number;
  logger: pino.Logger;
  processJob: (
    payload: QueuedImportValidationJobPayload,
  ) => Promise<QueuedImportValidationResult>;
};

type ImportValidationQueue = {
  enabled: boolean;
  enqueue: (
    payload: QueuedImportValidationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedImportValidationResult | undefined>;
  close: () => Promise<void>;
};

const resolveConnectionOptions = (redisUrl: string): BullMqConnectionOptions => {
  const parsed = new URL(redisUrl);
  const parsedPort = Number(parsed.port);
  const dbValue = Number(parsed.pathname.replace('/', ''));

  return {
    host: parsed.hostname,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(dbValue) && dbValue >= 0 ? dbValue : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
};

const resolveResultFromJob = async (
  job: Job<QueuedImportValidationJobPayload, QueuedImportValidationResult> | undefined,
  cached: QueuedImportValidationResult | undefined,
): Promise<QueuedImportValidationResult | undefined> => {
  if (!job) {
    return cached;
  }

  const state = await job.getState();
  if (state === 'active') {
    return { status: 'processing' };
  }

  if (state === 'failed') {
    return {
      status: 'failed',
      failedAt: cached?.failedAt,
      reason: job.failedReason ?? cached?.reason ?? 'Queued import validation failed',
    };
  }

  if (state === 'completed') {
    return (job.returnvalue as QueuedImportValidationResult | undefined) ?? cached;
  }

  return { status: 'queued' };
};

export const createImportValidationQueue = (
  options: ImportValidationQueueOptions,
): ImportValidationQueue => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'import-validation.queue.disabled', reason: 'ENABLE_IMPORT_VALIDATION_QUEUE=false' },
      'Import validation queue disabled',
    );

    return {
      enabled: false,
      enqueue: () => Promise.reject(new Error('Import validation queue is disabled.')),
      getStatus: () => Promise.resolve(undefined),
      close: () => Promise.resolve(),
    };
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'import-validation.queue.disabled', reason: 'missing_redis_url' },
      'Import validation queue requested but no Redis URL was configured',
    );

    return {
      enabled: false,
      enqueue: () =>
        Promise.reject(new Error('Import validation queue requires IMPORT_VALIDATION_QUEUE_REDIS_URL.')),
      getStatus: () => Promise.resolve(undefined),
      close: () => Promise.resolve(),
    };
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queue = new Queue<QueuedImportValidationJobPayload>(options.queueName, {
    connection,
    prefix: options.prefix,
  });
  const resultCache = new Map<string, QueuedImportValidationResult>();

  const worker = new Worker<QueuedImportValidationJobPayload, QueuedImportValidationResult>(
    options.queueName,
    async (job) => {
      const jobId = String(job.id);
      resultCache.set(jobId, { status: 'processing' });

      try {
        const result = await options.processJob(job.data);
        resultCache.set(jobId, result);
        return result;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unexpected import validation worker failure';
        const failedResult: QueuedImportValidationResult = {
          status: 'failed',
          failedAt: new Date().toISOString(),
          reason,
        };
        resultCache.set(jobId, failedResult);
        throw error;
      }
    },
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
    },
  );

  worker.on('error', (error) => {
    options.logger.error(
      { action: 'import-validation.queue.worker.error', err: error },
      'Import validation queue worker error',
    );
  });

  worker.on('failed', (job, error) => {
    const jobId = job?.id ? String(job.id) : 'unknown';
    const cached = job?.id ? resultCache.get(String(job.id)) : undefined;

    resultCache.set(jobId, {
      status: 'failed',
      failedAt: cached?.failedAt ?? new Date().toISOString(),
      reason: error.message,
    });
  });

  options.logger.info(
    {
      action: 'import-validation.queue.enabled',
      queueName: options.queueName,
      prefix: options.prefix,
      concurrency: options.concurrency,
    },
    'Import validation queue enabled',
  );

  return {
    enabled: true,
    enqueue: async (payload) => {
      const job = await queue.add('import-validation-run', payload, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });

      const jobId = String(job.id);
      resultCache.set(jobId, { status: 'queued' });

      return { jobId, status: 'queued' };
    },
    getStatus: async (jobId) => {
      const cached = resultCache.get(jobId);
      const job = await queue.getJob(jobId);
      const resolved = await resolveResultFromJob(job, cached);

      if (resolved) {
        resultCache.set(jobId, resolved);
      }

      return resolved;
    },
    close: async () => {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      resultCache.clear();
    },
  };
};
