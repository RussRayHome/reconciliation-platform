import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import type { OpenItemCandidate } from '@recon/domain';
import { createPostgresPool, PostgresOpenItemStore } from '../src';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

let database: TestDatabase | undefined;
let pool: Pool;
let runtimePool: Pool;
let startupError: Error | null = null;
let defaultOrganizationId: string;

const buildCandidate = (overrides: Partial<OpenItemCandidate> = {}): OpenItemCandidate => ({
  accountIdentifier: 'OPEN-ITEM-STORE-1',
  sourceSystem: 'gl',
  category: 'OutstandingCheck',
  naturalKey: 'check:OPEN-ITEM-STORE-1:1001',
  naturalKeyTier: 1,
  originalTransactionDate: '2026-01-05',
  amount: -250,
  checkNumber: '1001',
  ...overrides,
});

/** first_detected_job_id FKs to a real reconciliation_job row -- inserts a minimal one so
 * projectOpenItems' own writes satisfy the constraint. */
const insertJob = async (): Promise<string> => {
  const jobId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO reconciliation_job
       (id, organization_id, correlation_id, current_state, rulepack_version, started_at)
     VALUES ($1, $2, $3, 'FINALIZED', 'test', NOW())`,
    [jobId, defaultOrganizationId, jobId],
  );
  return jobId;
};

describe('PostgresOpenItemStore', () => {
  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_open_item_store');
      pool = database.pool;
      const harness = postgresHarness();
      runtimePool = createPostgresPool({
        connectionString: `postgresql://app_user:P%40ssw0rd@${harness.host}:${harness.port}/${database.name}`,
      });
      const organizationResult = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const organizationId = organizationResult.rows[0]?.id;
      if (!organizationId) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      defaultOrganizationId = organizationId;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
    if (database) {
      await database.drop();
    }
  });

  it('projects a new candidate as an OPEN item and writes an OPENED event', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    const result = await store.projectOpenItems(defaultOrganizationId, {
      jobId: await insertJob(),
      candidates: [buildCandidate()],
    });

    expect(result).toEqual({ opened: 1, carriedForward: 0 });

    const row = await pool.query<{ status: string; natural_key_tier: number }>(
      `SELECT oi.status, oi.natural_key_tier
         FROM reconciliation_open_item oi
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-1' AND oi.natural_key = 'check:OPEN-ITEM-STORE-1:1001'`,
    );
    expect(row.rows[0]).toEqual({ status: 'OPEN', natural_key_tier: 1 });

    const events = await pool.query<{ event_type: string; from_status: string | null; to_status: string }>(
      `SELECT event_type, from_status, to_status FROM reconciliation_open_item_event
        WHERE open_item_id = (
          SELECT oi.id FROM reconciliation_open_item oi
            JOIN reconciliation_account a ON a.id = oi.account_id
           WHERE a.account_identifier = 'OPEN-ITEM-STORE-1' AND oi.natural_key = 'check:OPEN-ITEM-STORE-1:1001'
        )`,
    );
    expect(events.rows).toEqual([{ event_type: 'OPENED', from_status: null, to_status: 'OPEN' }]);
  });

  it('is idempotent: projecting the same candidate a second time does not double-open, and writes a CARRIED_FORWARD event instead', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    const candidate = buildCandidate({ accountIdentifier: 'OPEN-ITEM-STORE-2', naturalKey: 'check:OPEN-ITEM-STORE-2:2001' });
    // Same jobId both times -- this is what "finalize runs twice for the same job" (a retry)
    // actually looks like, not two different jobs each opening the item once.
    const jobId = await insertJob();

    const first = await store.projectOpenItems(defaultOrganizationId, {
      jobId,
      candidates: [candidate],
    });
    const second = await store.projectOpenItems(defaultOrganizationId, {
      jobId,
      candidates: [candidate],
    });

    expect(first).toEqual({ opened: 1, carriedForward: 0 });
    expect(second).toEqual({ opened: 0, carriedForward: 1 });

    const countRow = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reconciliation_open_item oi
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-2' AND oi.natural_key = 'check:OPEN-ITEM-STORE-2:2001'`,
    );
    expect(countRow.rows[0]?.count).toBe('1');

    const eventTypes = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM reconciliation_open_item_event ev
         JOIN reconciliation_open_item oi ON oi.id = ev.open_item_id
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-2' AND oi.natural_key = 'check:OPEN-ITEM-STORE-2:2001'
        ORDER BY ev.event_id`,
    );
    expect(eventTypes.rows.map((row) => row.event_type)).toEqual(['OPENED', 'CARRIED_FORWARD']);
  });

  it('reuses the same reconciliation_account row across two separate candidates for the same identifier', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    await store.projectOpenItems(defaultOrganizationId, {
      jobId: await insertJob(),
      candidates: [
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-3',
          naturalKey: 'check:OPEN-ITEM-STORE-3:3001',
          checkNumber: '3001',
        }),
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-3',
          naturalKey: 'check:OPEN-ITEM-STORE-3:3002',
          checkNumber: '3002',
        }),
      ],
    });

    const accountCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM reconciliation_account WHERE account_identifier = 'OPEN-ITEM-STORE-3'",
    );
    expect(accountCount.rows[0]?.count).toBe('1');
  });

  it('markRunReconciled flips reconciliation_run.status to RECONCILED and is idempotent', async () => {
    if (startupError) throw startupError;

    const runId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, 'Store Smoke Run', 'MONTHLY', 2026)`,
      [runId, defaultOrganizationId],
    );

    const store = new PostgresOpenItemStore(runtimePool);
    await store.markRunReconciled(defaultOrganizationId, runId);
    await store.markRunReconciled(defaultOrganizationId, runId);

    const row = await pool.query<{ status: string }>(
      'SELECT status FROM reconciliation_run WHERE id = $1',
      [runId],
    );
    expect(row.rows[0]?.status).toBe('RECONCILED');
  });
});
