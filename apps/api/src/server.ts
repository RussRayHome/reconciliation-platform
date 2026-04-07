import {
  PostgresReconciliationLifecycleStore,
  PostgresReconciliationReadModelStore,
  createPostgresPool,
  isPostgresPersistenceEnabled,
  loadPostgresPersistenceConfigFromEnv,
  runPostgresMigrations,
} from '@recon/persistence';

import { FileBackedRunRepository } from './services/runRepository';
import { createApp } from './app';
import { createWriteStream } from 'node:fs';
import { markServerStarted } from './services/runtimeDiagnostics';
import path from 'node:path';
import pino from 'pino';

const repoRoot = process.cwd();
const persistedRunPath = process.env.RECONCILIATION_RUN_STORE_PATH ??
  path.join(repoRoot, 'test-results', 'latest-reconciliation-run.json');

const shouldRunMigrationsOnBoot = (): boolean => {
  const configured = process.env.RUN_DB_MIGRATIONS_ON_BOOT;
  if (configured === 'true') {
    return true;
  }

  if (configured === 'false') {
    return false;
  }

  return process.env.NODE_ENV !== 'production';
};

export type ServerRuntime = {
  app: ReturnType<typeof createApp>;
  port: number;
  logger: pino.Logger;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  readModelStore?: PostgresReconciliationReadModelStore;
};

/**
 * Starts the Express API server with environment-aware logging and runtime
 * diagnostics tracking.
 *
 * Logging is written to stdout in every environment and optionally mirrored to
 * a newline-delimited JSON file when `LOG_FILE` is configured.
 */
export const createServerRuntime = async (): Promise<ServerRuntime> => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logFile = process.env.LOG_FILE;
  const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;

  // Build a multistream that goes to:
  //   1. stdout   – pretty in dev, raw JSON in production
  //   2. log file – always raw newline-delimited JSON when LOG_FILE is set
  const streams: pino.StreamEntry[] = [];

  if (isProduction) {
    streams.push({ level, stream: process.stdout });
  } else {
    // pino.transport returns a writable stream backed by a worker thread
    const prettyStream = pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    }) as pino.DestinationStream;
    streams.push({
      level,
      stream: prettyStream,
    });
  }

  if (logFile) {
    streams.push({ level: 'debug', stream: createWriteStream(logFile, { flags: 'a' }) });
  }

  const logger = pino({ level }, pino.multistream(streams));

  let lifecycleStore: PostgresReconciliationLifecycleStore | undefined;
  let readModelStore: PostgresReconciliationReadModelStore | undefined;
  if (isPostgresPersistenceEnabled()) {
    const postgresConfig = loadPostgresPersistenceConfigFromEnv();

    if (!postgresConfig) {
      throw new Error('DATABASE_URL is required when PostgreSQL persistence is enabled.');
    }

    const pool = createPostgresPool(postgresConfig);
    if (shouldRunMigrationsOnBoot()) {
      await runPostgresMigrations(pool);
    } else {
      logger.info(
        { action: 'persistence.postgres.migrations.skipped', reason: 'RUN_DB_MIGRATIONS_ON_BOOT=false' },
        'Skipping PostgreSQL migrations during API startup',
      );
    }

    lifecycleStore = new PostgresReconciliationLifecycleStore(pool);
    readModelStore = new PostgresReconciliationReadModelStore(pool);
    logger.info({ action: 'persistence.postgres.ready' }, 'PostgreSQL persistence initialized');
  }

  const app = createApp(
    new FileBackedRunRepository(persistedRunPath),
    lifecycleStore,
    readModelStore,
  );
  const port = Number(process.env.PORT ?? '4000');

  return {
    app,
    port,
    logger,
    lifecycleStore,
    readModelStore,
  };
};

export const startServer = async (): Promise<void> => {
  const runtime = await createServerRuntime();

  runtime.app.listen(runtime.port, '0.0.0.0', () => {
    markServerStarted();
    runtime.logger.info(
      { port: runtime.port, logFile: process.env.LOG_FILE ?? null, level: process.env.LOG_LEVEL ?? 'info' },
      'Reconciliation API listening',
    );
  });
};
