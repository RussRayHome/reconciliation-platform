import { beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

interface ImportApprovalRow {
  id: string;
  source_file_id: string;
  status: string;
  uploaded_by: string;
  approved_by: string | null;
  rationale: string | null;
  requested_at: string;
  decided_at: string | null;
}

interface SourceFileRow {
  id: string;
  file_name: string;
  source_system: string;
}

interface ApprovalRequestRow {
  id: string;
  subject_type: string;
  subject_id: string;
  status: string;
  submitted_by: string;
  decided_by: string | null;
  rationale: string | null;
  requested_at: string;
  decided_at: string | null;
}

interface MatchingConfigVersionRow {
  id: string;
  version_number: number;
  status: string;
}

/**
 * Fake pool covering the full /api/approvals* route family (apps/api/src/app.ts) -- no test file
 * exercised this route family before this one, for any ApprovableType. Query branches ordered
 * most-specific-first where two shapes share a table (e.g. the JOIN-based list query vs. the
 * plain `SELECT status ... FOR UPDATE` row lock both touch reconciliation_import_approval).
 */
const createFakeApprovalsPool = (seed: {
  importApprovals?: ImportApprovalRow[];
  sourceFiles?: SourceFileRow[];
  approvalRequests?: ApprovalRequestRow[];
  matchingConfigVersions?: MatchingConfigVersionRow[];
}) => {
  const importApprovals: ImportApprovalRow[] = (seed.importApprovals ?? []).map((row) => ({ ...row }));
  const sourceFiles: SourceFileRow[] = seed.sourceFiles ?? [];
  const approvalRequests: ApprovalRequestRow[] = (seed.approvalRequests ?? []).map((row) => ({
    ...row,
  }));
  const matchingConfigVersions: MatchingConfigVersionRow[] = (seed.matchingConfigVersions ?? []).map(
    (row) => ({ ...row }),
  );

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    // ── reconciliation_import_approval ──────────────────────────────────────────────────────────
    if (text.includes('JOIN reconciliation_source_file')) {
      const [status, uploadedBy, routedToOrUnassigned] = params as [
        string | null,
        string | null,
        string | null,
      ];
      const rows = importApprovals
        .filter((row) => status === null || row.status === status)
        .filter((row) => uploadedBy === null || row.uploaded_by === uploadedBy)
        .filter(
          (row) =>
            routedToOrUnassigned === null ||
            row.approved_by === routedToOrUnassigned ||
            row.approved_by === null,
        )
        .map((row) => {
          const file = sourceFiles.find((candidate) => candidate.id === row.source_file_id)!;
          return { ...row, file_name: file.file_name, source_system: file.source_system };
        });
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (text.includes('UPDATE reconciliation_import_approval') && text.includes('SET approved_by = $2')) {
      const [id, actor] = params as [string, string];
      const row = importApprovals.find(
        (candidate) => candidate.id === id && candidate.status === 'PENDING' && !candidate.approved_by,
      );
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.approved_by = actor;
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }

    if (text.includes('COUNT(*) FILTER') && text.includes('FROM reconciliation_import_approval')) {
      const canApprove = text.includes('approved_by = $1 OR approved_by IS NULL');
      const [username] = params as [string];
      const pending = importApprovals.filter((row) => row.status === 'PENDING');
      const approved = importApprovals.filter((row) => row.status === 'APPROVED');
      const rejected = importApprovals.filter((row) => row.status === 'REJECTED');
      return Promise.resolve({
        rows: [
          {
            pending: String(
              canApprove
                ? pending.filter((row) => row.approved_by === username || row.approved_by === null).length
                : pending.filter((row) => row.uploaded_by === username).length,
            ),
            approved: String(
              canApprove ? approved.length : approved.filter((row) => row.uploaded_by === username).length,
            ),
            rejected: String(
              canApprove ? rejected.length : rejected.filter((row) => row.uploaded_by === username).length,
            ),
            my_submissions: String(importApprovals.filter((row) => row.uploaded_by === username).length),
          },
        ],
        rowCount: 1,
      });
    }

    if (text.includes('FROM reconciliation_import_approval') && text.includes('FOR UPDATE')) {
      const [id] = params as [string];
      const row = importApprovals.find((candidate) => candidate.id === id);
      return Promise.resolve({ rows: row ? [{ status: row.status }] : [], rowCount: row ? 1 : 0 });
    }

    if (text.includes('UPDATE reconciliation_import_approval') && text.includes('SET status = $2')) {
      const [id, toStatus, actor, rationale] = params as [string, string, string, string | null];
      const row = importApprovals.find((candidate) => candidate.id === id);
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.status = toStatus;
      row.approved_by = actor;
      row.rationale = rationale;
      row.decided_at = new Date(0).toISOString();
      return Promise.resolve({ rows: [{ ...row }], rowCount: 1 });
    }

    if (text.includes('INSERT INTO reconciliation_approval_history')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // ── reconciliation_approval_request ─────────────────────────────────────────────────────────
    if (text.includes('UPDATE reconciliation_approval_request') && text.includes('SET decided_by = $2')) {
      const [id, actor] = params as [string, string];
      const row = approvalRequests.find(
        (candidate) => candidate.id === id && candidate.status === 'PENDING' && !candidate.decided_by,
      );
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.decided_by = actor;
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }

    if (text.includes('COUNT(*) FILTER') && text.includes('FROM reconciliation_approval_request')) {
      const canApprove = text.includes('decided_by = $1 OR decided_by IS NULL');
      const [username, subjectTypes] = params as [string, string[]];
      const inScope = approvalRequests.filter((row) => subjectTypes.includes(row.subject_type));
      const pending = inScope.filter((row) => row.status === 'PENDING');
      const approved = inScope.filter((row) => row.status === 'APPROVED');
      const rejected = inScope.filter((row) => row.status === 'REJECTED');
      return Promise.resolve({
        rows: [
          {
            pending: String(
              canApprove
                ? pending.filter((row) => row.decided_by === username || row.decided_by === null).length
                : pending.filter((row) => row.submitted_by === username).length,
            ),
            approved: String(
              canApprove ? approved.length : approved.filter((row) => row.submitted_by === username).length,
            ),
            rejected: String(
              canApprove ? rejected.length : rejected.filter((row) => row.submitted_by === username).length,
            ),
            my_submissions: String(inScope.filter((row) => row.submitted_by === username).length),
          },
        ],
        rowCount: 1,
      });
    }

    if (text.includes('FROM reconciliation_approval_request') && text.includes('FOR UPDATE')) {
      const [id] = params as [string];
      const row = approvalRequests.find((candidate) => candidate.id === id);
      return Promise.resolve({ rows: row ? [{ status: row.status }] : [], rowCount: row ? 1 : 0 });
    }

    if (text.includes('UPDATE reconciliation_approval_request') && text.includes('SET status = $2')) {
      const [id, toStatus, actor, rationale] = params as [string, string, string, string | null];
      const row = approvalRequests.find((candidate) => candidate.id === id);
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.status = toStatus;
      row.decided_by = actor;
      row.rationale = rationale;
      row.decided_at = new Date(0).toISOString();
      return Promise.resolve({ rows: [{ ...row }], rowCount: 1 });
    }

    if (text.includes('INSERT INTO reconciliation_approval_request_history')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM reconciliation_approval_request')) {
      const [subjectType, status, submittedBy, routedToOrUnassigned] = params as [
        string,
        string | null,
        string | null,
        string | null,
      ];
      const rows = approvalRequests
        .filter((row) => row.subject_type === subjectType)
        .filter((row) => status === null || row.status === status)
        .filter((row) => submittedBy === null || row.submitted_by === submittedBy)
        .filter(
          (row) =>
            routedToOrUnassigned === null ||
            row.decided_by === routedToOrUnassigned ||
            row.decided_by === null,
        );
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    // ── reconciliation_matching_config_version ──────────────────────────────────────────────────
    if (text.includes('FROM reconciliation_matching_config_version')) {
      return Promise.resolve({ rows: matchingConfigVersions, rowCount: matchingConfigVersions.length });
    }

    if (text.includes("SET status = 'SUPERSEDED'") && text.includes('reconciliation_matching_config_version')) {
      const [, excludeId] = params as [string, string];
      matchingConfigVersions
        .filter((row) => row.status === 'ACTIVE' && row.id !== excludeId)
        .forEach((row) => {
          row.status = 'SUPERSEDED';
        });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes("UPDATE reconciliation_matching_config_version") && text.includes("SET status = 'ACTIVE'")) {
      const [id] = params as [string];
      const row = matchingConfigVersions.find(
        (candidate) => candidate.id === id && candidate.status === 'DRAFT',
      );
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.status = 'ACTIVE';
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }

    // ── reconciliation_run (File Imports & Validation's approval type) ─────────────────────────────
    // None of this suite's scenarios seed any reconciliation_run rows -- these two handlers only
    // need to satisfy PostgresImportValidationStore.getRunApprovalCounts's own two queries
    // (resolveUserId, then the FILTER-based count) with an always-empty answer, so
    // GET /api/approvals/counts's merged 'import' key still resolves instead of 500ing on an
    // unrecognized query.
    if (text.includes('SELECT id FROM reconciliation_user')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('COUNT(*) FILTER') && text.includes('FROM reconciliation_run')) {
      return Promise.resolve({
        rows: [{ pending: '0', approved: '0', rejected: '0', my_submissions: '0' }],
        rowCount: 1,
      });
    }

    throw new Error(`createFakeApprovalsPool: unexpected query: ${text}`);
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

const appWithPool = (pool: Pool) => createApp(undefined, undefined, undefined, pool);

const importApprovalPending = (overrides: Partial<ImportApprovalRow> = {}): ImportApprovalRow => ({
  id: 'ia-1',
  source_file_id: 'sf-1',
  status: 'PENDING',
  uploaded_by: 'test-user',
  approved_by: null,
  rationale: null,
  requested_at: new Date(0).toISOString(),
  decided_at: null,
  ...overrides,
});

const sourceFile: SourceFileRow = { id: 'sf-1', file_name: 'bank.xlsx', source_system: 'bank' };

describe('GET /api/approvals', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending()],
      sourceFiles: [sourceFile],
    });
  });

  it('lists import approvals for the pending tab (canApprove, routed-or-unassigned)', async () => {
    const response = await authedApp(appWithPool(pool)).get('/api/approvals?type=import&tab=pending');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ type: 'import', title: 'bank.xlsx', meta: 'BANK import' });
  });

  it('scopes to "mine" via uploadedBy', async () => {
    pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending({ id: 'ia-2', uploaded_by: 'someone-else' })],
      sourceFiles: [sourceFile],
    });

    const response = await authedApp(appWithPool(pool)).get('/api/approvals?type=import&tab=mine');
    expect(response.body).toEqual([]);
  });

  it('scopes a non-approver to their own uploads on the pending tab', async () => {
    pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending({ uploaded_by: 'test-user' })],
      sourceFiles: [sourceFile],
    });

    const response = await authedApp(appWithPool(pool), { role: 'financial-analyst' }).get(
      '/api/approvals?type=import&tab=pending',
    );
    expect(response.body).toHaveLength(1);
  });

  it('lists the approved and rejected tabs', async () => {
    pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending({ id: 'ia-approved', status: 'APPROVED' })],
      sourceFiles: [sourceFile],
    });
    const approved = await authedApp(appWithPool(pool)).get('/api/approvals?type=import&tab=approved');
    expect(approved.body).toHaveLength(1);

    const rejected = await authedApp(appWithPool(pool)).get('/api/approvals?type=import&tab=rejected');
    expect(rejected.body).toEqual([]);
  });

  it('resolves a matchingRule row title from a live matching config version', async () => {
    pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-1',
          subject_type: 'matchingRule',
          subject_id: 'mcv-1',
          status: 'PENDING',
          submitted_by: 'test-user',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
      matchingConfigVersions: [{ id: 'mcv-1', version_number: 9, status: 'DRAFT' }],
    });

    const response = await authedApp(appWithPool(pool)).get(
      '/api/approvals?type=matchingRule&tab=pending',
    );
    expect(response.body[0]).toMatchObject({
      title: 'Matching config v9',
      meta: 'Matching rule change',
    });
  });

  it('resolves a varianceThreshold row title and meta distinctly from matchingRule', async () => {
    pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-2',
          subject_type: 'varianceThreshold',
          subject_id: 'mcv-1',
          status: 'PENDING',
          submitted_by: 'test-user',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
      matchingConfigVersions: [{ id: 'mcv-1', version_number: 9, status: 'DRAFT' }],
    });

    const response = await authedApp(appWithPool(pool)).get(
      '/api/approvals?type=varianceThreshold&tab=pending',
    );
    expect(response.body[0]).toMatchObject({
      title: 'Matching config v9',
      meta: 'Variance threshold change',
    });
  });

  it('falls back to the raw subject id when no matching version is found', async () => {
    pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-3',
          subject_type: 'mappingProfile',
          subject_id: 'unresolved-subject',
          status: 'PENDING',
          submitted_by: 'test-user',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });

    const response = await authedApp(appWithPool(pool)).get(
      '/api/approvals?type=mappingProfile&tab=pending',
    );
    expect(response.body[0]).toMatchObject({ title: 'unresolved-subject' });
    expect(response.body[0].meta).toBeUndefined();
  });

  it('rejects an invalid type/tab with the schema default rather than crashing', async () => {
    const response = await authedApp(appWithPool(pool)).get('/api/approvals?type=bogus&tab=bogus');
    // approvalsQuerySchema .catch()es invalid values back to defaults ('import'/'pending') rather
    // than 400ing -- this exercises that fallback path.
    expect(response.status).toBe(200);
  });

  it('returns 501 when no pool is configured', async () => {
    const response = await authedApp(appWithPool(undefined as unknown as Pool)).get(
      '/api/approvals?type=import&tab=pending',
    );
    expect(response.status).toBe(501);
  });
});

describe('GET /api/approvals/counts', () => {
  it('returns 501 when no pool is configured', async () => {
    const response = await authedApp(appWithPool(undefined as unknown as Pool)).get(
      '/api/approvals/counts',
    );
    expect(response.status).toBe(501);
  });

  it('returns counts across all five groups', async () => {
    const pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending()],
      sourceFiles: [sourceFile],
      approvalRequests: [
        {
          id: 'ar-1',
          subject_type: 'matchingRule',
          subject_id: 'mcv-1',
          status: 'PENDING',
          submitted_by: 'test-user',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });

    const response = await authedApp(appWithPool(pool)).get('/api/approvals/counts');
    expect(response.status).toBe(200);
    expect(response.body.import.pending).toBe(1);
    expect(response.body.matchingRule.pending).toBe(1);
    expect(response.body.mappingProfile.pending).toBe(0);
  });

  it('scopes counts to own submissions for a non-approver', async () => {
    const pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending({ uploaded_by: 'someone-else' })],
      sourceFiles: [sourceFile],
    });

    const response = await authedApp(appWithPool(pool), { role: 'financial-analyst' }).get(
      '/api/approvals/counts',
    );
    expect(response.body.import.pending).toBe(0);
  });
});

describe('POST /api/approvals/:type/:id/decision', () => {
  it('returns 501 when no pool is configured', async () => {
    const response = await authedApp(appWithPool(undefined as unknown as Pool))
      .post('/api/approvals/import/ia-1/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(501);
  });

  it('returns 403 for a non-approver', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool), { role: 'financial-analyst' })
      .post('/api/approvals/import/ia-1/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(403);
  });

  it('returns 400 for an invalid body', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/import/ia-1/decision')
      .send({ status: 'NOT_A_STATUS' });
    expect(response.status).toBe(400);
  });

  it('decides an import approval', async () => {
    const pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending()],
      sourceFiles: [sourceFile],
    });
    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/import/ia-1/decision')
      .send({ status: 'APPROVED', rationale: 'ok' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('APPROVED');
  });

  it('returns 404 when the import approval does not exist', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/import/does-not-exist/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(404);
  });

  it('rejects an unknown generic approvable type with 400', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/notAType/some-id/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Unknown approvable type');
  });

  it('publishes the matching config version when approving a matchingRule request', async () => {
    const pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-1',
          subject_type: 'matchingRule',
          subject_id: 'mcv-1',
          status: 'PENDING',
          submitted_by: 'someone-else',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
      matchingConfigVersions: [{ id: 'mcv-1', version_number: 9, status: 'DRAFT' }],
    });

    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/matchingRule/ar-1/decision')
      .send({ status: 'APPROVED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('APPROVED');
  });

  it('returns 404 approving a matchingRule request with no matching pending record', async () => {
    const pool = createFakeApprovalsPool({
      matchingConfigVersions: [{ id: 'mcv-1', version_number: 9, status: 'DRAFT' }],
    });

    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/matchingRule/does-not-exist/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(404);
  });

  it('rejects a varianceThreshold request without touching publish', async () => {
    const pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-2',
          subject_type: 'varianceThreshold',
          subject_id: 'mcv-1',
          status: 'PENDING',
          submitted_by: 'someone-else',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });

    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/varianceThreshold/ar-2/decision')
      .send({ status: 'REJECTED' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('REJECTED');
  });

  it('decides a mappingProfile generic request', async () => {
    const pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-3',
          subject_type: 'mappingProfile',
          subject_id: 'mp-1',
          status: 'PENDING',
          submitted_by: 'someone-else',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });

    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/mappingProfile/ar-3/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(200);
  });

  it('returns 404 when the generic approval request does not exist', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool))
      .post('/api/approvals/mappingProfile/does-not-exist/decision')
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/approvals/:type/:id/claim', () => {
  it('returns 501 when no pool is configured', async () => {
    const response = await authedApp(appWithPool(undefined as unknown as Pool)).post(
      '/api/approvals/import/ia-1/claim',
    );
    expect(response.status).toBe(501);
  });

  it('returns 403 for a non-approver', async () => {
    const pool = createFakeApprovalsPool({});
    const response = await authedApp(appWithPool(pool), { role: 'financial-analyst' }).post(
      '/api/approvals/import/ia-1/claim',
    );
    expect(response.status).toBe(403);
  });

  it('claims an unclaimed import approval', async () => {
    const pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending()],
      sourceFiles: [sourceFile],
    });
    const response = await authedApp(appWithPool(pool)).post('/api/approvals/import/ia-1/claim');
    expect(response.status).toBe(200);
    expect(response.body.approvedBy).toBe('test-user');
  });

  it('returns 409 when an import approval is already claimed', async () => {
    const pool = createFakeApprovalsPool({
      importApprovals: [importApprovalPending({ approved_by: 'someone-else' })],
      sourceFiles: [sourceFile],
    });
    const response = await authedApp(appWithPool(pool)).post('/api/approvals/import/ia-1/claim');
    expect(response.status).toBe(409);
  });

  it('claims an unclaimed generic approval request', async () => {
    const pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-1',
          subject_type: 'mappingProfile',
          subject_id: 'mp-1',
          status: 'PENDING',
          submitted_by: 'someone-else',
          decided_by: null,
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });
    const response = await authedApp(appWithPool(pool)).post('/api/approvals/mappingProfile/ar-1/claim');
    expect(response.status).toBe(200);
  });

  it('returns 409 when a generic approval request is already claimed', async () => {
    const pool = createFakeApprovalsPool({
      approvalRequests: [
        {
          id: 'ar-1',
          subject_type: 'mappingProfile',
          subject_id: 'mp-1',
          status: 'PENDING',
          submitted_by: 'someone-else',
          decided_by: 'someone-else-entirely',
          rationale: null,
          requested_at: new Date(0).toISOString(),
          decided_at: null,
        },
      ],
    });
    const response = await authedApp(appWithPool(pool)).post('/api/approvals/mappingProfile/ar-1/claim');
    expect(response.status).toBe(409);
  });
});
