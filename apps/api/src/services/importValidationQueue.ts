import { Queue, Worker, type Job } from 'bullmq';
import type pino from 'pino';

/**
 * Own queue, deliberately separate from reconciliationQueue.ts's producer/consumer pair (File
 * Imports & Validation product decision: "we should use the best queuing tool" resolved to
 * BullMQ, but as its own queue rather than sharing the existing reconciliation queue's job type/
 * connection config) -- same shape as that pair (enabled/redisUrl fallback, worker concurrency,
 * no in-process result cache), duplicated rather than genericized so this feature's queue can
 * evolve independently without risking the existing, already-relied-upon reconciliation queue.
 */
export type QueuedImportValidationJobPayload = {
  organizationId: string;
  runId: string;
  importJobId: string;
  /** Session id (JWT `jti`) of whoever submitted the files, so the worker -- which runs outside
   * the original request's lifecycle and has no `request.log` to inherit -- can still bind it
   * onto every log line it emits while processing the job. */
  sessionId?: string;
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

type ImportValidationQueueConnectionOptions = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  logger: pino.Logger;
};

export type ImportValidationQueueProducerOptions = ImportValidationQueueConnectionOptions;

export type ImportValidationQueueConsumerOptions = ImportValidationQueueConnectionOptions & {
  concurrency: number;
  processJob: (
    payload: QueuedImportValidationJobPayload,
  ) => Promise<QueuedImportValidationResult>;
};

export type ImportValidationQueueProducer = {
  enabled: boolean;
  enqueue: (
    payload: QueuedImportValidationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedImportValidationResult | undefined>;
  close: () => Promise<void>;
};

/** See reconciliationQueue.ts's `ReconciliationQueueConsumer` -- same start/stop split, same
 * reason (BullMQ's `Worker.run()` only resolves once the worker closes, so `start()` fires it
 * without awaiting). */
export type ImportValidationQueueConsumer = {
  start: () => void;
  stop: () => Promise<void>;
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

/**
 * Resolves a job's status entirely from BullMQ's own Redis-persisted job state (`getState()`,
 * `returnvalue`, `failedReason`) -- deliberately no in-process cache, matching
 * reconciliationQueue.ts's `resolveResultFromJob`. `Queue.getJob` reads from Redis regardless of
 * which process created or is processing the job, so this is what lets the producer
 * (`enqueue`/`getStatus`) and consumer (the `Worker` below, its own process -- Issue #134) not
 * need to share process memory at all.
 *
 * Known gap, not silently ignored: if a job is evicted from Redis before any client polls it
 * (`removeOnComplete`/`removeOnFail` below cap retention at 200/500 respectively), `queue.getJob`
 * returns `undefined` and this can no longer answer at all. Accepted for now, same deferred
 * tradeoff as reconciliationQueue.ts.
 */
const resolveResultFromJob = async (
  job: Job<QueuedImportValidationJobPayload, QueuedImportValidationResult> | undefined,
): Promise<QueuedImportValidationResult | undefined> => {
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
      reason: job.failedReason ?? 'Queued import validation failed',
    };
  }

  if (state === 'completed') {
    return job.returnvalue as QueuedImportValidationResult | undefined;
  }

  return { status: 'queued' };
};

const disabledProducer = (reason: string): ImportValidationQueueProducer => ({
  enabled: false,
  enqueue: () => Promise.reject(new Error(reason)),
  getStatus: () => Promise.resolve(undefined),
  close: () => Promise.resolve(),
});

const disabledConsumer = (): ImportValidationQueueConsumer => ({
  start: () => undefined,
  stop: () => Promise.resolve(),
});

/** Producer half (Issue #134 phase 2): owns the BullMQ `Queue` only -- what app.ts's Express
 * routes need. No knowledge of `processJob`/`Worker`. */
export const createImportValidationProducer = (
  options: ImportValidationQueueProducerOptions,
): ImportValidationQueueProducer => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'import-validation.queue.disabled', reason: 'ENABLE_IMPORT_VALIDATION_QUEUE=false' },
      'Import validation queue disabled',
    );

    return disabledProducer('Import validation queue is disabled.');
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'import-validation.queue.disabled', reason: 'missing_redis_url' },
      'Import validation queue requested but no Redis URL was configured',
    );

    return disabledProducer(
      'Import validation queue requires IMPORT_VALIDATION_QUEUE_REDIS_URL.',
    );
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queue = new Queue<QueuedImportValidationJobPayload>(options.queueName, {
    connection,
    prefix: options.prefix,
  });

  options.logger.info(
    {
      action: 'import-validation.queue.producer.enabled',
      queueName: options.queueName,
      prefix: options.prefix,
    },
    'Import validation queue producer enabled',
  );

  return {
    enabled: true,
    enqueue: async (payload) => {
      const job = await queue.add('import-validation-run', payload, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      });

      return { jobId: String(job.id), status: 'queued' };
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

/** Consumer half (Issue #134 phase 2): owns the BullMQ `Worker` only -- what
 * `apps/api/src/worker.ts` runs in its own process. `autorun: false` so construction and
 * "start pulling jobs" are separate steps. */
export const createImportValidationConsumer = (
  options: ImportValidationQueueConsumerOptions,
): ImportValidationQueueConsumer => {
  if (!options.enabled) {
    options.logger.info(
      { action: 'import-validation.queue.disabled', reason: 'ENABLE_IMPORT_VALIDATION_QUEUE=false' },
      'Import validation queue disabled',
    );

    return disabledConsumer();
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'import-validation.queue.disabled', reason: 'missing_redis_url' },
      'Import validation queue requested but no Redis URL was configured',
    );

    return disabledConsumer();
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const worker = new Worker<QueuedImportValidationJobPayload, QueuedImportValidationResult>(
    options.queueName,
    (job) => options.processJob(job.data),
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      autorun: false,
    },
  );

  worker.on('error', (error) => {
    options.logger.error(
      { action: 'import-validation.queue.worker.error', err: error },
      'Import validation queue worker error',
    );
  });

  worker.on('failed', (job, error) => {
    options.logger.error(
      { action: 'import-validation.queue.job.failed', jobId: job?.id, err: error },
      'Import validation queue job failed',
    );
  });

  return {
    start: () => {
      options.logger.info(
        {
          action: 'import-validation.queue.consumer.enabled',
          queueName: options.queueName,
          prefix: options.prefix,
          concurrency: options.concurrency,
        },
        'Import validation queue consumer started',
      );
      void worker.run();
    },
    stop: async () => {
      await worker.close().catch(() => undefined);
    },
  };
};
