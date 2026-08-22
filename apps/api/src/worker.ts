import {
  PostgresReconciliationLifecycleStore,
  createPostgresPool,
  isPostgresPersistenceEnabled,
  loadPostgresPersistenceConfigFromEnv,
} from '@recon/persistence';
import type { Pool } from 'pg';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import pino from 'pino';

import {
  ReconciliationFileValidationError,
  fromQueuedReconciliationFiles,
  handleFailedReconciliationRun,
  processImportValidationJob,
  recordSuccessfulReconciliationRun,
  resolveImportValidationQueueConfiguration,
  resolveReconciliationQueueConfiguration,
  runReconciliationWorkflow,
  sanitizeRun,
} from './app';
import { assertRuntimeRoleIsNotPrivileged } from './server';
import { FileBackedRunRepository } from './services/runRepository';
import { resolveLogLevelAtLeastInfo } from './services/logLevel';
import { logRedactOptions } from './services/logRedaction';
import { captureApiException, flushApiSentry, initializeApiSentry } from './services/sentry';
import { startTelemetry, stopTelemetry } from './telemetry';
import {
  createImportValidationConsumer,
  type QueuedImportValidationJobPayload,
  type QueuedImportValidationResult,
} from './services/importValidationQueue';
import {
  createReconciliationConsumer,
  type QueuedReconciliationJobPayload,
  type QueuedReconciliationResult,
} from './services/reconciliationQueue';

const repoRoot = process.cwd();
const persistedRunPath =
  process.env.RECONCILIATION_RUN_STORE_PATH ??
  path.join(repoRoot, 'test-results', 'latest-reconciliation-run.json');

const parseBooleanFlag = (value: string | undefined): boolean | null => {
  if (value === undefined) {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
};

/**
 * Standalone consumer process (Issue #134 phases 2-3): pulls jobs off the same BullMQ queues
 * `apps/api/src/app.ts`'s producers enqueue onto, and processes them by calling exactly the same
 * `runReconciliationWorkflow`/`processImportValidationJob` functions the synchronous in-request
 * fallback path uses -- exported from app.ts for this reason. No process memory is shared with
 * the API server process; everything both sides need to agree on (job payloads, job state) is
 * already durable in Redis via BullMQ, and the actual reconciliation/import-validation results
 * land in the same Postgres database both processes connect to.
 *
 * Deliberately mirrors `createServerRuntime`/`startServer` in server.ts: a `createWorkerRuntime`
 * that builds dependencies, and a `startWorker` that wires signal handlers and graceful shutdown
 * around it, so the two entrypoints read the same way side by side.
 */
export type WorkerRuntime = {
  logger: pino.Logger;
  postgresPool?: Pool;
  reconciliationConsumer: ReturnType<typeof createReconciliationConsumer>;
  importValidationConsumer: ReturnType<typeof createImportValidationConsumer>;
};

export const createWorkerRuntime = async (): Promise<WorkerRuntime> => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logFile = process.env.LOG_FILE;
  const level = resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL);
  const streamLevel: pino.Level = level === 'silent' ? 'info' : level;

  const streams: pino.StreamEntry[] = [];

  if (isProduction) {
    streams.push({ level: streamLevel, stream: process.stdout });
  } else {
    const prettyStream = pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    }) as pino.DestinationStream;
    streams.push({ level: streamLevel, stream: prettyStream });
  }

  if (logFile) {
    streams.push({ level: 'debug', stream: createWriteStream(logFile, { flags: 'a' }) });
  }

  const logger = pino({ level, redact: logRedactOptions }, pino.multistream(streams));
  const telemetryRequired = parseBooleanFlag(process.env.OTEL_REQUIRED) === true;

  try {
    startTelemetry(logger);
  } catch (error: unknown) {
    logger.error({ err: error }, 'Failed to initialize OpenTelemetry tracing');
    if (telemetryRequired) {
      throw error;
    }
  }

  initializeApiSentry(logger);

  let lifecycleStore: PostgresReconciliationLifecycleStore | undefined;
  let postgresPool: Pool | undefined;
  if (isPostgresPersistenceEnabled()) {
    const postgresConfig = loadPostgresPersistenceConfigFromEnv();

    if (!postgresConfig) {
      throw new Error('DATABASE_URL is required when PostgreSQL persistence is enabled.');
    }

    const pool = createPostgresPool(postgresConfig);
    postgresPool = pool;
    await assertRuntimeRoleIsNotPrivileged(pool);

    lifecycleStore = new PostgresReconciliationLifecycleStore(pool);
    logger.info({ action: 'persistence.postgres.ready' }, 'PostgreSQL persistence initialized');
  }

  const repository = new FileBackedRunRepository(persistedRunPath);
  const pool = postgresPool;

  const reconciliationConsumer = createReconciliationConsumer({
    ...resolveReconciliationQueueConfiguration(),
    logger,
    processJob: async (
      payload: QueuedReconciliationJobPayload,
      onStep,
    ): Promise<QueuedReconciliationResult> => {
      const started = Date.now();
      let persistenceJobId: string | undefined;

      try {
        const workflowResult = await runReconciliationWorkflow({
          body: payload.body,
          files: fromQueuedReconciliationFiles(payload.files),
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          organizationId: payload.organizationId,
          requestLog: logger,
          repository,
          lifecycleStore,
          pool,
          onStep,
        });
        persistenceJobId = workflowResult.persistenceJobId;

        recordSuccessfulReconciliationRun({
          requestId: payload.requestId,
          started,
          result: workflowResult,
        });

        return {
          status: 'completed',
          runId: workflowResult.run.id,
          run: sanitizeRun(workflowResult.run),
        };
      } catch (error) {
        // Same rationale as the (now removed) in-process queue Worker this replaces: a File
        // Validation failure is expected user-input rejection, not an application bug.
        if (error instanceof ReconciliationFileValidationError) {
          return {
            status: 'failed',
            failedAt: new Date().toISOString(),
            reason: `File Validation failed: ${error.bankIssues.length} bank issue(s), ${error.glIssues.length} GL issue(s).`,
          };
        }

        await handleFailedReconciliationRun({
          requestId: payload.requestId,
          requestBody: payload.body,
          started,
          organizationId: payload.organizationId,
          lifecycleStore,
          persistenceJobId,
          error,
        });
        captureApiException(error, {
          tags: { scope: 'reconciliation-queue' },
          extra: { requestId: payload.requestId },
        });

        return {
          status: 'failed',
          failedAt: new Date().toISOString(),
          reason:
            error instanceof Error ? error.message : 'Unexpected reconciliation queue failure',
        };
      }
    },
  });

  // worker-N (not a random id): if two worker processes are ever run side by side, import_job.
  // worker_id should read as which *process* handled a job.
  const importValidationWorkerId = `import-validation-worker-${process.pid}`;
  const importValidationConsumer = createImportValidationConsumer({
    ...resolveImportValidationQueueConfiguration(),
    logger,
    processJob: (
      payload: QueuedImportValidationJobPayload,
      onStep,
    ): Promise<QueuedImportValidationResult> =>
      processImportValidationJob({
        organizationId: payload.organizationId,
        runId: payload.runId,
        importJobId: payload.importJobId,
        workerId: importValidationWorkerId,
        // Same invariant `app.ts`'s synchronous fallback path relies on: the import validation
        // queue is only ever enabled alongside Postgres persistence (requirePool gates every
        // route that can enqueue onto it), so this consumer never actually runs without a pool.
        pool: pool!,
        repository,
        lifecycleStore,
        requestLog: logger,
        sessionId: payload.sessionId,
        onStep,
      }),
  });

  return { logger, postgresPool, reconciliationConsumer, importValidationConsumer };
};

/**
 * Bootstraps the worker process: builds both queue consumers, starts them pulling jobs, and
 * registers SIGTERM/SIGINT graceful shutdown handlers mirroring `startServer`'s.
 */
export const startWorker = async (): Promise<void> => {
  const runtime = await createWorkerRuntime();

  process.on('uncaughtException', (error) => {
    runtime.logger.fatal({ err: error }, 'Uncaught exception, terminating process');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    runtime.logger.fatal({ err: reason }, 'Unhandled promise rejection, terminating process');
    process.exit(1);
  });

  runtime.reconciliationConsumer.start();
  runtime.importValidationConsumer.start();
  runtime.logger.info({ action: 'worker.started' }, 'Reconciliation worker started');

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      runtime.logger.warn({ signal }, 'Shutdown already in progress');
      return;
    }

    shuttingDown = true;
    runtime.logger.info({ signal }, 'Received shutdown signal');

    const shutdownTimeout = setTimeout(() => {
      runtime.logger.error({ signal, timeoutMs: 40000 }, 'Graceful shutdown timed out');
      process.exit(1);
    }, 40000);
    shutdownTimeout.unref();

    try {
      await runtime.reconciliationConsumer.stop();
      await runtime.importValidationConsumer.stop();

      if (runtime.postgresPool) {
        await runtime.postgresPool.end();
      }

      await stopTelemetry(runtime.logger);
      await flushApiSentry().catch(() => undefined);

      clearTimeout(shutdownTimeout);
      runtime.logger.info({ signal }, 'Graceful shutdown completed');
      process.exit(0);
    } catch (error: unknown) {
      clearTimeout(shutdownTimeout);
      runtime.logger.error({ err: error, signal }, 'Graceful shutdown failed');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
};
