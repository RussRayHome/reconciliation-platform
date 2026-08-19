import {
  allExceptionCategories,
  createAllExceptionsBankWorkbook,
  createAllExceptionsGlWorkbook,
  createSampleBankWorkbook,
  createSampleGlWorkbook,
} from '@recon/test-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { PostgresReconciliationReadModelStore } from '@recon/persistence';

import ExcelJS from 'exceljs';
import { FileBackedRunRepository, InMemoryRunRepository } from '../src/services/runRepository';
import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';
import request from 'supertest';
import { hashPassword } from '../src/services/authService';
import { errorCategoryDisplayNames } from '@recon/domain';
import path from 'node:path';
import { tmpdir } from 'node:os';

const parseBinaryBody = (
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: unknown) => void,
): void => {
  let data = '';
  response.setEncoding('binary');
  response.on('data', (chunk) => {
    data += chunk;
  });
  response.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
};

type QueryableReadModelPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type QueryableAuthPool = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{
    rows: Array<{
      user_name: string;
      first_name: string;
      last_name: string;
      password_hash: string;
      role: string;
      organization_id: string;
    }>;
  }>;
};

const createCountingReadModelPool = (runId: string, exceptionCount: number) => {
  let queryCount = 0;
  const now = new Date().toISOString();

  const exceptionRows = Array.from({ length: exceptionCount }, (_, index) => ({
    id: `exception-${index + 1}`,
    category: 'MissingFromGL',
    severity: 'High',
    source_system: 'bank',
    spreadsheet_file_name: 'bank.xlsx',
    line_number: index + 2,
    transaction_date: '2025-01-01',
    amount: 10 + index,
    error_message: `Synthetic exception ${index + 1}`,
    rule_trace_json: {
      ruleId: 'residual-missing-from-gl',
      ruleName: 'Missing from GL',
      reason: 'Synthetic query-budget fixture',
      evidence: ['fixture'],
    },
    prior_rule_traces_json: [],
    recommended_next_actions: ['Investigate source and ledger records.'],
    likely_matching_reference: null,
    reviewer_notes: null,
    match_confidence: null,
    normalized_comparison_tokens: [`ROW-${index + 1}`],
    related_transaction_ids: [`bank-${index + 1}`],
  }));

  const summaryRow = {
    total_records_reviewed: exceptionCount,
    bank_records: exceptionCount,
    gl_records: exceptionCount,
    exact_matches: 0,
    probable_matches: 0,
    unmatched_items: exceptionCount,
    duplicates: 0,
    bank_duplicates: 0,
    gl_duplicates: 0,
    date_variances: 0,
    timing_differences: 0,
    data_quality_issues: 0,
    amount_mismatches: 0,
    missing_from_bank: 0,
    missing_from_gl: exceptionCount,
    unmatched_bank_net_amount: 0,
    unmatched_gl_net_amount: exceptionCount * 10,
    clean_matched_amount: 0,
    unresolved_exposure: exceptionCount * 10,
    counts_by_category_json: { MissingFromGL: exceptionCount },
    amount_by_category_json: { MissingFromGL: exceptionCount * 10 },
    charts_json: [],
  };

  const pool: QueryableReadModelPool = {
    query(text: string, params?: unknown[]) {
      queryCount += 1;

      if (text.includes('FROM reconciliation_job') && text.includes('WHERE id = $1')) {
        const requestedRunId = typeof params?.[0] === 'string' ? params[0] : '';
        if (requestedRunId !== runId) {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({
          rows: [
            {
              id: runId,
              correlation_id: 'corr-query-budget',
              account_identifier: 'OPERATING-001',
              period_label: 'Query Budget',
              reconciliation_frequency: 'Monthly',
              current_state: 'FINALIZED',
              started_at: now,
              completed_at: now,
            },
          ],
        });
      }

      if (text.includes('FROM reconciliation_source_file')) {
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('FROM reconciliation_match_group')) {
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('FROM reconciliation_match_result')) {
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('FROM reconciliation_job_summary')) {
        return Promise.resolve({ rows: [summaryRow] });
      }

      if (text.includes('FROM reconciliation_review_observation')) {
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('FROM reconciliation_review_decision')) {
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('FROM reconciliation_export')) {
        return Promise.resolve({
          rows: [
            {
              file_name: 'reconciliation.xlsx',
              generated_at: now,
              tab_names_json: ['Summary', 'Error Report'],
            },
          ],
        });
      }

      if (text.includes('FROM reconciliation_exception') && text.includes('LIMIT $2 OFFSET $3')) {
        const limit = Number(params?.[1] ?? exceptionCount);
        const offset = Number(params?.[2] ?? 0);
        return Promise.resolve({ rows: exceptionRows.slice(offset, offset + limit) });
      }

      if (text.includes('COUNT(*)::text AS count FROM reconciliation_exception')) {
        return Promise.resolve({ rows: [{ count: String(exceptionCount) }] });
      }

      if (text.includes('FROM reconciliation_exception')) {
        return Promise.resolve({ rows: exceptionRows });
      }

      throw new Error(`Unexpected query in query-budget test: ${text.slice(0, 80)}`);
    },
  };

  // The read-model store now goes through runInTenantScope (packages/persistence/src/postgres.ts),
  // which checks out a client and issues BEGIN / SET LOCAL app.current_organization_id / ... /
  // COMMIT rather than calling pool.query directly -- so this fake needs pool.connect() too.
  // Transaction control and the set_config GUC call are answered without touching `pool.query`,
  // so they don't count against the query budget this test is asserting on.
  const clientQuery = (text: string, params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [] });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params?.[1] }] });
    }
    return pool.query(text, params);
  };
  const poolWithConnect = {
    ...pool,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  };

  return {
    pool: poolWithConnect,
    getQueryCount: (): number => queryCount,
    resetQueryCount: (): void => {
      queryCount = 0;
    },
  };
};

describe('reconciliation API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs reconciliation and exposes summary, exceptions, and workbook export endpoints', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'January 2025')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      summary: { totalRecordsReviewed: number };
      groupedMatchResults?: unknown[];
    };

    expect(runPayload.id).toBeTypeOf('string');
    expect(runPayload.summary.totalRecordsReviewed).toBeGreaterThan(0);
    expect(Array.isArray(runPayload.groupedMatchResults)).toBe(true);
    expect((runResponse.body as Record<string, unknown>).rawRows).toBeUndefined();
    expect((runResponse.body as Record<string, unknown>).normalizedTransactions).toBeUndefined();
    expect((runResponse.body as Record<string, unknown>).matchResults).toBeUndefined();
    expect((runResponse.body as Record<string, unknown>).auditEvents).toBeUndefined();

    const { id } = runPayload;

    const latestResponse = await authedApp(app).get('/api/reconciliation/latest').expect(200);
    const latestPayload = latestResponse.body as { id: string };
    expect(latestPayload.id).toBe(id);
    expect((latestResponse.body as Record<string, unknown>).rawRows).toBeUndefined();
    expect((latestResponse.body as Record<string, unknown>).normalizedTransactions).toBeUndefined();

    const summaryResponse = await authedApp(app).get(`/api/reconciliation/${id}/summary`).expect(200);
    const summaryPayload = summaryResponse.body as {
      exactMatches: number;
      countsByCategory: Record<string, number>;
    };
    expect(summaryPayload.exactMatches).toBeGreaterThanOrEqual(1);

    const exceptionsResponse = await authedApp(app)
      .get(`/api/reconciliation/${id}/exceptions`)
      .expect(200);
    expect(Array.isArray(exceptionsResponse.body)).toBe(true);
    const exceptionsPayload = exceptionsResponse.body as Array<{
      category: string;
      ruleTrace?: { ruleId?: string; reason?: string };
      recommendedNextActions?: string[];
    }>;
    expect(exceptionsPayload.length).toBeGreaterThan(0);
    expect(
      exceptionsPayload.every(
        (item) =>
          typeof item.ruleTrace?.reason === 'string' &&
          (item.recommendedNextActions?.length ?? 0) > 0,
      ),
    ).toBe(true);

    const workbookResponse = await authedApp(app)
      .get(`/api/reconciliation/${id}/export/workbook`)
      .buffer(true)
      .parse(
        parseBinaryBody as (
          response: unknown,
          callback: (error: Error | null, body: unknown) => void,
        ) => void,
      )
      .expect(200);
    expect(workbookResponse.headers['content-type']).toContain('spreadsheetml.sheet');

    const workbook = new ExcelJS.Workbook();
    const workbookBinary = Buffer.isBuffer(workbookResponse.body)
      ? workbookResponse.body
      : Buffer.from(workbookResponse.body as ArrayLike<number>);
    await workbook.xlsx.load(
      workbookBinary as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );
    const summarySheet = workbook.getWorksheet('Summary');
    const errorReportSheet = workbook.getWorksheet('Error Report');

    expect(summarySheet).toBeDefined();
    expect(errorReportSheet).toBeDefined();

    const summaryLabels = summarySheet
      ?.getColumn(1)
      .values.filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining([
        'Total exact matches',
        'Total probable matches',
        'Total timing differences',
      ]),
    );

    const categoryColumnRawValues = errorReportSheet?.getColumn(2).values;
    const categoryColumnValues = Array.isArray(categoryColumnRawValues)
      ? categoryColumnRawValues.filter((value): value is string => typeof value === 'string')
      : [];

    const headerRowRawValues = errorReportSheet?.getRow(1).values;
    const headerRowValues = Array.isArray(headerRowRawValues)
      ? headerRowRawValues.filter((value): value is string => typeof value === 'string')
      : [];

    expect(headerRowValues).toEqual(expect.arrayContaining(['Counterparts', 'Rule Lineage']));

    const nonHeaderCategories = categoryColumnValues.filter((value) => value !== 'Category');
    expect(nonHeaderCategories.some((value) => value.includes(' '))).toBe(true);

    const workbookCategoryCounts = nonHeaderCategories.reduce<Record<string, number>>(
      (counts, label) => {
        counts[label] = (counts[label] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const exceptionCounts = exceptionsPayload.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return counts;
    }, {});

    Object.entries(exceptionCounts).forEach(([category, count]) => {
      const displayName =
        errorCategoryDisplayNames[category as keyof typeof errorCategoryDisplayNames] ?? category;
      expect(workbookCategoryCounts[displayName]).toBe(count);
      expect(summaryPayload.countsByCategory[category]).toBe(count);
    });
  });

  it('applies varianceOverrides sent as a JSON string, filtering non-numeric values', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .field(
        'varianceOverrides',
        JSON.stringify({ wireFeeTolerance: 500, notANumber: 'nope', alsoBad: null }),
      )
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    expect(response.body.appliedVarianceOverrides).toEqual({ wireFeeTolerance: 500 });
  });

  it('ignores a malformed varianceOverrides JSON string rather than failing the run', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('varianceOverrides', '{not valid json')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    expect(response.body.appliedVarianceOverrides).toBeUndefined();
  });

  it('drops a varianceOverrides object whose values are all non-numeric', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('varianceOverrides', JSON.stringify({ notANumber: 'nope' }))
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    expect(response.body.appliedVarianceOverrides).toBeUndefined();
  });

  // 'handles non-standard bank headers for account 5703 without cascading invalid amount errors'
  // is retired (Issue #137): it exercised fuzzy alias-based header matching (e.g. "Posted Date" ->
  // "Date") against `/api/reconciliation/run`. File Validation is exact-header-match only by
  // design now -- a non-standard header fails HEADER-gate validation and the route correctly
  // rejects it with 400, so this scenario's premise no longer holds. Equivalent coverage for exact
  // vs. non-standard headers lives in fileValidation/structuralGates.test.ts.

  it('accepts the combined all-exceptions workbook pair and surfaces every exception category through the API', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'All Exception Categories')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'sample-all-exceptions-gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      summary: { countsByCategory: Record<string, number> };
      groupedMatchResults: Array<{ category?: string }>;
    };

    expect(runPayload.groupedMatchResults.length).toBeGreaterThan(0);
    expect(
      runPayload.groupedMatchResults.some(
        (item) =>
          item.category === 'DepositGroupingIssue' || item.category === 'LikelySplitCombineIssue',
      ),
    ).toBe(true);

    const exceptionsResponse = await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions`)
      .expect(200);

    const exceptionsPayload = exceptionsResponse.body as Array<{ category: string }>;
    const exceptionCounts = exceptionsPayload.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return counts;
    }, {});

    allExceptionCategories.forEach((category) => {
      expect(exceptionCounts[category]).toBeGreaterThan(0);
      expect(runPayload.summary.countsByCategory[category]).toBe(exceptionCounts[category]);
    });
  });

  it('supports paginated exception responses when limit and offset are provided', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'Paginated Exceptions')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'sample-all-exceptions-gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as { id: string; exceptions: Array<{ id: string }> };

    const pagedResponse = await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions?limit=5&offset=3`)
      .expect(200);

    const pagedPayload = pagedResponse.body as {
      items: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };

    expect(pagedPayload.total).toBe(runPayload.exceptions.length);
    expect(pagedPayload.limit).toBe(5);
    expect(pagedPayload.offset).toBe(3);
    expect(pagedPayload.items).toHaveLength(5);
    expect(pagedPayload.items[0]?.id).toBe(runPayload.exceptions[3]?.id);
    expect(pagedPayload.hasMore).toBe(true);
  });

  it('filters paged exceptions by category and severity and rejects unknown filter values', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'Filtered Exceptions')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'sample-all-exceptions-gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string; category: string; severity: string }>;
    };

    const targetCategory = runPayload.exceptions[0]?.category;
    expect(targetCategory).toBeDefined();
    const expectedCategoryMatches = runPayload.exceptions.filter(
      (item) => item.category === targetCategory,
    );

    const categoryResponse = await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions?category=${targetCategory}`)
      .expect(200);

    const categoryPayload = categoryResponse.body as {
      items: Array<{ id: string; category: string }>;
      total: number;
    };

    expect(categoryPayload.total).toBe(expectedCategoryMatches.length);
    expect(categoryPayload.items.every((item) => item.category === targetCategory)).toBe(true);

    const targetSeverity = runPayload.exceptions[0]?.severity;
    const expectedCombinedMatches = runPayload.exceptions.filter(
      (item) => item.category === targetCategory && item.severity === targetSeverity,
    );

    const combinedResponse = await authedApp(app)
      .get(
        `/api/reconciliation/${runPayload.id}/exceptions?category=${targetCategory}&severity=${targetSeverity}`,
      )
      .expect(200);

    const combinedPayload = combinedResponse.body as {
      items: Array<{ category: string; severity: string }>;
      total: number;
    };

    expect(combinedPayload.total).toBe(expectedCombinedMatches.length);
    expect(
      combinedPayload.items.every(
        (item) => item.category === targetCategory && item.severity === targetSeverity,
      ),
    ).toBe(true);

    await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions?category=NotACategory`)
      .expect(400);

    await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions?severity=Bogus`)
      .expect(400);
  });

  it('keeps read-model query counts bounded for paged exceptions under larger result sets', async () => {
    const runId = 'query-budget-run';
    const { pool, getQueryCount, resetQueryCount } = createCountingReadModelPool(runId, 20);
    const readModelStore = new PostgresReconciliationReadModelStore(
      pool as unknown as ConstructorParameters<typeof PostgresReconciliationReadModelStore>[0],
    );
    const app = createApp(undefined, undefined, readModelStore);

    const pagedResponse = await authedApp(app)
      .get(`/api/reconciliation/${runId}/exceptions?limit=20&offset=0`)
      .expect(200);

    const pagedPayload = pagedResponse.body as {
      items: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };

    expect(pagedPayload.items).toHaveLength(20);
    expect(pagedPayload.total).toBe(20);
    expect(pagedPayload.limit).toBe(20);
    expect(pagedPayload.offset).toBe(0);
    expect(pagedPayload.hasMore).toBe(false);
    expect(getQueryCount()).toBeLessThanOrEqual(11);

    resetQueryCount();

    const runResponse = await authedApp(app).get(`/api/reconciliation/${runId}`).expect(200);
    const runPayload = runResponse.body as { id: string; exceptions: unknown[] };

    expect(runPayload.id).toBe(runId);
    expect(runPayload.exceptions).toHaveLength(20);
    expect(getQueryCount()).toBeLessThanOrEqual(9);
  });

  it('accepts browser uploads when the workbook MIME type is application/octet-stream', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/octet-stream',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/octet-stream',
      })
      .expect(201);

    const payload = response.body as {
      sourceFiles: Array<{ fileName: string }>;
      summary: { totalRecordsReviewed: number };
    };

    expect(payload.sourceFiles.map((file) => file.fileName)).toEqual(['bank.xlsx', 'gl.xlsx']);
    expect(payload.summary.totalRecordsReviewed).toBeGreaterThan(0);
  });

  it('rejects non-xlsx uploads with a validation error', async () => {
    const app = createApp();
    const glBuffer = await createSampleGlWorkbook();

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', Buffer.from('not-an-excel-file'), {
        filename: 'bank.txt',
        contentType: 'text/plain',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/octet-stream',
      })
      .expect(400);

    const payload = response.body as { message: string };
    expect(payload.message).toContain('Only .xlsx files are accepted.');
  });

  it('rejects requests that do not provide both required files', async () => {
    const app = createApp();

    const response = await authedApp(app).post('/api/reconciliation/run').expect(400);
    const payload = response.body as { message: string };
    expect(payload.message).toContain('Both bankFile and glFile');
  });

  it('returns 404 when no latest reconciliation run has been stored yet', async () => {
    const app = createApp();

    const response = await authedApp(app).get('/api/reconciliation/latest').expect(404);
    const payload = response.body as { message: string };

    expect(payload.message).toContain('No completed reconciliation run found');
  });

  it('persists reviewer decisions and exposes them through the run and reviewer-decision endpoints', async () => {
    const snapshotDirectory = mkdtempSync(
      path.join(tmpdir(), 'reconciliation-reviewer-decisions-'),
    );

    try {
      const repositoryFilePath = path.join(snapshotDirectory, 'latest-run.json');
      const firstApp = createApp(new FileBackedRunRepository(repositoryFilePath));
      const [bankBuffer, glBuffer] = await Promise.all([
        createSampleBankWorkbook(),
        createSampleGlWorkbook(),
      ]);

      const runResponse = await authedApp(firstApp)
        .post('/api/reconciliation/run')
        .attach('bankFile', bankBuffer, {
          filename: 'bank.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .attach('glFile', glBuffer, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .expect(201);

      const runPayload = runResponse.body as {
        id: string;
        probableMatches: Array<{ id: string; disposition: string }>;
        reviewerDecisions: unknown[];
      };

      expect(runPayload.reviewerDecisions).toEqual([]);

      const probableTarget = runPayload.probableMatches.find(
        (item) => item.disposition === 'ProbableMatch' || item.disposition === 'AmbiguousReview',
      );
      expect(probableTarget).toBeDefined();

      const decisionResponse = await authedApp(firstApp)
        .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
        .send({
          targetType:
            probableTarget?.disposition === 'AmbiguousReview' ? 'AmbiguousReview' : 'ProbableMatch',
          targetId: probableTarget?.id,
          outcome: 'ApprovedMatch',
          notes: 'Approved after source document review.',
          reviewerName: 'Controller',
        })
        .expect(201);

      const savedDecision = decisionResponse.body as {
        runId: string;
        targetId: string;
        outcome: string;
        reviewerName?: string;
      };

      expect(savedDecision.runId).toBe(runPayload.id);
      expect(savedDecision.targetId).toBe(probableTarget?.id);
      expect(savedDecision.outcome).toBe('ApprovedMatch');
      expect(savedDecision.reviewerName).toBe('Controller');

      const reviewerDecisionList = await authedApp(firstApp)
        .get(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
        .expect(200);
      const reviewerDecisionsPayload = reviewerDecisionList.body as Array<{ targetId: string }>;
      expect(reviewerDecisionsPayload).toHaveLength(1);
      expect(reviewerDecisionsPayload[0]?.targetId).toBe(probableTarget?.id);

      const restartedApp = createApp(new FileBackedRunRepository(repositoryFilePath));
      const runAfterRestart = await authedApp(restartedApp)
        .get(`/api/reconciliation/${runPayload.id}`)
        .expect(200);
      const hydratedRun = runAfterRestart.body as {
        reviewerDecisions: Array<{ targetId: string; outcome: string }>;
      };

      expect(hydratedRun.reviewerDecisions).toHaveLength(1);
      expect(hydratedRun.reviewerDecisions[0]?.targetId).toBe(probableTarget?.id);
      expect(hydratedRun.reviewerDecisions[0]?.outcome).toBe('ApprovedMatch');
    } finally {
      rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  });

  it('clears a reviewer decision through the delete endpoint and is idempotent', async () => {
    const app = createApp();
    const spreadsheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('glFile', glBuffer, { filename: 'gl.xlsx', contentType: spreadsheetMime })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      probableMatches: Array<{ id: string; disposition: string }>;
    };
    const target = runPayload.probableMatches.find(
      (item) => item.disposition === 'ProbableMatch' || item.disposition === 'AmbiguousReview',
    );
    expect(target).toBeDefined();
    const targetType =
      target?.disposition === 'AmbiguousReview' ? 'AmbiguousReview' : 'ProbableMatch';
    const targetId = target?.id ?? '';

    await authedApp(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({ targetType, targetId, outcome: 'ApprovedMatch' })
      .expect(201);

    await authedApp(app)
      .delete(
        `/api/reconciliation/${runPayload.id}/reviewer-decisions/${encodeURIComponent(targetId)}`,
      )
      .query({ targetType })
      .expect(204);

    const afterDelete = await authedApp(app)
      .get(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .expect(200);
    expect(afterDelete.body).toEqual([]);

    // A second delete is a no-op and still succeeds.
    await authedApp(app)
      .delete(
        `/api/reconciliation/${runPayload.id}/reviewer-decisions/${encodeURIComponent(targetId)}`,
      )
      .query({ targetType })
      .expect(204);
  });

  it('rejects a reviewer decision delete without a valid targetType', async () => {
    const app = createApp();
    const spreadsheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('glFile', glBuffer, { filename: 'gl.xlsx', contentType: spreadsheetMime })
      .expect(201);

    const { id } = runResponse.body as { id: string };

    await authedApp(app)
      .delete(`/api/reconciliation/${id}/reviewer-decisions/some-target`)
      .expect(400);
  });

  it('returns 404 for run, summary, exceptions, and workbook when run id is unknown', async () => {
    const app = createApp();
    const unknownId = 'does-not-exist';

    await authedApp(app).get(`/api/reconciliation/${unknownId}`).expect(404);
    await authedApp(app).get(`/api/reconciliation/${unknownId}/summary`).expect(404);
    await authedApp(app).get(`/api/reconciliation/${unknownId}/exceptions`).expect(404);
    await authedApp(app)
      .get(`/api/reconciliation/${unknownId}/exceptions?limit=5&offset=0`)
      .expect(404);
    await authedApp(app).get(`/api/reconciliation/${unknownId}/export/workbook`).expect(404);
  });

  // ISSUE-001: the workbook export route used to call repository.findById() directly, never
  // consulting request.auth -- any authenticated user from any tenant could download another
  // tenant's output workbook given the run id. It now resolves through the same tenant-scoped
  // path (loadRunReport / readModelStore) as the sibling run routes, so a real ownership check
  // gates the export the same way it already gates GET /api/reconciliation/:id.
  it('serves the workbook to the owning tenant but 404s for a different tenant requesting the same run id', async () => {
    const runId = 'tenant-scoped-run';
    const ownerOrgId = 'org-a';
    const fileName = 'tenant-scoped-run.xlsx';

    const query = (text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('set_config(')) {
        return Promise.resolve({ rows: [{ set_config: params?.[1] }] });
      }

      // Mirrors what RLS does at the database layer: a real Postgres pool would silently filter
      // every one of these rows out for any organization other than the one they belong to. The
      // fake pool has no RLS of its own, so it has to emulate that filtering explicitly here.
      const currentOrgId = query.currentOrgId;
      const ownedByCurrentTenant = currentOrgId === ownerOrgId;

      if (text.includes('FROM reconciliation_job') && text.includes('WHERE id = $1')) {
        const [requestedId] = params as [string];
        if (requestedId !== runId || !ownedByCurrentTenant) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({
          rows: [
            {
              id: runId,
              correlation_id: 'corr-1',
              account_identifier: null,
              period_label: null,
              reconciliation_frequency: null,
              current_state: 'Completed',
              started_at: '2026-08-01T00:00:00.000Z',
              completed_at: '2026-08-01T00:00:01.000Z',
            },
          ],
        });
      }
      if (text.includes('FROM reconciliation_export') && text.includes("'workbook'")) {
        if (!ownedByCurrentTenant) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({
          rows: [{ file_name: fileName, generated_at: '2026-08-01T00:00:01.000Z', tab_names_json: [] }],
        });
      }
      // Every other query loadFullReportWithClient issues (source files, matches, exceptions,
      // summary, ...) is irrelevant to what this test is proving -- answer with nothing.
      return Promise.resolve({ rows: [] });
    };
    // set_config's second param is the organization id being applied for this transaction --
    // track it on the fn object so the branches above can read the "current" tenant.
    query.currentOrgId = undefined as string | undefined;
    const trackedQuery = (text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
      if (text.includes('set_config(')) {
        query.currentOrgId = params?.[0] as string;
      }
      return query(text, params);
    };

    const pool = {
      connect: () => Promise.resolve({ query: trackedQuery, release: () => undefined }),
    } as unknown as ConstructorParameters<typeof PostgresReconciliationReadModelStore>[0];
    const readModelStore = new PostgresReconciliationReadModelStore(pool);

    // The read model only ever stores export *metadata* (see fetchOutputWorkbook) -- the actual
    // binary lives in the in-memory repository, so it has to be seeded there directly for the
    // owning-tenant case to reach a real 200. repository.findById() has no tenant awareness of
    // its own (that gap is ISSUE-002, tracked separately); this test's 404 for org-b has to come
    // entirely from the readModelStore check above, exactly as it would in production once RLS
    // is what's doing the filtering instead of this fake.
    const repository = new InMemoryRunRepository();
    repository.save({
      id: runId,
      correlationId: 'corr-1',
      status: 'Completed',
      startedAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:01.000Z',
      sourceFiles: [],
      rawRows: [],
      normalizedTransactions: [],
      matchResults: [],
      groupedMatchResults: [],
      probableMatches: [],
      exceptions: [],
      summary: {
        totalRecordsReviewed: 0,
        bankRecords: 0,
        glRecords: 0,
        exactMatches: 0,
        probableMatches: 0,
        unmatchedItems: 0,
        duplicates: 0,
        bankDuplicates: 0,
        glDuplicates: 0,
        dateVariances: 0,
        timingDifferences: 0,
        dataQualityIssues: 0,
        amountMismatches: 0,
        missingFromBank: 0,
        missingFromGL: 0,
        unmatchedBankNetAmount: 0,
        unmatchedGlNetAmount: 0,
        cleanMatchedAmount: 0,
        unresolvedExposure: 0,
        countsByCategory: {},
        amountByCategory: {},
        charts: [],
      },
      reviewerObservations: [],
      reviewerDecisions: [],
      auditEvents: [],
      outputWorkbook: { fileName, generatedAt: '2026-08-01T00:00:01.000Z', tabNames: [], binary: new Uint8Array([1, 2, 3]) },
    });

    const app = createApp(repository, undefined, readModelStore);

    const crossTenantResponse = await authedApp(app, { organizationId: 'org-b' }).get(
      `/api/reconciliation/${runId}/export/workbook`,
    );
    expect(crossTenantResponse.status).toBe(404);
    expect((crossTenantResponse.body as { message: string }).message).toBe(
      'Workbook export is not available for this run.',
    );

    const ownerResponse = await authedApp(app, { organizationId: ownerOrgId })
      .get(`/api/reconciliation/${runId}/export/workbook`)
      .buffer(true)
      .parse(
        parseBinaryBody as (
          response: unknown,
          callback: (error: Error | null, body: unknown) => void,
        ) => void,
      );
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers['content-disposition']).toContain(fileName);
  });

  it('returns 404 when posting a reviewer decision to an unknown run id', async () => {
    const app = createApp();

    const response = await authedApp(app)
      .post('/api/reconciliation/does-not-exist/reviewer-decisions')
      .send({ targetType: 'ExceptionItem', targetId: 'some-id', outcome: 'ConfirmedException' })
      .expect(404);

    const payload = response.body as { message: string };
    expect(payload.message).toContain('not found');
  });

  it('accepts ConfirmedException and ReclassifiedException decisions for ExceptionItem targets', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };

    expect(runPayload.exceptions.length).toBeGreaterThan(1);
    const [exception1, exception2] = runPayload.exceptions;

    const confirmedResponse = await authedApp(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: exception1?.id,
        outcome: 'ConfirmedException',
        notes: 'Verified against source documents.',
      })
      .expect(201);

    const confirmedDecision = confirmedResponse.body as { outcome: string; targetId: string };
    expect(confirmedDecision.outcome).toBe('ConfirmedException');
    expect(confirmedDecision.targetId).toBe(exception1?.id);

    const reclassifiedResponse = await authedApp(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: exception2?.id,
        outcome: 'ReclassifiedException',
        finalCategory: 'MissingFromGL',
      })
      .expect(201);

    const reclassifiedDecision = reclassifiedResponse.body as {
      outcome: string;
      finalCategory: string;
    };
    expect(reclassifiedDecision.outcome).toBe('ReclassifiedException');
    expect(reclassifiedDecision.finalCategory).toBe('MissingFromGL');
  });

  it('rejects reviewer decisions with missing or invalid field values', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const { id, exceptions } = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };
    const exceptionId = exceptions[0]?.id;

    const missingTargetType = await authedApp(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetId: exceptionId, outcome: 'ConfirmedException' })
      .expect(400);
    expect((missingTargetType.body as { message: string }).message).toContain('targetType');

    const emptyTargetId = await authedApp(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetType: 'ExceptionItem', targetId: '   ', outcome: 'ConfirmedException' })
      .expect(400);
    expect((emptyTargetId.body as { message: string }).message).toContain('targetId');

    const missingOutcome = await authedApp(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetType: 'ExceptionItem', targetId: exceptionId })
      .expect(400);
    expect((missingOutcome.body as { message: string }).message).toContain('outcome');

    const nonExistentTarget = await authedApp(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: 'does-not-exist-in-run',
        outcome: 'ConfirmedException',
      })
      .expect(400);
    expect((nonExistentTarget.body as { message: string }).message).toContain('not found');
  });

  it('rejects invalid reviewer decision payloads', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };

    const invalidOutcomeResponse = await authedApp(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: runPayload.exceptions[0]?.id,
        outcome: 'ApprovedMatch',
      })
      .expect(400);

    const invalidOutcomePayload = invalidOutcomeResponse.body as { message: string };
    expect(invalidOutcomePayload.message).toContain('not valid for the specified target type');

    const missingCategoryResponse = await authedApp(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: runPayload.exceptions[0]?.id,
        outcome: 'ReclassifiedException',
      })
      .expect(400);

    const missingCategoryPayload = missingCategoryResponse.body as { message: string };
    expect(missingCategoryPayload.message).toContain('finalCategory is required');
  });

  it('authenticates against local fallback users when a database pool is unavailable', async () => {
    // ADR-0002 step 7: the local fallback (username == password) must be an explicit opt-in,
    // never reachable just because no pool happens to be configured.
    vi.stubEnv('ALLOW_LOCAL_LOGIN_FALLBACK', 'true');
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(200);

    expect(response.body).toMatchObject({
      username: 'rray',
      firstName: 'rray',
      lastName: '',
      role: 'superuser',
    });
    expect(typeof (response.body as { token: unknown }).token).toBe('string');
    expect(typeof (response.body as { organizationId: unknown }).organizationId).toBe('string');
  });

  it('refuses to start with the local login fallback enabled in production', () => {
    vi.stubEnv('ALLOW_LOCAL_LOGIN_FALLBACK', 'true');
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => createApp()).toThrow(/ALLOW_LOCAL_LOGIN_FALLBACK/);
  });

  it('rejects local fallback login with the wrong password for a known fallback username', async () => {
    // authenticateWithLocalUsers's `localUser?.password !== password` check -- the "flag enabled
    // but credentials wrong" branch, distinct from "flag not enabled at all" below.
    vi.stubEnv('ALLOW_LOCAL_LOGIN_FALLBACK', 'true');
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'not-the-right-password' })
      .expect(401);

    expect((response.body as { message: string }).message).toBe(
      'The user or password does not match.',
    );
  });

  it('rejects local fallback login for a username with no fallback entry at all', async () => {
    vi.stubEnv('ALLOW_LOCAL_LOGIN_FALLBACK', 'true');
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody-registered', password: 'anything' })
      .expect(401);

    expect((response.body as { message: string }).message).toBe(
      'The user or password does not match.',
    );
  });

  it('rejects local fallback login when the flag is not enabled', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(401);

    expect((response.body as { message: string }).message).toBe(
      'The user or password does not match.',
    );
  });

  it('returns 401 for invalid login credentials', async () => {
    const authPool: QueryableAuthPool = {
      query: () => Promise.resolve({ rows: [] }),
    };

    const app = createApp(
      undefined,
      undefined,
      undefined,
      authPool as unknown as Parameters<typeof createApp>[3],
    );

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'wrong-password' })
      .expect(401);

    expect((response.body as { message: string }).message).toBe(
      'The user or password does not match.',
    );
  });

  it('returns user profile details for valid login credentials', async () => {
    const passwordHash = await hashPassword('rray');
    const authPool: QueryableAuthPool = {
      query: (_text, params) => {
        const username = typeof params?.[0] === 'string' ? params[0] : '';

        if (username !== 'rray') {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({
          rows: [
            {
              user_name: 'rray',
              first_name: 'Ryan',
              last_name: 'Ray',
              password_hash: passwordHash,
              role: 'superuser',
              organization_id: 'org-1',
            },
          ],
        });
      },
    };

    const app = createApp(
      undefined,
      undefined,
      undefined,
      authPool as unknown as Parameters<typeof createApp>[3],
    );

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(200);

    expect(response.body).toMatchObject({
      username: 'rray',
      firstName: 'Ryan',
      lastName: 'Ray',
      role: 'superuser',
      organizationId: 'org-1',
    });
    expect(typeof (response.body as { token: unknown }).token).toBe('string');
  });
});

describe('login/logout audit trail (ISSUE-050.2)', () => {
  // These tests assert on 'info'-level log lines, but `npm run test:integration` runs with
  // LOG_LEVEL=silent (see package.json) for quieter CI output -- and resolveLogLevelAtLeastInfo
  // (apps/api/src/services/logLevel.ts) deliberately honors `silent` under Vitest rather than
  // flooring it to 'info' like it would in a real runtime. Without this override, createApp()
  // builds an httpLogger that genuinely emits nothing, and every capture.lines() lookup below
  // finds an empty array -- not a timing race, a real level mismatch.
  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'info');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type CapturedInsert = { params: unknown[] };

  /** Fake pool answering both the login handler's user-lookup SELECT and recordLoginEvent's
   * INSERT -- QueryableAuthPool (used by the tests above) only ever needed the first. */
  const makeAuditPool = (userRow: Record<string, unknown> | null) => {
    const inserts: CapturedInsert[] = [];
    const query = (text: string, params?: unknown[]) => {
      if (text.includes('FROM reconciliation_user')) {
        return Promise.resolve({ rows: userRow ? [userRow] : [] });
      }
      if (text.includes('INSERT INTO reconciliation_login_event')) {
        inserts.push({ params: params ?? [] });
        return Promise.resolve({
          rows: [
            {
              id: params?.[0],
              organization_id: params?.[1],
              username: params?.[2],
              event_type: params?.[3],
              failure_reason: params?.[4] ?? null,
              ip_address: params?.[5] ?? null,
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      throw new Error(`makeAuditPool: unexpected query: ${text}`);
    };
    return { pool: { query } as unknown as Parameters<typeof createApp>[3], inserts };
  };

  /** Captures every line written to stdout during the test, parsed as JSON -- createApp()
   * builds its own internal httpLogger writing to process.stdout with no injectable stream
   * (see apps/api/tests/log-redaction.test.ts for the same technique).
   *
   * MUST be called before `createApp()`, not after: pino's default destination (SonicBoom)
   * binds to `process.stdout.write` once, at construction time, inside `pino({...})`. A spy
   * installed after that construction never sees anything -- this bit a first draft of these
   * tests, where every log-line assertion silently found nothing. */
  const captureStdout = () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(chunk.toString());
        return true;
      });
    return {
      lines: (): Record<string, unknown>[] =>
        written
          .join('')
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
      // Extra safety margin in case a write is still queued when the request resolves --
      // setImmediate runs after I/O callbacks, which is where SonicBoom's async flush lands.
      restore: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        spy.mockRestore();
      },
    };
  };

  it('persists and logs LOGIN_SUCCESS for a real-DB login', async () => {
    const passwordHash = await hashPassword('rray');
    const { pool, inserts } = makeAuditPool({
      user_name: 'rray',
      first_name: 'Ryan',
      last_name: 'Ray',
      password_hash: passwordHash,
      role: 'superuser',
      organization_id: 'org-1',
    });
    const capture = captureStdout();
    const app = createApp(undefined, undefined, undefined, pool);

    await request(app).post('/api/auth/login').send({ username: 'rray', password: 'rray' }).expect(200);
    await capture.restore();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params).toEqual(
      expect.arrayContaining(['org-1', 'rray', 'LOGIN_SUCCESS']),
    );

    const logLine = capture.lines().find((line) => line.action === 'auth.login_success');
    expect(logLine).toMatchObject({ username: 'rray', organizationId: 'org-1' });
  });

  it('persists and logs LOGIN_FAILURE with reason unknown_username', async () => {
    const { pool, inserts } = makeAuditPool(null);
    const capture = captureStdout();
    const app = createApp(undefined, undefined, undefined, pool);

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'whatever' })
      .expect(401);
    await capture.restore();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params).toEqual(
      expect.arrayContaining([null, 'nobody', 'LOGIN_FAILURE', 'unknown_username']),
    );

    const logLine = capture.lines().find((line) => line.action === 'auth.login_failure');
    expect(logLine).toMatchObject({ username: 'nobody', failureReason: 'unknown_username' });
  });

  it('persists and logs LOGIN_FAILURE with reason invalid_password, distinct from unknown_username', async () => {
    const passwordHash = await hashPassword('rray');
    const { pool, inserts } = makeAuditPool({
      user_name: 'rray',
      first_name: 'Ryan',
      last_name: 'Ray',
      password_hash: passwordHash,
      role: 'superuser',
      organization_id: 'org-1',
    });
    const app = createApp(undefined, undefined, undefined, pool);

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'wrong-password' })
      .expect(401);

    expect(inserts[0]?.params).toEqual(
      expect.arrayContaining(['org-1', 'rray', 'LOGIN_FAILURE', 'invalid_password']),
    );
  });

  it('logs LOGIN_SUCCESS for local fallback without attempting to persist (no pool configured)', async () => {
    vi.stubEnv('ALLOW_LOCAL_LOGIN_FALLBACK', 'true');
    const capture = captureStdout();
    const app = createApp();

    await request(app).post('/api/auth/login').send({ username: 'rray', password: 'rray' }).expect(200);
    await capture.restore();

    const logLine = capture.lines().find((line) => line.action === 'auth.login_success');
    expect(logLine).toMatchObject({ username: 'rray' });
  });

  it('persists and logs LOGOUT after a successful logout', async () => {
    const { pool, inserts } = makeAuditPool(null);
    const capture = captureStdout();
    const app = createApp(undefined, undefined, undefined, pool);

    await authedApp(app, { sub: 'rray', organizationId: 'org-1' })
      .post('/api/auth/logout')
      .expect(204);
    await capture.restore();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params).toEqual(expect.arrayContaining(['org-1', 'rray', 'LOGOUT']));

    const logLine = capture.lines().find((line) => line.action === 'auth.logout');
    expect(logLine).toMatchObject({ username: 'rray', organizationId: 'org-1' });
  });
});
