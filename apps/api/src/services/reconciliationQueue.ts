import type { ReconciliationRunReport } from '@recon/domain';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import type pino from 'pino';

import type { QueueProgressMessage, QueueStepReporter } from './queueProgress';

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

export type ReconciliationQueueProducerOptions = ReconciliationQueueConnectionOptions;

export type ReconciliationQueueConsumerOptions = ReconciliationQueueConnectionOptions & {
  concurrency: number;
  /** `onStep`'s publish half is constructed here (wrapping `Job.updateProgress`, the only thing
   * this file has access to) and passed down for the caller's business logic to invoke at each
   * checkpoint -- see queueProgress.ts. */
  processJob: (
    payload: QueuedReconciliationJobPayload,
    onStep: QueueStepReporter,
  ) => Promise<QueuedReconciliationResult>;
};

export type ReconciliationQueueProducer = {
  enabled: boolean;
  enqueue: (
    payload: QueuedReconciliationJobPayload,
  ) => Promise<{ jobId: string; status: 'queued' }>;
  getStatus: (jobId: string) => Promise<QueuedReconciliationResult | undefined>;
  /** Backlog on the live queue -- `worker` (Issue #134) never starts an HTTP server, so it has no
   * metrics endpoint of its own (see prometheus.yml's comment); this is why queue depth is read
   * from here, the producer side, which already lives in the scraped `api` process. */
  getJobCounts: () => Promise<{ waiting: number; active: number; delayed: number }>;
  /** Depth of the dead-letter queue -- every job here is a permanently exhausted failure sitting
   * in its default 'waiting' state (nothing ever consumes this queue, see
   * `createReconciliationConsumer`'s doc comment), so 'waiting' count is the DLQ's entire depth. */
  getDeadLetterCount: () => Promise<number>;
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
  getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, delayed: 0 }),
  getDeadLetterCount: () => Promise.resolve(0),
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
  // Read-only handle onto the dead-letter queue -- no Worker attached here either, same as the
  // consumer's own DLQ handle (createReconciliationConsumer). Constructed on the producer side
  // purely so its depth can be reported from the `api` process's /api/metrics, the only HTTP
  // surface either queue role actually has.
  const dlqQueue = new Queue<{ originalPayload: QueuedReconciliationJobPayload } & DeadLetterMetadata>(
    `${options.queueName}-dlq`,
    { connection, prefix: options.prefix },
  );

  options.logger.info(
    {
      action: 'reconciliation.queue.producer.enabled',
      queueName: options.queueName,
      prefix: options.prefix,
    },
    'Reconciliation queue producer enabled',
  );

  return {
    enabled: true,
    enqueue: async (payload) => {
      const job = await queue.add('reconciliation-run', payload, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
        attempts: options.maxAttempts,
        backoff: { type: 'exponential', delay: options.backoffDelayMs },
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

  // Dead-letter queue: never given a Worker, so nothing auto-consumes it -- that's what makes it
  // a *dead* letter queue rather than another retry tier. A job lands here only once BullMQ has
  // genuinely given up on it (see the 'failed' handler below), and it sits there for a human to
  // inspect (redis-cli for now, or `npm run queue:clear-dlq` to purge it during development).
  const dlqQueue = new Queue<{ originalPayload: QueuedReconciliationJobPayload } & DeadLetterMetadata>(
    `${options.queueName}-dlq`,
    { connection, prefix: options.prefix },
  );

  const worker = new Worker<QueuedReconciliationJobPayload, PersistedQueuedReconciliationResult>(
    options.queueName,
    async (job) => {
      const onStep: QueueStepReporter = async (statusMessage, details) => {
        await job
          .updateProgress({
            organizationId: job.data.organizationId,
            // requestId, not runId: the standalone /api/reconciliation/run route's run id isn't
            // known until registerLifecycleJob resolves mid-processing, well after enqueue -- see
            // queueProgress.ts's QueueProgressMessage doc comment.
            processId: job.data.requestId,
            queueType: 'reconciliation',
            statusMessage,
            details,
          })
          .catch(() => undefined);
      };
      return toPersistedResult(await options.processJob(job.data, onStep));
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
      { action: 'reconciliation.queue.worker.error', err: error },
      'Reconciliation queue worker error',
    );
  });

  worker.on('failed', (job, error) => {
    options.logger.error(
      { action: 'reconciliation.queue.job.failed', jobId: job?.id, err: error },
      'Reconciliation queue job failed',
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
            action: 'reconciliation.queue.job.dead-lettered',
            jobId: job.id,
            attemptsMade: job.attemptsMade,
          },
          'Reconciliation queue job exhausted all retries and moved to the dead-letter queue',
        );
      })
      .catch((dlqError: unknown) => {
        options.logger.error(
          { action: 'reconciliation.queue.dlq.enqueue_error', jobId: job.id, err: dlqError },
          'Failed to move exhausted reconciliation queue job to the dead-letter queue',
        );
      });
  });

  worker.on('stalled', (jobId) => {
    options.logger.warn(
      { action: 'reconciliation.queue.job.stalled', jobId },
      'Reconciliation queue job stalled -- its worker likely crashed or hung mid-job; BullMQ will retry it on another worker',
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
export type ReconciliationQueueEvents = {
  enabled: boolean;
  /** Registers a listener for every progress message this queue's workers publish. Returns an
   * unsubscribe function -- call it when the caller (an SSE connection) disconnects, or the
   * underlying `QueueEvents` listener count grows unbounded over the process's lifetime. */
  onProgress: (listener: (message: QueueProgressMessage) => void) => () => void;
  close: () => Promise<void>;
};

const disabledQueueEvents = (): ReconciliationQueueEvents => ({
  enabled: false,
  onProgress: () => () => undefined,
  close: () => Promise.resolve(),
});

export const createReconciliationQueueEvents = (
  options: ReconciliationQueueProducerOptions,
): ReconciliationQueueEvents => {
  if (!options.enabled || !options.redisUrl) {
    return disabledQueueEvents();
  }

  const connection = resolveConnectionOptions(options.redisUrl);
  const queueEvents = new QueueEvents(options.queueName, { connection, prefix: options.prefix });

  queueEvents.on('error', (error) => {
    options.logger.error(
      { action: 'reconciliation.queue.events.error', err: error },
      'Reconciliation queue events listener error',
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
