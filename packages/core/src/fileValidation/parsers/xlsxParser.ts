import ExcelJS from 'exceljs';

import type { FileParser, ParsedFile } from './fileParser';

/** Formats a native date cell to plain `YYYY-MM-DD` (spec §1) -- UTC getters via `toISOString`,
 * not local-timezone ones, so the calendar date can't shift a day depending on the host's zone. */
const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

/** Reduces one ExcelJS cell value to a plain string, matching spec §1's "native types read
 * directly" rule: dates become YYYY-MM-DD, everything else becomes its literal text/number. */
const stringifyCellValue = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return formatDateOnly(value);
  }

  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('');
    }

    if ('result' in value) {
      return value.result === undefined ? '' : stringifyCellValue(value.result);
    }

    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    // Formula error cells ({error: 'code'}) and any other unrecognized object shape have no
    // sensible plain-text value -- treated the same as a blank cell.
    return '';
  }

  return String(value);
};

/**
 * Reads the first worksheet's header row (row 1) and every following row into the shared
 * {headers, rows} shape (transaction-csv-spec.md §0.2: one data worksheet, header in row 1).
 *
 * Deliberately independent of `packages/core/src/parsers/excelParser.ts` -- that parser
 * fuzzy-matches header aliases for the existing reconciliation pipeline's own column-mapping
 * config and excludes rows by configured pattern, neither of which applies here. This one
 * preserves headers and column order exactly, unresolved, so the File Validation Engine's own
 * structural gates (header-present, column-order) can compare them directly against the expected
 * banking/GL header lists.
 */
export class XlsxParser implements FileParser {
  async parse(bytes: Buffer): Promise<ParsedFile> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { headers: [], rows: [] };
    }

    const headerRow = worksheet.getRow(1);
    // Read every column up to the row's own cell count (not eachCell with includeEmpty:false) --
    // a blank header cell in the middle of the row must still occupy a position in `headers`, or
    // every later column's index would drift out of alignment with the data rows read below.
    const columnCount = headerRow.cellCount;
    const headers: string[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      headers.push(stringifyCellValue(headerRow.getCell(column).value));
    }

    if (headers.length === 0) {
      return { headers: [], rows: [] };
    }

    const rows: Record<string, string>[] = [];
    // worksheet.rowCount is the highest row index with any value -- NOT actualRowCount, which
    // counts only non-empty rows and so undercounts whenever a fully-blank row sits before the
    // true last row (e.g. header, row2, blank row3, row4 -> actualRowCount is 3, silently
    // dropping row 4). lastRow?.number is the more direct equivalent; rowCount is used here to
    // stay consistent with a plain numeric fallback of 0 when the sheet has no rows at all.
    const lastRowNumber = worksheet.rowCount;

    for (let rowNumber = 2; rowNumber <= lastRowNumber; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const record: Record<string, string> = {};
      let hasValue = false;

      headers.forEach((header, index) => {
        const value = stringifyCellValue(row.getCell(index + 1).value);
        record[header] = value;
        if (value !== '') {
          hasValue = true;
        }
      });

      if (hasValue) {
        rows.push(record);
      }
    }

    return { headers, rows };
  }
}
