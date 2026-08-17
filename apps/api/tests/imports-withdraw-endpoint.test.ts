import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

interface FakeRun {
  id: string;
  status: string;
  submitted_by: string | null;
}

/**
 * Self-contained fake for POST /api/imports/runs/:id/withdraw -- deliberately its own pool
 * (not an extension of imports-submit-endpoint.test.ts's createFakeSubmitPool) because that fake
 * documents and relies on FROM reconciliation_user always resolving to no rows ("submitted_by
 * always resolves to NULL"); withdrawRunApproval needs a real resolved actor id to reach its
 * not_submitter/withdrawn branches, which would mean changing behavior other tests in that file
 * depend on.
 */
const createFakeWithdrawPool = () => {
  const runs: FakeRun[] = [
    { id: 'run-pending', status: 'PENDING_APPROVAL', submitted_by: 'user-test-user' },
    { id: 'run-pending-other-submitter', status: 'PENDING_APPROVAL', submitted_by: 'user-other' },
    { id: 'run-draft', status: 'DRAFT', submitted_by: null },
  ];
  const userIdByUsername = new Map([
    ['test-user', 'user-test-user'],
    ['other-user', 'user-other'],
  ]);

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('FROM reconciliation_user')) {
      const [username] = params as [string];
      const id = userIdByUsername.get(username);
      return Promise.resolve({ rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 });
    }

    if (text.includes('SELECT status, submitted_by FROM reconciliation_run') && text.includes('FOR UPDATE')) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id);
      return Promise.resolve({
        rows: run ? [{ status: run.status, submitted_by: run.submitted_by }] : [],
        rowCount: run ? 1 : 0,
      });
    }

    if (text.includes("UPDATE reconciliation_run") && text.includes("SET status = 'DRAFT'")) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = 'DRAFT';
      run.submitted_by = null;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM reconciliation_run') && text.includes('WHERE id = $1')) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id);
      return Promise.resolve({
        rows: run
          ? [
              {
                id: run.id,
                label: 'Test Run',
                account_identifier: null,
                frequency: 'MONTHLY',
                period_year: 2026,
                period_month: 8,
                status: run.status,
                created_at: '2026-08-01T00:00:00.000Z',
              },
            ]
          : [],
        rowCount: run ? 1 : 0,
      });
    }

    if (text.includes('FROM run_source_file rsf') && text.includes('JOIN import_file')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`createFakeWithdrawPool: unexpected query: ${text}`);
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

describe('POST /api/imports/runs/:id/withdraw (Phase 14)', () => {
  it('withdraws the submitter\'s own PENDING_APPROVAL run to DRAFT', async () => {
    const app = appWithPool(createFakeWithdrawPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-pending/withdraw',
    );

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({ id: 'run-pending', status: 'DRAFT' });
  });

  it('returns 403 when the actor did not submit the run', async () => {
    const app = appWithPool(createFakeWithdrawPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-pending-other-submitter/withdraw',
    );

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/only the analyst who submitted/i);
  });

  it('returns 409 when the run is not PENDING_APPROVAL', async () => {
    const app = appWithPool(createFakeWithdrawPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-draft/withdraw',
    );

    expect(response.status).toBe(409);
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(createFakeWithdrawPool());

    const response = await authedApp(app, { role: 'senior-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/00000000-0000-0000-0000-000000000000/withdraw',
    );

    expect(response.status).toBe(404);
  });

  it('returns 403 for a role other than senior-analyst', async () => {
    const app = appWithPool(createFakeWithdrawPool());

    const response = await authedApp(app, { role: 'financial-analyst', sub: 'test-user' }).post(
      '/api/imports/runs/run-pending/withdraw',
    );

    expect(response.status).toBe(403);
  });

  it('returns 501 when no database pool is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);

    const response = await authedApp(app, { role: 'senior-analyst' }).post(
      '/api/imports/runs/some-id/withdraw',
    );

    expect(response.status).toBe(501);
  });
});
