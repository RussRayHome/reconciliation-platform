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

// Matches Dockerfile.postgres's POSTGRES_BASE_IMAGE -- this suite is meant to prove the schema
// baseline against the same major.minor Postgres actually shipped, not a nearby-but-different one.
const POSTGRES_IMAGE = 'postgres:16.14';
const CREDENTIALS = { user: 'recon', password: 'recon' } as const;
const MAINTENANCE_DATABASE = 'postgres';
const TEMPLATE_DATABASE = 'recon_template';

/**
 * Issue #285. Nothing on this path bounds itself:
 *
 *  - vitest awaits `globalSetup` with no timeout at all -- the project's `testTimeout` /
 *    `hookTimeout` (180 s) govern tests and hooks, not global setup;
 *  - testcontainers' reaper acquires its lock with `retries: { forever: true }`
 *    (`testcontainers/build/common/file-lock.js`);
 *  - the ryuk reaper's own `container.start()` carries no `withStartupTimeout`, and the 60 s
 *    default in `wait-strategy.js` governs readiness polling, not the Docker start call.
 *
 * A saturated machine can therefore stall the run silently and indefinitely, which looks
 * identical to a slow one. This bounds it and fails loudly instead.
 *
 * Exported for `globalSetupTimeout.test.ts`. The env override also exercises the guard end to
 * end: `RECON_TESTCONTAINERS_TIMEOUT_MS=1 npx vitest run --project unit-data`.
 */
export const BRING_UP_TIMEOUT_MS = Number(process.env.RECON_TESTCONTAINERS_TIMEOUT_MS ?? 300_000);

/** Built here so the test asserts on the same string the operator reads. */
export const bringUpTimeoutMessage = (ms: number): string =>
  [
    `testcontainers bring-up did not complete within ${ms} ms (issue #285).`,
    'This is almost always machine saturation, not a Docker fault.',
    '',
    'Recover:',
    '  1. docker ps -a --filter name=testcontainers-ryuk   # look for one stuck in "Created"',
    '  2. docker rm -f <that container>',
    '  3. retry unloaded, and not concurrently with another test run',
    '',
    'To skip the Docker-backed project entirely: npm run coverage:docker-fallback',
    'To raise this bound: RECON_TESTCONTAINERS_TIMEOUT_MS=<ms>',
  ].join('\n');

/**
 * Rejects if `operation` has not settled within `ms`. Always clears its timer.
 *
 * `onAbandoned` exists because losing the race does not cancel the work: `.start()` is still in
 * flight, and Docker will happily finish creating the container seconds later with nobody left
 * holding it. The `catch` below cannot clean that up -- `container` is still `undefined` there,
 * because the assignment never happened. Verified by forcing the bound to 1 ms, which leaked a
 * running `postgres:16.14` until this callback was added.
 */
export const withBringUpTimeout = async <T>(
  operation: Promise<T>,
  ms: number,
  onAbandoned?: (value: T) => unknown,
): Promise<T> => {
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Side-channel, deliberately not part of the race. The rejection handler is what stops a
  // post-timeout failure from surfacing as an unhandled rejection once the race has moved on.
  void operation.then(
    async (value) => {
      if (abandoned) {
        try {
          await onAbandoned?.(value);
        } catch {
          // Best effort: the run is already failing, and a cleanup error would mask its cause.
        }
      }
    },
    () => undefined,
  );

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abandoned = true;
          reject(new Error(bringUpTimeoutMessage(ms)));
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

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
    container = await withBringUpTimeout(
      new GenericContainer(POSTGRES_IMAGE)
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
        .start(),
      BRING_UP_TIMEOUT_MS,
      (late) => late.stop(),
    );

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
