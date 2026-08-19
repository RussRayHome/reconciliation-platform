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
  /** Session id (JWT `jti`) of whoever submitted this run, so the worker -- which runs outside
   * the original request's lifecycle and has no `request.log` to inherit -- can still bind it
   * onto every log line it emits while processing the job. */
  sessionId?: string;
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

/** Shared by both the producer (`enqueue`/`getStatus`, lives wherever Express routes run) and the
 * consumer (the `Worker`, lives in its own process -- Issue #134) -- both just need to reach the
 * same Redis-backed BullMQ queue by name/prefix, nothing else. */
type ReconciliationQueueConnectionOptions = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  logger: pino.Logger;
};

export type ReconciliationQueueProducerOptions = ReconciliationQueueConnectionOptions;

export type ReconciliationQueueConsumerOptions = ReconciliationQueueConnectionOptions & {
  concurrency: number;
  processJob: (payload: QueuedReconciliationJobPayload) => Promise<QueuedReconciliationResult>;
};

export type ReconciliationQueueProducer = {
  enabled: boolean;
  enqueue: (
    payload: QueuedReconciliationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedReconciliationResult | undefined>;
  close: () => Promise<void>;
};

/** The consumer's own lifecycle is separate from construction (unlike the producer, which is
 * ready to use the moment it's returned) -- `start()` is analogous to `startServer`'s
 * `app.listen()`: fire off BullMQ's internal polling loop without awaiting it, since it only
 * resolves once the worker is closed. */
export type ReconciliationQueueConsumer = {
  start: () => void;
  stop: () => Promise<void>;
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

/**
 * Resolves a job's status entirely from BullMQ's own Redis-persisted job state (`getState()`,
 * `returnvalue`, `failedReason`) -- deliberately no in-process cache. `Queue.getJob` reads from
 * Redis regardless of which process created or is processing the job, so this is what lets the
 * producer (`enqueue`/`getStatus`, living in the API process) and consumer (the `Worker` below,
 * its own process -- Issue #134) not need to share process memory at all.
 *
 * `run` (the full `ReconciliationRunReport`) is deliberately never populated here -- it never was
 * persisted into `job.returnvalue` either (see `toPersistedResult`), and the one caller
 * (`GET /api/reconciliation/jobs/:jobId`) already has its own fallback to fetch it via
 * `loadRunReport(organizationId, runId)` once `status === 'completed'`.
 *
 * Known gap, not silently ignored: if a job is evicted from Redis before any client polls it
 * (`removeOnComplete`/`removeOnFail` below cap retention at 200/500 respectively), `queue.getJob`
 * returns `undefined` and this can no longer answer at all. Accepted for now -- closing it would
 * need a Postgres-backed fallback keyed by a pre-generated job id threaded through
 * `registerLifecycleJob`, a larger change deferred past Issue #134's Phase 1-4 scope.
 */
const resolveResultFromJob = async (
  job: Job<QueuedReconciliationJobPayload, PersistedQueuedReconciliationResult> | undefined,
): Promise<QueuedReconciliationResult | undefined> => {
  if (!job) {
    return undefined;
  }

  const state = await job.getState();
  if (state === 'active') {
    return { status: 'processing' };
  }

  if (state === 'failed') {
    return {
      status: 'failed',
      reason: job.failedReason ?? 'Queued reconciliation failed',
    };
  }

  if (state === 'completed') {
    const persisted = (job.returnvalue ?? {}) as PersistedQueuedReconciliationResult;
    return {
      status: 'completed',
      runId: persisted.runId,
      failedAt: persisted.failedAt,
      reason: persisted.reason,
    };
  }

  return { status: 'queued' };
};

const disabledProducer = (reason: string): ReconciliationQueueProducer => ({
  enabled: false,
  enqueue: () => Promise.reject(new Error(reason)),
  getStatus: () => Promise.resolve(undefined),
  close: () => Promise.resolve(),
});

const disabledConsumer = (): ReconciliationQueueConsumer => ({
  start: () => undefined,
  stop: () => Promise.resolve(),
});

/** Producer half of the reconciliation queue (Issue #134 phase 2): owns the BullMQ `Queue` only
 * -- `enqueue`/`getStatus`/`close`, everything the Express routes in app.ts need. Deliberately
 * has no knowledge of `processJob` or a `Worker` at all, so it's safe to construct in the API
 * process even once the consumer moves to its own worker process. */
export const createReconciliationProducer = (
  options: ReconciliationQueueProducerOptions,
): ReconciliationQueueProducer => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'reconciliation.queue.disabled', reason: 'ENABLE_RECONCILIATION_QUEUE=false' },
      'Reconciliation queue disabled',
    );

    return disabledProducer('Reconciliation queue is disabled.');
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'reconciliation.queue.disabled', reason: 'missing_redis_url' },
      'Reconciliation queue requested but no Redis URL was configured',
    );

    return disabledProducer('Reconciliation queue requires RECONCILIATION_QUEUE_REDIS_URL.');
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queue = new Queue<QueuedReconciliationJobPayload>(options.queueName, {
    connection,
    prefix: options.prefix,
  });

  options.logger.info(
    { action: 'reconciliation.queue.producer.enabled', queueName: options.queueName, prefix: options.prefix },
    'Reconciliation queue producer enabled',
  );

  return {
    enabled: true,
    enqueue: async (payload) => {
      const job = await queue.add('reconciliation-run', payload, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });

      return {
        jobId: String(job.id),
        status: 'queued',
      };
    },
    getStatus: async (jobId) => {
      const job = await queue.getJob(jobId);
      return resolveResultFromJob(job);
    },
    close: async () => {
      await queue.close().catch(() => undefined);
    },
  };
};

/** Consumer half of the reconciliation queue (Issue #134 phase 2): owns the BullMQ `Worker` only
 * -- what `apps/api/src/worker.ts` runs in its own process. `autorun: false` on the underlying
 * `Worker` so construction and "start pulling jobs" are separate steps, mirroring how
 * `createServerRuntime`/`startServer` are split in server.ts. */
export const createReconciliationConsumer = (
  options: ReconciliationQueueConsumerOptions,
): ReconciliationQueueConsumer => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'reconciliation.queue.disabled', reason: 'ENABLE_RECONCILIATION_QUEUE=false' },
      'Reconciliation queue disabled',
    );

    return disabledConsumer();
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'reconciliation.queue.disabled', reason: 'missing_redis_url' },
      'Reconciliation queue requested but no Redis URL was configured',
    );

    return disabledConsumer();
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const worker = new Worker<QueuedReconciliationJobPayload, PersistedQueuedReconciliationResult>(
    options.queueName,
    async (job) => toPersistedResult(await options.processJob(job.data)),
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      autorun: false,
    },
  );

  worker.on('error', (error) => {
    options.logger.error(
      { action: 'reconciliation.queue.worker.error', err: error },
      'Reconciliation queue worker error',
    );
  });

  worker.on('failed', (job, error) => {
    options.logger.error(
      { action: 'reconciliation.queue.job.failed', jobId: job?.id, err: error },
      'Reconciliation queue job failed',
    );
  });

  return {
    start: () => {
      options.logger.info(
        {
          action: 'reconciliation.queue.consumer.enabled',
          queueName: options.queueName,
          prefix: options.prefix,
          concurrency: options.concurrency,
        },
        'Reconciliation queue consumer started',
      );
      void worker.run();
    },
    stop: async () => {
      await worker.close().catch(() => undefined);
    },
  };
};
