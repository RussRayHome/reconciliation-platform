import type { NormalizedTransaction } from '@recon/domain';

import { dateDifferenceDays } from '../matching/similarity';

/** Inferred transaction direction or instrument type used for timing-compatibility checks. */
export type TransactionKind =
  'deposit' | 'withdrawal' | 'transfer' | 'journal' | 'check' | 'unknown';

/** Parses an ISO date string (`YYYY-MM-DD`) to a midnight UTC `Date`, or returns `undefined` for invalid input. */
export const parseIsoDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

/** Builds a frequency map of transaction amounts, used to identify distinctive vs. common amounts. */
export const buildAmountFrequency = (
  transactions: NormalizedTransaction[],
): Map<number, number> => {
  const frequency = new Map<number, number>();

  transactions.forEach((transaction) => {
    if (transaction.amount === null) {
      return;
    }

    frequency.set(transaction.amount, (frequency.get(transaction.amount) ?? 0) + 1);
  });

  return frequency;
};

/**
 * Returns `true` when the GL transaction has a check number, serial number, a type string
 * containing "check", or a description that reads as a check ("check"/"chk" as a whole word) —
 * the last fallback matters for GL exports that record the disbursement type only in free text.
 */
export const isCheckLikeGlTransaction = (transaction: NormalizedTransaction): boolean => {
  const transactionType = (transaction.transactionType ?? '').toLowerCase();
  if (
    Boolean(transaction.checkNumber || transaction.serialNumber) ||
    transactionType.includes('check')
  ) {
    return true;
  }

  const description = (transaction.description ?? '').toLowerCase();
  return /\bchk\b/.test(description) || /\bcheck\b/.test(description);
};

const normalizeTransactionType = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

/** Sums the `amount` field across all transactions in the array; amounts must be non-null. */
export const sumTransactionAmounts = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): number => transactions.reduce((total, transaction) => total + transaction.amount, 0);

const dedupeKinds = (transactions: NormalizedTransaction[]): string[] => [
  ...new Set(
    transactions
      .map((transaction) => inferTransactionKind(transaction))
      .filter((kind) => kind !== 'unknown'),
  ),
];

/** Returns a comma-separated string of distinct inferred transaction kinds (excluding `'unknown'`). */
export const formatKinds = (transactions: NormalizedTransaction[]): string => {
  const kinds = dedupeKinds(transactions);
  return kinds.length ? kinds.join(', ') : 'unknown';
};

/** Flattens normalized comparison tokens from multiple transactions into a single array for grouped similarity scoring. */
export const mergeComparisonTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedComparisonTokens);

/** Flattens normalized reference tokens from multiple transactions into a single array for grouped reference scoring. */
export const mergeReferenceTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedReferenceTokens);

/** Infers the transaction kind from the raw transaction type string, description, and check/serial number fields. */
export const inferTransactionKind = (transaction: NormalizedTransaction): TransactionKind => {
  const transactionType = normalizeTransactionType(transaction.transactionType);
  const description = normalizeTransactionType(transaction.description);

  if (
    isCheckLikeGlTransaction(transaction) ||
    transaction.checkNumber ||
    transaction.serialNumber
  ) {
    return 'check';
  }

  if (transactionType.includes('journal')) {
    return 'journal';
  }

  if (
    transactionType.includes('transfer') ||
    description.includes('transfer') ||
    description.includes('online from')
  ) {
    return 'transfer';
  }

  if ((transaction.amount ?? 0) > 0 || transactionType.includes('deposit')) {
    return 'deposit';
  }

  if (
    (transaction.amount ?? 0) < 0 ||
    transactionType.includes('expense') ||
    transactionType.includes('payment')
  ) {
    return 'withdrawal';
  }

  return 'unknown';
};

/** Returns `true` when the inferred kinds of two transactions are directionally compatible for timing classification. */
export const areTimingKindsCompatible = (
  bankTransaction: NormalizedTransaction,
  glTransaction: NormalizedTransaction,
): boolean => {
  const bankKind = inferTransactionKind(bankTransaction);
  const glKind = inferTransactionKind(glTransaction);

  if (bankKind === 'unknown' || glKind === 'unknown') {
    return true;
  }

  if (bankKind === glKind) {
    return true;
  }

  return (
    (bankKind === 'transfer' && glKind === 'journal') ||
    (bankKind === 'deposit' && glKind === 'transfer')
  );
};

/** Returns `true` for kinds that can represent an inflow (deposit, transfer, journal, or unknown). */
export const isDepositLikeKind = (kind: TransactionKind): boolean =>
  kind === 'deposit' || kind === 'transfer' || kind === 'journal' || kind === 'unknown';

/** Returns `true` when every anchor/counterpart transaction pair has compatible inferred kinds for grouped matching. */
export const areGroupedTransactionsCompatible = (
  anchorTransactions: NormalizedTransaction[],
  counterpartTransactions: NormalizedTransaction[],
): boolean =>
  anchorTransactions.every((anchorTransaction) =>
    counterpartTransactions.every((counterpartTransaction) =>
      areTimingKindsCompatible(anchorTransaction, counterpartTransaction),
    ),
  );

/** Returns the maximum pairwise date difference (in days) across all bank/GL transaction combinations, or `null` if any date is missing. */
export const calculateGroupedDateDifference = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
): number | null => {
  let maxDifference: number | null = null;

  for (const bankTransaction of bankTransactions) {
    for (const glTransaction of glTransactions) {
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        glTransaction.transactionDate ?? glTransaction.postingDate,
      );

      if (dateDifference === null) {
        return null;
      }

      maxDifference =
        maxDifference === null ? dateDifference : Math.max(maxDifference, dateDifference);
    }
  }

  return maxDifference;
};

/** Generates all sub-arrays of `transactions` whose length is between `minimumSize` and `maximumSize` inclusive. */
export const generateTransactionCombinations = <T>(
  transactions: T[],
  minimumSize: number,
  maximumSize: number,
): T[][] => {
  const combinations: T[][] = [];

  const visit = (startIndex: number, current: T[]): void => {
    if (current.length >= minimumSize) {
      combinations.push([...current]);
    }

    if (current.length === maximumSize) {
      return;
    }

    for (let index = startIndex; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      if (!transaction) {
        continue;
      }

      current.push(transaction);
      visit(index + 1, current);
      current.pop();
    }
  };

  visit(0, []);
  return combinations;
};
