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
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .attach('qboFile', qboBuffer, { filename: 'qbo.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
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

    const exceptionsResponse = await request(app).get(`/api/reconciliation/${id}/exceptions`).expect(200);
    expect(Array.isArray(exceptionsResponse.body)).toBe(true);
    const exceptionsPayload = exceptionsResponse.body as Array<{
      category: string;
      ruleTrace?: { ruleId?: string; reason?: string };
      recommendedNextActions?: string[];
    }>;
    expect(exceptionsPayload.length).toBeGreaterThan(0);
    expect(
      exceptionsPayload.every(
        (item) => typeof item.ruleTrace?.reason === 'string' && (item.recommendedNextActions?.length ?? 0) > 0,
      ),
    ).toBe(true);

    const workbookResponse = await request(app)
      .get(`/api/reconciliation/${id}/export/workbook`)
      .buffer(true)
      .parse(parseBinaryBody as (response: unknown, callback: (error: Error | null, body: unknown) => void) => void)
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
      .values
      .filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining(['Total exact matches', 'Total probable matches', 'Total timing differences']),
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

    const workbookCategoryCounts = nonHeaderCategories.reduce<Record<string, number>>((counts, label) => {
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {});
    const exceptionCounts = exceptionsPayload.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return counts;
    }, {});

    Object.entries(exceptionCounts).forEach(([category, count]) => {
      const displayName = errorCategoryDisplayNames[category as keyof typeof errorCategoryDisplayNames] ?? category;
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
        (item) => item.category === 'DepositGroupingIssue' || item.category === 'LikelySplitCombineIssue',
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
    const snapshotDirectory = mkdtempSync(path.join(tmpdir(), 'reconciliation-reviewer-decisions-'));

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
          targetType: probableTarget?.disposition === 'AmbiguousReview' ? 'AmbiguousReview' : 'ProbableMatch',
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
});
