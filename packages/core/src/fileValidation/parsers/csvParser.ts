import type { FileParser, ParsedFile } from './fileParser';

const BOM = '\uFEFF';
const QUOTE = '"';
const COMMA = ',';

/**
 * Tokenizes RFC 4180 CSV text into rows of raw field strings. Hand-rolled rather than a
 * dependency (e.g. `csv-parse`) -- this repo takes no new npm dependencies for this feature, and
 * `apps/web/src/lib/csvHeader.ts` already establishes the same "no dependency, quote-aware
 * hand-rolled parser" convention for CSV in this codebase, just for a single line at a time.
 * This one has to go further: a quoted field may itself contain a literal newline
 * (transaction-csv-spec.md §1: "Fields containing a comma, quote, or newline must be
 * double-quoted"), so rows cannot be pre-split on `\n` the way a single-line header read can --
 * this reads character-by-character across the whole buffer and only treats a line ending as a
 * row separator when outside a quoted field.
 */
const tokenizeCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;
  const { length } = text;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < length) {
    const char = text[index];

    if (inQuotes) {
      if (char === QUOTE) {
        if (text[index + 1] === QUOTE) {
          field += QUOTE;
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === QUOTE) {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === COMMA) {
      pushField();
      index += 1;
      continue;
    }

    if (char === '\r' && text[index + 1] === '\n') {
      pushRow();
      index += 2;
      continue;
    }

    if (char === '\n') {
      pushRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Final field/row when the text doesn't end with a line ending -- if it does, the last pushRow()
  // already reset field/row to empty, so this correctly adds nothing (no phantom trailing row).
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
};

/** Parses UTF-8 CSV bytes (BOM tolerated and stripped, per spec §1) into the shared row shape. */
export const parseCsvBuffer = (bytes: Buffer): ParsedFile => {
  let text = bytes.toString('utf8');
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }

  const rows = tokenizeCsv(text);
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    return { headers: [], rows: [] };
  }

  const parsedRows = dataRows
    // A single empty field is a blank line (trailing or interstitial), not a data row.
    .filter((row) => !(row.length === 1 && row[0] === ''))
    .map((row) => {
      const record: Record<string, string> = {};
      headerRow.forEach((header, index) => {
        record[header] = row[index] ?? '';
      });
      return record;
    });

  return { headers: headerRow, rows: parsedRows };
};

/** Hand-rolled RFC 4180 CSV parser for the File Validation Engine (no `csv-parse` dependency --
 * see the File Imports & Validation plan's own note on this tradeoff). */
export class CsvParser implements FileParser {
  /** Parses raw CSV bytes into the shared {headers, rows} shape (row 1 is the header row). */
  // Not async -- parseCsvBuffer is synchronous; Promise.resolve satisfies FileParser's Promise
  // return type without an empty async body (which the require-await lint rule rejects).
  parse(bytes: Buffer): Promise<ParsedFile> {
    return Promise.resolve(parseCsvBuffer(bytes));
  }
}
