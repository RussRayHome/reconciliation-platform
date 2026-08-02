import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { Pool } from 'pg';

const LIQUIBASE_IMAGE = 'liquibase/liquibase:4.31';
const LIQUIBASE_DIR = path.resolve(__dirname, '..', '..', 'liquibase');
const CHANGESETS_DIR = path.join(LIQUIBASE_DIR, 'changesets');

/** Number of changeset files under packages/persistence/liquibase/changesets. */
export const countChangesetFiles = (): number =>
  readdirSync(CHANGESETS_DIR).filter((name) => /\.(sql|yaml|yml)$/.test(name)).length;

/**
 * Runs a Liquibase command against `database` inside the given PostgreSQL container's own
 * network namespace (so `127.0.0.1:5432` inside the Liquibase container reaches Postgres
 * directly, with no cross-container DNS/port-mapping needed). Requires a Docker CLI on the host
 * running the test. Bounded by a hard subprocess timeout so a hung Liquibase/Docker invocation
 * fails the test instead of hanging CI indefinitely.
 */
export const runLiquibase = (
  postgresContainerId: string,
  database: string,
  ...command: string[]
): void => {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      `container:${postgresContainerId}`,
      '-v',
      `${LIQUIBASE_DIR}:/liquibase/changelog`,
      LIQUIBASE_IMAGE,
      '--search-path=/liquibase/changelog',
      '--changelog-file=changelog-master.yaml',
      `--url=jdbc:postgresql://127.0.0.1:5432/${database}`,
      '--username=recon',
      '--password=recon',
      ...command,
    ],
    { stdio: 'pipe', timeout: 90000 },
  );
};

const stripLiquibaseDirectives = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !/^--liquibase\b|^--changeset\b|^--rollback\b/.test(line))
    .join('\n');

/**
 * Replays changesets 0001-0009 (the exact SQL bodies that used to live in the retired
 * `postgresMigrations` array) directly via plain SQL, simulating a database that was already
 * migrated by the pre-Liquibase mechanism before this repo adopted Liquibase. Used to test that
 * `liquibase changelog-sync-to-tag --tag=v1-v9-baseline` converges such a database to the same
 * schema as a fresh `liquibase update` — see packages/persistence/liquibase/README.md.
 */
export const replayPreLiquibaseBaseline = async (pool: Pool): Promise<void> => {
  const baselineFiles = readdirSync(CHANGESETS_DIR)
    .filter((name) => /^000[1-9][_.]/.test(name) && name.endsWith('.sql'))
    .sort();

  for (const file of baselineFiles) {
    const sql = stripLiquibaseDirectives(readFileSync(path.join(CHANGESETS_DIR, file), 'utf8'));
    await pool.query(sql);
  }
};
