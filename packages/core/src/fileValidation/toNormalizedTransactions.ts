import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';

import type {
  NormalizedTransaction,
  RawTransactionRow,
  ReconciliationConfig,
  SourceSystem,
} from '@recon/domain';

import { buildComparisonTokens, buildContextFingerprint, normalizeText } from '../normalization/text';
import type { NormalizedRecord } from './types';

/** Fixed, arbitrary namespace for deriving a raw row's id (reconciliation_raw_row.id /
 * reconciliation_canonical_row.raw_row_id, both UUID columns, changeset 0001) deterministically
 * from `${sourceFileId}:${sourceLineNumber}` -- `toRawTransactionRows` and
 * `toNormalizedTransactions` are called independently on the same records, so the two id
 * fields they each produce for the same logical row must resolve to the identical UUID without
 * any shared state between the calls. A plain composite string here previously failed Postgres's
 * `invalid input syntax for type uuid` check outright. */
const RAW_ROW_ID_NAMESPACE = '6f1d6b6e-2c0a-4b7e-9e6b-6a6b7a6b7a6b';

const deriveRawRowId = (sourceFileId: string, sourceLineNumber: number): string =>
  uuidv5(`${sourceFileId}:${sourceLineNumber}`, RAW_ROW_ID_NAMESPACE);

/**
 * Adapts File Validation's already-validated `NormalizedRecord`s into the `NormalizedTransaction`
 * shape the Matching Engine (`matching/engine.ts`, `matching/groupedReservations.ts`) consumes
 * (Issue #137). This is the ONLY module allowed to know about both shapes -- it depends on
 * `fileValidation/types.ts` and the shared `normalization/text.ts` helpers, never on `matching/*`,
 * so the Matching Engine's own rule code needs zero changes and never imports from File
 * Validation. Every record handed in has already passed Step 3's hard validation (File
 * Validation's own `normalized` array only ever contains rows with no ERROR-severity issue), so
 * this adapter never produces a `dataQualityIssues` entry or excludes a row -- there is nothing
 * left to flag by the time a record reaches here.
 */

export interface NormalizedTransactionContext {
  runId: string;
  sourceFileId: string;
  spreadsheetFileName: string;
  /** No File Validation input format has worksheets (CSV) or is read via a sheet name (XLSX
   * headers/rows are read positionally, not by sheet) -- a fixed placeholder matches what
   * `NormalizedTransaction.worksheetName` expects without inventing sheet-tracking that doesn't
   * exist anywhere in this pipeline. */
  worksheetName?: string;
  config: ReconciliationConfig;
}

const toSourceSystem = (sourceSystem: NormalizedRecord['sourceSystem']): SourceSystem =>
  sourceSystem === 'BANK' ? 'bank' : 'gl';

const BEGINNING_BALANCE_EXCLUSION_REASON = 'Beginning balance row excluded from reconciliation.';

/** Ported from the retired `excelParser.ts`'s `isBeginningBalanceRow` (Issue #137) -- GL files
 * commonly carry an opening/beginning-balance line that isn't a real transaction and must never
 * compete for a match. Config-driven per source (`config.gl.excludeBeginningBalance` is on by
 * default; `config.bank.excludeBeginningBalance` is off), matched against description/payee text. */
const isBeginningBalanceRecord = (
  record: NormalizedRecord,
  source: SourceSystem,
  config: ReconciliationConfig,
): boolean => {
  const sourceConfig = source === 'bank' ? config.bank : config.gl;
  if (!sourceConfig.excludeBeginningBalance) {
    return false;
  }

  const haystacks = [record.description, record.payeeName]
    .filter(Boolean)
    .map((value) => value!.toUpperCase());

  return sourceConfig.beginningBalancePatterns.some((pattern) =>
    haystacks.some((haystack) => haystack.includes(pattern.toUpperCase())),
  );
};

/**
 * Companion to `toNormalizedTransactions`: produces the `RawTransactionRow[]` shape the
 * reconciliation lifecycle store's `persistParsedRows` state-machine step expects
 * (`reconciliation_source_file`/`reconciliation_raw_row`, IMPORTING -> IMPORTED). File Validation
 * has no equivalent "raw row" persistence of its own -- this repackages the already-captured
 * `NormalizedRecord.raw` values into that shape rather than inventing new data, so the lifecycle
 * store's audit trail stays accurate for File-Validation-sourced runs too.
 */
export const toRawTransactionRows = (
  records: NormalizedRecord[],
  context: NormalizedTransactionContext,
): RawTransactionRow[] =>
  records.map((record) => {
    const source = toSourceSystem(record.sourceSystem);
    const raw = record.raw as unknown as Record<string, string | undefined>;
    const isBeginningBalance = isBeginningBalanceRecord(record, source, context.config);
    return {
      id: deriveRawRowId(context.sourceFileId, record.sourceLineNumber),
      sourceFileId: context.sourceFileId,
      source,
      spreadsheetFileName: context.spreadsheetFileName,
      worksheetName: context.worksheetName ?? '',
      lineNumber: record.sourceLineNumber,
      rawValues: { ...raw },
      transactionDateRaw: record.date,
      postingDateRaw: undefined,
      transactionTypeRaw: record.transactionType ?? (record.signedAmount >= 0 ? 'credit' : 'debit'),
      checkNumberRaw: record.checkNumber,
      serialNumberRaw: undefined,
      referenceNumberRaw: record.referenceNumber,
      descriptionRaw: record.description,
      merchantNameRaw: undefined,
      payeeNameRaw: record.payeeName,
      amountRaw: source === 'gl' ? raw.Amount : undefined,
      splitAmountRaw: undefined,
      debitRaw: source === 'bank' ? raw.Debit : undefined,
      creditRaw: source === 'bank' ? raw.Credit : undefined,
      runningBalanceRaw: raw.Balance,
      excluded: isBeginningBalance,
      exclusionReason: isBeginningBalance ? BEGINNING_BALANCE_EXCLUSION_REASON : undefined,
      parsingIssues: [],
    } satisfies RawTransactionRow;
  });

export const toNormalizedTransactions = (
  records: NormalizedRecord[],
  context: NormalizedTransactionContext,
): NormalizedTransaction[] =>
  records.map((record) => {
    const source = toSourceSystem(record.sourceSystem);
    const isBeginningBalance = isBeginningBalanceRecord(record, source, context.config);
    const comparisonTokens = buildComparisonTokens(
      [record.description, record.payeeName],
      context.config.textNormalization,
    );
    const referenceTokens = buildComparisonTokens(
      [record.checkNumber, record.referenceNumber],
      { ...context.config.textNormalization, removeStopWords: false, stopWords: [] },
    );
    const normalizedComparisonText = normalizeText(
      [record.payeeName, record.description].filter(Boolean).join(' '),
      context.config.textNormalization,
    );

    return {
      id: randomUUID(),
      runId: context.runId,
      rawRowId: deriveRawRowId(context.sourceFileId, record.sourceLineNumber),
      sourceFileId: context.sourceFileId,
      source,
      spreadsheetFileName: context.spreadsheetFileName,
      worksheetName: context.worksheetName ?? '',
      lineNumber: record.sourceLineNumber,
      transactionDate: record.date,
      postingDate: undefined,
      // GL's real Type column ("Journal Entry", "Check", "Deposit", ...) drives the Matching
      // Engine's transaction-kind inference and must never be overridden -- the derived
      // credit/debit label is strictly a Bank fallback, since Bank has no Type column at all.
      transactionType: record.transactionType ?? (record.signedAmount >= 0 ? 'credit' : 'debit'),
      checkNumber: record.checkNumber,
      serialNumber: undefined,
      referenceNumber: record.referenceNumber,
      description: record.description,
      merchantName: undefined,
      payeeName: record.payeeName,
      amount: record.signedAmount,
      splitAmount: null,
      debit: record.signedAmount < 0 ? Math.abs(record.signedAmount) : null,
      credit: record.signedAmount > 0 ? record.signedAmount : null,
      runningBalance: record.runningBalance ?? null,
      normalizedComparisonText,
      normalizedComparisonTokens: comparisonTokens,
      normalizedReferenceTokens: referenceTokens,
      rawSourceValues: { ...record.raw } as RawTransactionRow['rawValues'],
      dataQualityIssues: [],
      isExcluded: isBeginningBalance,
      exclusionReason: isBeginningBalance ? BEGINNING_BALANCE_EXCLUSION_REASON : undefined,
      isZeroAmount: record.signedAmount === 0,
      contextFingerprint: buildContextFingerprint([
        source,
        record.date,
        record.signedAmount,
        record.checkNumber,
        record.referenceNumber,
        normalizedComparisonText,
      ]),
      accountIdentifier: record.account,
    } satisfies NormalizedTransaction;
  });
