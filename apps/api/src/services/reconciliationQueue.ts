import type { ReconciliationRunReport } from '@recon/domain';
import { Queue, Worker, type Job } from 'bullmq';
import type pino from 'pino';

export type QueuedReconciliationFilePayload = {
  originalname: string;
  mimetype: string;
  buffer: string;
};

export type QueuedReconciliationJobPayload = {
  requestId: string;
  organizationId: string;
  body: Record<string, unknown>;
  files: {
    bankFile: QueuedReconciliationFilePayload;
    glFile: QueuedReconciliationFilePayload;
  };
};

export type QueuedReconciliationResult = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  runId?: string;
  run?: ReconciliationRunReport;
  failedAt?: string;
  reason?: string;
};

type PersistedQueuedReconciliationResult = Omit<QueuedReconciliationResult, 'run'>;

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

type ReconciliationQueueOptions = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  concurrency: number;
  logger: pino.Logger;
  processJob: (payload: QueuedReconciliationJobPayload) => Promise<QueuedReconciliationResult>;
};

type ReconciliationQueue = {
  enabled: boolean;
  enqueue: (
    payload: QueuedReconciliationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedReconciliationResult | undefined>;
  close: () => Promise<void>;
};

const toPersistedResult = (
  result: QueuedReconciliationResult,
): PersistedQueuedReconciliationResult => ({
  status: result.status,
  runId: result.runId,
  failedAt: result.failedAt,
  reason: result.reason,
});

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
  job: Job<QueuedReconciliationJobPayload, PersistedQueuedReconciliationResult> | undefined,
  cached: QueuedReconciliationResult | undefined,
): Promise<QueuedReconciliationResult | undefined> => {
  if (!job) {
    return cached;
  }

  const state = await job.getState();
  if (state === 'active') {
    return { status: 'processing', runId: cached?.runId, run: cached?.run };
  }

  if (state === 'failed') {
    return {
      status: 'failed',
      runId: cached?.runId,
      failedAt: cached?.failedAt,
      reason: job.failedReason ?? cached?.reason ?? 'Queued reconciliation failed',
    };
  }

  if (state === 'completed') {
    const persisted = (job.returnvalue ?? {}) as PersistedQueuedReconciliationResult;
    return {
      status: 'completed',
      runId: persisted.runId ?? cached?.runId,
      run: cached?.run,
      failedAt: persisted.failedAt ?? cached?.failedAt,
      reason: persisted.reason ?? cached?.reason,
    };
  }

  return { status: 'queued', runId: cached?.runId, run: cached?.run };
};

export const createReconciliationQueue = (
  options: ReconciliationQueueOptions,
): ReconciliationQueue => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'reconciliation.queue.disabled', reason: 'ENABLE_RECONCILIATION_QUEUE=false' },
      'Reconciliation queue disabled',
    );

    return {
      enabled: false,
      enqueue: () => Promise.reject(new Error('Reconciliation queue is disabled.')),
      getStatus: () => Promise.resolve(undefined),
      close: () => Promise.resolve(),
    };
  }

  if (!options.redisUrl) {
    options.logger.warn(
      {
        action: 'reconciliation.queue.disabled',
        reason: 'missing_redis_url',
      },
      'Reconciliation queue requested but no Redis URL was configured',
    );

    return {
      enabled: false,
      enqueue: () =>
        Promise.reject(new Error('Reconciliation queue requires RECONCILIATION_QUEUE_REDIS_URL.')),
      getStatus: () => Promise.resolve(undefined),
      close: () => Promise.resolve(),
    };
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queue = new Queue<QueuedReconciliationJobPayload>(options.queueName, {
    connection,
    prefix: options.prefix,
  });
  const resultCache = new Map<string, QueuedReconciliationResult>();

  const worker = new Worker<QueuedReconciliationJobPayload, PersistedQueuedReconciliationResult>(
    options.queueName,
    async (job) => {
      const jobId = String(job.id);
      resultCache.set(jobId, { status: 'processing' });

      try {
        const result = await options.processJob(job.data);
        resultCache.set(jobId, result);
        return toPersistedResult(result);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unexpected reconciliation queue worker failure';
        const failedResult: QueuedReconciliationResult = {
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
      { action: 'reconciliation.queue.worker.error', err: error },
      'Reconciliation queue worker error',
    );
  });

  worker.on('failed', (job, error) => {
    const jobId = job?.id ? String(job.id) : 'unknown';
    const cached = job?.id ? resultCache.get(String(job.id)) : undefined;

    resultCache.set(jobId, {
      status: 'failed',
      runId: cached?.runId,
      run: cached?.run,
      failedAt: cached?.failedAt ?? new Date().toISOString(),
      reason: error.message,
    });
  });

  options.logger.info(
    {
      action: 'reconciliation.queue.enabled',
      queueName: options.queueName,
      prefix: options.prefix,
      concurrency: options.concurrency,
    },
    'Reconciliation queue enabled',
  );

  return {
    enabled: true,
    enqueue: async (payload) => {
      const job = await queue.add('reconciliation-run', payload, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });

      const jobId = String(job.id);
      resultCache.set(jobId, { status: 'queued' });

      return {
        jobId,
        status: 'queued',
      };
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
