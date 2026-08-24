import { CsvParser } from './parsers/csvParser';
import type { FileParser } from './parsers/fileParser';
import { XlsxParser } from './parsers/xlsxParser';
import {
  validateBankingRows,
  validateBillingRows,
  validateGeneralLedgerRows,
  type RowIssueObserver,
} from './rowValidators';
import { checkColumnOrder, checkHeaderPresent } from './structuralGates';
import {
  BANKING_HEADERS,
  BILLING_HEADERS,
  GL_HEADERS,
  REQUIRED_BANKING_HEADERS,
  REQUIRED_BILLING_HEADERS,
  REQUIRED_GL_HEADERS,
  type FileValidationGate,
  type FileValidationOutcome,
  type RawApBillingRow,
  type RawBankingRow,
  type RawGeneralLedgerRow,
  type ValidationOptions,
} from './types';

export interface ValidateFileInput {
  bytes: Buffer;
  fileFormat: 'CSV' | 'XLSX';
  fileType: 'BANK' | 'GL' | 'BILLING';
  options?: ValidationOptions;
  /** Fires once per validation issue found on any row/file-level check, `undefined` by default.
   * A caller (apps/api) supplies one only when DEBUG-level fault-finding detail is wanted --
   * this module never depends on a logger itself. */
  onIssue?: RowIssueObserver;
}

const parserFor = (fileFormat: 'CSV' | 'XLSX'): FileParser =>
  fileFormat === 'CSV' ? new CsvParser() : new XlsxParser();

/** Per-source-type header/required-header pair -- a fileType is a lookup key here, not a branch,
 * so a fourth source type is a new map entry, not a new `if`. */
const HEADERS_BY_FILE_TYPE: Record<
  ValidateFileInput['fileType'],
  { allKnownHeaders: readonly string[]; requiredHeaders: readonly string[] }
> = {
  BANK: { allKnownHeaders: BANKING_HEADERS, requiredHeaders: REQUIRED_BANKING_HEADERS },
  GL: { allKnownHeaders: GL_HEADERS, requiredHeaders: REQUIRED_GL_HEADERS },
  BILLING: { allKnownHeaders: BILLING_HEADERS, requiredHeaders: REQUIRED_BILLING_HEADERS },
};

/**
 * Runs the full ordered File Validation Engine (transaction-csv-spec.md §4) against one file:
 * Step 1 (header present) -> Step 2 (column order) -> Step 3 (cell values, delegates to
 * rowValidators.ts). Only a Step 1/2 (structural) failure stops the file entirely -- there's
 * literally no reliable row shape to work with (wrong/missing columns) -- and short-circuits with
 * `normalized: []` before Step 3 ever runs, reflected by `gatesRun` not including `'CELL_VALUES'`.
 *
 * `normalized` always contains every row once Step 3 runs, regardless of `ok` -- Step 3 no longer
 * excludes a row for a content issue (ERROR or WARNING); each row carries its own issues via
 * `NormalizedRecord.issues` instead (see rowValidators.ts, toNormalizedTransactions.ts). `ok`
 * (true iff no ERROR-severity issue anywhere) remains a useful "did this file have problems"
 * signal for reporting/UI, but callers must NOT use `!ok` to decide whether to proceed with
 * reconciliation -- use `gatesRun.includes('CELL_VALUES')` for that (false only on a genuine
 * structural failure).
 */
export const validateFile = async (input: ValidateFileInput): Promise<FileValidationOutcome> => {
  const { allKnownHeaders, requiredHeaders } = HEADERS_BY_FILE_TYPE[input.fileType];
  const parser = parserFor(input.fileFormat);
  const { headers, rows } = await parser.parse(input.bytes);

  const totalRowCount = rows.length;

  const gatesRun: FileValidationGate[] = ['HEADER'];
  const headerIssues = checkHeaderPresent(headers, allKnownHeaders);
  if (headerIssues.some((issue) => issue.severity === 'ERROR')) {
    return { ok: false, gatesRun, issues: headerIssues, normalized: [], totalRowCount };
  }

  gatesRun.push('COLUMN_ORDER');
  const columnOrderIssues = checkColumnOrder(headers, requiredHeaders, allKnownHeaders);
  const structuralIssues = [...headerIssues, ...columnOrderIssues];
  if (columnOrderIssues.some((issue) => issue.severity === 'ERROR')) {
    return { ok: false, gatesRun, issues: structuralIssues, normalized: [], totalRowCount };
  }

  gatesRun.push('CELL_VALUES');
  let rowOutcome: ReturnType<typeof validateBankingRows>;
  if (input.fileType === 'BANK') {
    rowOutcome = validateBankingRows(rows as unknown as RawBankingRow[], input.options, input.onIssue);
  } else if (input.fileType === 'GL') {
    rowOutcome = validateGeneralLedgerRows(rows as unknown as RawGeneralLedgerRow[], input.options, input.onIssue);
  } else {
    rowOutcome = validateBillingRows(rows as unknown as RawApBillingRow[], input.options, input.onIssue);
  }

  const issues = [...structuralIssues, ...rowOutcome.issues];
  const ok = !issues.some((issue) => issue.severity === 'ERROR');

  return { ok, gatesRun, issues, normalized: rowOutcome.normalized, totalRowCount };
};
