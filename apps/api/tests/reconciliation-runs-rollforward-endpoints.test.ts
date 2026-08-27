import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { ERROR_DEFINITIONS, OPERATIONS } from '@recon/domain';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

const expectNoPoolError = (body: unknown, operation: keyof typeof OPERATIONS): void => {
  const definition = ERROR_DEFINITIONS['RCN-DB-001'];
  const parsed = body as { message: string; code: string; reference: string; retryable: boolean };
  expect(parsed.message).toBe(`Unable to ${OPERATIONS[operation]}. ${definition.publicMessage}`);
  expect(parsed.code).toBe('RCN-DB-001');
  expect(parsed.reference.length).toBeGreaterThan(0);
  expect(parsed.retryable).toBe(definition.retryable);
};

interface FakeRun {
  id: string;
  label: string;
  account_identifier: string | null;
  frequency: 'MONTHLY' | 'ANNUAL';
  period_year: number;
  period_month: number | null;
  period_end: string | null;
  status: string;
  created_at: string;
}

interface FakeOpenItem {
  id: string;
  account_identifier: string;
  source_system: string;
  category: string;
  status: string;
  natural_key: string;
  natural_key_tier: number;
  original_transaction_date: string;
  amount: string;
  check_number: string | null;
  reference_number: string | null;
  description_snapshot: string | null;
  age_in_days: number;
  owner_username: string | null;
  due_date: string | null;
  disposition_code: string | null;
  disposition_note: string | null;
}

/**
 * Unreconciled Item Roll-Forward PR F.1/F.2. Route-layer coverage only (query param validation,
 * 404 handling, response shape) -- PostgresImportRunStore.listRuns and
 * PostgresOpenItemStore.getRunRollforward's own filtering/join behavior is covered against a
 * real Postgres in packages/persistence/tests/importRunStore.test.ts and openItemStore.test.ts.
 */
const createFakePool = () => {
  const runs: FakeRun[] = [
    {
      id: 'run-jan',
      label: 'January',
      account_identifier: 'ACCT-1',
      frequency: 'MONTHLY',
      period_year: 2026,
      period_month: 1,
      period_end: '2026-01-31',
      status: 'CLOSED',
      created_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'run-feb',
      label: 'February',
      account_identifier: 'ACCT-1',
      frequency: 'MONTHLY',
      period_year: 2026,
      period_month: 2,
      period_end: '2026-02-28',
      status: 'RECONCILED',
      created_at: '2026-03-01T00:00:00.000Z',
    },
  ];

  const openItems: FakeOpenItem[] = [
    {
      id: 'item-1',
      account_identifier: 'ACCT-1',
      source_system: 'gl',
      category: 'OutstandingCheck',
      status: 'OPEN',
      natural_key: 'check:ACCT-1:5001',
      natural_key_tier: 1,
      original_transaction_date: '2026-01-05',
      amount: '-250.00',
      check_number: '5001',
      reference_number: null,
      description_snapshot: 'CHECK 5001',
      age_in_days: 60,
      owner_username: null,
      due_date: null,
      disposition_code: null,
      disposition_note: null,
    },
  ];

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('FROM reconciliation_run') && text.includes('ORDER BY period_year DESC')) {
      let matches = runs;
      let paramIndex = 1; // $1 is organizationId, already implicit in this fake
      if (text.includes(`account_identifier = $${paramIndex + 1}`)) {
        const accountIdentifier = params[paramIndex] as string;
        matches = matches.filter((r) => r.account_identifier === accountIdentifier);
        paramIndex += 1;
      }
      if (text.includes(`period_year = $${paramIndex + 1}`)) {
        const periodYear = params[paramIndex] as number;
        matches = matches.filter((r) => r.period_year === periodYear);
        paramIndex += 1;
      }
      if (text.includes(`period_month = $${paramIndex + 1}`)) {
        const periodMonth = params[paramIndex] as number;
        matches = matches.filter((r) => r.period_month === periodMonth);
      }
      return Promise.resolve({ rows: [...matches].reverse(), rowCount: matches.length });
    }

    if (text.includes('SELECT id FROM reconciliation_run WHERE id = $1')) {
      const [id] = params as [string];
      const run = runs.find((r) => r.id === id);
      return Promise.resolve({ rows: run ? [{ id: run.id }] : [], rowCount: run ? 1 : 0 });
    }

    if (text.includes('FROM reconciliation_period_rollforward')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('opened_in_run_id = $1') || text.includes('cleared_in_run_id = $1')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('FROM reconciliation_open_item oi') && text.includes('age_in_days')) {
      let matches = openItems;
      let paramIndex = 1;
      if (text.includes(`a.account_identifier = $${paramIndex + 1}`)) {
        const accountIdentifier = params[paramIndex] as string;
        matches = matches.filter((item) => item.account_identifier === accountIdentifier);
        paramIndex += 1;
      }
      if (text.includes(`oi.status = $${paramIndex + 1}`)) {
        const status = params[paramIndex] as string;
        matches = matches.filter((item) => item.status === status);
      }
      return Promise.resolve({ rows: matches, rowCount: matches.length });
    }

    if (text === 'SELECT 1') {
      // error-handling-build-plan.md EH7: requireDatabase now probes liveness on every guarded
      // request via checkDatabaseReachable(pool) -- this fake pool must answer it too.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`createFakePool: unexpected query: ${text}`);
  };

  const clientQuery = (text: string, params: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params[1] }], rowCount: 1 });
    }
    return query(text, params);
  };

  return {
    query,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

const appWithPool = (pool: Pool) =>
  createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]);

describe('GET /api/reconciliation/runs', () => {
  it('lists runs filtered by accountId, newest period first', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get('/api/reconciliation/runs?accountId=ACCT-1');

    expect(response.status).toBe(200);
    expect(response.body.runs.map((r: { id: string }) => r.id)).toEqual(['run-feb', 'run-jan']);
  });

  it('filters further by periodYear and periodMonth', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get(
      '/api/reconciliation/runs?accountId=ACCT-1&periodYear=2026&periodMonth=1',
    );

    expect(response.status).toBe(200);
    expect(response.body.runs.map((r: { id: string }) => r.id)).toEqual(['run-jan']);
  });

  it('returns 400 for a periodMonth out of range', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get('/api/reconciliation/runs?periodMonth=13');

    expect(response.status).toBe(400);
  });

  it('returns 503 when no database pool is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);

    const response = await authedApp(app).get('/api/reconciliation/runs');

    expect(response.status).toBe(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'RECONCILIATION_RUNS_LIST');
  });
});

describe('GET /api/reconciliation/runs/:id/rollforward', () => {
  it('returns the snapshot/open-item shape for a known run', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get('/api/reconciliation/runs/run-jan/rollforward');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ snapshots: [], openedThisRun: [], clearedThisRun: [] });
  });

  it('returns 404 for an unknown run', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get(
      '/api/reconciliation/runs/00000000-0000-0000-0000-000000000000/rollforward',
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /api/reconciliation/open-items', () => {
  it('lists open items filtered by account', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get('/api/reconciliation/open-items?accountId=ACCT-1');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: 'item-1',
      accountIdentifier: 'ACCT-1',
      status: 'OPEN',
      naturalKey: 'check:ACCT-1:5001',
      amount: -250,
      ageInDays: 60,
    });
  });

  it('filters by status', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get(
      '/api/reconciliation/open-items?accountId=ACCT-1&status=CLEARED',
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it('returns 400 for an unknown status value', async () => {
    const app = appWithPool(createFakePool());

    const response = await authedApp(app).get('/api/reconciliation/open-items?status=BOGUS');

    expect(response.status).toBe(400);
  });

  it('returns 503 when no database pool is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);

    const response = await authedApp(app).get('/api/reconciliation/open-items');

    expect(response.status).toBe(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'RECONCILIATION_OPEN_ITEMS_LIST');
  });
});
