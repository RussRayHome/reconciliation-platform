import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { ERROR_DEFINITIONS, OPERATIONS } from '@recon/domain';
import type { UserRole } from '@recon/domain';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

interface FakeRun {
  id: string;
  status: string;
  submitted_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  reopen_count: number;
  period_end: string | null;
}

interface FakeOpenItem {
  id: string;
  status: string;
  /** Signed, as in the real column -- a credit is negative. Issue #283 bands on the ABSOLUTE
   *  value, so the fixtures below are deliberately negative to keep that at the route layer too. */
  amount: number;
  disposition_code: string | null;
  disposition_note: string | null;
  written_off_by: string | null;
}

/**
 * Unreconciled Item Roll-Forward PR E. Route-layer coverage only (role gates, no-pool 503,
 * outcome-to-status-code mapping) -- PostgresOpenItemStore.closeRun/reopenRun/writeOffOpenItem's
 * own behavior (tie-out arithmetic, segregation of duty, is_stale propagation, etc.) is covered
 * thoroughly against a real Postgres in packages/persistence/tests/openItemStore.test.ts. The
 * "clean close" path here (a run with zero linked accounts) is deliberately the one exercised
 * end-to-end through the route, since it's the one path that doesn't require faking closeRun's
 * full per-account query sequence (prior snapshot, this-run activity, actual-open count) to prove
 * the route wires params/body/response correctly.
 */
const createFakeCloseReopenPool = () => {
  const runs: FakeRun[] = [
    {
      id: 'run-reconciled-clean',
      status: 'RECONCILED',
      submitted_by: 'user-other',
      closed_at: null,
      closed_by: null,
      reopen_count: 0,
      period_end: '2026-03-31',
    },
    {
      id: 'run-draft',
      status: 'DRAFT',
      submitted_by: null,
      closed_at: null,
      closed_by: null,
      reopen_count: 0,
      period_end: null,
    },
    {
      id: 'run-closed',
      status: 'CLOSED',
      submitted_by: 'user-other',
      closed_at: '2026-04-01T00:00:00.000Z',
      closed_by: 'user-test-user',
      reopen_count: 0,
      period_end: '2026-03-31',
    },
  ];
  const openItems: FakeOpenItem[] = [
    // -1,200: comfortably inside the lowest authority band.
    { id: 'item-open', status: 'OPEN', amount: -1200, disposition_code: null, disposition_note: null, written_off_by: null },
    { id: 'item-cleared', status: 'CLEARED', amount: -1200, disposition_code: null, disposition_note: null, written_off_by: null },
    // -50,000: above the CFO band's 40,000 ceiling, so it requires COO authority.
    { id: 'item-large', status: 'OPEN', amount: -50000, disposition_code: null, disposition_note: null, written_off_by: null },
    // Small enough that the band check passes; the UPDATE below rejects it the way the trigger does.
    { id: 'item-sod', status: 'OPEN', amount: -1200, disposition_code: null, disposition_note: null, written_off_by: null },
  ];
  // Issue #283 reads the actor's ROLE from the database, not from the bearer token, so which
  // authority a test exercises is set HERE -- changing authedApp's `role` claim does not move it.
  const usersByUsername = new Map<string, { id: string; role: UserRole }>([
    ['test-user', { id: 'user-test-user', role: 'controller' }],
    ['test-analyst', { id: 'user-test-analyst', role: 'senior-analyst' }],
    ['test-coo', { id: 'user-test-coo', role: 'coo' }],
  ]);

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('FROM reconciliation_user')) {
      const [username] = params as [string];
      const user = usersByUsername.get(username);
      return Promise.resolve({
        rows: user ? [{ id: user.id, role: user.role }] : [],
        rowCount: user ? 1 : 0,
      });
    }

    if (text.includes('SELECT id, status FROM reconciliation_run')) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id);
      return Promise.resolve({
        rows: run ? [{ id: run.id, status: run.status }] : [],
        rowCount: run ? 1 : 0,
      });
    }

    if (
      text.includes('SELECT id, status, period_end') &&
      text.includes('FROM reconciliation_run')
    ) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id);
      return Promise.resolve({
        rows: run ? [{ id: run.id, status: run.status, period_end: run.period_end }] : [],
        rowCount: run ? 1 : 0,
      });
    }

    if (text.includes('FROM reconciliation_run_account')) {
      // No accounts linked to any run in this fake -- exercises closeRun's "zero accounts, zero
      // snapshots, still closes" path.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes("UPDATE reconciliation_run SET status = 'CLOSED'")) {
      const [id, actorUserId] = params as [string, string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = 'CLOSED';
      run.closed_at = '2026-04-01T00:00:00.000Z';
      run.closed_by = actorUserId;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('UPDATE reconciliation_run_account SET is_terminal_good = TRUE')) {
      // No accounts linked to any run in this fake -- correcting is_terminal_good back past the
      // changeset 0062 trigger's own CLOSED gap (see closeRun's own doc comment) is a no-op here.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes("SET status = 'RECONCILED', closed_at = NULL")) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = 'RECONCILED';
      run.closed_at = null;
      run.closed_by = null;
      run.reopen_count += 1;
      return Promise.resolve({ rows: [{ reopen_count: run.reopen_count }], rowCount: 1 });
    }

    if (text.includes('INSERT INTO reconciliation_run_event')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (
      text.includes('UPDATE reconciliation_period_rollforward pr') &&
      text.includes('is_stale = TRUE')
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('FROM reconciliation_open_item') && text.includes('amount::text')) {
      const [id] = params as [string];
      const item = openItems.find((candidate) => candidate.id === id);
      // `amount::text` -- pg returns NUMERIC as a string and the store parses it back with
      // Number(), so returning a number here would hide a real driver-shape assumption.
      return Promise.resolve({
        rows: item ? [{ status: item.status, amount: String(item.amount) }] : [],
        rowCount: item ? 1 : 0,
      });
    }

    if (text.includes("UPDATE reconciliation_open_item") && text.includes("'WRITTEN_OFF'")) {
      const [id, dispositionCode, dispositionNote, writtenOffBy] = params as [
        string,
        string,
        string | null,
        string,
      ];
      // Changeset 0075's segregation-of-duty check is a database trigger, so the only faithful
      // fake of it is the error it raises. The constraint NAME matters and is not decoration: the
      // store discriminates on it to tell this apart from the approver-recorded CHECK, which
      // shares SQLSTATE 23514 but means the code failed to set written_off_by.
      if (id === 'item-sod') {
        return Promise.reject(
          Object.assign(new Error('Segregation of duty'), {
            code: '23514',
            constraint: 'reconciliation_open_item_writeoff_segregation_of_duty',
          }),
        );
      }
      const item = openItems.find((candidate) => candidate.id === id)!;
      item.status = 'WRITTEN_OFF';
      item.disposition_code = dispositionCode;
      item.disposition_note = dispositionNote;
      item.written_off_by = writtenOffBy;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('INSERT INTO reconciliation_open_item_event')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text === 'SELECT 1') {
      // error-handling-build-plan.md EH7: requireDatabase now probes liveness on every guarded
      // request via checkDatabaseReachable(pool) -- this fake pool must answer it too.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`createFakeCloseReopenPool: unexpected query: ${text}`);
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

describe('POST /api/imports/runs/:id/close', () => {
  it('closes a RECONCILED run with no linked accounts', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' }).post(
      '/api/imports/runs/run-reconciled-clean/close',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ snapshots: [] });
  });

  it('returns 409 when the run has not reached RECONCILED', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' }).post(
      '/api/imports/runs/run-draft/close',
    );

    expect(response.status).toBe(409);
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' }).post(
      '/api/imports/runs/00000000-0000-0000-0000-000000000000/close',
    );

    expect(response.status).toBe(404);
  });

  it('returns 403 for a role without canApprove', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-reconciled-clean/close',
    );

    expect(response.status).toBe(403);
  });

  it('returns 503 when no database pool is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);

    const response = await authedApp(app, { role: 'controller' }).post(
      '/api/imports/runs/some-id/close',
    );

    const definition = ERROR_DEFINITIONS['RCN-DB-001'];
    expect(response.status).toBe(definition.httpStatus);
    const body = response.body as {
      message: string;
      code: string;
      reference: string;
      retryable: boolean;
    };
    expect(body.message).toBe(`Unable to ${OPERATIONS.IMPORT_RUN_CLOSE}. ${definition.publicMessage}`);
    expect(body.code).toBe('RCN-DB-001');
    expect(body.reference.length).toBeGreaterThan(0);
    expect(body.retryable).toBe(definition.retryable);
  });
});

describe('POST /api/imports/runs/:id/reopen', () => {
  it('reopens a CLOSED run', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' }).post(
      '/api/imports/runs/run-closed/reopen',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reopenCount: 1, staleSnapshotCount: 0 });
  });

  it('returns 409 when the run is not CLOSED', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' }).post(
      '/api/imports/runs/run-reconciled-clean/reopen',
    );

    expect(response.status).toBe(409);
  });

  it('returns 403 for a role without canApprove', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-closed/reopen',
    );

    expect(response.status).toBe(403);
  });
});

describe('POST /api/imports/open-items/:id/write-off', () => {
  it('writes off an OPEN item', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' })
      .post('/api/imports/open-items/item-open/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED', dispositionNote: 'Escheatment pending' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'written_off' });
  });

  it('returns 400 when dispositionCode is missing', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' })
      .post('/api/imports/open-items/item-open/write-off')
      .send({});

    expect(response.status).toBe(400);
  });

  it('returns 409 when the item is not OPEN', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    const response = await authedApp(app, { role: 'controller', sub: 'test-user' })
      .post('/api/imports/open-items/item-cleared/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED' });

    expect(response.status).toBe(409);
  });

  it("returns 403 when the amount exceeds the actor's band, naming the authority required", async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    // item-large is -50,000. Banding on the ABSOLUTE value puts it above the CFO ceiling, so a
    // controller -- who may approve runs of any size -- cannot write this one off. Comparing the
    // raw signed amount would find -50000 <= 20000 and admit it at the lowest band.
    const response = await authedApp(app, { role: 'controller', sub: 'test-user' })
      .post('/api/imports/open-items/item-large/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED' });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('COO');
  });

  it('admits an analyst inside the lowest band, which the old canApprove gate rejected', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    // The deliberate widening in Issue #283: senior-analyst has canApprove === false and used to
    // be 403'd by the route before any amount was consulted. Pinning it means re-adding a
    // canApprove gate fails a test rather than silently narrowing authority back.
    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-analyst' })
      .post('/api/imports/open-items/item-open/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'written_off' });
  });

  it('lets a COO write off the amount a controller was refused', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    // Same item as the 403 above with only the actor changed, so a band check that rejected
    // everything rather than only under-authorised actors would fail here.
    const response = await authedApp(app, { role: 'coo', sub: 'test-coo' })
      .post('/api/imports/open-items/item-large/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'written_off' });
  });

  it('returns 409 when the database rejects the pairing for segregation of duty', async () => {
    const app = appWithPool(createFakeCloseReopenPool());

    // 409 rather than 403, matching how run-approval segregation is already surfaced: the actor's
    // role IS sufficient for this amount -- it is this maker/checker pairing that is not.
    const response = await authedApp(app, { role: 'controller', sub: 'test-user' })
      .post('/api/imports/open-items/item-sod/write-off')
      .send({ dispositionCode: 'STALE_UNCLAIMED' });

    expect(response.status).toBe(409);
  });
});
