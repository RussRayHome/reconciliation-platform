import { CsvParser } from './parsers/csvParser';
import type { FileParser } from './parsers/fileParser';
import { XlsxParser } from './parsers/xlsxParser';
import { validateBankingRows, validateGeneralLedgerRows } from './rowValidators';
import { checkColumnOrder, checkHeaderPresent } from './structuralGates';
import {
  BANKING_HEADERS,
  GL_HEADERS,
  REQUIRED_BANKING_HEADERS,
  REQUIRED_GL_HEADERS,
  type FileValidationGate,
  type FileValidationOutcome,
  type RawBankingRow,
  type RawGeneralLedgerRow,
  type ValidationOptions,
} from './types';

export interface ValidateFileInput {
  bytes: Buffer;
  fileFormat: 'CSV' | 'XLSX';
  fileType: 'BANK' | 'GL';
  options?: ValidationOptions;
}

const parserFor = (fileFormat: 'CSV' | 'XLSX'): FileParser =>
  fileFormat === 'CSV' ? new CsvParser() : new XlsxParser();

/**
 * Runs the full ordered File Validation Engine (transaction-csv-spec.md §4) against one file:
 * Step 1 (header present) -> Step 2 (column order) -> Step 3 (cell values, delegates to
 * rowValidators.ts). A gate failure (any ERROR-severity issue) stops further checks for that
 * file, matching "a gate failure stops further checks for that file" -- called once per file
 * (bank, then GL), never both at once; each file's outcome is independent.
 *
 * `normalized` always reflects exactly the rows that individually passed Step 3, regardless of
 * `ok` -- a file-level Step 3 finding (e.g. BANK_BALANCE_CONTINUITY, GL_UNBALANCED) makes `ok`
 * false without retroactively excluding any row, matching schema.ts's own ported behavior. This
 * is what makes partial import possible: the caller decides VALIDATION_FAILED vs. "offer partial
 * import" from `normalized.length`, not from `ok`.
 */
export const validateFile = async (input: ValidateFileInput): Promise<FileValidationOutcome> => {
  const allKnownHeaders = input.fileType === 'BANK' ? BANKING_HEADERS : GL_HEADERS;
  const requiredHeaders = input.fileType === 'BANK' ? REQUIRED_BANKING_HEADERS : REQUIRED_GL_HEADERS;
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
  const rowOutcome =
    input.fileType === 'BANK'
      ? validateBankingRows(rows as unknown as RawBankingRow[], input.options)
      : validateGeneralLedgerRows(rows as unknown as RawGeneralLedgerRow[], input.options);

  const issues = [...structuralIssues, ...rowOutcome.issues];
  const ok = !issues.some((issue) => issue.severity === 'ERROR');

  return { ok, gatesRun, issues, normalized: rowOutcome.normalized, totalRowCount };
};
