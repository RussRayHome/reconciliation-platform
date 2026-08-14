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
      expect.objectContaining({ code: 'STRUCT_COLUMN_MISSING', field: 'currency_code' }),
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
      expect.objectContaining({ code: 'BANK_ID_DUPLICATE', rowNumber: 2 }),
      expect.objectContaining({ code: 'BANK_POSTED_DATE_FORMAT', rowNumber: 3 }),
      expect.objectContaining({ code: 'BANK_AMOUNT_FORMAT', rowNumber: 4 }),
      expect.objectContaining({ code: 'BANK_TYPE_INVALID', rowNumber: 5 }),
      expect.objectContaining({ code: 'BANK_DESCRIPTION_REQUIRED', rowNumber: 6 }),
      expect.objectContaining({ code: 'BANK_BALANCE_CONTINUITY', rowNumber: 7 }),
    ]);

    // Rows 1 (TXN-B001, first occurrence) and 7 (TXN-B007) are the only rows with no per-row
    // hard error -- the balance-continuity finding on row 7 doesn't exclude row 7 itself, matching
    // schema.ts's own ported behavior (a file-level Step 3 finding doesn't retroactively drop a
    // row that is otherwise individually clean). This is exactly what makes partial import
    // possible: 2 of 7 rows are importable even though the file overall is not `ok`.
    expect(outcome.normalized.map((record) => record.recordId)).toEqual(['TXN-B001', 'TXN-B007']);
    expect(outcome.normalized).toHaveLength(2);
    expect(outcome.totalRowCount).toBe(7);
  });
});

describe('validateFile (GL)', () => {
  it('a fully valid, balanced entry passes all three gates with zero issues', async () => {
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

  it('reports per-row and entry-level codes without excluding otherwise-clean lines from the same entry', async () => {
    const outcome = await validateFile({
      bytes: fixture('gl-multi-error.csv'),
      fileFormat: 'CSV',
      fileType: 'GL',
    });

    expect(outcome.gatesRun).toEqual(['HEADER', 'COLUMN_ORDER', 'CELL_VALUES']);
    expect(outcome.ok).toBe(false);

    const codes = outcome.issues.map((issue) => issue.code);
    expect(codes).toContain('GL_DESCRIPTION_REQUIRED'); // JE-2 line 2 (row 5)
    expect(codes).toContain('GL_UNBALANCED'); // JE-2: 300 debit vs 290 credit
    expect(codes).toContain('GL_LINE_NO_DUPLICATE'); // JE-3: line_number "1" used twice

    // JE-1 (both lines clean+balanced), JE-2 line 1 (clean despite its entry being unbalanced),
    // and both JE-3 lines (clean despite the entry-level duplicate-line-number finding) are all
    // importable -- only JE-2 line 2 has its own row-level hard error.
    expect(outcome.normalized.map((record) => record.recordId)).toEqual([
      'JE-1:1',
      'JE-1:2',
      'JE-2:1',
      'JE-3:1',
      'JE-3:1', // duplicate line_number -> duplicate recordId, both still individually valid
    ]);
    expect(outcome.normalized).toHaveLength(5);
  });
});

describe('validateFile (XLSX)', () => {
  it('validates the same outcome as the equivalent CSV data, built in-memory', async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow([
      'transaction_id',
      'account_id',
      'posted_date',
      'transaction_date',
      'amount',
      'currency_code',
      'transaction_type',
      'description',
      'memo',
      'check_number',
      'reference_number',
      'counterparty_account',
      'running_balance',
    ]);
    sheet.addRow(['TXN-X001', 'ACC-1', '2026-07-01', null, 100, 'USD', 'DEP', 'Deposit', null, null, 'REF-1', null, 1000]);
    sheet.addRow(['TXN-X002', 'ACC-1', '2026-07-02', null, -84.23, 'USD', 'POS', 'Purchase', null, null, 'REF-2', null, 915.77]);
    const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const outcome = await validateFile({ bytes: xlsxBytes, fileFormat: 'XLSX', fileType: 'BANK' });

    expect(outcome.ok).toBe(true);
    expect(outcome.normalized).toHaveLength(2);
  });
});
