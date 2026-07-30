import {
  allExceptionCategories,
  createAllExceptionsBankWorkbook,
  createAllExceptionsQboWorkbook,
  createSampleBankWorkbook,
  createSampleQboWorkbook,
  createWorkbookFromRows,
  nonStandardHeaderBankRows,
  nonStandardHeaderQboRows,
} from '@recon/test-fixtures';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { PostgresReconciliationReadModelStore } from '@recon/persistence';

import ExcelJS from 'exceljs';
import { FileBackedRunRepository } from '../src/services/runRepository';
import { createApp } from '../src/app';
import { errorCategoryDisplayNames } from '@recon/domain';
import path from 'node:path';
import request from 'supertest';
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
  ) => Promise<{ rows: Array<{ user_name: string; first_name: string; last_name: string }> }>;
};

const createCountingReadModelPool = (runId: string, exceptionCount: number) => {
  let queryCount = 0;
  const now = new Date().toISOString();

  const exceptionRows = Array.from({ length: exceptionCount }, (_, index) => ({
    id: `exception-${index + 1}`,
    category: 'MissingFromQBO',
    severity: 'High',
    source_system: 'bank',
    spreadsheet_file_name: 'bank.xlsx',
    line_number: index + 2,
    transaction_date: '2025-01-01',
    amount: 10 + index,
    error_message: `Synthetic exception ${index + 1}`,
    rule_trace_json: {
      ruleId: 'residual-missing-from-qbo',
      ruleName: 'Missing from QBO',
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
    qbo_records: exceptionCount,
    exact_matches: 0,
    probable_matches: 0,
    unmatched_items: exceptionCount,
    duplicates: 0,
    bank_duplicates: 0,
    qbo_duplicates: 0,
    date_variances: 0,
    timing_differences: 0,
    data_quality_issues: 0,
    amount_mismatches: 0,
    missing_from_bank: 0,
    missing_from_qbo: exceptionCount,
    unmatched_bank_net_amount: 0,
    unmatched_qbo_net_amount: exceptionCount * 10,
    clean_matched_amount: 0,
    unresolved_exposure: exceptionCount * 10,
    counts_by_category_json: { MissingFromQBO: exceptionCount },
    amount_by_category_json: { MissingFromQBO: exceptionCount * 10 },
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

  return {
    pool,
    getQueryCount: (): number => queryCount,
    resetQueryCount: (): void => {
      queryCount = 0;
    },
  };
};

describe('reconciliation API', () => {
  it('runs reconciliation and exposes summary, exceptions, and workbook export endpoints', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'January 2025')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
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

    const latestResponse = await request(app).get('/api/reconciliation/latest').expect(200);
    const latestPayload = latestResponse.body as { id: string };
    expect(latestPayload.id).toBe(id);
    expect((latestResponse.body as Record<string, unknown>).rawRows).toBeUndefined();
    expect((latestResponse.body as Record<string, unknown>).normalizedTransactions).toBeUndefined();

    const summaryResponse = await request(app).get(`/api/reconciliation/${id}/summary`).expect(200);
    const summaryPayload = summaryResponse.body as {
      exactMatches: number;
      countsByCategory: Record<string, number>;
    };
    expect(summaryPayload.exactMatches).toBeGreaterThanOrEqual(1);

    const exceptionsResponse = await request(app)
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

    const workbookResponse = await request(app)
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

  it('handles non-standard bank headers for account 5703 without cascading invalid amount errors', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(nonStandardHeaderBankRows),
      createWorkbookFromRows(nonStandardHeaderQboRows),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', '5703')
      .field('periodLabel', 'January 2025')
      .attach('bankFile', bankBuffer, {
        filename: 'bank-5703.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo-5703.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      summary: {
        exactMatches: number;
        dataQualityIssues: number;
      };
    };

    expect(runPayload.summary.exactMatches).toBeGreaterThanOrEqual(2);
    expect(runPayload.summary.dataQualityIssues).toBe(0);
  });

  it('accepts the combined all-exceptions workbook pair and surfaces every exception category through the API', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'All Exception Categories')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'sample-all-exceptions-qbo.xlsx',
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

    const exceptionsResponse = await request(app)
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
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'Paginated Exceptions')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'sample-all-exceptions-qbo.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as { id: string; exceptions: Array<{ id: string }> };

    const pagedResponse = await request(app)
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
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('periodLabel', 'Filtered Exceptions')
      .attach('bankFile', bankBuffer, {
        filename: 'sample-all-exceptions-bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'sample-all-exceptions-qbo.xlsx',
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

    const categoryResponse = await request(app)
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

    const combinedResponse = await request(app)
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

    await request(app)
      .get(`/api/reconciliation/${runPayload.id}/exceptions?category=NotACategory`)
      .expect(400);

    await request(app)
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

    const pagedResponse = await request(app)
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

    const runResponse = await request(app).get(`/api/reconciliation/${runId}`).expect(200);
    const runPayload = runResponse.body as { id: string; exceptions: unknown[] };

    expect(runPayload.id).toBe(runId);
    expect(runPayload.exceptions).toHaveLength(20);
    expect(getQueryCount()).toBeLessThanOrEqual(9);
  });

  it('accepts browser uploads when the workbook MIME type is application/octet-stream', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const response = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/octet-stream',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/octet-stream',
      })
      .expect(201);

    const payload = response.body as {
      sourceFiles: Array<{ fileName: string }>;
      summary: { totalRecordsReviewed: number };
    };

    expect(payload.sourceFiles.map((file) => file.fileName)).toEqual(['bank.xlsx', 'qbo.xlsx']);
    expect(payload.summary.totalRecordsReviewed).toBeGreaterThan(0);
  });

  it('rejects non-xlsx uploads with a validation error', async () => {
    const app = createApp();
    const qboBuffer = await createSampleQboWorkbook();

    const response = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', Buffer.from('not-an-excel-file'), {
        filename: 'bank.txt',
        contentType: 'text/plain',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/octet-stream',
      })
      .expect(400);

    const payload = response.body as { message: string };
    expect(payload.message).toContain('Only .xlsx files are accepted.');
  });

  it('rejects requests that do not provide both required files', async () => {
    const app = createApp();

    const response = await request(app).post('/api/reconciliation/run').expect(400);
    const payload = response.body as { message: string };
    expect(payload.message).toContain('Both bankFile and qboFile');
  });

  it('returns 404 when no latest reconciliation run has been stored yet', async () => {
    const app = createApp();

    const response = await request(app).get('/api/reconciliation/latest').expect(404);
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
      const [bankBuffer, qboBuffer] = await Promise.all([
        createSampleBankWorkbook(),
        createSampleQboWorkbook(),
      ]);

      const runResponse = await request(firstApp)
        .post('/api/reconciliation/run')
        .attach('bankFile', bankBuffer, {
          filename: 'bank.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        .attach('qboFile', qboBuffer, {
          filename: 'qbo.xlsx',
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

      const decisionResponse = await request(firstApp)
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

      const reviewerDecisionList = await request(firstApp)
        .get(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
        .expect(200);
      const reviewerDecisionsPayload = reviewerDecisionList.body as Array<{ targetId: string }>;
      expect(reviewerDecisionsPayload).toHaveLength(1);
      expect(reviewerDecisionsPayload[0]?.targetId).toBe(probableTarget?.id);

      const restartedApp = createApp(new FileBackedRunRepository(repositoryFilePath));
      const runAfterRestart = await request(restartedApp)
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
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('qboFile', qboBuffer, { filename: 'qbo.xlsx', contentType: spreadsheetMime })
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

    await request(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({ targetType, targetId, outcome: 'ApprovedMatch' })
      .expect(201);

    await request(app)
      .delete(
        `/api/reconciliation/${runPayload.id}/reviewer-decisions/${encodeURIComponent(targetId)}`,
      )
      .query({ targetType })
      .expect(204);

    const afterDelete = await request(app)
      .get(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .expect(200);
    expect(afterDelete.body).toEqual([]);

    // A second delete is a no-op and still succeeds.
    await request(app)
      .delete(
        `/api/reconciliation/${runPayload.id}/reviewer-decisions/${encodeURIComponent(targetId)}`,
      )
      .query({ targetType })
      .expect(204);
  });

  it('rejects a reviewer decision delete without a valid targetType', async () => {
    const app = createApp();
    const spreadsheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('qboFile', qboBuffer, { filename: 'qbo.xlsx', contentType: spreadsheetMime })
      .expect(201);

    const { id } = runResponse.body as { id: string };

    await request(app)
      .delete(`/api/reconciliation/${id}/reviewer-decisions/some-target`)
      .expect(400);
  });

  it('returns 404 for run, summary, exceptions, and workbook when run id is unknown', async () => {
    const app = createApp();
    const unknownId = 'does-not-exist';

    await request(app).get(`/api/reconciliation/${unknownId}`).expect(404);
    await request(app).get(`/api/reconciliation/${unknownId}/summary`).expect(404);
    await request(app).get(`/api/reconciliation/${unknownId}/exceptions`).expect(404);
    await request(app)
      .get(`/api/reconciliation/${unknownId}/exceptions?limit=5&offset=0`)
      .expect(404);
    await request(app).get(`/api/reconciliation/${unknownId}/export/workbook`).expect(404);
  });

  it('returns 404 when posting a reviewer decision to an unknown run id', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/reconciliation/does-not-exist/reviewer-decisions')
      .send({ targetType: 'ExceptionItem', targetId: 'some-id', outcome: 'ConfirmedException' })
      .expect(404);

    const payload = response.body as { message: string };
    expect(payload.message).toContain('not found');
  });

  it('accepts ConfirmedException and ReclassifiedException decisions for ExceptionItem targets', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };

    expect(runPayload.exceptions.length).toBeGreaterThan(1);
    const [exception1, exception2] = runPayload.exceptions;

    const confirmedResponse = await request(app)
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

    const reclassifiedResponse = await request(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: exception2?.id,
        outcome: 'ReclassifiedException',
        finalCategory: 'MissingFromQBO',
      })
      .expect(201);

    const reclassifiedDecision = reclassifiedResponse.body as {
      outcome: string;
      finalCategory: string;
    };
    expect(reclassifiedDecision.outcome).toBe('ReclassifiedException');
    expect(reclassifiedDecision.finalCategory).toBe('MissingFromQBO');
  });

  it('rejects reviewer decisions with missing or invalid field values', async () => {
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const { id, exceptions } = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };
    const exceptionId = exceptions[0]?.id;

    const missingTargetType = await request(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetId: exceptionId, outcome: 'ConfirmedException' })
      .expect(400);
    expect((missingTargetType.body as { message: string }).message).toContain('targetType');

    const emptyTargetId = await request(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetType: 'ExceptionItem', targetId: '   ', outcome: 'ConfirmedException' })
      .expect(400);
    expect((emptyTargetId.body as { message: string }).message).toContain('targetId');

    const missingOutcome = await request(app)
      .post(`/api/reconciliation/${id}/reviewer-decisions`)
      .send({ targetType: 'ExceptionItem', targetId: exceptionId })
      .expect(400);
    expect((missingOutcome.body as { message: string }).message).toContain('outcome');

    const nonExistentTarget = await request(app)
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
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    const runResponse = await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    const runPayload = runResponse.body as {
      id: string;
      exceptions: Array<{ id: string }>;
    };

    const invalidOutcomeResponse = await request(app)
      .post(`/api/reconciliation/${runPayload.id}/reviewer-decisions`)
      .send({
        targetType: 'ExceptionItem',
        targetId: runPayload.exceptions[0]?.id,
        outcome: 'ApprovedMatch',
      })
      .expect(400);

    const invalidOutcomePayload = invalidOutcomeResponse.body as { message: string };
    expect(invalidOutcomePayload.message).toContain('not valid for the specified target type');

    const missingCategoryResponse = await request(app)
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
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(200);

    expect(response.body).toEqual({
      username: 'rray',
      firstName: 'rray',
      lastName: '',
    });
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
    const authPool: QueryableAuthPool = {
      query: (_text, params) => {
        const username = typeof params?.[0] === 'string' ? params[0] : '';
        const password = typeof params?.[1] === 'string' ? params[1] : '';

        if (username !== 'rray' || password !== 'rray') {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({
          rows: [
            {
              user_name: 'rray',
              first_name: 'Ryan',
              last_name: 'Ray',
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

    expect(response.body).toEqual({
      username: 'rray',
      firstName: 'Ryan',
      lastName: 'Ray',
    });
  });
});
