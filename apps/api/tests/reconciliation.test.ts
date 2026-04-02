import {
  createSampleBankWorkbook,
  createSampleQboWorkbook,
  createWorkbookFromRows,
  nonStandardHeaderBankRows,
  nonStandardHeaderQboRows,
} from '@recon/test-fixtures';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { createApp } from '../src/app';
import request from 'supertest';

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
    };

    expect(runPayload.id).toBeTypeOf('string');
    expect(runPayload.summary.totalRecordsReviewed).toBeGreaterThan(0);

    const { id } = runPayload;

    const summaryResponse = await request(app).get(`/api/reconciliation/${id}/summary`).expect(200);
    const summaryPayload = summaryResponse.body as { exactMatches: number };
    expect(summaryPayload.exactMatches).toBeGreaterThanOrEqual(1);

    const exceptionsResponse = await request(app).get(`/api/reconciliation/${id}/exceptions`).expect(200);
    expect(Array.isArray(exceptionsResponse.body)).toBe(true);

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

    const categoryColumnValues = errorReportSheet
      ?.getColumn(2)
      .values
      .filter((value) => typeof value === 'string') as string[];

    const nonHeaderCategories = categoryColumnValues.filter((value) => value !== 'Category');
    expect(nonHeaderCategories.some((value) => value.includes(' '))).toBe(true);
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
});
