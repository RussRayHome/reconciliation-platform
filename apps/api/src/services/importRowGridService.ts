import { CsvParser, XlsxParser } from '@recon/core';
import type { RunIssueItem } from '@recon/persistence';

export interface ImportRowGridFlag {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface ImportRowGridRow {
  /** 1-based data-row number -- matches validation_issue.row_number and canonical_record.
   * source_line_number exactly (both set via rowValidators.ts's `rows.forEach((row, index) => ...
   * index + 1)`), *not* the file's physical line number (the header row isn't counted). Kept
   * consistent with those rather than physical-line numbering so this grid's "Line" column lines
   * up with the same run's error-report CSV and failure-detail issues instead of being one row
   * off from them. */
  lineNumber: number;
  values: Record<string, string>;
  status: 'IMPORT' | 'SKIP';
  /** Keyed by field name -- only fields with a persisted issue appear here, matching Screen 06's
   * "only the offending cell is flagged, never the whole row" rule. */
  flaggedFields: Record<string, ImportRowGridFlag>;
  /** Issues for this row with no specific field (e.g. a file/entry-level finding that still
   * carries this row's line number). */
  rowLevelIssues: ImportRowGridFlag[];
}

export interface ImportRowGridResult {
  headers: string[];
  rows: ImportRowGridRow[];
  totalRows: number;
  errorRowCount: number;
  warningRowCount: number;
  cleanRowCount: number;
  /** True when `rows` was capped below `totalRows` -- see ROW_GRID_LIMIT's own comment. */
  truncated: boolean;
}

/** Screen 06 has no pagination in the design (the fixture is 9 rows on one screen), and this
 * build doesn't add pagination UI for it -- but a 50 MB file could still have tens of thousands of
 * rows, so a hard cap with an honest `truncated` flag beats either an unbounded response or a
 * silent cutoff. */
const ROW_GRID_LIMIT = 2000;

/**
 * Re-parses a validated file's full rows (Screen 06's grid needs every row's actual cell values,
 * which validation_issue never stored -- it only records what failed, not the raw row) and
 * annotates each with the issues already persisted for it at submit time. No re-validation
 * happens here; this only re-derives display data from bytes that already passed gates 1 and 2.
 */
export const buildImportRowGrid = async (input: {
  bytes: Buffer;
  fileFormat: 'CSV' | 'XLSX';
  issues: Array<Pick<RunIssueItem, 'severity' | 'code' | 'message' | 'field' | 'rowNumber'>>;
}): Promise<ImportRowGridResult> => {
  const parser = input.fileFormat === 'CSV' ? new CsvParser() : new XlsxParser();
  const { headers, rows } = await parser.parse(input.bytes);

  const issuesByRow = new Map<number, typeof input.issues>();
  for (const issue of input.issues) {
    if (issue.rowNumber === null) {
      continue;
    }
    const existing = issuesByRow.get(issue.rowNumber);
    if (existing) {
      existing.push(issue);
    } else {
      issuesByRow.set(issue.rowNumber, [issue]);
    }
  }

  let errorRowCount = 0;
  let warningRowCount = 0;
  let cleanRowCount = 0;

  const gridRows: ImportRowGridRow[] = rows.map((values, index) => {
    const lineNumber = index + 1;
    const rowIssues = issuesByRow.get(lineNumber) ?? [];

    const flaggedFields: ImportRowGridRow['flaggedFields'] = {};
    const rowLevelIssues: ImportRowGridRow['rowLevelIssues'] = [];
    let hasError = false;
    let hasWarning = false;

    for (const issue of rowIssues) {
      if (issue.severity === 'ERROR') {
        hasError = true;
      } else {
        hasWarning = true;
      }

      const flag: ImportRowGridFlag = { code: issue.code, severity: issue.severity, message: issue.message };
      if (issue.field) {
        flaggedFields[issue.field] = flag;
      } else {
        rowLevelIssues.push(flag);
      }
    }

    if (hasError) {
      errorRowCount += 1;
    } else if (hasWarning) {
      warningRowCount += 1;
    } else {
      cleanRowCount += 1;
    }

    return {
      lineNumber,
      values,
      status: hasError ? 'SKIP' : 'IMPORT',
      flaggedFields,
      rowLevelIssues,
    };
  });

  return {
    headers,
    rows: gridRows.slice(0, ROW_GRID_LIMIT),
    totalRows: gridRows.length,
    errorRowCount,
    warningRowCount,
    cleanRowCount,
    truncated: gridRows.length > ROW_GRID_LIMIT,
  };
};
