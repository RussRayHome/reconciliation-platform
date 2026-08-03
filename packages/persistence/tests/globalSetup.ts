import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { createPostgresPool } from '../src/postgres';
import { runLiquibase } from './testHelpers/liquibase';

/**
 * Connection details for the single PostgreSQL container shared by every test file in the
 * `unit-data` / `postgres-integration` projects.
 */
export interface PostgresHarness {
  containerId: string;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Maintenance database used to issue CREATE/DROP DATABASE. Never holds test data. */
  maintenanceDatabase: string;
  /** Fully migrated database used as the source for `CREATE DATABASE ... TEMPLATE`. */
  templateDatabase: string;
}

declare module 'vitest' {
  interface ProvidedContext {
    postgresHarness: PostgresHarness;
  }
}

const POSTGRES_IMAGE = 'postgres:16.13';
const CREDENTIALS = { user: 'recon', password: 'recon' } as const;
const MAINTENANCE_DATABASE = 'postgres';
const TEMPLATE_DATABASE = 'recon_template';

/**
 * Starts one PostgreSQL container for the whole run, installs pgTap into it, and migrates a
 * single `recon_template` database with Liquibase. Individual test files then clone that template
 * with `CREATE DATABASE ... TEMPLATE`, which PostgreSQL implements as a file copy — milliseconds,
 * versus a full Liquibase invocation each.
 *
 * Before this existed the suite started three containers and ran Liquibase seven times per
 * execution, which is what forced the 120s/180s per-file timeouts.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let container: StartedTestContainer | undefined;

  try {
    container = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: MAINTENANCE_DATABASE,
        POSTGRES_USER: CREDENTIALS.user,
        POSTGRES_PASSWORD: CREDENTIALS.password,
      })
      // pg_stat_statements has to be preloaded at server start; the migration suite asserts it
      // records query stats. Running as root is required for the pgTap apt-get install below.
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
      .withUser('root')
      .withExposedPorts(5432)
      .start();

    const pgtapInstall = await container.exec([
      'bash',
      '-lc',
      [
        'set -euo pipefail',
        'apt-get update',
        'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-16-pgtap',
      ].join('; '),
    ]);
    if (pgtapInstall.exitCode !== 0) {
      throw new Error(`Failed to install pgTap: ${pgtapInstall.output}`);
    }

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const containerId = container.getId();

    const adminPool = createPostgresPool({
      connectionString: `postgresql://${CREDENTIALS.user}:${CREDENTIALS.password}@${host}:${port}/${MAINTENANCE_DATABASE}`,
    });

    try {
      await adminPool.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
      runLiquibase(containerId, TEMPLATE_DATABASE, 'update');
      // Blocking connections guarantees no session can hold the template open — PostgreSQL
      // refuses `CREATE DATABASE ... TEMPLATE` while the source has active sessions, and this
      // turns a flaky race into an impossibility. It is how template0 itself is configured.
      await adminPool.query(
        `ALTER DATABASE ${TEMPLATE_DATABASE} WITH ALLOW_CONNECTIONS false IS_TEMPLATE true`,
      );
    } finally {
      await adminPool.end();
    }

    project.provide('postgresHarness', {
      containerId,
      host,
      port,
      user: CREDENTIALS.user,
      password: CREDENTIALS.password,
      maintenanceDatabase: MAINTENANCE_DATABASE,
      templateDatabase: TEMPLATE_DATABASE,
    });
  } catch (error) {
    await container?.stop().catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }

  const startedContainer = container;
  return async () => {
    await startedContainer.stop();
  };
}
