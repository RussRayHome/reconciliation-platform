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

  it('reaches Step 3 and reports exactly the hand-verified per-row and file-level codes, offering partial import', async () => {
    const outcome = await validateFile({
      bytes: fixture('banking-multi-error.csv'),
      fileFormat: 'CSV',
      fileType: 'BANK',
    });

    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER', 'CELL_VALUES']);
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

    // Rows 1 (Sequence 1, first occurrence) and 7 (Sequence 7) are the only rows with no per-row
    // hard error -- the balance-continuity finding on row 7 doesn't exclude row 7 itself, matching
    // the engine's own behavior (a file-level Step 3 finding doesn't retroactively drop a row that
    // is otherwise individually clean). This is exactly what makes partial import possible: 2 of 7
    // rows are importable even though the file overall is not `ok`.
    expect(outcome.normalized.map((record) => record.recordId)).toEqual(['1', '7']);
    expect(outcome.normalized).toHaveLength(2);
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

  it('reports per-row codes without excluding rows whose only finding is a warning', async () => {
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

    // Row 1 (clean) and row 4 (zero-amount is a WARNING, not a hard error) are the only importable
    // rows -- rows 2, 3, and 5 each have their own row-level hard error.
    expect(outcome.normalized.map((record) => record.recordId)).toEqual(['1', '4']);
    expect(outcome.normalized).toHaveLength(2);
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
