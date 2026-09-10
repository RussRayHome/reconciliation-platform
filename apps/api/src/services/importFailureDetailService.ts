import {
  CsvParser,
  DEFAULT_VALIDATION_OPTIONS,
  REQUIRED_BANKING_HEADERS,
  REQUIRED_BILLING_HEADERS,
  REQUIRED_GL_HEADERS,
  XlsxParser,
  type FileValidationGate,
} from '@recon/core';
import type { RunIssueItem } from '@recon/persistence';
import type { ImportFileSourceType } from '@recon/domain';

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
  sourceType: ImportFileSourceType;
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
  sourceType: ImportFileSourceType;
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
    // A lookup, not a ternary. This was `sourceType === 'BANK' ? banking : gl`, which was correct
    // only while BANK and GL were the sole possibilities -- the moment #463 widened the union, that
    // shape would have compared every AP, AR and payroll file against GL's headers and reported a
    // confident, wrong comparison. That is the silent miscategorization `assertBankOrGl`'s comment
    // was written to prevent, arriving through a different door.
    //
    // RECEIPT and PAYROLL are absent deliberately: no required-header set exists for them yet (AR
    // rule content is deferred, payroll's ships with #408).
    //
    // They fall through to `null`, and that is NOT a neutral "no comparison available" -- null is
    // load-bearing on the web side, where it selects Screen 07 (all rows invalid) when
    // importableRowCount is also 0 (see ImportFileFailureDetail in apps/web/src/lib/api.ts). The
    // combination null + importableRowCount > 0 is an unspecified third state.
    //
    // It is unreachable today: this whole block is gated on isStructuralFailure, and a source type
    // with no validation rules produces no gate failures to be structural about. So RECEIPT and
    // PAYROLL cannot arrive here until their rules land -- and whichever change lands those rules
    // must add their header set here, or design the third state, before that stops being true.
    // Emitting GL's headers instead would be worse in the meantime: a confident, wrong comparison
    // reads as a real finding about the user's file.
    const expectedHeadersBySourceType: Partial<Record<ImportFileSourceType, readonly string[]>> = {
      BANK: REQUIRED_BANKING_HEADERS,
      GL: REQUIRED_GL_HEADERS,
      BILLING: REQUIRED_BILLING_HEADERS,
    };
    const expectedHeaders = expectedHeadersBySourceType[input.sourceType];
    headerComparison = expectedHeaders ? buildHeaderComparison(expectedHeaders, headers) : null;
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

/**
 * Neutralises CSV formula injection (Issue #258, OWASP "CSV Injection").
 *
 * A spreadsheet evaluates a cell as a formula when its text begins with `=`, `+`, `-` or `@`, so a
 * value that starts with one of those is executable content, not data. CSV has no cell types to
 * distinguish the two -- unlike XLSX, where every value carries an explicit type. Prefixing with an
 * apostrophe forces the consumer to read it as text.
 *
 * The exposed field here is `file`, which is the uploaded filename (`file.originalname`) and is
 * fully attacker-controlled at position 0. `message` is NOT: every validation message begins with a
 * literal ("Date must be YYYY-MM-DD, got ...") and interpolates user text only after it, so a
 * payload can never reach the first character. Verified by grep over rowValidators.ts -- zero
 * messages start with an interpolation. `line`, `column`, `code` and `severity` are integers and
 * internal enums. Escaping is applied to every field regardless: it costs nothing, and it stops the
 * guarantee depending on message wording that a later edit could change.
 *
 * All four characters are escaped, including `-`. Issue #258 asked that a value like
 * "-125.50 REVERSAL" round-trip unescaped, but that concern belongs to transaction DESCRIPTIONS,
 * which go to the XLSX workbook, not to this report. No column here carries monetary text: a
 * filename, a line number, a field name, an error code, a severity, and a message that always
 * starts with English. Leaving `-` unescaped would keep "-2+3+cmd|'/C calc'!A0" live for nothing.
 */
const escapeFormula = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const csvField = (value: string): string => {
  const escaped = escapeFormula(value);
  return /[",\n]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
};

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
