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

const DRAFT_ROW = {
  id: 'mcv-1',
  organization_id: 'test-org',
  version_number: 8,
  status: 'DRAFT',
  variance_overrides: { wireFeeTolerance: 750 },
  created_by: 'test-user',
  created_at: '2026-08-04T00:00:00.000Z',
  published_by: null,
  published_at: null,
  effective_at: null,
  pending_approval_owner: null,
};

const ACTIVE_ROW = {
  ...DRAFT_ROW,
  id: 'mcv-0',
  version_number: 7,
  status: 'ACTIVE',
  published_by: 'mortega',
  published_at: '2026-08-01T00:00:00.000Z',
  effective_at: '2026-08-01T00:00:00.000Z',
};

/**
 * Fake pool answering exactly the query shapes createMatchingConfigVersionDraft/
 * publishMatchingConfigVersion/listMatchingConfigVersions issue (readModelStore.ts), matched by
 * SQL text fragment the same way createFakeMappingPool (mapping-endpoints.test.ts) does.
 */
const createFakePool = (
  overrides: Partial<{
    insertRows: unknown[];
    activateRows: unknown[];
    listRows: unknown[];
    insertErrorCode: string;
    approvalRequestRows: unknown[];
  }> = {},
): Pool => {
  const clientQuery = (text: string, _params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: 'test-org' }], rowCount: 1 });
    }
    if (text.includes('INSERT INTO reconciliation_matching_config_version')) {
      if (overrides.insertErrorCode) {
        const error = Object.assign(new Error('duplicate key value'), {
          code: overrides.insertErrorCode,
        });
        return Promise.reject(error);
      }
      return Promise.resolve({ rows: overrides.insertRows ?? [DRAFT_ROW] });
    }
    if (text.includes("SET status = 'ACTIVE'")) {
      return Promise.resolve({ rows: overrides.activateRows ?? [] });
    }
    if (text.includes("SET status = 'SUPERSEDED'")) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT') && text.includes('FROM reconciliation_matching_config_version')) {
      return Promise.resolve({ rows: overrides.listRows ?? [] });
    }
    // Draft creation also opens an Approvals-queue entry (createApprovalRequest); publish also
    // looks for one to auto-resolve (listApprovalRequests) -- see app.ts's rules/versions routes.
    if (text.includes('INSERT INTO reconciliation_approval_request')) {
      return Promise.resolve({
        rows: [
          {
            id: 'ar-1',
            subject_type: 'matchingRule',
            subject_id: DRAFT_ROW.id,
            status: 'PENDING',
            submitted_by: 'test-user',
            decided_by: null,
            rationale: null,
            requested_at: '2026-08-04T00:00:00.000Z',
            decided_at: null,
          },
        ],
      });
    }
    if (text.includes('SELECT') && text.includes('FROM reconciliation_approval_request')) {
      return Promise.resolve({ rows: overrides.approvalRequestRows ?? [] });
    }
    if (text === 'SELECT 1') {
      // error-handling-build-plan.md EH7: requireDatabase now probes liveness on every guarded
      // request via checkDatabaseReachable(pool) -- this fake pool must answer it too.
      return Promise.resolve({ rows: [] });
    }
    throw new Error(`createFakePool: unexpected query: ${text}`);
  };

  return {
    query: clientQuery,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

describe('GET /api/rules/versions', () => {
  it('splits the org history into active/draft plus the full list, with overridesAppliedToEngine true', async () => {
    const pool = createFakePool({ listRows: [DRAFT_ROW, ACTIVE_ROW] });
    const app = createApp(undefined, undefined, undefined, pool);
    const response = await authedApp(app).get('/api/rules/versions').expect(200);

    expect(response.body.active.id).toBe('mcv-0');
    expect(response.body.draft.id).toBe('mcv-1');
    expect(response.body.history).toHaveLength(2);
    // Issue #260: true since a run resolves its organization's ACTIVE version and hands those
    // overrides to the engine. This flag is what the UI reads to decide whether an ACTIVE version's
    // sliders are more than cosmetic, so it asserting `false` was the visible half of the defect --
    // the platform telling its own users the values do not apply.
    expect(response.body.overridesAppliedToEngine).toBe(true);
  });

  it('returns null active/draft when neither exists yet', async () => {
    const pool = createFakePool({ listRows: [] });
    const app = createApp(undefined, undefined, undefined, pool);
    const response = await authedApp(app).get('/api/rules/versions').expect(200);

    expect(response.body.active).toBeNull();
    expect(response.body.draft).toBeNull();
    expect(response.body.history).toEqual([]);
  });

  it('returns 503 when no database is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);
    const response = await authedApp(app)
      .get('/api/rules/versions')
      .expect(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'RULE_VERSIONS_LIST');
  });
});

describe('POST /api/rules/versions/draft', () => {
  it('creates a draft when the caller can adjust slider defaults', async () => {
    const pool = createFakePool({ insertRows: [DRAFT_ROW] });
    const app = createApp(undefined, undefined, undefined, pool);
    const response = await authedApp(app)
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: { wireFeeTolerance: 750 }, reason: 'Widen wire fee tolerance' })
      .expect(201);

    expect(response.body.status).toBe('DRAFT');
    expect(response.body.varianceOverrides).toEqual({ wireFeeTolerance: 750 });
  });

  it('rejects a non-admin role with 403', async () => {
    const pool = createFakePool();
    const app = createApp(undefined, undefined, undefined, pool);
    await authedApp(app, { role: 'financial-analyst' })
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: {}, reason: 'Fixture draft' })
      .expect(403);
  });

  // #404: the reason is required, and "required" that accepts whitespace is not required.
  // Worth its own case because the three tests above were silently relying on it being optional --
  // making it required turned the unknown-metric test into a test of the missing reason instead,
  // which is the kind of drift that leaves a suite asserting something other than its own name.
  it('rejects a draft with no reason, and one that is only whitespace', async () => {
    const pool = createFakePool({ insertRows: [DRAFT_ROW] });
    const app = createApp(undefined, undefined, undefined, pool);

    await authedApp(app).post('/api/rules/versions/draft').send({ varianceOverrides: {} }).expect(400);

    // Trimmed before the min(1) check, so whitespace is not a reason.
    await authedApp(app)
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: {}, reason: '   ' })
      .expect(400);
  });

  it('rejects an unknown variance metric id with 400', async () => {
    const pool = createFakePool();
    const app = createApp(undefined, undefined, undefined, pool);
    const response = await authedApp(app)
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: { notARealMetric: 1 }, reason: 'Probe unknown metric' })
      .expect(400);

    expect(response.body.message).toContain('notARealMetric');
  });

  it('returns 409 when a draft is already pending for the organization', async () => {
    const pool = createFakePool({ insertErrorCode: '23505' });
    const app = createApp(undefined, undefined, undefined, pool);
    await authedApp(app)
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: {}, reason: 'Fixture draft' })
      .expect(409);
  });

  it('returns 503 when no database is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);
    const response = await authedApp(app)
      .post('/api/rules/versions/draft')
      .send({ varianceOverrides: {}, reason: 'Fixture draft' })
      .expect(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'RULE_VERSION_DRAFT');
  });
});

describe('POST /api/rules/versions/:id/publish', () => {
  it('publishes a draft when the caller can adjust slider defaults', async () => {
    const pool = createFakePool({
      activateRows: [{ ...DRAFT_ROW, status: 'ACTIVE', published_by: 'test-user' }],
    });
    const app = createApp(undefined, undefined, undefined, pool);
    const response = await authedApp(app).post('/api/rules/versions/mcv-1/publish').send({}).expect(200);

    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.publishedBy).toBe('test-user');
  });

  it('rejects a non-admin role with 403', async () => {
    const pool = createFakePool();
    const app = createApp(undefined, undefined, undefined, pool);
    await authedApp(app, { role: 'financial-analyst' })
      .post('/api/rules/versions/mcv-1/publish')
      .send({})
      .expect(403);
  });

  it('returns 404 when there is no matching draft to publish', async () => {
    const pool = createFakePool({ activateRows: [] });
    const app = createApp(undefined, undefined, undefined, pool);
    await authedApp(app).post('/api/rules/versions/mcv-missing/publish').send({}).expect(404);
  });

  it('rejects a malformed effectiveAt with 400 instead of silently dropping it', async () => {
    const pool = createFakePool();
    const app = createApp(undefined, undefined, undefined, pool);
    await authedApp(app)
      .post('/api/rules/versions/mcv-1/publish')
      .send({ effectiveAt: 'not-a-date' })
      .expect(400);
  });

  it('returns 503 when no database is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);
    const response = await authedApp(app)
      .post('/api/rules/versions/mcv-1/publish')
      .send({})
      .expect(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'RULE_VERSION_PUBLISH');
  });
});
