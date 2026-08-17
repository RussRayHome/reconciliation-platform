import { describe, expect, it } from 'vitest';

import { buildImportRowGrid } from '../src/services/importRowGridService';

const bankCsv = Buffer.from(
  'transaction_id,account_id,posted_date,amount,currency_code\n' +
    'TXN-1,ACC-1,2026-07-01,100.00,USD\n' +
    'TXN-2,ACC-1,2026-07-02,not-a-number,USD\n' +
    'TXN-3,ACC-1,2026-07-03,,USD\n',
);

describe('buildImportRowGrid', () => {
  it('annotates only the row/field an issue targets, leaving other rows clean', async () => {
    const grid = await buildImportRowGrid({
      bytes: bankCsv,
      fileFormat: 'CSV',
      issues: [
        {
          severity: 'ERROR',
          code: 'BANK_AMOUNT_FORMAT',
          field: 'amount',
          rowNumber: 3,
          message: '"amount" is not a valid number.',
        },
      ],
    });

    expect(grid.headers).toEqual(['transaction_id', 'account_id', 'posted_date', 'amount', 'currency_code']);
    expect(grid.totalRows).toBe(3);
    expect(grid.errorRowCount).toBe(1);
    expect(grid.warningRowCount).toBe(0);
    expect(grid.cleanRowCount).toBe(2);

    const [row1, row2, row3] = grid.rows;
    expect(row1).toMatchObject({ lineNumber: 1, status: 'IMPORT', flaggedFields: {} });
    expect(row2).toMatchObject({ lineNumber: 2, status: 'IMPORT', flaggedFields: {} });
    expect(row3!.lineNumber).toBe(3);
    expect(row3!.status).toBe('SKIP');
    expect(row3!.flaggedFields.amount).toMatchObject({
      code: 'BANK_AMOUNT_FORMAT',
      severity: 'ERROR',
    });
    expect(row3!.flaggedFields.transaction_id).toBeUndefined();
  });

  it('keeps a warning-only row as IMPORT (warnings never block import)', async () => {
    const grid = await buildImportRowGrid({
      bytes: bankCsv,
      fileFormat: 'CSV',
      issues: [
        {
          severity: 'WARNING',
          code: 'CSV_ENCODING_NON_UTF8',
          field: 'description',
          rowNumber: 1,
          message: 'Transcoded from CP-1252.',
        },
      ],
    });

    expect(grid.rows[0]!.status).toBe('IMPORT');
    expect(grid.warningRowCount).toBe(1);
    expect(grid.errorRowCount).toBe(0);
    expect(grid.cleanRowCount).toBe(2);
  });

  it('puts a fieldless issue into rowLevelIssues rather than flaggedFields', async () => {
    const grid = await buildImportRowGrid({
      bytes: bankCsv,
      fileFormat: 'CSV',
      issues: [
        {
          severity: 'ERROR',
          code: 'GL_UNBALANCED',
          field: null,
          rowNumber: 1,
          message: 'Debits and credits differ.',
        },
      ],
    });

    expect(grid.rows[0]!.flaggedFields).toEqual({});
    expect(grid.rows[0]!.rowLevelIssues).toEqual([
      { code: 'GL_UNBALANCED', severity: 'ERROR', message: 'Debits and credits differ.' },
    ]);
    expect(grid.rows[0]!.status).toBe('SKIP');
  });

  it('ignores file-level issues (rowNumber null) when building per-row annotations', async () => {
    const grid = await buildImportRowGrid({
      bytes: bankCsv,
      fileFormat: 'CSV',
      issues: [
        {
          severity: 'ERROR',
          code: 'BANK_BALANCE_CONTINUITY',
          field: null,
          rowNumber: null,
          message: 'Running balance does not reconcile.',
        },
      ],
    });

    expect(grid.rows.every((row) => row.status === 'IMPORT')).toBe(true);
    expect(grid.errorRowCount).toBe(0);
  });

  it('is not truncated for a small file', async () => {
    const grid = await buildImportRowGrid({ bytes: bankCsv, fileFormat: 'CSV', issues: [] });
    expect(grid.truncated).toBe(false);
    expect(grid.rows).toHaveLength(3);
  });
});
