import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';
import { generateSchemaBaseline } from './testHelpers/schemaBaseline';

const BASELINE_PATH = path.resolve(__dirname, 'schema', 'schema-baseline.sql');
const shouldUpdateBaseline = process.env.UPDATE_SCHEMA_BASELINE === 'true';

/**
 * Pins the Liquibase-managed schema with pgTap.
 *
 * The migration suite proves `liquibase update` runs; this proves what it *produced*. The
 * generated baseline uses exact-set assertions (`tables_are`, `columns_are`, `indexes_are`), so a
 * column quietly added in changeset 0026 fails here just as loudly as a dropped CHECK — which is
 * the whole point, since additions are what silently accumulate.
 *
 * Regenerate deliberately after a schema change:
 *
 *   npm run test:postgres:update-baseline
 */
describe('schema baseline (pgTap)', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let generated: string;

  beforeAll(async () => {
    database = await createDatabaseFromTemplate('recon_schema');
    pool = database.pool;
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgtap');
    generated = await generateSchemaBaseline(pool);
  });

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  it('matches the committed baseline', () => {
    if (shouldUpdateBaseline) {
      mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, generated, 'utf8');
      return;
    }

    expect(
      existsSync(BASELINE_PATH),
      `Missing ${BASELINE_PATH}. Generate it with: npm run test:postgres:update-baseline`,
    ).toBe(true);

    // Compared as line arrays so a failure shows which assertions moved rather than dumping two
    // multi-thousand-line strings at the reader.
    expect(generated.split('\n')).toEqual(readFileSync(BASELINE_PATH, 'utf8').split('\n'));
  });

  it('passes every assertion in the committed baseline against the migrated database', async () => {
    if (shouldUpdateBaseline) {
      return;
    }

    const baseline = readFileSync(BASELINE_PATH, 'utf8');
    // node-postgres returns one Result per statement for a multi-statement simple query.
    const results = (await pool.query(baseline)) as unknown as
      Array<{ rows: Array<Record<string, unknown>> }> | { rows: Array<Record<string, unknown>> };
    const resultList = Array.isArray(results) ? results : [results];

    const output = resultList
      .flatMap((result) => result.rows ?? [])
      .flatMap((row) => Object.values(row))
      .filter((value): value is string => typeof value === 'string');

    const failures = output.filter((line) => line.startsWith('not ok'));
    expect(failures, `pgTap reported failing assertions:\n${failures.join('\n')}`).toEqual([]);

    // finish() emits diagnostics only when something failed, so an all-green run still has to
    // prove the assertions actually executed rather than the script silently doing nothing.
    expect(output.filter((line) => line.startsWith('ok ')).length).toBeGreaterThan(0);
  });
});
