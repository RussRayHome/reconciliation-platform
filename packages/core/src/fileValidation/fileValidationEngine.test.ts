import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateFile } from './fileValidationEngine';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '__fixtures__', name));

describe('validateFile (banking)', () => {
  it('a fully valid file passes all three gates with zero issues', async () => {
    const outcome = await validateFile({
      bytes: fixture('banking-valid.csv'),
      fileFormat: 'CSV',
      fileType: 'BANK',
    });

    expect(outcome).toMatchObject({
      ok: true,
      gatesRun: ['HEADER', 'COLUMN_ORDER', 'CELL_VALUES'],
      issues: [],
      totalRowCount: 3,
    });
    expect(outcome.normalized).toHaveLength(3);
  });

  it('stops at Step 1 when the first row is not a recognizable header', async () => {
    const outcome = await validateFile({
      bytes: fixture('banking-structural-header-missing.csv'),
      fileFormat: 'CSV',
      fileType: 'BANK',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.gatesRun).toEqual(['HEADER']);
    expect(outcome.issues).toEqual([expect.objectContaining({ code: 'STRUCT_HEADER_MISSING' })]);
    expect(outcome.normalized).toEqual([]);
    // The parser still read every row before Step 1 rejected row 1 as a header -- totalRowCount
    // reflects that, even though the engine stopped before Step 3 could normalize any of them.
    expect(outcome.totalRowCount).toBeGreaterThan(0);
  });

  it('stops at Step 2 when a required column is missing -- Step 3 never runs', async () => {
    const outcome = await validateFile({
      bytes: fixture('banking-structural-missing-column.csv'),
      fileFormat: 'CSV',
      fileType: 'BANK',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER']);
    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: 'STRUCT_COLUMN_MISSING', field: 'Sequence Number' }),
    ]);
    expect(outcome.normalized).toEqual([]);
  });

  it('reaches Step 3, reports the hand-verified per-row and file-level codes, and keeps every row', async () => {
    const outcome = await validateFile({
      bytes: fixture('banking-multi-error.csv'),
      fileFormat: 'CSV',
      fileType: 'BANK',
    });

    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER', 'CELL_VALUES']);
    // `ok` stays an accurate "did this file have problems" signal even though no row gets
    // excluded any more -- it's no longer what gates whether reconciliation proceeds
    // (apps/api uses `gatesRun.includes('CELL_VALUES')` for that instead).
    expect(outcome.ok).toBe(false);

    // 7 data rows, 6 errors, one per row from line 3 on; line 2 and line 8 are clean.
    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: 'BANK_SEQUENCE_DUPLICATE', rowNumber: 2 }),
      expect.objectContaining({ code: 'BANK_DATE_FORMAT', rowNumber: 3 }),
      expect.objectContaining({ code: 'BANK_CREDIT_FORMAT', rowNumber: 4 }),
      // An unparseable Credit falls back to 0 in the amount tally, so it also fails the
      // at-least-one-of check -- both findings are correct on this one row.
      expect.objectContaining({ code: 'BANK_NO_AMOUNT', rowNumber: 4 }),
      expect.objectContaining({ code: 'BANK_BOTH_AMOUNTS', rowNumber: 5 }),
      expect.objectContaining({ code: 'BANK_DESCRIPTION_REQUIRED', rowNumber: 6 }),
      expect.objectContaining({ code: 'BANK_BALANCE_CONTINUITY', rowNumber: 7 }),
    ]);

    // Nothing is excluded on a content issue any more -- all 7 rows stay normalized, each
    // carrying its own issues (empty for the two genuinely clean rows) so a flagged row still
    // surfaces downstream instead of silently vanishing.
    expect(outcome.normalized).toHaveLength(7);
    // Row 2 duplicates row 1's own Sequence Number ("1"), so its recordId is "1" too -- that's
    // the whole point of BANK_SEQUENCE_DUPLICATE.
    expect(outcome.normalized.map((record) => record.recordId)).toEqual([
      '1',
      '1',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(outcome.normalized[0]?.issues).toEqual([]);
    expect(outcome.normalized[1]?.issues).toEqual([
      expect.objectContaining({ code: 'BANK_SEQUENCE_DUPLICATE' }),
    ]);
    expect(outcome.normalized[6]?.issues).toEqual([]);
    expect(outcome.totalRowCount).toBe(7);
  });
});

describe('validateFile (GL)', () => {
  it('a fully valid file passes all three gates with zero issues', async () => {
    const outcome = await validateFile({
      bytes: fixture('gl-valid.csv'),
      fileFormat: 'CSV',
      fileType: 'GL',
    });

    expect(outcome).toMatchObject({
      ok: true,
      gatesRun: ['HEADER', 'COLUMN_ORDER', 'CELL_VALUES'],
      issues: [],
    });
    expect(outcome.normalized).toHaveLength(2);
  });

  it('reports per-row codes and keeps every row, including ones with a hard error', async () => {
    const outcome = await validateFile({
      bytes: fixture('gl-multi-error.csv'),
      fileFormat: 'CSV',
      fileType: 'GL',
    });

    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER', 'CELL_VALUES']);
    expect(outcome.ok).toBe(false);

    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: 'GL_DESCRIPTION_REQUIRED', rowNumber: 2 }),
      expect.objectContaining({ code: 'GL_AMOUNT_FORMAT', rowNumber: 3 }),
      expect.objectContaining({ code: 'GL_AMOUNT_ZERO', rowNumber: 4, severity: 'WARNING' }),
      expect.objectContaining({ code: 'GL_TXN_DATE_FORMAT', rowNumber: 5 }),
    ]);

    // Nothing is excluded on a content issue any more -- all 5 rows stay normalized, each
    // carrying its own issues (empty for row 1, the only genuinely clean row).
    expect(outcome.normalized).toHaveLength(5);
    expect(outcome.normalized.map((record) => record.recordId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(outcome.normalized[0]?.issues).toEqual([]);
    expect(outcome.normalized[1]?.issues).toEqual([
      expect.objectContaining({ code: 'GL_DESCRIPTION_REQUIRED' }),
    ]);
    expect(outcome.normalized[2]?.issues).toEqual([
      expect.objectContaining({ code: 'GL_AMOUNT_FORMAT' }),
    ]);
    expect(outcome.normalized[3]?.issues).toEqual([
      expect.objectContaining({ code: 'GL_AMOUNT_ZERO', severity: 'WARNING' }),
    ]);
    expect(outcome.normalized[4]?.issues).toEqual([
      expect.objectContaining({ code: 'GL_TXN_DATE_FORMAT' }),
    ]);
  });
});

describe('validateFile (BILLING)', () => {
  it('a fully valid file passes all three gates with zero issues', async () => {
    const outcome = await validateFile({
      bytes: fixture('billing-valid.csv'),
      fileFormat: 'CSV',
      fileType: 'BILLING',
    });

    expect(outcome).toMatchObject({
      ok: true,
      gatesRun: ['HEADER', 'COLUMN_ORDER', 'CELL_VALUES'],
      issues: [],
      totalRowCount: 2,
    });
    expect(outcome.normalized).toHaveLength(2);
    expect(outcome.normalized.map((record) => record.sourceSystem)).toEqual(['BILLING', 'BILLING']);
  });

  it('stops at Step 2 when a required column is missing -- Step 3 never runs', async () => {
    const outcome = await validateFile({
      bytes: fixture('billing-structural-missing-column.csv'),
      fileFormat: 'CSV',
      fileType: 'BILLING',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER']);
    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: 'STRUCT_COLUMN_MISSING', field: 'Doc No' }),
    ]);
    expect(outcome.normalized).toEqual([]);
  });
});

describe('validateFile (XLSX)', () => {
  it('validates the same outcome as the equivalent CSV data, built in-memory', async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Date', 'Description', 'Sequence Number', 'Check Number', 'Reference', 'Debit', 'Credit', 'Balance']);
    sheet.addRow(['2026-07-01', 'Deposit', '1', null, 'REF-1', null, 100, 1000]);
    sheet.addRow(['2026-07-02', 'Purchase', '2', null, 'REF-2', 84.23, null, 915.77]);
    const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const outcome = await validateFile({ bytes: xlsxBytes, fileFormat: 'XLSX', fileType: 'BANK' });

    expect(outcome.ok).toBe(true);
    expect(outcome.normalized).toHaveLength(2);
  });
});
