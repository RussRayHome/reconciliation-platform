import type { NormalizedTransaction } from '@recon/domain';

import { dateDifferenceDays } from '../matching/similarity';

export type TransactionKind =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'journal'
  | 'check'
  | 'unknown';

export const parseIsoDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

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

export const isCheckLikeQboTransaction = (transaction: NormalizedTransaction): boolean => {
  const transactionType = (transaction.transactionType ?? '').toLowerCase();
  return (
    Boolean(transaction.checkNumber || transaction.serialNumber) ||
    transactionType.includes('check')
  );
};

const normalizeTransactionType = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

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

export const formatKinds = (transactions: NormalizedTransaction[]): string => {
  const kinds = dedupeKinds(transactions);
  return kinds.length ? kinds.join(', ') : 'unknown';
};

export const mergeComparisonTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedComparisonTokens);

export const mergeReferenceTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedReferenceTokens);

export const inferTransactionKind = (transaction: NormalizedTransaction): TransactionKind => {
  const transactionType = normalizeTransactionType(transaction.transactionType);
  const description = normalizeTransactionType(transaction.description);

  if (
    isCheckLikeQboTransaction(transaction) ||
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

export const areTimingKindsCompatible = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
): boolean => {
  const bankKind = inferTransactionKind(bankTransaction);
  const qboKind = inferTransactionKind(qboTransaction);

  if (bankKind === 'unknown' || qboKind === 'unknown') {
    return true;
  }

  if (bankKind === qboKind) {
    return true;
  }

  return (
    (bankKind === 'transfer' && qboKind === 'journal') ||
    (bankKind === 'deposit' && qboKind === 'transfer')
  );
};

export const isDepositLikeKind = (kind: TransactionKind): boolean =>
  kind === 'deposit' || kind === 'transfer' || kind === 'journal' || kind === 'unknown';

export const areGroupedTransactionsCompatible = (
  anchorTransactions: NormalizedTransaction[],
  counterpartTransactions: NormalizedTransaction[],
): boolean =>
  anchorTransactions.every((anchorTransaction) =>
    counterpartTransactions.every((counterpartTransaction) =>
      areTimingKindsCompatible(anchorTransaction, counterpartTransaction),
    ),
  );

export const calculateGroupedDateDifference = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
): number | null => {
  let maxDifference: number | null = null;

  for (const bankTransaction of bankTransactions) {
    for (const qboTransaction of qboTransactions) {
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        qboTransaction.transactionDate ?? qboTransaction.postingDate,
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
