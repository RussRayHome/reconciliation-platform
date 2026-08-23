import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import type pino from 'pino';

import type { QueueProgressMessage, QueueStepReporter } from './queueProgress';

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
  /** Total attempts (including the first) before a job is considered permanently failed and moves
   * to the dead-letter queue. Only consulted by the producer's `enqueue` -- BullMQ enforces it. */
  maxAttempts: number;
  /** Delay in ms before the first retry; each subsequent retry doubles it (BullMQ's `exponential`
   * backoff type). */
  backoffDelayMs: number;
};

/** Metadata attached to a job when it's moved to the dead-letter queue after exhausting all
 * retries -- the DLQ job's payload is the original job's data plus this. */
type DeadLetterMetadata = {
  originalJobId: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
};

export type ImportValidationQueueProducerOptions = ImportValidationQueueConnectionOptions;

export type ImportValidationQueueConsumerOptions = ImportValidationQueueConnectionOptions & {
  concurrency: number;
  /** `onStep`'s publish half is constructed here (wrapping `Job.updateProgress`, the only thing
   * this file has access to) and passed down for the caller's business logic to invoke at each
   * checkpoint -- see queueProgress.ts. */
  processJob: (
    payload: QueuedImportValidationJobPayload,
    onStep: QueueStepReporter,
  ) => Promise<QueuedImportValidationResult>;
};

export type ImportValidationQueueProducer = {
  enabled: boolean;
  enqueue: (
    payload: QueuedImportValidationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedImportValidationResult | undefined>;
  /** Backlog on the live queue -- see reconciliationQueue.ts's `getJobCounts` doc comment (same
   * rationale: `worker` has no HTTP server of its own to scrape). */
  getJobCounts: () => Promise<{ waiting: number; active: number; delayed: number }>;
  /** Depth of the dead-letter queue -- see reconciliationQueue.ts's `getDeadLetterCount`. */
  getDeadLetterCount: () => Promise<number>;
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
  getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, delayed: 0 }),
  getDeadLetterCount: () => Promise.resolve(0),
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
      {
        action: 'import-validation.queue.disabled',
        reason: 'ENABLE_IMPORT_VALIDATION_QUEUE=false',
      },
      'Import validation queue disabled',
    );

    return disabledProducer('Import validation queue is disabled.');
  }

  if (!options.redisUrl) {
    options.logger.warn(
      { action: 'import-validation.queue.disabled', reason: 'missing_redis_url' },
      'Import validation queue requested but no Redis URL was configured',
    );

    return disabledProducer('Import validation queue requires IMPORT_VALIDATION_QUEUE_REDIS_URL.');
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queue = new Queue<QueuedImportValidationJobPayload>(options.queueName, {
    connection,
    prefix: options.prefix,
  });
  // Read-only handle onto the dead-letter queue -- no Worker attached here either, same as the
  // consumer's own DLQ handle (createImportValidationConsumer). Constructed on the producer side
  // purely so its depth can be reported from the `api` process's /api/metrics, the only HTTP
  // surface either queue role actually has.
  const dlqQueue = new Queue<{ originalPayload: QueuedImportValidationJobPayload } & DeadLetterMetadata>(
    `${options.queueName}-dlq`,
    { connection, prefix: options.prefix },
  );

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
        attempts: options.maxAttempts,
        backoff: { type: 'exponential', delay: options.backoffDelayMs },
      });

      return { jobId: String(job.id), status: 'queued' };
    },
    getStatus: async (jobId) => {
      const job = await queue.getJob(jobId);
      return resolveResultFromJob(job);
    },
    getJobCounts: async () => {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
      };
    },
    getDeadLetterCount: async () => {
      const counts = await dlqQueue.getJobCounts('waiting');
      return counts.waiting ?? 0;
    },
    close: async () => {
      await queue.close().catch(() => undefined);
      await dlqQueue.close().catch(() => undefined);
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
      {
        action: 'import-validation.queue.disabled',
        reason: 'ENABLE_IMPORT_VALIDATION_QUEUE=false',
      },
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

  // Dead-letter queue: never given a Worker, so nothing auto-consumes it -- that's what makes it
  // a *dead* letter queue rather than another retry tier. A job lands here only once BullMQ has
  // genuinely given up on it (see the 'failed' handler below), and it sits there for a human to
  // inspect (redis-cli for now, or `npm run queue:clear-dlq` to purge it during development).
  const dlqQueue = new Queue<{ originalPayload: QueuedImportValidationJobPayload } & DeadLetterMetadata>(
    `${options.queueName}-dlq`,
    { connection, prefix: options.prefix },
  );

  const worker = new Worker<QueuedImportValidationJobPayload, QueuedImportValidationResult>(
    options.queueName,
    async (job) => {
      const result = await options.processJob(job.data, async (statusMessage, details) => {
        await job
          .updateProgress({
            organizationId: job.data.organizationId,
            processId: job.data.runId,
            queueType: 'import-validation',
            statusMessage,
            details,
          })
          .catch(() => undefined);
      });

      // processImportValidationJob (app.ts) never throws -- it always resolves, even on failure,
      // to preserve the synchronous in-request route's existing "200 + status:'failed' body"
      // contract. That means BullMQ itself never sees a rejected promise unless we throw here
      // explicitly -- without this, `attempts`/`backoff` above would be a no-op (every job would
      // look "completed" to BullMQ regardless of whether the underlying validation run failed).
      if (result.status === 'failed') {
        throw new Error(result.reason ?? 'Import validation job failed');
      }

      return result;
    },
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

    if (!job) {
      return;
    }

    // 'failed' fires on every failed attempt, including ones BullMQ is about to retry -- job's
    // own isFailed() is the authoritative check for "attempts are genuinely exhausted" (correctly
    // covers both a thrown error exceeding `attempts` and a stall exceeding `maxStalledCount`,
    // without this file needing to separately reason about which one happened).
    void job
      .isFailed()
      .then(async (isTerminal) => {
        if (!isTerminal) {
          return;
        }

        await dlqQueue.add('dead-letter', {
          originalPayload: job.data,
          originalJobId: String(job.id),
          failedReason: job.failedReason ?? error.message,
          attemptsMade: job.attemptsMade,
          failedAt: new Date().toISOString(),
        });

        options.logger.error(
          {
            action: 'import-validation.queue.job.dead-lettered',
            jobId: job.id,
            attemptsMade: job.attemptsMade,
          },
          'Import validation queue job exhausted all retries and moved to the dead-letter queue',
        );
      })
      .catch((dlqError: unknown) => {
        options.logger.error(
          { action: 'import-validation.queue.dlq.enqueue_error', jobId: job.id, err: dlqError },
          'Failed to move exhausted import validation queue job to the dead-letter queue',
        );
      });
  });

  worker.on('stalled', (jobId) => {
    options.logger.warn(
      { action: 'import-validation.queue.job.stalled', jobId },
      'Import validation queue job stalled -- its worker likely crashed or hung mid-job; BullMQ will retry it on another worker',
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
      await dlqQueue.close().catch(() => undefined);
    },
  };
};

/** Issue #154 (live status push): a shared, process-wide listener onto every `'progress'` event
 * this queue's workers publish, unfiltered across every organization and run -- per-connection
 * filtering (by organizationId/processId) is the SSE endpoint's job, not this file's. One
 * `QueueEvents` per queue per API process, not one per SSE connection -- constructed once
 * alongside the producer in `createApp` and reused by every connection, so N concurrent listeners
 * never open N redundant Redis subscriptions. */
export type ImportValidationQueueEvents = {
  enabled: boolean;
  /** Registers a listener for every progress message this queue's workers publish. Returns an
   * unsubscribe function -- call it when the caller (an SSE connection) disconnects, or the
   * underlying `QueueEvents` listener count grows unbounded over the process's lifetime. */
  onProgress: (listener: (message: QueueProgressMessage) => void) => () => void;
  close: () => Promise<void>;
};

const disabledQueueEvents = (): ImportValidationQueueEvents => ({
  enabled: false,
  onProgress: () => () => undefined,
  close: () => Promise.resolve(),
});

export const createImportValidationQueueEvents = (
  options: ImportValidationQueueProducerOptions,
): ImportValidationQueueEvents => {
  if (!options.enabled || !options.redisUrl) {
    return disabledQueueEvents();
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queueEvents = new QueueEvents(options.queueName, { connection, prefix: options.prefix });

  queueEvents.on('error', (error) => {
    options.logger.error(
      { action: 'import-validation.queue.events.error', err: error },
      'Import validation queue events listener error',
    );
  });

  return {
    enabled: true,
    onProgress: (listener) => {
      const wrapped = ({ data }: { jobId: string; data: unknown }) => {
        listener(data as QueueProgressMessage);
      };
      queueEvents.on('progress', wrapped);
      return () => {
        queueEvents.off('progress', wrapped);
      };
    },
    close: async () => {
      await queueEvents.close().catch(() => undefined);
    },
  };
};
