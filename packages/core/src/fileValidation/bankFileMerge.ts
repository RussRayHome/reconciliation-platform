import { parseBankAccountLast4FromFilename } from '@recon/domain';

import { isBlank } from './primitives';
import { CsvParser } from './parsers/csvParser';
import { writeCsvBuffer } from './parsers/csvWriter';
import type { FileParser, ParsedFile } from './parsers/fileParser';
import { XlsxParser } from './parsers/xlsxParser';
import { checkColumnOrder, checkHeaderPresent } from './structuralGates';
import { BANKING_HEADERS, REQUIRED_BANKING_HEADERS, type ValidationIssue } from './types';

/** #153: an import run supports 1-4 bank accounts. */
export const MIN_BANK_ACCOUNTS = 1;
export const MAX_BANK_ACCOUNTS = 4;

/** Raised when a raw bank file's name doesn't start with `<digits><-|_>` (ADR-0003 §3) -- an
 * upload-level filename problem, never a File Validation content issue, so this is never routed
 * through the `validation_issue`/rule-version DB system. */
export class BankFilenameAccountParseError extends Error {
  /** @param originalFilename The uploaded bank file's own filename, named back in the message so
   * the offending file is identifiable when two bank files are uploaded in the same request. */
  constructor(public readonly originalFilename: string) {
    super(
      `Bank file "${originalFilename}" must start with the account number (or its last 4 digits) ` +
        `followed by "-" or "_", e.g. "4321_bank-export.csv".`,
    );
    this.name = 'BankFilenameAccountParseError';
  }
}

/** Raised when `mergeBankFiles` is called with fewer than 1 or more than
 * {@link MAX_BANK_ACCOUNTS} raw files -- a caller-contract violation (the HTTP layer's own multer
 * config and upload-count check should normally prevent this from ever reaching here), not a
 * per-file content problem, so it's a distinct error from {@link BankFilenameAccountParseError}/
 * {@link BankFileStructuralError} below. */
export class BankFileCountError extends Error {
  /** @param fileCount The number of raw bank files actually passed, named back in the message so
   * the caller can see what was rejected. */
  constructor(public readonly fileCount: number) {
    super(
      `mergeBankFiles requires between 1 and ${MAX_BANK_ACCOUNTS} raw bank files, got ${fileCount}.`,
    );
    this.name = 'BankFileCountError';
  }
}

/** Raised when a raw per-account bank file fails Step 1/Step 2 (header present, column order) on
 * its own, before it ever reaches the merge. Checked per-file, pre-merge, specifically so a
 * malformed raw file still produces a clear, attributable structural error -- the merge step
 * always re-serializes the merged output with the canonical `BANKING_HEADERS` header row
 * (regardless of either input file's own header shape), so once merged, a raw file's structural
 * problem could otherwise only resurface as a confusing wall of per-row CELL_VALUES errors (every
 * column blank because none of that file's column names matched anything) instead of one clear
 * "missing column" finding. */
export class BankFileStructuralError extends Error {
  /**
   * @param originalFilename The specific raw bank file that failed, so the caller can attribute
   * the failure to one of the two per-account uploads rather than the merged output.
   * @param issues The Step 1/Step 2 structural issues raised against this file on its own.
   */
  constructor(
    public readonly originalFilename: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(`Bank file "${originalFilename}" failed structural validation.`);
    this.name = 'BankFileStructuralError';
  }
}

export interface RawBankFileInput {
  bytes: Buffer;
  fileFormat: 'CSV' | 'XLSX';
  originalFilename: string;
}

export interface MergedBankFile {
  bytes: Buffer;
  fileFormat: 'CSV';
}

const SEQUENCE_NUMBER_HEADER = 'Sequence Number';
const BALANCE_HEADER = 'Balance';

const parserFor = (fileFormat: 'CSV' | 'XLSX'): FileParser =>
  fileFormat === 'CSV' ? new CsvParser() : new XlsxParser();

/** Prefixes the Sequence Number (per-account disambiguation) and drops the Balance column. Each
 * account's Balance is its own independent running ledger -- concatenating two accounts' balances
 * end-to-end has no coherent single-ledger story and would trip BANK_BALANCE_CONTINUITY at every
 * account boundary on every real merged run, not just a contrived edge case (the file-level
 * continuity check has no concept of "two accounts" to reset at). Blanking it here makes
 * `validateFile`'s continuity check skip entirely for the merged file (it only runs when every row
 * has a value) rather than produce a false positive at the seam. */
const prepareRowsForMerge = (parsed: ParsedFile, last4: string): Record<string, string>[] =>
  parsed.rows.map((row) => {
    const rest: Record<string, string> = { ...row };
    delete rest[BALANCE_HEADER];
    const sequenceNumber = rest[SEQUENCE_NUMBER_HEADER];
    if (isBlank(sequenceNumber)) {
      return rest;
    }
    return { ...rest, [SEQUENCE_NUMBER_HEADER]: `${last4}-${sequenceNumber}` };
  });

/**
 * Merges 1-4 per-account raw bank files into one unified bank dataset, upstream of and invisible
 * to File Validation (ADR-0003, Issue #141; widened from exactly 2 to 1-4 by Issue #153). Each
 * file's account number is parsed from its ORIGINAL FILENAME (not its content) via
 * `@recon/domain`'s `parseBankAccountLast4FromFilename`; every non-blank Sequence Number is
 * prefixed `<last4>-<sequence>` to disambiguate the accounts' otherwise-independent sequence
 * numbering once combined. Reuses (does not reimplement) File Validation's own Step 1/Step 2
 * structural gate functions against each raw file individually before merging -- this is not
 * "duplicating the pipeline's validation logic" (the ADR's own boundary), it's calling the same
 * functions `fileValidationEngine.ts` calls, just per-file instead of per-merged-output, so a
 * malformed raw file fails clearly and by name rather than dissolving into row-level noise
 * post-merge (see `BankFileStructuralError`'s own doc comment). Step 3 (CELL_VALUES) is
 * deliberately NOT run per-file here -- row content is only meaningful once merged (e.g.
 * BANK_SEQUENCE_DUPLICATE spans every account), so that stays exactly where the ADR puts it:
 * against the merged output, via the unchanged `validateFile`. Also drops the Balance column from
 * every row (see `prepareRowsForMerge`'s own comment) -- otherwise BANK_BALANCE_CONTINUITY would
 * false-positive at each account boundary on every real merged run. Concatenates accounts in
 * input-array order (`flat()`) -- no cross-account interleaving or sorting.
 */
export const mergeBankFiles = async (
  files: readonly RawBankFileInput[],
): Promise<MergedBankFile> => {
  if (files.length < MIN_BANK_ACCOUNTS || files.length > MAX_BANK_ACCOUNTS) {
    throw new BankFileCountError(files.length);
  }

  const prefixedRows = await Promise.all(
    files.map(async (file) => {
      const last4 = parseBankAccountLast4FromFilename(file.originalFilename);
      if (last4 === null) {
        throw new BankFilenameAccountParseError(file.originalFilename);
      }

      const parsed = await parserFor(file.fileFormat).parse(file.bytes);
      const structuralIssues = [
        ...checkHeaderPresent(parsed.headers, BANKING_HEADERS),
        ...checkColumnOrder(parsed.headers, REQUIRED_BANKING_HEADERS, BANKING_HEADERS),
      ];
      if (structuralIssues.some((issue) => issue.severity === 'ERROR')) {
        throw new BankFileStructuralError(file.originalFilename, structuralIssues);
      }

      return prepareRowsForMerge(parsed, last4);
    }),
  );

  const mergedRows = prefixedRows.flat();
  return { bytes: writeCsvBuffer([...BANKING_HEADERS], mergedRows), fileFormat: 'CSV' };
};
