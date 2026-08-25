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

interface IssueRow {
  id: string;
  import_job_id: string;
  import_file_id: string;
  severity: 'ERROR' | 'WARNING';
  code: string;
  row_number: number | null;
  entry_id: string | null;
  field: string | null;
  message: string;
  created_at: string;
}

interface RecordRow {
  id: string;
  reconciliation_run_id: string;
  import_file_id: string;
  source_type: string;
  record_id: string;
  source_line_number: number;
  account: string;
  txn_date: string;
  currency_code: string;
  signed_amount: string;
  direction: 'INFLOW' | 'OUTFLOW';
  magnitude: string;
  excluded: boolean;
  exclusion_reason: string | null;
  description: string;
  reference_ids: unknown;
  counterparty_type: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  value_date: string | null;
  effective_date: string | null;
  evidence: unknown;
  created_at: string;
}

const RUN_ID = 'run-1';
const IMPORT_JOB_ID = 'job-1';
const BANK_FILE_ID = 'file-bank-1';
const GL_FILE_ID = 'file-gl-1';

const ISSUES: IssueRow[] = [
  {
    id: '1',
    import_job_id: IMPORT_JOB_ID,
    import_file_id: BANK_FILE_ID,
    severity: 'ERROR',
    code: 'BANK_ID_REQUIRED',
    row_number: 2,
    entry_id: null,
    field: 'transaction_id',
    message: 'transaction_id is required',
    created_at: '2026-08-13T00:00:00.000Z',
  },
  {
    id: '2',
    import_job_id: IMPORT_JOB_ID,
    import_file_id: BANK_FILE_ID,
    severity: 'WARNING',
    code: 'BANK_AMOUNT_ZERO',
    row_number: 1,
    entry_id: null,
    field: 'amount',
    message: 'amount is zero',
    created_at: '2026-08-13T00:00:01.000Z',
  },
  {
    id: '3',
    import_job_id: IMPORT_JOB_ID,
    import_file_id: GL_FILE_ID,
    severity: 'ERROR',
    code: 'GL_ENTRY_ID_REQUIRED',
    row_number: 1,
    entry_id: null,
    field: 'entry_id',
    message: 'entry_id is required',
    created_at: '2026-08-13T00:00:02.000Z',
  },
];

const RECORDS: RecordRow[] = [
  {
    id: '1',
    reconciliation_run_id: RUN_ID,
    import_file_id: BANK_FILE_ID,
    source_type: 'BANK',
    record_id: 'TXN-1',
    source_line_number: 1,
    account: 'ACCT-1',
    txn_date: '2026-08-05',
    currency_code: 'USD',
    signed_amount: '100.0000',
    direction: 'INFLOW',
    magnitude: '100.0000',
    excluded: false,
    exclusion_reason: null,
    description: 'Deposit',
    reference_ids: { reference: 'REF-1' },
    counterparty_type: null,
    counterparty_id: null,
    counterparty_name: null,
    value_date: null,
    effective_date: null,
    evidence: null,
    created_at: '2026-08-13T00:00:00.000Z',
  },
  {
    id: '2',
    reconciliation_run_id: RUN_ID,
    import_file_id: GL_FILE_ID,
    source_type: 'GL',
    record_id: 'JE-1',
    source_line_number: 1,
    account: 'ACCT-1',
    txn_date: '2026-08-05',
    currency_code: 'USD',
    signed_amount: '100.0000',
    direction: 'INFLOW',
    magnitude: '100.0000',
    excluded: false,
    exclusion_reason: null,
    description: 'Journal entry',
    reference_ids: null,
    counterparty_type: null,
    counterparty_id: null,
    counterparty_name: null,
    value_date: null,
    effective_date: null,
    evidence: null,
    created_at: '2026-08-13T00:00:01.000Z',
  },
];

/**
 * Fake pool for GET /api/imports/runs/:id/issues and /records (Phase 8 review drilldown), built
 * against listRunIssues/listRunRecords's exact query shapes (packages/persistence/src/
 * importValidationStore.ts): a run-exists check, then a filtered items query and a matching
 * COUNT(*) query. Filter params are inserted between runId and limit/offset in the same order the
 * real conditions array pushes them (severity before code; sourceType before importFileId), so
 * this walks params positionally rather than re-deriving the WHERE clause from scratch.
 */
const createFakeReviewPool = (options: { knownRunId?: string } = {}) => {
  const knownRunId = options.knownRunId ?? RUN_ID;

  const query = (text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('SELECT 1 FROM reconciliation_run')) {
      const [runId] = params as [string];
      const found = runId === knownRunId;
      return Promise.resolve({ rows: found ? [{ '?column?': 1 }] : [], rowCount: found ? 1 : 0 });
    }

    if (text.includes('FROM validation_issue')) {
      let idx = 1;
      let severity: string | undefined;
      let code: string | undefined;
      if (text.includes('severity = $')) severity = params[idx++] as string;
      if (text.includes('code = $')) code = params[idx++] as string;

      const filtered = ISSUES.filter(
        (row) => (!severity || row.severity === severity) && (!code || row.code === code),
      );

      if (text.startsWith('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ count: String(filtered.length) }], rowCount: 1 });
      }

      const [limit, offset] = params.slice(idx) as [number, number];
      const page = filtered.slice(offset, offset + limit);
      return Promise.resolve({ rows: page, rowCount: page.length });
    }

    if (text.includes('FROM canonical_record')) {
      let idx = 1;
      let sourceType: string | undefined;
      let importFileId: string | undefined;
      if (text.includes('source_type = $')) sourceType = params[idx++] as string;
      if (text.includes('import_file_id = $')) importFileId = params[idx++] as string;

      const filtered = RECORDS.filter(
        (row) =>
          (!sourceType || row.source_type === sourceType) &&
          (!importFileId || row.import_file_id === importFileId),
      );

      if (text.startsWith('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ count: String(filtered.length) }], rowCount: 1 });
      }

      const [limit, offset] = params.slice(idx) as [number, number];
      const page = filtered.slice(offset, offset + limit);
      return Promise.resolve({ rows: page, rowCount: page.length });
    }

    throw new Error(`createFakeReviewPool: unexpected query: ${text}`);
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

const appWithPool = (pool?: Pool) => createApp(undefined, undefined, undefined, pool);

describe('GET /api/imports/runs/:id/issues', () => {
  it('returns 503 when no database is configured', async () => {
    const app = appWithPool(undefined);
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .expect(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'IMPORT_RUN_ISSUES');
  });

  it('returns 404 when the run does not exist', async () => {
    const app = appWithPool(createFakeReviewPool());
    await authedApp(app).get('/api/imports/runs/does-not-exist/issues').expect(404);
  });

  it('returns every issue across both files by default', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app).get(`/api/imports/runs/${RUN_ID}/issues`).expect(200);

    expect(response.body).toMatchObject({ total: 3, limit: 50, offset: 0, hasMore: false });
    expect(response.body.items).toHaveLength(3);
  });

  it('paginates with limit/offset and reports hasMore', async () => {
    const app = appWithPool(createFakeReviewPool());
    const firstPage = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .query({ limit: 2, offset: 0 })
      .expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);

    const secondPage = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .query({ limit: 2, offset: 2 })
      .expect(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.hasMore).toBe(false);
  });

  it('filters by severity', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .query({ severity: 'WARNING' })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ code: 'BANK_AMOUNT_ZERO', severity: 'WARNING' });
  });

  it('filters by code', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .query({ code: 'GL_ENTRY_ID_REQUIRED' })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ code: 'GL_ENTRY_ID_REQUIRED', importFileId: GL_FILE_ID });
  });

  it('rejects an unknown severity filter with 400', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/issues`)
      .query({ severity: 'FATAL' })
      .expect(400);

    expect(response.body.message).toContain('severity');
  });

  it('rejects an empty code filter with 400', async () => {
    const app = appWithPool(createFakeReviewPool());
    await authedApp(app).get(`/api/imports/runs/${RUN_ID}/issues`).query({ code: '' }).expect(400);
  });
});

describe('GET /api/imports/runs/:id/records', () => {
  it('returns 503 when no database is configured', async () => {
    const app = appWithPool(undefined);
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/records`)
      .expect(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
    expectNoPoolError(response.body, 'IMPORT_RUN_RECORDS');
  });

  it('returns 404 when the run does not exist', async () => {
    const app = appWithPool(createFakeReviewPool());
    await authedApp(app).get('/api/imports/runs/does-not-exist/records').expect(404);
  });

  it('returns records from both files by default', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app).get(`/api/imports/runs/${RUN_ID}/records`).expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items.map((item: { recordId: string }) => item.recordId).sort()).toEqual([
      'JE-1',
      'TXN-1',
    ]);
  });

  it('filters by sourceType', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/records`)
      .query({ sourceType: 'GL' })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ recordId: 'JE-1', sourceType: 'GL' });
  });

  it('filters by importFileId', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/records`)
      .query({ importFileId: BANK_FILE_ID })
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ recordId: 'TXN-1', importFileId: BANK_FILE_ID });
  });

  it('rejects an unknown sourceType filter with 400', async () => {
    const app = appWithPool(createFakeReviewPool());
    const response = await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/records`)
      .query({ sourceType: 'PAYROLL' })
      .expect(400);

    expect(response.body.message).toContain('sourceType');
  });

  it('rejects an empty importFileId filter with 400', async () => {
    const app = appWithPool(createFakeReviewPool());
    await authedApp(app)
      .get(`/api/imports/runs/${RUN_ID}/records`)
      .query({ importFileId: '' })
      .expect(400);
  });
});
