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

/** Minimal reconciliation_run row for PR E's close/reopen tests -- status/period/submitted_by all
 * configurable since each test exercises a different lifecycle stage or account/period pairing. */
const insertRun = async (
  overrides: {
    status?: string;
    periodYear?: number;
    periodMonth?: number | null;
    periodEnd?: string | null;
    submittedByUsername?: string;
  } = {},
): Promise<string> => {
  const runId = crypto.randomUUID();
  const submittedById = overrides.submittedByUsername
    ? (
        await pool.query<{ id: string }>(
          'SELECT id FROM reconciliation_user WHERE user_name = $1 AND organization_id = $2',
          [overrides.submittedByUsername, defaultOrganizationId],
        )
      ).rows[0]?.id
    : null;
  await pool.query(
    `INSERT INTO reconciliation_run
       (id, organization_id, label, frequency, period_year, period_month, period_end, status,
        submitted_by)
     VALUES ($1, $2, 'PR E Test Run', 'MONTHLY', $3, $4, $5, $6, $7)`,
    [
      runId,
      defaultOrganizationId,
      overrides.periodYear ?? 2026,
      overrides.periodMonth ?? 3,
      overrides.periodEnd ?? '2026-03-31',
      overrides.status ?? 'RECONCILED',
      submittedById,
    ],
  );
  return runId;
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

      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ('close-submitter', 'Sam', 'Submitter', 'hash', 'senior-analyst', $1)
         ON CONFLICT DO NOTHING`,
        [defaultOrganizationId],
      );
      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ('close-approver', 'Ana', 'Approver', 'hash', 'controller', $1)
         ON CONFLICT DO NOTHING`,
        [defaultOrganizationId],
      );
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

  describe('linkRunAccounts (PR E.1 prerequisite fix)', () => {
    it('links a run to its accounts, creating them if needed, idempotently', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'DRAFT' });

      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: runId,
        accountIdentifiers: ['LINK-ACCOUNT-1', 'LINK-ACCOUNT-2'],
      });
      // Same call again -- must not duplicate or throw.
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: runId,
        accountIdentifiers: ['LINK-ACCOUNT-1', 'LINK-ACCOUNT-2'],
      });

      const linked = await pool.query<{ account_identifier: string }>(
        `SELECT a.account_identifier FROM reconciliation_run_account ra
           JOIN reconciliation_account a ON a.id = ra.account_id
          WHERE ra.reconciliation_run_id = $1
          ORDER BY a.account_identifier`,
        [runId],
      );
      expect(linked.rows.map((r) => r.account_identifier)).toEqual([
        'LINK-ACCOUNT-1',
        'LINK-ACCOUNT-2',
      ]);
    });

    it('is a no-op for an empty account list', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'DRAFT' });

      await expect(
        store.linkRunAccounts(defaultOrganizationId, {
          reconciliationRunId: runId,
          accountIdentifiers: [],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('closeRun (PR E.2)', () => {
    it('returns not_found for an unknown run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      expect(
        await store.closeRun(defaultOrganizationId, {
          runId: crypto.randomUUID(),
          actorUsername: 'close-approver',
        }),
      ).toEqual({ outcome: 'not_found' });
    });

    it('returns not_closable for a run that has not reached RECONCILED', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'DRAFT' });

      expect(
        await store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' }),
      ).toEqual({ outcome: 'not_closable', status: 'DRAFT' });
    });

    it('closes a clean RECONCILED run with no linked accounts, freezing zero snapshots', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });

      const result = await store.closeRun(defaultOrganizationId, {
        runId,
        actorUsername: 'close-approver',
      });
      expect(result).toEqual({ outcome: 'closed', snapshots: [] });

      const row = await pool.query<{ status: string; closed_at: Date | null; closed_by: string }>(
        'SELECT status, closed_at, closed_by FROM reconciliation_run WHERE id = $1',
        [runId],
      );
      expect(row.rows[0]?.status).toBe('CLOSED');
      expect(row.rows[0]?.closed_at).not.toBeNull();

      const events = await pool.query<{ event_type: string; from_status: string; to_status: string }>(
        'SELECT event_type, from_status, to_status FROM reconciliation_run_event WHERE run_id = $1',
        [runId],
      );
      expect(events.rows).toEqual([
        { event_type: 'CLOSED', from_status: 'RECONCILED', to_status: 'CLOSED' },
      ]);
    });

    it('keeps reconciliation_run_account.is_terminal_good TRUE across the RECONCILED -> CLOSED transition', async () => {
      if (startupError) throw startupError;

      // Regression coverage for changeset 0062's own trigger, which only recognizes the literal
      // 'RECONCILED' status -- without closeRun's explicit follow-up UPDATE, this transition
      // would silently flip is_terminal_good to FALSE and reopen the account+period to a second
      // concurrent RECONCILED run, defeating changeset 0062's own uniqueness guarantee.
      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: runId,
        accountIdentifiers: ['CLOSE-TERMINAL-GOOD-1'],
      });

      const beforeClose = await pool.query<{ is_terminal_good: boolean }>(
        'SELECT is_terminal_good FROM reconciliation_run_account WHERE reconciliation_run_id = $1',
        [runId],
      );
      expect(beforeClose.rows[0]?.is_terminal_good).toBe(true);

      await store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' });

      const afterClose = await pool.query<{ is_terminal_good: boolean }>(
        'SELECT is_terminal_good FROM reconciliation_run_account WHERE reconciliation_run_id = $1',
        [runId],
      );
      expect(afterClose.rows[0]?.is_terminal_good).toBe(true);
    });

    it('recomputes and freezes a snapshot reflecting this run\'s own open-item activity', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });
      const jobId = await insertJob();

      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: runId,
        accountIdentifiers: ['CLOSE-SNAPSHOT-1'],
      });
      await store.projectOpenItems(defaultOrganizationId, {
        jobId,
        reconciliationRunId: runId,
        candidates: [
          buildCandidate({
            accountIdentifier: 'CLOSE-SNAPSHOT-1',
            naturalKey: 'check:CLOSE-SNAPSHOT-1:7001',
            checkNumber: '7001',
            amount: -125.5,
          }),
        ],
      });

      const result = await store.closeRun(defaultOrganizationId, {
        runId,
        actorUsername: 'close-approver',
      });

      expect(result.outcome).toBe('closed');
      if (result.outcome !== 'closed') throw new Error('expected closed');
      expect(result.snapshots).toHaveLength(1);
      // Snapshot amounts are stored SIGNED (matching reconciliation_open_item.amount itself), not
      // abs()-ed like SummaryMetrics.rollForward's UI-facing exposure figures -- a genuine dollar
      // rollforward, not an exposure count. The candidate's amount is -125.5.
      expect(result.snapshots[0]).toMatchObject({
        accountIdentifier: 'CLOSE-SNAPSHOT-1',
        openingCount: 0,
        openingAmount: 0,
        newCount: 1,
        newAmount: -125.5,
        clearedCount: 0,
        clearedAmount: 0,
        writtenOffCount: 0,
        writtenOffAmount: 0,
        closingCount: 1,
        closingAmount: -125.5,
      });

      const persisted = await pool.query<{
        opening_count: number;
        new_count: number;
        closing_count: number;
        closing_amount: string;
        is_stale: boolean;
      }>(
        `SELECT opening_count, new_count, closing_count, closing_amount, is_stale
           FROM reconciliation_period_rollforward WHERE reconciliation_run_id = $1`,
        [runId],
      );
      expect(persisted.rows[0]).toMatchObject({
        opening_count: 0,
        new_count: 1,
        closing_count: 1,
        closing_amount: '-125.50',
        is_stale: false,
      });
    });

    it('rejects closing with the same actor who submitted the run (segregation of duty)', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });

      await expect(
        store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-submitter' }),
      ).rejects.toThrow();
    });

    it('returns not_closable when closing an already-CLOSED run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });
      await store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' });

      expect(
        await store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' }),
      ).toEqual({ outcome: 'not_closable', status: 'CLOSED' });
    });
  });

  describe('reopenRun (PR E.3)', () => {
    it('returns not_found for an unknown run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      expect(
        await store.reopenRun(defaultOrganizationId, {
          runId: crypto.randomUUID(),
          actorUsername: 'close-approver',
        }),
      ).toEqual({ outcome: 'not_found' });
    });

    it('returns not_closed for a run that is not CLOSED', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED' });

      expect(
        await store.reopenRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' }),
      ).toEqual({ outcome: 'not_closed', status: 'RECONCILED' });
    });

    it('reopens a closed run: status back to RECONCILED, reopen_count incremented, closed_at/closed_by cleared, event written', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });
      await store.closeRun(defaultOrganizationId, { runId, actorUsername: 'close-approver' });

      const result = await store.reopenRun(defaultOrganizationId, {
        runId,
        actorUsername: 'close-approver',
      });
      expect(result).toMatchObject({ outcome: 'reopened', reopenCount: 1 });

      const row = await pool.query<{
        status: string;
        closed_at: Date | null;
        closed_by: string | null;
        reopen_count: number;
      }>('SELECT status, closed_at, closed_by, reopen_count FROM reconciliation_run WHERE id = $1', [
        runId,
      ]);
      expect(row.rows[0]).toMatchObject({
        status: 'RECONCILED',
        closed_at: null,
        closed_by: null,
        reopen_count: 1,
      });

      const events = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM reconciliation_run_event WHERE run_id = $1 ORDER BY event_id`,
        [runId],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['CLOSED', 'REOPENED']);
    });

    it('marks a later closed period\'s snapshot is_stale, but leaves an earlier one alone', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const account = 'REOPEN-STALE-1';

      const januaryRunId = await insertRun({
        status: 'RECONCILED',
        submittedByUsername: 'close-submitter',
        periodYear: 2026,
        periodMonth: 1,
        periodEnd: '2026-01-31',
      });
      const februaryRunId = await insertRun({
        status: 'RECONCILED',
        submittedByUsername: 'close-submitter',
        periodYear: 2026,
        periodMonth: 2,
        periodEnd: '2026-02-28',
      });
      const marchRunId = await insertRun({
        status: 'RECONCILED',
        submittedByUsername: 'close-submitter',
        periodYear: 2026,
        periodMonth: 3,
        periodEnd: '2026-03-31',
      });

      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: januaryRunId,
        accountIdentifiers: [account],
      });
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: februaryRunId,
        accountIdentifiers: [account],
      });
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: marchRunId,
        accountIdentifiers: [account],
      });

      await store.closeRun(defaultOrganizationId, { runId: januaryRunId, actorUsername: 'close-approver' });
      await store.closeRun(defaultOrganizationId, { runId: februaryRunId, actorUsername: 'close-approver' });
      await store.closeRun(defaultOrganizationId, { runId: marchRunId, actorUsername: 'close-approver' });

      // Reopening February should flag March's snapshot (later) as stale but leave January's
      // (earlier) alone.
      const result = await store.reopenRun(defaultOrganizationId, {
        runId: februaryRunId,
        actorUsername: 'close-approver',
      });
      expect(result).toMatchObject({ outcome: 'reopened', staleSnapshotCount: 1 });

      const staleFlags = await pool.query<{ reconciliation_run_id: string; is_stale: boolean }>(
        `SELECT reconciliation_run_id, is_stale FROM reconciliation_period_rollforward
          WHERE reconciliation_run_id = ANY($1::uuid[])`,
        [[januaryRunId, marchRunId]],
      );
      const staleByRun = Object.fromEntries(
        staleFlags.rows.map((row) => [row.reconciliation_run_id, row.is_stale]),
      );
      expect(staleByRun[januaryRunId]).toBe(false);
      expect(staleByRun[marchRunId]).toBe(true);
    });
  });

  describe('writeOffOpenItem (PR E.4)', () => {
    it('returns not_found for an unknown open item', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      expect(
        await store.writeOffOpenItem(defaultOrganizationId, {
          openItemId: crypto.randomUUID(),
          actorUsername: 'close-approver',
          dispositionCode: 'STALE_UNCLAIMED',
        }),
      ).toEqual({ outcome: 'not_found' });
    });

    it('returns not_open for an item that is not OPEN', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        candidates: [
          buildCandidate({
            accountIdentifier: 'WRITEOFF-NOT-OPEN-1',
            naturalKey: 'check:WRITEOFF-NOT-OPEN-1:8001',
            checkNumber: '8001',
          }),
        ],
      });
      const store2 = new PostgresOpenItemStore(runtimePool);
      const openItemRow = await pool.query<{ id: string }>(
        `SELECT oi.id FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
          WHERE a.account_identifier = 'WRITEOFF-NOT-OPEN-1'`,
      );
      const openItemId = openItemRow.rows[0]!.id;
      await store2.clearOpenItems(defaultOrganizationId, { clearances: [{ openItemId }] });

      expect(
        await store.writeOffOpenItem(defaultOrganizationId, {
          openItemId,
          actorUsername: 'close-approver',
          dispositionCode: 'STALE_UNCLAIMED',
        }),
      ).toEqual({ outcome: 'not_open', status: 'CLEARED' });
    });

    it('writes off an OPEN item: status WRITTEN_OFF, disposition persisted, event written, row never deleted', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        candidates: [
          buildCandidate({
            accountIdentifier: 'WRITEOFF-OPEN-1',
            naturalKey: 'check:WRITEOFF-OPEN-1:8002',
            checkNumber: '8002',
          }),
        ],
      });
      const openItemRow = await pool.query<{ id: string }>(
        `SELECT oi.id FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
          WHERE a.account_identifier = 'WRITEOFF-OPEN-1'`,
      );
      const openItemId = openItemRow.rows[0]!.id;

      const result = await store.writeOffOpenItem(defaultOrganizationId, {
        openItemId,
        actorUsername: 'close-approver',
        dispositionCode: 'STALE_UNCLAIMED',
        dispositionNote: 'Escheatment review pending',
      });
      expect(result).toEqual({ outcome: 'written_off' });

      const row = await pool.query<{
        status: string;
        disposition_code: string;
        disposition_note: string;
      }>(
        'SELECT status, disposition_code, disposition_note FROM reconciliation_open_item WHERE id = $1',
        [openItemId],
      );
      expect(row.rows[0]).toEqual({
        status: 'WRITTEN_OFF',
        disposition_code: 'STALE_UNCLAIMED',
        disposition_note: 'Escheatment review pending',
      });

      const events = await pool.query<{ event_type: string; from_status: string; to_status: string }>(
        'SELECT event_type, from_status, to_status FROM reconciliation_open_item_event WHERE open_item_id = $1 ORDER BY event_id',
        [openItemId],
      );
      expect(events.rows[events.rows.length - 1]).toEqual({
        event_type: 'WRITTEN_OFF',
        from_status: 'OPEN',
        to_status: 'WRITTEN_OFF',
      });
    });
  });

  describe('getRunRollforward (PR F.2)', () => {
    it('returns null for an unknown run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      expect(await store.getRunRollforward(defaultOrganizationId, crypto.randomUUID())).toBeNull();
    });

    it('returns an empty snapshots array for a run that has never been closed', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const runId = await insertRun({ status: 'DRAFT' });

      expect(await store.getRunRollforward(defaultOrganizationId, runId)).toEqual({
        snapshots: [],
        openedThisRun: [],
        clearedThisRun: [],
      });
    });

    it('returns the frozen snapshot plus this run\'s own opened/cleared open items after close', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      const account = 'ROLLFORWARD-DETAIL-1';

      // February closes first, with its own item still open at close -- gives that item a real
      // "opening" pedigree for March. Periods must close in chronological order: an item left
      // open in a later, not-yet-closed period would otherwise show up in an earlier period's
      // "actual currently open" count and fail that earlier close's own tie-out.
      const priorRunId = await insertRun({
        status: 'RECONCILED',
        submittedByUsername: 'close-submitter',
        periodYear: 2026,
        periodMonth: 2,
        periodEnd: '2026-02-28',
      });
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: priorRunId,
        accountIdentifiers: [account],
      });
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        reconciliationRunId: priorRunId,
        candidates: [
          buildCandidate({
            accountIdentifier: account,
            naturalKey: `check:${account}:9002`,
            checkNumber: '9002',
            amount: -20,
          }),
        ],
      });
      const priorClose = await store.closeRun(defaultOrganizationId, {
        runId: priorRunId,
        actorUsername: 'close-approver',
      });
      expect(priorClose.outcome).toBe('closed');

      // March: opens a genuinely new item (9001) and clears February's carried item (9002).
      const runId = await insertRun({ status: 'RECONCILED', submittedByUsername: 'close-submitter' });
      await store.linkRunAccounts(defaultOrganizationId, {
        reconciliationRunId: runId,
        accountIdentifiers: [account],
      });
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        reconciliationRunId: runId,
        candidates: [
          buildCandidate({
            accountIdentifier: account,
            naturalKey: `check:${account}:9001`,
            checkNumber: '9001',
            amount: -50,
          }),
        ],
      });

      const priorItemRow = await pool.query<{ id: string }>(
        `SELECT oi.id FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
          WHERE a.account_identifier = $1 AND oi.natural_key = $2`,
        [account, `check:${account}:9002`],
      );
      await store.clearOpenItems(defaultOrganizationId, {
        reconciliationRunId: runId,
        clearances: [{ openItemId: priorItemRow.rows[0]!.id }],
      });

      const closeResult = await store.closeRun(defaultOrganizationId, {
        runId,
        actorUsername: 'close-approver',
      });
      expect(closeResult.outcome).toBe('closed');

      const result = await store.getRunRollforward(defaultOrganizationId, runId);
      expect(result?.snapshots).toHaveLength(1);
      expect(result?.snapshots[0]).toMatchObject({
        accountIdentifier: account,
        newCount: 1,
        newAmount: -50,
        clearedCount: 1,
        clearedAmount: -20,
      });
      expect(result?.openedThisRun.map((i) => i.naturalKey)).toEqual([`check:${account}:9001`]);
      expect(result?.clearedThisRun.map((i) => i.naturalKey)).toEqual([`check:${account}:9002`]);
    });
  });

  describe('listOpenItemsSchedule (PR F.4)', () => {
    it('lists items with a computed ageInDays and a null owner (nothing assigns it yet)', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        candidates: [
          buildCandidate({
            accountIdentifier: 'SCHEDULE-1',
            naturalKey: 'check:SCHEDULE-1:1001',
            checkNumber: '1001',
            originalTransactionDate: '2026-01-01',
            amount: -300,
          }),
        ],
      });

      const items = await store.listOpenItemsSchedule(defaultOrganizationId, {
        accountIdentifier: 'SCHEDULE-1',
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        accountIdentifier: 'SCHEDULE-1',
        status: 'OPEN',
        naturalKey: 'check:SCHEDULE-1:1001',
        amount: -300,
        ownerUsername: undefined,
        dueDate: undefined,
      });
      expect(items[0]!.ageInDays).toBeGreaterThan(0);
    });

    it('filters by status', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      await store.projectOpenItems(defaultOrganizationId, {
        jobId: await insertJob(),
        candidates: [
          buildCandidate({
            accountIdentifier: 'SCHEDULE-2',
            naturalKey: 'check:SCHEDULE-2:2001',
            checkNumber: '2001',
          }),
        ],
      });
      const openItemRow = await pool.query<{ id: string }>(
        `SELECT oi.id FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
          WHERE a.account_identifier = 'SCHEDULE-2'`,
      );
      await store.clearOpenItems(defaultOrganizationId, {
        clearances: [{ openItemId: openItemRow.rows[0]!.id }],
      });

      const openOnly = await store.listOpenItemsSchedule(defaultOrganizationId, {
        accountIdentifier: 'SCHEDULE-2',
        status: 'OPEN',
      });
      const clearedOnly = await store.listOpenItemsSchedule(defaultOrganizationId, {
        accountIdentifier: 'SCHEDULE-2',
        status: 'CLEARED',
      });

      expect(openOnly).toHaveLength(0);
      expect(clearedOnly).toHaveLength(1);
      expect(clearedOnly[0]?.status).toBe('CLEARED');
    });

    it('returns an empty array when nothing matches', async () => {
      if (startupError) throw startupError;

      const store = new PostgresOpenItemStore(runtimePool);
      expect(
        await store.listOpenItemsSchedule(defaultOrganizationId, {
          accountIdentifier: 'SCHEDULE-NONEXISTENT',
        }),
      ).toEqual([]);
    });
  });
});
