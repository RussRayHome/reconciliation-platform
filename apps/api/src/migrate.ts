import {
  createPostgresPool,
  loadPostgresPersistenceConfigFromEnv,
  runPostgresMigrations,
} from '@recon/persistence';
import { resolveLogLevelAtLeastInfo } from './services/logLevel';

import pino from 'pino';

const logger = pino({ level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL) });

const main = async (): Promise<void> => {
  const postgresConfig = loadPostgresPersistenceConfigFromEnv();
  if (!postgresConfig) {
    throw new Error('DATABASE_URL is required to run PostgreSQL migrations.');
  }

  const pool = createPostgresPool(postgresConfig);
  try {
    await runPostgresMigrations(pool);
    logger.info(
      { action: 'persistence.postgres.migrations.complete' },
      'PostgreSQL migrations completed',
    );
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'PostgreSQL migrations failed');
  process.exitCode = 1;
});
