import {
  CsvParser,
  DEFAULT_VALIDATION_OPTIONS,
  REQUIRED_BANKING_HEADERS,
  REQUIRED_GL_HEADERS,
  XlsxParser,
  type FileValidationGate,
} from '@recon/core';
import type { RunIssueItem } from '@recon/persistence';

export interface HeaderComparisonRow {
  position: number;
  expected: string | null;
  found: string | null;
  matches: boolean;
}

export interface GateSequenceEntry {
  gate: FileValidationGate;
  state: 'PASSED' | 'FAILED' | 'NOT_RUN';
}

export interface ImportFileFailureDetail {
  importFileId: string;
  originalFilename: string;
  sourceType: 'BANK' | 'GL';
  fileFormat: 'CSV' | 'XLSX';
  validationStatus: string;
  rowCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  importableRowCount: number;
  gateSequence: GateSequenceEntry[];
  /** Only populated when the failure is structural (HEADER or COLUMN_ORDER gate) -- null for an
   * all-rows-invalid (CELL_VALUES) failure, since there's nothing to compare column-by-column. */
  headerComparison: HeaderComparisonRow[] | null;
  issues: Array<Pick<RunIssueItem, 'severity' | 'code' | 'message' | 'field' | 'rowNumber'>>;
  issuesByCode: Array<{ code: string; severity: string; count: number }>;
  amountTolerance: number;
}

const HEADER_GATE_FAILURE_CODE = 'STRUCT_HEADER_MISSING';
const COLUMN_GATE_FAILURE_CODES = new Set(['STRUCT_COLUMN_MISSING', 'STRUCT_COLUMN_ORDER']);

/** Reconstructs which of the three ordered gates (transaction-csv-spec.md §4) ran, from the
 * persisted issue codes -- `gatesRun` itself isn't persisted, but the engine's own "stop at the
 * first ERROR" contract (fileValidationEngine.ts) makes it a deterministic function of which
 * gate-blocking codes are present, not a guess. */
const deriveGateSequence = (
  issues: Array<Pick<RunIssueItem, 'severity' | 'code'>>,
): GateSequenceEntry[] => {
  const hasHeaderFailure = issues.some(
    (issue) => issue.severity === 'ERROR' && issue.code === HEADER_GATE_FAILURE_CODE,
  );
  if (hasHeaderFailure) {
    return [
      { gate: 'HEADER', state: 'FAILED' },
      { gate: 'COLUMN_ORDER', state: 'NOT_RUN' },
      { gate: 'CELL_VALUES', state: 'NOT_RUN' },
    ];
  }

  const hasColumnFailure = issues.some(
    (issue) => issue.severity === 'ERROR' && COLUMN_GATE_FAILURE_CODES.has(issue.code),
  );
  if (hasColumnFailure) {
    return [
      { gate: 'HEADER', state: 'PASSED' },
      { gate: 'COLUMN_ORDER', state: 'FAILED' },
      { gate: 'CELL_VALUES', state: 'NOT_RUN' },
    ];
  }

  return [
    { gate: 'HEADER', state: 'PASSED' },
    { gate: 'COLUMN_ORDER', state: 'PASSED' },
    { gate: 'CELL_VALUES', state: 'PASSED' },
  ];
};

const buildHeaderComparison = (
  expectedHeaders: readonly string[],
  foundHeaders: string[],
): HeaderComparisonRow[] => {
  const length = Math.max(expectedHeaders.length, foundHeaders.length);
  return Array.from({ length }, (_, index) => {
    const expected = expectedHeaders[index] ?? null;
    const found = foundHeaders[index] ?? null;
    return { position: index + 1, expected, found, matches: expected !== null && expected === found };
  });
};

/**
 * Builds the full failure-detail view for one file (Phase 11's Screen 05/07) by combining
 * already-persisted issues/counts with a fresh re-parse of the stored original bytes -- the raw
 * found-header row was never persisted (nothing needed it before this), so recovering it means
 * re-reading the file rather than adding a column for data derivable on demand. This is the
 * cross-package bridge point (needs both @recon/core's parsers and @recon/persistence's stored
 * bytes/issues), matching Phase 6's synthesizeXlsxFromCsv precedent of keeping that composition
 * out of both packages themselves.
 */
export const buildImportFileFailureDetail = async (input: {
  importFileId: string;
  originalFilename: string;
  sourceType: 'BANK' | 'GL';
  fileFormat: 'CSV' | 'XLSX';
  validationStatus: string;
  rowCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  importableRowCount: number;
  bytes: Buffer;
  issues: Array<Pick<RunIssueItem, 'severity' | 'code' | 'message' | 'field' | 'rowNumber'>>;
}): Promise<ImportFileFailureDetail> => {
  const gateSequence = deriveGateSequence(input.issues);
  const isStructuralFailure = gateSequence.some(
    (entry) => entry.gate !== 'CELL_VALUES' && entry.state === 'FAILED',
  );

  let headerComparison: HeaderComparisonRow[] | null = null;
  if (isStructuralFailure) {
    const parser = input.fileFormat === 'CSV' ? new CsvParser() : new XlsxParser();
    const { headers } = await parser.parse(input.bytes);
    const expectedHeaders =
      input.sourceType === 'BANK' ? REQUIRED_BANKING_HEADERS : REQUIRED_GL_HEADERS;
    headerComparison = buildHeaderComparison(expectedHeaders, headers);
  }

  const issuesByCodeMap = new Map<string, { code: string; severity: string; count: number }>();
  for (const issue of input.issues) {
    const existing = issuesByCodeMap.get(issue.code);
    if (existing) {
      existing.count += 1;
    } else {
      issuesByCodeMap.set(issue.code, { code: issue.code, severity: issue.severity, count: 1 });
    }
  }
  const issuesByCode = [...issuesByCodeMap.values()].sort((a, b) => b.count - a.count);

  return {
    importFileId: input.importFileId,
    originalFilename: input.originalFilename,
    sourceType: input.sourceType,
    fileFormat: input.fileFormat,
    validationStatus: input.validationStatus,
    rowCount: input.rowCount,
    errorCount: input.errorCount,
    warningCount: input.warningCount,
    importableRowCount: input.importableRowCount,
    gateSequence,
    headerComparison,
    issues: input.issues,
    issuesByCode,
    amountTolerance: DEFAULT_VALIDATION_OPTIONS.amountTolerance,
  };
};

export interface ErrorReportRow {
  file: string;
  line: number | null;
  column: string | null;
  code: string;
  severity: string;
  message: string;
}

const csvField = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Builds the error-report CSV (README §7.8: `file,line,column,code,severity,message,raw_value`,
 * one row per finding, ordered by file then line then column). `raw_value` is always empty --
 * the File Validation Engine's `ValidationIssue` doesn't capture the offending cell's original
 * text today, only its parsed/derived finding, so there's nothing honest to put there yet. The
 * column stays in the header so downstream tooling built against this exact shape doesn't break
 * once a future engine change adds it. */
export const buildErrorReportCsv = (rows: ErrorReportRow[]): string => {
  const header = 'file,line,column,code,severity,message,raw_value';
  const sorted = [...rows].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? '').localeCompare(b.column ?? ''),
  );
  const lines = sorted.map((row) =>
    [
      row.file,
      row.line !== null ? String(row.line) : '',
      row.column ?? '',
      row.code,
      row.severity,
      row.message,
      '',
    ]
      .map(csvField)
      .join(','),
  );
  return [header, ...lines].join('\n') + '\n';
};
