import type { MatchingConfig, NormalizedTransaction } from '@recon/domain';

import { currencyEquals, dateDifferenceDays } from './similarity';

export interface GroupedReservationCandidate {
  category: 'DepositGroupingIssue' | 'LikelySplitCombineIssue';
  ruleId: 'grouped-deposit-reserved' | 'grouped-split-combine-reserved';
  ruleName: 'Grouped Deposit Candidate' | 'Grouped Split/Combine Candidate';
  reason: string;
  evidence: string[];
  dateDifferenceDays: number | null;
  bankTransactions: Array<NormalizedTransaction & { amount: number }>;
  qboTransactions: Array<NormalizedTransaction & { amount: number }>;
  bankTransactionIds: string[];
  qboTransactionIds: string[];
  score: number;
}

const normalizeTransactionType = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const inferTransactionKind = (
  transaction: NormalizedTransaction,
): 'deposit' | 'withdrawal' | 'transfer' | 'journal' | 'check' | 'unknown' => {
  const transactionType = normalizeTransactionType(transaction.transactionType);
  const description = normalizeTransactionType(transaction.description);

  if (transaction.checkNumber || transaction.serialNumber || transactionType.includes('check')) {
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

  if ((transaction.amount ?? 0) < 0 || transactionType.includes('expense') || transactionType.includes('payment')) {
    return 'withdrawal';
  }

  return 'unknown';
};

const areTimingKindsCompatible = (
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

  return (bankKind === 'transfer' && qboKind === 'journal') || (bankKind === 'deposit' && qboKind === 'transfer');
};

const areGroupedTransactionsCompatible = (
  anchorTransactions: NormalizedTransaction[],
  counterpartTransactions: NormalizedTransaction[],
): boolean =>
  anchorTransactions.every((anchorTransaction) =>
    counterpartTransactions.every((counterpartTransaction) =>
      areTimingKindsCompatible(anchorTransaction, counterpartTransaction),
    ),
  );

const sumTransactionAmounts = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): number => transactions.reduce((total, transaction) => total + transaction.amount, 0);

const formatKinds = (transactions: NormalizedTransaction[]): string =>
  [...new Set(transactions.map((transaction) => inferTransactionKind(transaction)))].join(', ');

const describeTransactionGroup = (transactions: Array<NormalizedTransaction & { amount: number }>): string =>
  transactions
    .map(
      (transaction) =>
        `${transaction.spreadsheetFileName}:L${transaction.lineNumber}:${transaction.amount.toFixed(2)}`,
    )
    .join('; ');

const generateTransactionCombinations = <T>(
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

const calculateGroupedDateDifference = (
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

      maxDifference = maxDifference === null ? dateDifference : Math.max(maxDifference, dateDifference);
    }
  }

  return maxDifference;
};

const buildGroupedReservationCandidate = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  qboTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): GroupedReservationCandidate | undefined => {
  if (!bankTransactions.length || !qboTransactions.length) {
    return undefined;
  }

  if (bankTransactions.length === 1 && qboTransactions.length === 1) {
    return undefined;
  }

  const bankTotal = sumTransactionAmounts(bankTransactions);
  const qboTotal = sumTransactionAmounts(qboTransactions);

  if (!currencyEquals(bankTotal, qboTotal, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTotal) !== Math.sign(qboTotal)) {
    return undefined;
  }

  if (!areGroupedTransactionsCompatible(bankTransactions, qboTransactions)) {
    return undefined;
  }

  const dateDifference = calculateGroupedDateDifference(bankTransactions, qboTransactions);
  if (dateDifference === null || dateDifference > matching.timingDifferenceDays) {
    return undefined;
  }

  const bankKinds = formatKinds(bankTransactions);
  const qboKinds = formatKinds(qboTransactions);
  const category = bankTotal > 0 && qboTotal > 0 ? 'DepositGroupingIssue' : 'LikelySplitCombineIssue';

  return {
    category,
    ruleId: category === 'DepositGroupingIssue' ? 'grouped-deposit-reserved' : 'grouped-split-combine-reserved',
    ruleName:
      category === 'DepositGroupingIssue'
        ? 'Grouped Deposit Candidate'
        : 'Grouped Split/Combine Candidate',
    reason:
      category === 'DepositGroupingIssue'
        ? 'A balanced grouped deposit candidate was reserved before one-to-one review matching.'
        : 'A balanced grouped split/combine candidate was reserved before one-to-one review matching.',
    evidence: [
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); QBO total is ${qboTotal.toFixed(2)} across ${qboTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and qbo=${qboKinds}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `QBO members: ${describeTransactionGroup(qboTransactions)}.`,
    ],
    dateDifferenceDays: dateDifference,
    bankTransactions,
    qboTransactions,
    bankTransactionIds: bankTransactions.map((transaction) => transaction.id),
    qboTransactionIds: qboTransactions.map((transaction) => transaction.id),
    score: 100 - dateDifference * 2 - (bankTransactions.length + qboTransactions.length),
  };
};

const collectGroupedCounterpartPool = (
  anchorTransaction: NormalizedTransaction & { amount: number },
  counterpartTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): Array<NormalizedTransaction & { amount: number }> =>
  counterpartTransactions
    .filter((counterpartTransaction) => {
      if (Math.sign(counterpartTransaction.amount) !== Math.sign(anchorTransaction.amount)) {
        return false;
      }

      if (Math.abs(counterpartTransaction.amount) > Math.abs(anchorTransaction.amount) + matching.amountTolerance) {
        return false;
      }

      return areGroupedTransactionsCompatible([anchorTransaction], [counterpartTransaction]);
    })
    .sort((left, right) => {
      const leftDateDifference =
        dateDifferenceDays(
          anchorTransaction.transactionDate ?? anchorTransaction.postingDate,
          left.transactionDate ?? left.postingDate,
        ) ?? Number.MAX_SAFE_INTEGER;
      const rightDateDifference =
        dateDifferenceDays(
          anchorTransaction.transactionDate ?? anchorTransaction.postingDate,
          right.transactionDate ?? right.postingDate,
        ) ?? Number.MAX_SAFE_INTEGER;

      if (leftDateDifference !== rightDateDifference) {
        return leftDateDifference - rightDateDifference;
      }

      return Math.abs(anchorTransaction.amount - left.amount) - Math.abs(anchorTransaction.amount - right.amount);
    })
    .slice(0, matching.groupedCandidatePoolSize);

const findGroupedReservationCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationCandidate[] => {
  const candidates: GroupedReservationCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );
  const qboResiduals = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, qboResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, matching.groupedMatchMaxSize);

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate([bankTransaction], combination, matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const qboTransaction of qboResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(qboTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, matching.groupedMatchMaxSize);

    for (const combination of combinations) {
      const candidate = buildGroupedReservationCandidate(combination, [qboTransaction], matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

export interface GroupedReservationResult {
  reservedBankTransactionIds: Set<string>;
  reservedQboTransactionIds: Set<string>;
  selectedCandidates: GroupedReservationCandidate[];
}

export const reserveGroupedTransactionIds = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedReservationResult => {
  const reservedBankTransactionIds = new Set<string>();
  const reservedQboTransactionIds = new Set<string>();
  const selectedCandidates: GroupedReservationCandidate[] = [];
  const candidates = findGroupedReservationCandidates(bankTransactions, qboTransactions, matching);

  candidates.forEach((candidate) => {
    if (
      candidate.bankTransactionIds.some((transactionId) => reservedBankTransactionIds.has(transactionId)) ||
      candidate.qboTransactionIds.some((transactionId) => reservedQboTransactionIds.has(transactionId))
    ) {
      return;
    }

    candidate.bankTransactionIds.forEach((transactionId) => {
      reservedBankTransactionIds.add(transactionId);
    });
    candidate.qboTransactionIds.forEach((transactionId) => {
      reservedQboTransactionIds.add(transactionId);
    });
    selectedCandidates.push(candidate);
  });

  return {
    reservedBankTransactionIds,
    reservedQboTransactionIds,
    selectedCandidates,
  };
};