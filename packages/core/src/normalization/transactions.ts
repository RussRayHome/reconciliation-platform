import { createHash, randomUUID } from 'node:crypto';

import type {
  NormalizedTransaction,
  RawTransactionRow,
  ReconciliationConfig,
  SourceSystem,
} from '@recon/domain';

import { buildComparisonTokens, normalizeText } from './text';

const parseNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isParenthesesNegative = /^\(.*\)$/.test(trimmed);
  const hasTrailingMinus = /-$/.test(trimmed);
  const directionMatch = /\b(CR|DR)\b$/i.exec(trimmed);

  const unsigned = trimmed
    .replaceAll(/[,$\s]/g, '')
    .replaceAll(/[()]/g, '')
    .replaceAll(/\b(CR|DR)\b/gi, '')
    .replaceAll(/[^0-9.+-]/g, '');

  if (!unsigned || unsigned === '-' || unsigned === '+') {
    return null;
  }

  const parsed = Number(unsigned.replace(/-$/, ''));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const directionToken = directionMatch?.[1]?.toUpperCase();
  let directionalSign = 1;
  if (directionToken === 'DR') {
    directionalSign = -1;
  }
  const explicitNumericSign = parsed < 0 ? -1 : 1;
  const numericSign = isParenthesesNegative || hasTrailingMinus ? -1 : explicitNumericSign;

  return Math.abs(parsed) * directionalSign * numericSign;
};

const parseDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 20_000 && numeric < 60_000) {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + numeric);
    return base.toISOString().slice(0, 10);
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
};

const computeSignedAmount = (
  row: RawTransactionRow,
  source: SourceSystem,
  config: ReconciliationConfig,
): { amount: number | null; debit: number | null; credit: number | null } => {
  const sourceConfig = source === 'bank' ? config.bank : config.qbo;
  const parsedAmount = parseNumber(row.amountRaw);
  const debit = parseNumber(row.debitRaw);
  const credit = parseNumber(row.creditRaw);
  const hasDebitOrCredit = credit !== null || debit !== null;
  const amountFromDebitCredit = hasDebitOrCredit ? (credit ?? 0) - Math.abs(debit ?? 0) : null;

  if (sourceConfig.amountSignConvention === 'signedAmount') {
    const amount = parsedAmount ?? amountFromDebitCredit;

    return {
      amount,
      debit: amount !== null && amount < 0 ? Math.abs(amount) : null,
      credit: amount !== null && amount > 0 ? amount : null,
    };
  }

  const amount = parsedAmount ?? amountFromDebitCredit;

  return {
    amount,
    debit: debit !== null ? Math.abs(debit) : null,
    credit,
  };
};

const buildFingerprint = (parts: Array<string | number | undefined | null>): string =>
  createHash('sha1')
    .update(parts.filter((part) => part !== undefined && part !== null).join('|'))
    .digest('hex');

/**
 * Transforms raw parsed spreadsheet rows into normalized transaction objects ready for matching.
 * Applies text normalization, computes comparison tokens, deduplicated reference tokens, and
 * attaches a context fingerprint used for duplicate detection.
 */
export const normalizeTransactions = (
  runId: string,
  rawRows: RawTransactionRow[],
  config: ReconciliationConfig,
): NormalizedTransaction[] =>
  rawRows.map((row) => {
    const comparisonTokens = buildComparisonTokens(
      [row.descriptionRaw, row.merchantNameRaw, row.payeeNameRaw],
      config.textNormalization,
    );
    const referenceTokens = buildComparisonTokens(
      [row.checkNumberRaw, row.serialNumberRaw, row.referenceNumberRaw],
      {
        ...config.textNormalization,
        removeStopWords: false,
        stopWords: [],
      },
    );
    const { amount, debit, credit } = computeSignedAmount(row, row.source, config);
    const dataQualityIssues: string[] = [...row.parsingIssues];
    const transactionDate = parseDate(row.transactionDateRaw);
    const postingDate = parseDate(row.postingDateRaw);
    const effectiveTransactionDate = transactionDate ?? postingDate;

    if (amount === null) {
      dataQualityIssues.push('Amount is missing or malformed.');
    }

    if (!effectiveTransactionDate) {
      dataQualityIssues.push('Transaction date is missing or malformed.');
    }

    const sourceConfig = row.source === 'bank' ? config.bank : config.qbo;
    if (amount === 0 && !sourceConfig.allowZeroAmount) {
      dataQualityIssues.push('Zero amount transaction requires review.');
    }

    const normalizedComparisonText = normalizeText(
      [row.payeeNameRaw, row.merchantNameRaw, row.descriptionRaw].filter(Boolean).join(' '),
      config.textNormalization,
    );

    return {
      id: randomUUID(),
      runId,
      rawRowId: row.id,
      sourceFileId: row.sourceFileId,
      source: row.source,
      spreadsheetFileName: row.spreadsheetFileName,
      worksheetName: row.worksheetName,
      lineNumber: row.lineNumber,
      transactionDate: effectiveTransactionDate,
      postingDate,
      transactionType: row.transactionTypeRaw,
      checkNumber: row.checkNumberRaw,
      serialNumber: row.serialNumberRaw,
      referenceNumber: row.referenceNumberRaw,
      description: row.descriptionRaw,
      merchantName: row.merchantNameRaw,
      payeeName: row.payeeNameRaw,
      amount,
      splitAmount: parseNumber(row.splitAmountRaw),
      debit,
      credit,
      runningBalance: parseNumber(row.runningBalanceRaw),
      normalizedComparisonText,
      normalizedComparisonTokens: comparisonTokens,
      normalizedReferenceTokens: referenceTokens,
      rawSourceValues: row.rawValues,
      dataQualityIssues,
      isExcluded: row.excluded,
      exclusionReason: row.exclusionReason,
      isZeroAmount: amount === 0,
      contextFingerprint: buildFingerprint([
        row.source,
        transactionDate,
        amount,
        row.checkNumberRaw,
        row.referenceNumberRaw,
        normalizedComparisonText,
      ]),
      accountIdentifier: row.rawValues.Account as string | undefined,
    } satisfies NormalizedTransaction;
  });
