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

  it('getCarryForwardEnabled reads reconciliation_organization.carry_forward_enabled, false by default', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    expect(await store.getCarryForwardEnabled(defaultOrganizationId)).toBe(false);

    await pool.query('UPDATE reconciliation_organization SET carry_forward_enabled = TRUE WHERE id = $1', [
      defaultOrganizationId,
    ]);
    expect(await store.getCarryForwardEnabled(defaultOrganizationId)).toBe(true);
  });

  it('stampCarryForwardDecision persists an enabled decision with a null skip reason', async () => {
    if (startupError) throw startupError;

    const runId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, 'Stamp Enabled Run', 'MONTHLY', 2026)`,
      [runId, defaultOrganizationId],
    );

    const store = new PostgresOpenItemStore(runtimePool);
    await store.stampCarryForwardDecision(defaultOrganizationId, runId, { enabled: true });

    const row = await pool.query<{ carry_forward_applied: boolean; carry_forward_skip_reason: string | null }>(
      'SELECT carry_forward_applied, carry_forward_skip_reason FROM reconciliation_run WHERE id = $1',
      [runId],
    );
    expect(row.rows[0]).toEqual({ carry_forward_applied: true, carry_forward_skip_reason: null });
  });

  it('stampCarryForwardDecision persists a disabled decision with its skip reason', async () => {
    if (startupError) throw startupError;

    const runId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, 'Stamp Disabled Run', 'MONTHLY', 2026)`,
      [runId, defaultOrganizationId],
    );

    const store = new PostgresOpenItemStore(runtimePool);
    await store.stampCarryForwardDecision(defaultOrganizationId, runId, {
      enabled: false,
      reason: 'ORG_NOT_ENABLED',
    });

    const row = await pool.query<{ carry_forward_applied: boolean; carry_forward_skip_reason: string | null }>(
      'SELECT carry_forward_applied, carry_forward_skip_reason FROM reconciliation_run WHERE id = $1',
      [runId],
    );
    expect(row.rows[0]).toEqual({
      carry_forward_applied: false,
      carry_forward_skip_reason: 'ORG_NOT_ENABLED',
    });
  });

  it('stampCarryForwardDecision is a no-op when reconciliationRunId is undefined', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    // No reconciliation_run row exists for this call at all -- if this tried to UPDATE anything,
    // it would be a query against a nonexistent id, not a true no-op. Passing undefined must
    // short-circuit before any query runs.
    await expect(
      store.stampCarryForwardDecision(defaultOrganizationId, undefined, { enabled: true }),
    ).resolves.toBeUndefined();
  });

  it('loadOpenItems returns only still-OPEN items for the requested accounts (PR D.1)', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    await store.projectOpenItems(defaultOrganizationId, {
      jobId: await insertJob(),
      candidates: [
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-LOAD-1',
          naturalKey: 'check:OPEN-ITEM-STORE-LOAD-1:4001',
          checkNumber: '4001',
          amount: -333.33,
        }),
        // Different account -- must not come back when only LOAD-1 is requested.
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-LOAD-2',
          naturalKey: 'check:OPEN-ITEM-STORE-LOAD-2:4002',
          checkNumber: '4002',
        }),
      ],
    });

    const loaded = await store.loadOpenItems(defaultOrganizationId, ['OPEN-ITEM-STORE-LOAD-1']);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      accountIdentifier: 'OPEN-ITEM-STORE-LOAD-1',
      sourceSystem: 'gl',
      category: 'OutstandingCheck',
      naturalKey: 'check:OPEN-ITEM-STORE-LOAD-1:4001',
      naturalKeyTier: 1,
      originalTransactionDate: '2026-01-05',
      amount: -333.33,
      checkNumber: '4001',
    });
  });

  it('loadOpenItems returns an empty array for an empty account list without querying', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    expect(await store.loadOpenItems(defaultOrganizationId, [])).toEqual([]);
  });

  it('clearOpenItems marks an OPEN item CLEARED, stamps the clearing run and match result, and writes a CLEARED event', async () => {
    if (startupError) throw startupError;

    const jobId = await insertJob();
    const store = new PostgresOpenItemStore(runtimePool);
    await store.projectOpenItems(defaultOrganizationId, {
      jobId,
      candidates: [
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-CLEAR-1',
          naturalKey: 'check:OPEN-ITEM-STORE-CLEAR-1:5001',
          checkNumber: '5001',
        }),
      ],
    });
    const openItemRow = await pool.query<{ id: string }>(
      `SELECT oi.id FROM reconciliation_open_item oi
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-CLEAR-1'`,
    );
    const openItemId = openItemRow.rows[0]!.id;

    const matchResultId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_match_result
         (id, job_id, organization_id, result_bucket, disposition, confidence, rule_name, score, amount_difference)
       VALUES ($1, $2, $3, 'MATCH', 'ExactMatch', 'Exact', 'Reference + Amount Match', 1, 0)`,
      [matchResultId, jobId, defaultOrganizationId],
    );

    const clearingRunId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, 'Clearing Run', 'MONTHLY', 2026)`,
      [clearingRunId, defaultOrganizationId],
    );

    const result = await store.clearOpenItems(defaultOrganizationId, {
      reconciliationRunId: clearingRunId,
      clearances: [{ openItemId, matchResultId }],
    });
    expect(result).toEqual({ cleared: 1 });

    const row = await pool.query<{
      status: string;
      cleared_in_run_id: string;
      cleared_match_result_id: string;
      cleared_at: Date | null;
    }>(
      `SELECT status, cleared_in_run_id, cleared_match_result_id, cleared_at
         FROM reconciliation_open_item WHERE id = $1`,
      [openItemId],
    );
    expect(row.rows[0]?.status).toBe('CLEARED');
    expect(row.rows[0]?.cleared_in_run_id).toBe(clearingRunId);
    expect(row.rows[0]?.cleared_match_result_id).toBe(matchResultId);
    expect(row.rows[0]?.cleared_at).not.toBeNull();

    const events = await pool.query<{ event_type: string; from_status: string; to_status: string }>(
      `SELECT event_type, from_status, to_status FROM reconciliation_open_item_event
        WHERE open_item_id = $1 ORDER BY event_id`,
      [openItemId],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(['OPENED', 'CLEARED']);
    expect(events.rows[1]).toMatchObject({ from_status: 'OPEN', to_status: 'CLEARED' });

    // No longer OPEN -- must not come back from loadOpenItems.
    expect(await store.loadOpenItems(defaultOrganizationId, ['OPEN-ITEM-STORE-CLEAR-1'])).toEqual([]);
  });

  it('clearOpenItems is idempotent: clearing an already-CLEARED item is a harmless no-op', async () => {
    if (startupError) throw startupError;

    const jobId = await insertJob();
    const store = new PostgresOpenItemStore(runtimePool);
    await store.projectOpenItems(defaultOrganizationId, {
      jobId,
      candidates: [
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-CLEAR-2',
          naturalKey: 'check:OPEN-ITEM-STORE-CLEAR-2:5002',
          checkNumber: '5002',
        }),
      ],
    });
    const openItemRow = await pool.query<{ id: string }>(
      `SELECT oi.id FROM reconciliation_open_item oi
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-CLEAR-2'`,
    );
    const openItemId = openItemRow.rows[0]!.id;

    const first = await store.clearOpenItems(defaultOrganizationId, {
      clearances: [{ openItemId }],
    });
    const second = await store.clearOpenItems(defaultOrganizationId, {
      clearances: [{ openItemId }],
    });

    expect(first).toEqual({ cleared: 1 });
    expect(second).toEqual({ cleared: 0 });

    const events = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reconciliation_open_item_event WHERE open_item_id = $1 AND event_type = 'CLEARED'`,
      [openItemId],
    );
    expect(events.rows[0]?.count).toBe('1');
  });

  it('clearOpenItems writes a NULL cleared_match_result_id when no matchResultId is supplied', async () => {
    if (startupError) throw startupError;

    const jobId = await insertJob();
    const store = new PostgresOpenItemStore(runtimePool);
    await store.projectOpenItems(defaultOrganizationId, {
      jobId,
      candidates: [
        buildCandidate({
          accountIdentifier: 'OPEN-ITEM-STORE-CLEAR-3',
          naturalKey: 'check:OPEN-ITEM-STORE-CLEAR-3:5003',
          checkNumber: '5003',
        }),
      ],
    });
    const openItemRow = await pool.query<{ id: string }>(
      `SELECT oi.id FROM reconciliation_open_item oi
         JOIN reconciliation_account a ON a.id = oi.account_id
        WHERE a.account_identifier = 'OPEN-ITEM-STORE-CLEAR-3'`,
    );
    const openItemId = openItemRow.rows[0]!.id;

    await store.clearOpenItems(defaultOrganizationId, { clearances: [{ openItemId }] });

    const row = await pool.query<{ status: string; cleared_match_result_id: string | null }>(
      `SELECT status, cleared_match_result_id FROM reconciliation_open_item WHERE id = $1`,
      [openItemId],
    );
    expect(row.rows[0]).toEqual({ status: 'CLEARED', cleared_match_result_id: null });
  });

  /**
   * PR D.6's acceptance test, scoped to what this file can reach: `packages/persistence` has no
   * dependency on `@recon/core` (by design -- see the monorepo's own layering, `packages/core`
   * depends on `@recon/domain`, never the reverse), so the real matching engine/date-tolerance
   * widening and the `SummaryMetrics.rollForward` figure can't be exercised from here -- those are
   * covered directly in `packages/core/src/matching/engine.test.ts` ("Unreconciled Item
   * Roll-Forward PR D" describe block) and `packages/core/src/reporting/summary.test.ts`
   * ("rollForward" describe block). What this test proves is the real store's own two-period
   * open -> carry -> clear -> tie-out story: an item opened in period 1 is read back by D.1's
   * `loadOpenItems`, cleared by D.5's `clearOpenItems` once period 2 resolves it, and a second,
   * still-unresolved item from period 2 stays open into a would-be period 3 -- opening (1) + new
   * (1) - cleared (1) = closing (1), the control equation from §3.1, verified against real rows.
   */
  it('two-period story: an item opened in period 1 clears in period 2 while a period-2 item stays open (§3.1 tie-out)', async () => {
    if (startupError) throw startupError;

    const store = new PostgresOpenItemStore(runtimePool);
    const account = 'OPEN-ITEM-STORE-TWO-PERIOD';

    // Period 1: the run detects one outstanding check and projects it as OPEN.
    const period1JobId = await insertJob();
    const period1 = await store.projectOpenItems(defaultOrganizationId, {
      jobId: period1JobId,
      candidates: [
        buildCandidate({
          accountIdentifier: account,
          naturalKey: `check:${account}:6001`,
          checkNumber: '6001',
          amount: -400,
          originalTransactionDate: '2026-01-15',
        }),
      ],
    });
    expect(period1).toEqual({ opened: 1, carriedForward: 0 });

    // Period 2 starts: PR D.1 loads what's open going in -- this is period 2's "opening" balance.
    const opening = await store.loadOpenItems(defaultOrganizationId, [account]);
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ naturalKey: `check:${account}:6001`, amount: -400 });

    // Period 2's bank file finally shows check 6001 clearing (simulating what the real matching
    // engine + PR D.5's transaction-id lookup would have determined -- see engine.test.ts for
    // that half). Clear it against period 2's run.
    const period2RunId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year, period_month)
       VALUES ($1, $2, 'Period 2 Run', 'MONTHLY', 2026, 2)`,
      [period2RunId, defaultOrganizationId],
    );
    const clearResult = await store.clearOpenItems(defaultOrganizationId, {
      reconciliationRunId: period2RunId,
      clearances: [{ openItemId: opening[0]!.id }],
    });
    expect(clearResult).toEqual({ cleared: 1 });

    // Period 2 also has its own genuinely new, still-unresolved item (a fresh check that hasn't
    // presented yet) -- projected the same way period 1's was.
    const period2JobId = await insertJob();
    const period2Projection = await store.projectOpenItems(defaultOrganizationId, {
      jobId: period2JobId,
      reconciliationRunId: period2RunId,
      candidates: [
        buildCandidate({
          accountIdentifier: account,
          naturalKey: `check:${account}:6002`,
          checkNumber: '6002',
          amount: -175,
          originalTransactionDate: '2026-02-20',
        }),
      ],
    });
    expect(period2Projection).toEqual({ opened: 1, carriedForward: 0 });

    // Closing balance going into a would-be period 3: only check 6002, not the cleared 6001.
    const closing = await store.loadOpenItems(defaultOrganizationId, [account]);
    expect(closing).toHaveLength(1);
    expect(closing[0]).toMatchObject({ naturalKey: `check:${account}:6002`, amount: -175 });

    // opening (1) + new (1) - cleared (1) = closing (1).
    expect(opening.length + 1 - clearResult.cleared).toBe(closing.length);
  });
});
