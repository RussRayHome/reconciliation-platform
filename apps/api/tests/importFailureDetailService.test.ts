import { describe, expect, it } from 'vitest';

import {
  buildErrorReportCsv,
  buildImportFileFailureDetail,
} from '../src/services/importFailureDetailService';

const unrecognizableHeaderCsv = Buffer.from(
  'col_a,col_b,col_c\nx,y,z\n',
);

const validBankingHeaderMissingSequenceCsv = Buffer.from(
  'Date,Description,Check Number,Reference,Debit,Credit,Balance\n' +
    '2026-07-01,Payroll,,REF-1,,100.00,1000.00\n',
);

const fullyValidBankingHeaderCsv = Buffer.from(
  'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
    '2026-07-01,Payroll,1,,REF-1,not-a-number,,1000.00\n',
);

const baseInput = {
  importFileId: 'file-1',
  originalFilename: 'bank.csv',
  sourceType: 'BANK' as const,
  fileFormat: 'CSV' as const,
  validationStatus: 'INVALID',
  rowCount: 1,
  errorCount: 1,
  warningCount: 0,
  importableRowCount: 0,
};

describe('buildImportFileFailureDetail', () => {
  it('derives a HEADER-gate-failed sequence with a populated header comparison', async () => {
    const detail = await buildImportFileFailureDetail({
      ...baseInput,
      bytes: unrecognizableHeaderCsv,
      issues: [
        {
          severity: 'ERROR',
          code: 'STRUCT_HEADER_MISSING',
          message: 'The first row does not match any expected column name.',
          field: null,
          rowNumber: null,
        },
      ],
    });

    expect(detail.gateSequence).toEqual([
      { gate: 'HEADER', state: 'FAILED' },
      { gate: 'COLUMN_ORDER', state: 'NOT_RUN' },
      { gate: 'CELL_VALUES', state: 'NOT_RUN' },
    ]);
    expect(detail.headerComparison).not.toBeNull();
    // The found headers (col_a/col_b/col_c) match none of the expected required banking headers.
    expect(detail.headerComparison!.every((row) => !row.matches)).toBe(true);
    expect(detail.headerComparison![0]).toMatchObject({
      position: 1,
      expected: 'Date',
      found: 'col_a',
    });
  });

  it('derives a COLUMN_ORDER-gate-failed sequence when a required column is missing', async () => {
    const detail = await buildImportFileFailureDetail({
      ...baseInput,
      bytes: validBankingHeaderMissingSequenceCsv,
      issues: [
        {
          severity: 'ERROR',
          code: 'STRUCT_COLUMN_MISSING',
          message: 'Required column "Sequence Number" is absent.',
          field: 'Sequence Number',
          rowNumber: null,
        },
      ],
    });

    expect(detail.gateSequence).toEqual([
      { gate: 'HEADER', state: 'PASSED' },
      { gate: 'COLUMN_ORDER', state: 'FAILED' },
      { gate: 'CELL_VALUES', state: 'NOT_RUN' },
    ]);
    expect(detail.headerComparison).not.toBeNull();
    // Sequence Number (3rd required header) is absent from the actual file's headers -- found
    // slides everything after it over by one position, so this position shows the mismatch.
    const sequenceRow = detail.headerComparison!.find((row) => row.expected === 'Sequence Number');
    expect(sequenceRow?.matches).toBe(false);
  });

  it('derives an all-gates-passed sequence with no header comparison when there is no structural failure', async () => {
    const detail = await buildImportFileFailureDetail({
      ...baseInput,
      bytes: fullyValidBankingHeaderCsv,
      issues: [
        {
          severity: 'ERROR',
          code: 'BANK_DEBIT_FORMAT',
          message: '"Debit" is not a valid amount.',
          field: 'Debit',
          rowNumber: 1,
        },
      ],
    });

    expect(detail.gateSequence).toEqual([
      { gate: 'HEADER', state: 'PASSED' },
      { gate: 'COLUMN_ORDER', state: 'PASSED' },
      { gate: 'CELL_VALUES', state: 'PASSED' },
    ]);
    expect(detail.headerComparison).toBeNull();
  });

  it('sorts issuesByCode by count descending', async () => {
    const detail = await buildImportFileFailureDetail({
      ...baseInput,
      bytes: fullyValidBankingHeaderCsv,
      issues: [
        { severity: 'ERROR', code: 'GL_UNBALANCED', message: 'a', field: null, rowNumber: 1 },
        { severity: 'ERROR', code: 'GL_UNBALANCED', message: 'b', field: null, rowNumber: 2 },
        { severity: 'WARNING', code: 'CSV_ENCODING_NON_UTF8', message: 'c', field: null, rowNumber: 3 },
      ],
    });

    expect(detail.issuesByCode).toEqual([
      { code: 'GL_UNBALANCED', severity: 'ERROR', count: 2 },
      { code: 'CSV_ENCODING_NON_UTF8', severity: 'WARNING', count: 1 },
    ]);
  });

  it('reports the engine\'s default amount tolerance', async () => {
    const detail = await buildImportFileFailureDetail({
      ...baseInput,
      bytes: fullyValidBankingHeaderCsv,
      issues: [],
    });

    expect(detail.amountTolerance).toBe(0.005);
  });
});

describe('buildErrorReportCsv', () => {
  it('emits the exact header row and orders by file, then line, then column', () => {
    const csv = buildErrorReportCsv([
      { file: 'gl.csv', line: 5, column: 'amount', code: 'GL_A', severity: 'ERROR', message: 'm1' },
      { file: 'bank.csv', line: 2, column: 'amount', code: 'BANK_A', severity: 'ERROR', message: 'm2' },
      { file: 'bank.csv', line: 1, column: 'currency_code', code: 'BANK_B', severity: 'ERROR', message: 'm3' },
    ]);

    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('file,line,column,code,severity,message,raw_value');
    expect(lines[1]).toBe('bank.csv,1,currency_code,BANK_B,ERROR,m3,');
    expect(lines[2]).toBe('bank.csv,2,amount,BANK_A,ERROR,m2,');
    expect(lines[3]).toBe('gl.csv,5,amount,GL_A,ERROR,m1,');
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = buildErrorReportCsv([
      {
        file: 'bank.csv',
        line: 1,
        column: 'description',
        code: 'BANK_C',
        severity: 'ERROR',
        message: 'Contains, a comma and a "quote"',
      },
    ]);

    expect(csv).toContain('"Contains, a comma and a ""quote"""');
  });

  it('renders a null line/column as an empty CSV field', () => {
    const csv = buildErrorReportCsv([
      { file: 'gl.csv', line: null, column: null, code: 'GL_UNBALANCED', severity: 'ERROR', message: 'file-level' },
    ]);

    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe('gl.csv,,,GL_UNBALANCED,ERROR,file-level,');
  });
});
