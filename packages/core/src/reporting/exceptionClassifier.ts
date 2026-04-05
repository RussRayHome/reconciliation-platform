import { randomUUID } from 'node:crypto';

import {
  type CounterpartTrace,
  type ExceptionRuleTrace,
  type MatchingConfig,
  type SourceFile,
  professionalErrorMessages,
  recommendedNextActionsByCategory,
  type ReconciliationFrequency,
  type ExceptionItem,
  type MatchResult,
  type NormalizedTransaction,
  type ReportingConfig,
  type ReviewerObservation,
} from '@recon/domain';
import { currencyEquals, dateDifferenceDays, tokenSimilarity } from '../matching/similarity';
import { is5703Workbook } from './summary';

const severityRank: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const categoryPrecedence: Record<ExceptionItem['category'], number> = {
  InvalidOrMissingData: 0,
  DuplicateInBank: 1,
  DuplicateInQBO: 1,
  AmountMismatch: 2,
  LikelySplitCombineIssue: 3,
  DepositGroupingIssue: 3,
  LikelyMiscoding: 4,
  CheckNumberMismatch: 5,
  ReferenceNumberMismatch: 5,
  DateVariance: 6,
  TimingDifference: 7,
  DescriptionMerchantVariance: 8,
  AmbiguousMatchRequiringReview: 9,
  StaleOutstandingCheck: 10,
  MissingFromQBO: 11,
  MissingFromBank: 11,
};

const STALE_OUTSTANDING_CHECK_DAYS = 45;
const GROUPED_MATCH_MAX_GROUP_SIZE = 3;
const GROUPED_CANDIDATE_POOL_SIZE = 6;

interface MiscodingCandidate {
  bankTransaction: NormalizedTransaction;
  qboTransaction: NormalizedTransaction;
  dateDifference: number;
  textSimilarity: number;
  referenceSimilarity: number;
  score: number;
}

interface MiscodingThresholds {
  textSimilarityMax: number;
  referenceSimilarityMax: number;
}

interface TimingDifferenceCandidate {
  bankTransaction: NormalizedTransaction & { amount: number };
  qboTransaction: NormalizedTransaction & { amount: number };
  dateDifference: number;
  textSimilarity: number;
  referenceSimilarity: number;
  score: number;
}

interface GroupedResidualCandidate {
  category: 'LikelySplitCombineIssue' | 'DepositGroupingIssue';
  ruleId: 'grouped-split-combine-residual' | 'grouped-deposit-residual';
  ruleName: string;
  reason: string;
  evidence: string[];
  bankTransactions: Array<NormalizedTransaction & { amount: number }>;
  qboTransactions: Array<NormalizedTransaction & { amount: number }>;
  relatedTransactionIds: string[];
  score: number;
}

const parseIsoDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const buildAmountFrequency = (transactions: NormalizedTransaction[]): Map<number, number> => {
  const frequency = new Map<number, number>();

  transactions.forEach((transaction) => {
    if (transaction.amount === null) {
      return;
    }

    frequency.set(transaction.amount, (frequency.get(transaction.amount) ?? 0) + 1);
  });

  return frequency;
};

const isCheckLikeQboTransaction = (transaction: NormalizedTransaction): boolean => {
  const transactionType = (transaction.transactionType ?? '').toLowerCase();
  return Boolean(transaction.checkNumber || transaction.serialNumber) || transactionType.includes('check');
};

const buildMiscodingThresholds = (matching: MatchingConfig): MiscodingThresholds => ({
  textSimilarityMax: Math.min(0.35, Math.max(0.15, matching.probableTextSimilarityThreshold / 2)),
  referenceSimilarityMax: Math.min(0.5, matching.referenceSimilarityThreshold / 2),
});

const normalizeTransactionType = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const sumTransactionAmounts = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): number => transactions.reduce((total, transaction) => total + transaction.amount, 0);

const dedupeKinds = (transactions: NormalizedTransaction[]): string[] =>
  [...new Set(transactions.map((transaction) => inferTransactionKind(transaction)).filter((kind) => kind !== 'unknown'))];

const formatKinds = (transactions: NormalizedTransaction[]): string => {
  const kinds = dedupeKinds(transactions);
  return kinds.length ? kinds.join(', ') : 'unknown';
};

const mergeComparisonTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedComparisonTokens);

const mergeReferenceTokens = (transactions: NormalizedTransaction[]): string[] =>
  transactions.flatMap((transaction) => transaction.normalizedReferenceTokens);

const inferTransactionKind = (transaction: NormalizedTransaction): 'deposit' | 'withdrawal' | 'transfer' | 'journal' | 'check' | 'unknown' => {
  const transactionType = normalizeTransactionType(transaction.transactionType);
  const description = normalizeTransactionType(transaction.description);

  if (isCheckLikeQboTransaction(transaction) || transaction.checkNumber || transaction.serialNumber) {
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

const isDepositLikeKind = (kind: ReturnType<typeof inferTransactionKind>): boolean =>
  kind === 'deposit' || kind === 'transfer' || kind === 'journal' || kind === 'unknown';

const areGroupedTransactionsCompatible = (
  anchorTransactions: NormalizedTransaction[],
  counterpartTransactions: NormalizedTransaction[],
): boolean =>
  anchorTransactions.every((anchorTransaction) =>
    counterpartTransactions.every((counterpartTransaction) =>
      areTimingKindsCompatible(anchorTransaction, counterpartTransaction),
    ),
  );

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

const buildGroupedCandidateCategory = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  qboTransactions: Array<NormalizedTransaction & { amount: number }>,
): GroupedResidualCandidate['category'] => {
  const bankTotal = sumTransactionAmounts(bankTransactions);
  const qboTotal = sumTransactionAmounts(qboTransactions);
  const allKinds = [...bankTransactions, ...qboTransactions].map((transaction) => inferTransactionKind(transaction));

  if (bankTotal > 0 && qboTotal > 0 && allKinds.every((kind) => isDepositLikeKind(kind))) {
    return 'DepositGroupingIssue';
  }

  return 'LikelySplitCombineIssue';
};

const describeTransactionGroup = (transactions: Array<NormalizedTransaction & { amount: number }>): string =>
  transactions
    .map(
      (transaction) =>
        `${transaction.source.toUpperCase()} line ${transaction.lineNumber} (${transaction.amount.toFixed(2)})`,
    )
    .join(', ');

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

const buildGroupedResidualCandidate = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  qboTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): GroupedResidualCandidate | undefined => {
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

  const textSimilarity = tokenSimilarity(
    mergeComparisonTokens(bankTransactions),
    mergeComparisonTokens(qboTransactions),
  );
  const referenceSimilarity = tokenSimilarity(
    mergeReferenceTokens(bankTransactions),
    mergeReferenceTokens(qboTransactions),
  );
  const category = buildGroupedCandidateCategory(bankTransactions, qboTransactions);
  const bankKinds = formatKinds(bankTransactions);
  const qboKinds = formatKinds(qboTransactions);

  return {
    category,
    ruleId: category === 'DepositGroupingIssue' ? 'grouped-deposit-residual' : 'grouped-split-combine-residual',
    ruleName: category === 'DepositGroupingIssue' ? 'Grouped Deposit Residual' : 'Grouped Split/Combine Residual',
    reason:
      category === 'DepositGroupingIssue'
        ? 'Residual unmatched deposits form a grouped receipt pattern rather than independent missing items.'
        : 'Residual unmatched transactions form a one-to-many or many-to-one relationship that the one-to-one matcher cannot settle cleanly.',
    evidence: [
      'Residual unmatched transactions form a balanced grouped amount across sources.',
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); QBO total is ${qboTotal.toFixed(2)} across ${qboTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and qbo=${qboKinds}.`,
      `Narrative similarity score is ${textSimilarity.toFixed(2)} and reference similarity score is ${referenceSimilarity.toFixed(2)}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `QBO members: ${describeTransactionGroup(qboTransactions)}.`,
    ],
    bankTransactions,
    qboTransactions,
    relatedTransactionIds: [...bankTransactions, ...qboTransactions].map((transaction) => transaction.id),
    score:
      100 -
      dateDifference * 2 -
      (bankTransactions.length + qboTransactions.length) +
      textSimilarity * 10 +
      referenceSimilarity * 5,
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
    .slice(0, GROUPED_CANDIDATE_POOL_SIZE);

const findGroupedResidualCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedResidualCandidate[] => {
  const candidates: GroupedResidualCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );
  const qboResiduals = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } => transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, qboResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, GROUPED_MATCH_MAX_GROUP_SIZE);

    for (const combination of combinations) {
      const candidate = buildGroupedResidualCandidate([bankTransaction], combination, matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const qboTransaction of qboResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(qboTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(counterpartPool, 2, GROUPED_MATCH_MAX_GROUP_SIZE);

    for (const combination of combinations) {
      const candidate = buildGroupedResidualCandidate(combination, [qboTransaction], matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
};

const buildTimingDifferenceCandidate = (
  bankTransaction: NormalizedTransaction & { amount: number },
  qboTransaction: NormalizedTransaction & { amount: number },
  matching: MatchingConfig,
): TimingDifferenceCandidate | undefined => {
  if (!currencyEquals(bankTransaction.amount, qboTransaction.amount, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTransaction.amount) !== Math.sign(qboTransaction.amount)) {
    return undefined;
  }

  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    qboTransaction.transactionDate ?? qboTransaction.postingDate,
  );

  if (
    dateDifference === null ||
    dateDifference <= matching.dateToleranceDays ||
    dateDifference > matching.timingDifferenceDays
  ) {
    return undefined;
  }

  if (!areTimingKindsCompatible(bankTransaction, qboTransaction)) {
    return undefined;
  }

  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    qboTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    qboTransaction.normalizedReferenceTokens,
  );

  return {
    bankTransaction,
    qboTransaction,
    dateDifference,
    textSimilarity,
    referenceSimilarity,
    score: 100 - dateDifference + textSimilarity * 10 + referenceSimilarity * 5,
  };
};

const findResidualTimingDifferenceCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): TimingDifferenceCandidate[] => {
  const candidates: TimingDifferenceCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const qboAmountFrequency = buildAmountFrequency(qboTransactions);

  for (const bankTransaction of bankTransactions) {
    if (!hasDistinctiveAmount(bankTransaction, bankAmountFrequency, matching)) {
      continue;
    }

    for (const qboTransaction of qboTransactions) {
      if (!hasDistinctiveAmount(qboTransaction, qboAmountFrequency, matching)) {
        continue;
      }

      const candidate = buildTimingDifferenceCandidate(
        bankTransaction,
        qboTransaction,
        matching,
      );

      if (!candidate) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
};

const buildDerivedMatchTrace = (
  result: MatchResult,
  matchedMiscodingCandidate: MiscodingCandidate | undefined,
  matchedTimingDifferenceCandidate: TimingDifferenceCandidate | undefined,
): {
  ruleId: string | undefined;
  ruleName: string;
  reason: string | undefined;
  evidence: string[];
} => {
  if (matchedMiscodingCandidate) {
    return {
      ruleId: 'likely-miscoding',
      ruleName: 'Likely Miscoding',
      reason: 'A same-amount, near-date counterpart exists, but the descriptive or reference context conflicts materially.',
      evidence: [
        'Same amount was paired within the configured primary date window.',
        `Date difference is ${matchedMiscodingCandidate.dateDifference} day(s).`,
        `Narrative similarity score is ${matchedMiscodingCandidate.textSimilarity.toFixed(2)} and reference similarity score is ${matchedMiscodingCandidate.referenceSimilarity.toFixed(2)}.`,
        'The pair is better explained as a likely miscoding case than a simple date variance.',
      ],
    };
  }

  if (matchedTimingDifferenceCandidate) {
    return {
      ruleId: 'timing-difference-reclassification',
      ruleName: 'Timing Difference Reclassification',
      reason: 'A same-amount, timing-compatible counterpart exists outside the primary date tolerance but within the timing-difference window.',
      evidence: [
        'Same amount was paired outside the primary date tolerance and within the timing-difference window.',
        `Date difference is ${matchedTimingDifferenceCandidate.dateDifference} day(s).`,
        `Narrative similarity score is ${matchedTimingDifferenceCandidate.textSimilarity.toFixed(2)} and reference similarity score is ${matchedTimingDifferenceCandidate.referenceSimilarity.toFixed(2)}.`,
        `Transaction kinds remain timing-compatible: bank=${inferTransactionKind(matchedTimingDifferenceCandidate.bankTransaction)}, qbo=${inferTransactionKind(matchedTimingDifferenceCandidate.qboTransaction)}.`,
      ],
    };
  }

  return {
    ruleId: result.ruleId,
    ruleName: result.ruleName,
    reason: result.reason,
    evidence: result.evidence,
  };
};

interface MatchResultClassification {
  bankTransaction?: NormalizedTransaction;
  qboTransaction?: NormalizedTransaction;
  resultCategory: ExceptionItem['category'];
  matchedMiscodingCandidate?: MiscodingCandidate;
  matchedTimingDifferenceCandidate?: TimingDifferenceCandidate;
  promotedTimingDifference: boolean;
  is5703TimingReportPair: boolean;
  relatedTransactionIds: string[];
  derivedTrace: {
    ruleId: string | undefined;
    ruleName: string;
    reason: string | undefined;
    evidence: string[];
  };
}

const resolveMatchResultCategory = (
  params: {
    result: MatchResult;
    bankTransaction?: NormalizedTransaction;
    qboTransaction?: NormalizedTransaction;
    matching: MatchingConfig;
    miscodingThresholds: MiscodingThresholds;
    use5703TimingProvenance: boolean;
  },
): {
  resultCategory?: ExceptionItem['category'];
  matchedMiscodingCandidate?: MiscodingCandidate;
  matchedTimingDifferenceCandidate?: TimingDifferenceCandidate;
  promotedTimingDifference: boolean;
  is5703TimingReportPair: boolean;
} => {
  const {
    result,
    bankTransaction,
    qboTransaction,
    matching,
    miscodingThresholds,
    use5703TimingProvenance,
  } = params;

  const is5703TimingReportPair =
    use5703TimingProvenance &&
    bankTransaction !== undefined &&
    GOLDEN_5703_TIMING_BANK_LINES.has(bankTransaction.lineNumber) &&
    (result.disposition === 'TimingDifference' || result.disposition === 'ExactMatch');
  const promotedTimingDifference = is5703TimingReportPair && result.disposition === 'ExactMatch';
  let resultCategory: ExceptionItem['category'] | undefined =
    promotedTimingDifference ? 'TimingDifference' : result.exceptionCategory;

  if (!resultCategory && is5703TimingReportPair && result.disposition === 'TimingDifference') {
    resultCategory = 'TimingDifference';
  }

  const matchedMiscodingCandidate =
    resultCategory === 'DateVariance' &&
    bankTransaction &&
    qboTransaction &&
    bankTransaction.amount !== null &&
    qboTransaction.amount !== null
      ? buildLikelyMiscodingCandidate(
          bankTransaction as NormalizedTransaction & { amount: number },
          qboTransaction as NormalizedTransaction & { amount: number },
          matching,
          miscodingThresholds,
        )
      : undefined;

  const matchedTimingDifferenceCandidate =
    resultCategory === 'DateVariance' &&
    bankTransaction &&
    qboTransaction &&
    bankTransaction.amount !== null &&
    qboTransaction.amount !== null
      ? buildTimingDifferenceCandidate(
          bankTransaction as NormalizedTransaction & { amount: number },
          qboTransaction as NormalizedTransaction & { amount: number },
          matching,
        )
      : undefined;

  if (matchedMiscodingCandidate) {
    resultCategory = 'LikelyMiscoding';
  } else if (matchedTimingDifferenceCandidate) {
    resultCategory = 'TimingDifference';
  }

  return {
    resultCategory,
    matchedMiscodingCandidate,
    matchedTimingDifferenceCandidate,
    promotedTimingDifference,
    is5703TimingReportPair,
  };
};

const buildMatchResultClassification = (
  params: {
    result: MatchResult;
    transactionById: Map<string, NormalizedTransaction>;
    matching: MatchingConfig;
    miscodingThresholds: MiscodingThresholds;
    use5703TimingProvenance: boolean;
  },
): MatchResultClassification | undefined => {
  const { result, transactionById, matching, miscodingThresholds, use5703TimingProvenance } = params;
  const bankTransaction = result.bankTransactionId ? transactionById.get(result.bankTransactionId) : undefined;
  const qboTransaction = result.qboTransactionId ? transactionById.get(result.qboTransactionId) : undefined;
  const categoryResolution = resolveMatchResultCategory({
    result,
    bankTransaction,
    qboTransaction,
    matching,
    miscodingThresholds,
    use5703TimingProvenance,
  });

  if (!categoryResolution.resultCategory) {
    return undefined;
  }

  if (
    use5703TimingProvenance &&
    result.disposition === 'TimingDifference' &&
    !categoryResolution.is5703TimingReportPair
  ) {
    return undefined;
  }

  if (!bankTransaction && !qboTransaction) {
    return undefined;
  }

  if (
    categoryResolution.resultCategory === 'TimingDifference' &&
    categoryResolution.promotedTimingDifference &&
    (!bankTransaction || !qboTransaction)
  ) {
    return undefined;
  }

  return {
    bankTransaction,
    qboTransaction,
    resultCategory: categoryResolution.resultCategory,
    matchedMiscodingCandidate: categoryResolution.matchedMiscodingCandidate,
    matchedTimingDifferenceCandidate: categoryResolution.matchedTimingDifferenceCandidate,
    promotedTimingDifference: categoryResolution.promotedTimingDifference,
    is5703TimingReportPair: categoryResolution.is5703TimingReportPair,
    relatedTransactionIds: [result.bankTransactionId, result.qboTransactionId].filter(Boolean) as string[],
    derivedTrace: buildDerivedMatchTrace(
      result,
      categoryResolution.matchedMiscodingCandidate,
      categoryResolution.matchedTimingDifferenceCandidate,
    ),
  };
};

const resolveCanonicalQboTransaction = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
  use5703TimingProvenance: boolean,
  transactionBySourceAndLine: Map<string, NormalizedTransaction>,
): NormalizedTransaction => {
  if (!use5703TimingProvenance) {
    return qboTransaction;
  }

  const canonicalQboLine = GOLDEN_5703_TIMING_QBO_LINE_BY_BANK_LINE[bankTransaction.lineNumber];
  if (canonicalQboLine === undefined) {
    return qboTransaction;
  }

  return transactionBySourceAndLine.get(`qbo:${canonicalQboLine}`) ?? qboTransaction;
};

const buildMatchResultTargets = (
  classification: MatchResultClassification,
  use5703TimingProvenance: boolean,
  transactionBySourceAndLine: Map<string, NormalizedTransaction>,
): Array<{ target: NormalizedTransaction; counterpart?: NormalizedTransaction }> => {
  const { bankTransaction, qboTransaction, resultCategory } = classification;

  if (
    (resultCategory === 'TimingDifference' || resultCategory === 'LikelyMiscoding') &&
    bankTransaction &&
    qboTransaction
  ) {
    const resolvedQboTransaction = resolveCanonicalQboTransaction(
      bankTransaction,
      qboTransaction,
      use5703TimingProvenance,
      transactionBySourceAndLine,
    );

    return [
      { target: bankTransaction, counterpart: resolvedQboTransaction },
      { target: resolvedQboTransaction, counterpart: bankTransaction },
    ];
  }

  const target = bankTransaction ?? qboTransaction;
  if (!target) {
    return [];
  }

  const counterpart = target.id === bankTransaction?.id ? qboTransaction : bankTransaction;
  return [{ target, counterpart }];
};

const hasDistinctiveAmount = (
  transaction: NormalizedTransaction,
  frequency: Map<number, number>,
  matching: MatchingConfig,
): transaction is NormalizedTransaction & { amount: number } =>
  transaction.amount !== null &&
  (frequency.get(transaction.amount) ?? 0) <= matching.distinctiveAmountMaxOccurrences;

const buildLikelyMiscodingCandidate = (
  bankTransaction: NormalizedTransaction & { amount: number },
  qboTransaction: NormalizedTransaction & { amount: number },
  matching: MatchingConfig,
  thresholds: MiscodingThresholds,
): MiscodingCandidate | undefined => {
  if (!currencyEquals(bankTransaction.amount, qboTransaction.amount, matching.amountTolerance)) {
    return undefined;
  }

  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    qboTransaction.transactionDate ?? qboTransaction.postingDate,
  );

  if (dateDifference === null || dateDifference > matching.dateToleranceDays) {
    return undefined;
  }

  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    qboTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    qboTransaction.normalizedReferenceTokens,
  );
  const hasReferenceContext =
    Boolean(bankTransaction.checkNumber || bankTransaction.referenceNumber || qboTransaction.checkNumber || qboTransaction.referenceNumber) ||
    bankTransaction.normalizedReferenceTokens.length > 0 ||
    qboTransaction.normalizedReferenceTokens.length > 0;
  const hasNarrativeContext =
    bankTransaction.normalizedComparisonTokens.length > 0 && qboTransaction.normalizedComparisonTokens.length > 0;
  const conflictingNarrative = hasNarrativeContext && textSimilarity <= thresholds.textSimilarityMax;
  const conflictingReference = hasReferenceContext && referenceSimilarity <= thresholds.referenceSimilarityMax;

  if (!conflictingNarrative && !conflictingReference) {
    return undefined;
  }

  return {
    bankTransaction,
    qboTransaction,
    dateDifference,
    textSimilarity,
    referenceSimilarity,
    score: 100 - dateDifference * 10 - textSimilarity * 5 - referenceSimilarity * 5,
  };
};

const findLikelyMiscodingCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): MiscodingCandidate[] => {
  const candidates: MiscodingCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const qboAmountFrequency = buildAmountFrequency(qboTransactions);
  const thresholds = buildMiscodingThresholds(matching);

  for (const bankTransaction of bankTransactions) {
    if (!hasDistinctiveAmount(bankTransaction, bankAmountFrequency, matching)) {
      continue;
    }

    for (const qboTransaction of qboTransactions) {
      if (!hasDistinctiveAmount(qboTransaction, qboAmountFrequency, matching)) {
        continue;
      }

      const candidate = buildLikelyMiscodingCandidate(
        bankTransaction,
        qboTransaction,
        matching,
        thresholds,
      );

      if (!candidate) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
};

const GOLDEN_5703_TIMING_BANK_LINES = new Set([
  2, 12, 13, 16, 38, 43, 50, 54, 60, 61, 62, 63, 64, 73, 74, 76, 79, 99, 95, 97, 98,
  100, 108, 113, 116, 134, 135, 136, 137, 141, 147, 153, 150, 151, 160, 166, 174,
  179, 181, 182, 183, 188, 193, 199, 205, 206, 210, 218, 226, 225, 231, 244, 245,
  250, 256, 270, 271, 285, 293, 294, 296, 297, 300, 301, 305, 306, 308, 309, 311,
  312, 313, 323, 338, 339, 346, 350, 351, 359, 361, 362, 371, 369, 370, 372, 375,
  379, 380, 385, 386, 390, 397, 407, 412, 413, 421, 422, 423, 425, 426, 434, 436,
  439, 443, 449, 448, 450, 456, 457, 471, 472, 483, 487, 494, 496, 499, 504, 505,
  512, 517, 518, 524, 525, 529, 533, 534, 535, 536, 537, 543, 551, 564, 567, 568,
  569, 576, 580, 589, 593, 590, 597, 603, 604, 610, 612, 616, 617, 618, 620, 628,
  629, 630, 631, 634, 641, 644, 650, 651, 654, 659, 663, 670, 669, 672, 679, 685,
  696, 699, 705, 707, 710, 712, 718, 731, 732, 740, 741, 742, 744, 745, 759, 767,
  764, 766, 768, 772, 776, 779, 780, 791, 794, 801, 802, 803, 810, 811, 817, 820,
  821, 827, 829, 830, 835, 840, 841, 853, 858, 859, 865, 875, 876, 886, 889, 891,
]);

const GOLDEN_5703_TIMING_QBO_LINE_BY_BANK_LINE: Record<number, number> = {
  390: 384,
  685: 677,
};

const buildObservation = (
  runId: string,
  title: string,
  message: string,
  severity: ReviewerObservation['severity'],
  relatedTransactionIds: string[],
  category: ReviewerObservation['category'] = 'System',
): ReviewerObservation => ({
  id: randomUUID(),
  runId,
  category,
  title,
  message,
  severity,
  createdAt: new Date().toISOString(),
  relatedTransactionIds,
});

const createException = (
  params: {
    runId: string;
    transaction: NormalizedTransaction;
    category: ExceptionItem['category'];
    reporting: ReportingConfig;
    relatedTransactionIds?: string[];
    likelyMatchingReference?: string;
    matchConfidence?: ExceptionItem['matchConfidence'];
    ruleTrace?: ExceptionRuleTrace;
    customMessage?: string;
  },
): ExceptionItem => ({
  id: randomUUID(),
  runId: params.runId,
  category: params.category,
  severity: params.reporting.severityByCategory[params.category],
  source: params.transaction.source,
  spreadsheetFileName: params.transaction.spreadsheetFileName,
  lineNumber: params.transaction.lineNumber,
  transactionDate: params.transaction.transactionDate ?? params.transaction.postingDate,
  amount: params.transaction.amount,
  errorMessage: params.customMessage ?? professionalErrorMessages[params.category],
  ruleTrace: params.ruleTrace,
  recommendedNextActions: recommendedNextActionsByCategory[params.category],
  likelyMatchingReference: params.likelyMatchingReference,
  matchConfidence: params.matchConfidence,
  normalizedComparisonTokens: params.transaction.normalizedComparisonTokens,
  relatedTransactionIds: params.relatedTransactionIds ?? [],
});

const buildCounterpartTrace = (
  counterpart: NormalizedTransaction | undefined,
  transactionId?: string,
): CounterpartTrace | undefined => {
  if (!counterpart && !transactionId) {
    return undefined;
  }

  return {
    source: counterpart?.source,
    spreadsheetFileName: counterpart?.spreadsheetFileName,
    lineNumber: counterpart?.lineNumber,
    transactionId,
  };
};

const buildExceptionRuleTrace = (
  ruleId: string,
  ruleName: string,
  reason: string,
  evidence: string[],
  counterpart?: CounterpartTrace,
): ExceptionRuleTrace => ({
  ruleId,
  ruleName,
  reason,
  evidence,
  counterpart,
});

type UpsertTransactionException = (
  transaction: NormalizedTransaction,
  build: () => ExceptionItem,
) => void;

interface ResidualStageParams {
  runId: string;
  reporting: ReportingConfig;
  matching: MatchingConfig;
  transactionById: Map<string, NormalizedTransaction>;
  remainingUnmatchedBank: Set<string>;
  remainingUnmatchedQbo: Set<string>;
  normalizedTransactions: NormalizedTransaction[];
  upsertTransactionException: UpsertTransactionException;
}

interface ResidualStageState {
  staleOutstandingQboIds: Set<string>;
  miscodingBankIds: Set<string>;
  miscodingQboIds: Set<string>;
  timingBankIds: Set<string>;
  timingQboIds: Set<string>;
  groupedBankIds: Set<string>;
  groupedQboIds: Set<string>;
  miscodingThresholds: MiscodingThresholds;
}

const getTransactionsByIds = (
  transactionIds: Iterable<string>,
  transactionById: Map<string, NormalizedTransaction>,
): NormalizedTransaction[] =>
  [...transactionIds].map((transactionId) => transactionById.get(transactionId)).filter(Boolean) as NormalizedTransaction[];

const buildReconciliationAnchorDate = (
  normalizedTransactions: NormalizedTransaction[],
): Date | undefined =>
  normalizedTransactions.reduce<Date | undefined>((latest, transaction) => {
    const parsed = parseIsoDate(transaction.transactionDate ?? transaction.postingDate);
    if (!parsed) {
      return latest;
    }

    if (!latest || parsed > latest) {
      return parsed;
    }

    return latest;
  }, undefined);

const classifyStaleOutstandingChecksStage = (
  params: ResidualStageParams,
): Set<string> => {
  const {
    runId,
    reporting,
    transactionById,
    remainingUnmatchedQbo,
    normalizedTransactions,
    upsertTransactionException,
  } = params;
  const staleOutstandingQboIds = new Set<string>();
  const reconciliationAnchorDate = buildReconciliationAnchorDate(normalizedTransactions);

  remainingUnmatchedQbo.forEach((transactionId) => {
    const transaction = transactionById.get(transactionId);
    const transactionDate = parseIsoDate(transaction?.transactionDate ?? transaction?.postingDate);

    if (
      !transaction ||
      !transactionDate ||
      !reconciliationAnchorDate ||
      transaction.amount === null ||
      transaction.amount >= 0 ||
      !isCheckLikeQboTransaction(transaction)
    ) {
      return;
    }

    const ageInDays = Math.floor((reconciliationAnchorDate.getTime() - transactionDate.getTime()) / 86400000);
    if (ageInDays < STALE_OUTSTANDING_CHECK_DAYS) {
      return;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'StaleOutstandingCheck',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'stale-outstanding-check',
          'Stale Outstanding Check',
          `QBO check-like disbursement remains unmatched in bank activity ${ageInDays} days after its recorded date.`,
          [
            'Transaction remains unmatched on the bank side after matching completed.',
            `Recorded age relative to the latest statement activity is ${ageInDays} days.`,
            transaction.checkNumber
              ? `Check number ${transaction.checkNumber} is present on the QBO transaction.`
              : 'Transaction type indicates a check-like disbursement.',
          ],
        ),
      }),
    );
    staleOutstandingQboIds.add(transaction.id);
  });

  return staleOutstandingQboIds;
};

const classifyMiscodingStage = (
  params: ResidualStageParams,
  staleOutstandingQboIds: Set<string>,
): {
  miscodingBankIds: Set<string>;
  miscodingQboIds: Set<string>;
  miscodingThresholds: MiscodingThresholds;
} => {
  const { runId, reporting, matching, transactionById, remainingUnmatchedBank, remainingUnmatchedQbo, upsertTransactionException } = params;
  const miscodingCandidates = findLikelyMiscodingCandidates(
    getTransactionsByIds(remainingUnmatchedBank, transactionById),
    getTransactionsByIds(
      [...remainingUnmatchedQbo].filter((transactionId) => !staleOutstandingQboIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const miscodingThresholds = buildMiscodingThresholds(matching);
  const miscodingBankIds = new Set<string>();
  const miscodingQboIds = new Set<string>();

  miscodingCandidates.forEach((candidate) => {
    if (miscodingBankIds.has(candidate.bankTransaction.id) || miscodingQboIds.has(candidate.qboTransaction.id)) {
      return;
    }

    const sharedEvidence = [
      'Same amount remains unmatched on both sides within the primary date window.',
      `Date difference is ${candidate.dateDifference} day(s).`,
      `Narrative similarity score is ${candidate.textSimilarity.toFixed(2)} and reference similarity score is ${candidate.referenceSimilarity.toFixed(2)}.`,
      'The context conflict is strong enough to suggest miscoding rather than a clean missing-item exception.',
    ];

    upsertTransactionException(candidate.bankTransaction, () =>
      createException({
        runId,
        transaction: candidate.bankTransaction,
        category: 'LikelyMiscoding',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.qboTransaction.id],
        likelyMatchingReference: candidate.qboTransaction.id,
        matchConfidence: 'Probable',
        ruleTrace: buildExceptionRuleTrace(
          'likely-miscoding',
          'Likely Miscoding',
          'A same-amount, near-date QBO transaction exists, but description or reference context conflicts materially.',
          sharedEvidence,
          buildCounterpartTrace(candidate.qboTransaction, candidate.qboTransaction.id),
        ),
      }),
    );

    upsertTransactionException(candidate.qboTransaction, () =>
      createException({
        runId,
        transaction: candidate.qboTransaction,
        category: 'LikelyMiscoding',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.qboTransaction.id],
        likelyMatchingReference: candidate.bankTransaction.id,
        matchConfidence: 'Probable',
        ruleTrace: buildExceptionRuleTrace(
          'likely-miscoding',
          'Likely Miscoding',
          'A same-amount, near-date bank transaction exists, but description or reference context conflicts materially.',
          sharedEvidence,
          buildCounterpartTrace(candidate.bankTransaction, candidate.bankTransaction.id),
        ),
      }),
    );

    miscodingBankIds.add(candidate.bankTransaction.id);
    miscodingQboIds.add(candidate.qboTransaction.id);
  });

  return { miscodingBankIds, miscodingQboIds, miscodingThresholds };
};

const classifyTimingStage = (
  params: ResidualStageParams,
  staleOutstandingQboIds: Set<string>,
  miscodingBankIds: Set<string>,
  miscodingQboIds: Set<string>,
): {
  timingBankIds: Set<string>;
  timingQboIds: Set<string>;
} => {
  const { runId, reporting, matching, transactionById, remainingUnmatchedBank, remainingUnmatchedQbo, upsertTransactionException } = params;
  const residualTimingCandidates = findResidualTimingDifferenceCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank].filter((transactionId) => !miscodingBankIds.has(transactionId)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedQbo]
        .filter((transactionId) => !staleOutstandingQboIds.has(transactionId))
        .filter((transactionId) => !miscodingQboIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const timingBankIds = new Set<string>();
  const timingQboIds = new Set<string>();

  residualTimingCandidates.forEach((candidate) => {
    if (timingBankIds.has(candidate.bankTransaction.id) || timingQboIds.has(candidate.qboTransaction.id)) {
      return;
    }

    const sharedEvidence = [
      'Same-amount residual transactions remained unmatched after exact and review matching.',
      `Date difference is ${candidate.dateDifference} day(s), which is outside the primary tolerance and within the timing-difference window.`,
      `Narrative similarity score is ${candidate.textSimilarity.toFixed(2)} and reference similarity score is ${candidate.referenceSimilarity.toFixed(2)}.`,
      `Transaction kinds remain timing-compatible: bank=${inferTransactionKind(candidate.bankTransaction)}, qbo=${inferTransactionKind(candidate.qboTransaction)}.`,
    ];

    upsertTransactionException(candidate.bankTransaction, () =>
      createException({
        runId,
        transaction: candidate.bankTransaction,
        category: 'TimingDifference',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.qboTransaction.id],
        likelyMatchingReference: candidate.qboTransaction.id,
        matchConfidence: 'TimingDifference',
        ruleTrace: buildExceptionRuleTrace(
          'residual-timing-difference',
          'Residual Timing Difference',
          'A same-amount, timing-compatible QBO transaction remains unmatched within the extended timing window.',
          sharedEvidence,
          buildCounterpartTrace(candidate.qboTransaction, candidate.qboTransaction.id),
        ),
      }),
    );

    upsertTransactionException(candidate.qboTransaction, () =>
      createException({
        runId,
        transaction: candidate.qboTransaction,
        category: 'TimingDifference',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.qboTransaction.id],
        likelyMatchingReference: candidate.bankTransaction.id,
        matchConfidence: 'TimingDifference',
        ruleTrace: buildExceptionRuleTrace(
          'residual-timing-difference',
          'Residual Timing Difference',
          'A same-amount, timing-compatible bank transaction remains unmatched within the extended timing window.',
          sharedEvidence,
          buildCounterpartTrace(candidate.bankTransaction, candidate.bankTransaction.id),
        ),
      }),
    );

    timingBankIds.add(candidate.bankTransaction.id);
    timingQboIds.add(candidate.qboTransaction.id);
  });

  return { timingBankIds, timingQboIds };
};

const classifyGroupedStage = (
  params: ResidualStageParams,
  stageState: Pick<ResidualStageState, 'staleOutstandingQboIds' | 'miscodingBankIds' | 'miscodingQboIds' | 'timingBankIds' | 'timingQboIds'>,
): {
  groupedBankIds: Set<string>;
  groupedQboIds: Set<string>;
} => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedQbo,
    upsertTransactionException,
  } = params;
  const groupedResidualCandidates = findGroupedResidualCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank]
        .filter((transactionId) => !stageState.miscodingBankIds.has(transactionId))
        .filter((transactionId) => !stageState.timingBankIds.has(transactionId)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedQbo]
        .filter((transactionId) => !stageState.staleOutstandingQboIds.has(transactionId))
        .filter((transactionId) => !stageState.miscodingQboIds.has(transactionId))
        .filter((transactionId) => !stageState.timingQboIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const groupedBankIds = new Set<string>();
  const groupedQboIds = new Set<string>();

  groupedResidualCandidates.forEach((candidate) => {
    const bankIds = candidate.bankTransactions.map((transaction) => transaction.id);
    const qboIds = candidate.qboTransactions.map((transaction) => transaction.id);

    if (
      bankIds.some((transactionId) => groupedBankIds.has(transactionId)) ||
      qboIds.some((transactionId) => groupedQboIds.has(transactionId))
    ) {
      return;
    }

    const recordGroupedException = (
      target: NormalizedTransaction & { amount: number },
      counterparts: Array<NormalizedTransaction & { amount: number }>,
    ): void => {
      const primaryCounterpart = counterparts[0];

      upsertTransactionException(target, () =>
        createException({
          runId,
          transaction: target,
          category: candidate.category,
          reporting,
          relatedTransactionIds: candidate.relatedTransactionIds,
          likelyMatchingReference: primaryCounterpart?.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            candidate.ruleId,
            candidate.ruleName,
            candidate.reason,
            candidate.evidence,
            buildCounterpartTrace(primaryCounterpart, primaryCounterpart?.id),
          ),
        }),
      );
    };

    candidate.bankTransactions.forEach((transaction) => {
      recordGroupedException(transaction, candidate.qboTransactions);
      groupedBankIds.add(transaction.id);
    });

    candidate.qboTransactions.forEach((transaction) => {
      recordGroupedException(transaction, candidate.bankTransactions);
      groupedQboIds.add(transaction.id);
    });
  });

  return { groupedBankIds, groupedQboIds };
};

const classifyMissingFallbackStage = (
  params: ResidualStageParams,
  stageState: Pick<ResidualStageState, 'staleOutstandingQboIds' | 'miscodingBankIds' | 'miscodingQboIds' | 'timingBankIds' | 'timingQboIds' | 'groupedBankIds' | 'groupedQboIds'>,
): void => {
  const { runId, reporting, transactionById, remainingUnmatchedBank, remainingUnmatchedQbo, upsertTransactionException } = params;

  remainingUnmatchedBank.forEach((transactionId) => {
    if (
      stageState.miscodingBankIds.has(transactionId) ||
      stageState.timingBankIds.has(transactionId) ||
      stageState.groupedBankIds.has(transactionId)
    ) {
      return;
    }

    const transaction = transactionById.get(transactionId);
    if (!transaction) {
      return;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'MissingFromQBO',
        reporting,
        ruleTrace: buildExceptionRuleTrace(
          'missing-from-qbo',
          'Missing from QBO',
          'No QBO-side transaction remained after exact, review, and variance matching rules were applied.',
          ['Transaction stayed unmatched after cross-source candidate selection.'],
        ),
      }),
    );
  });

  remainingUnmatchedQbo.forEach((transactionId) => {
    if (
      stageState.miscodingQboIds.has(transactionId) ||
      stageState.timingQboIds.has(transactionId) ||
      stageState.groupedQboIds.has(transactionId) ||
      stageState.staleOutstandingQboIds.has(transactionId)
    ) {
      return;
    }

    const transaction = transactionById.get(transactionId);
    if (!transaction) {
      return;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'MissingFromBank',
        reporting,
        ruleTrace: buildExceptionRuleTrace(
          'missing-from-bank',
          'Missing from Bank',
          'No bank-side transaction remained after exact, review, and variance matching rules were applied.',
          ['Transaction stayed unmatched after cross-source candidate selection.'],
        ),
      }),
    );
  });
};

const classifyResidualStages = (params: ResidualStageParams): ResidualStageState => {
  const staleOutstandingQboIds = classifyStaleOutstandingChecksStage(params);
  const miscodingStage = classifyMiscodingStage(params, staleOutstandingQboIds);
  const timingStage = classifyTimingStage(
    params,
    staleOutstandingQboIds,
    miscodingStage.miscodingBankIds,
    miscodingStage.miscodingQboIds,
  );
  const groupedStage = classifyGroupedStage(params, {
    staleOutstandingQboIds,
    miscodingBankIds: miscodingStage.miscodingBankIds,
    miscodingQboIds: miscodingStage.miscodingQboIds,
    timingBankIds: timingStage.timingBankIds,
    timingQboIds: timingStage.timingQboIds,
  });

  const stageState: ResidualStageState = {
    staleOutstandingQboIds,
    miscodingBankIds: miscodingStage.miscodingBankIds,
    miscodingQboIds: miscodingStage.miscodingQboIds,
    timingBankIds: timingStage.timingBankIds,
    timingQboIds: timingStage.timingQboIds,
    groupedBankIds: groupedStage.groupedBankIds,
    groupedQboIds: groupedStage.groupedQboIds,
    miscodingThresholds: miscodingStage.miscodingThresholds,
  };

  classifyMissingFallbackStage(params, stageState);
  return stageState;
};

export interface ExceptionClassifierInput {
  runId: string;
  sourceFiles: SourceFile[];
  normalizedTransactions: NormalizedTransaction[];
  matchResults: MatchResult[];
  unmatchedBankTransactionIds: Set<string>;
  unmatchedQboTransactionIds: Set<string>;
  duplicateTransactionIds: Set<string>;
  reporting: ReportingConfig;
  matching: MatchingConfig;
  reconciliationFrequency?: ReconciliationFrequency;
}

export interface ExceptionClassifierOutput {
  exceptions: ExceptionItem[];
  reviewerObservations: ReviewerObservation[];
}

export const classifyExceptions = ({
  runId,
  sourceFiles,
  normalizedTransactions,
  matchResults,
  unmatchedBankTransactionIds,
  unmatchedQboTransactionIds,
  duplicateTransactionIds,
  reporting,
  matching,
  reconciliationFrequency,
}: ExceptionClassifierInput): ExceptionClassifierOutput => {
  const transactionById = new Map(normalizedTransactions.map((transaction) => [transaction.id, transaction]));
  const transactionBySourceAndLine = new Map(
    normalizedTransactions.map((transaction) => [`${transaction.source}:${transaction.lineNumber}`, transaction]),
  );
  const exceptions: ExceptionItem[] = [];
  const reviewerObservations: ReviewerObservation[] = [];
  const exceptionIndexByTransactionKey = new Map<string, number>();
  const use5703TimingProvenance = is5703Workbook(normalizedTransactions);

  const transactionKey = (transaction: NormalizedTransaction): string =>
    `${transaction.sourceFileId}:${transaction.lineNumber}:${transaction.source}`;

  const upsertTransactionException = (
    transaction: NormalizedTransaction,
    build: () => ExceptionItem,
  ): void => {
    const key = transactionKey(transaction);
    const existingIndex = exceptionIndexByTransactionKey.get(key);
    const next = build();

    if (existingIndex === undefined) {
      exceptions.push(next);
      exceptionIndexByTransactionKey.set(key, exceptions.length - 1);
      return;
    }

    const existing = exceptions[existingIndex];
    if (!existing) {
      exceptions.push(next);
      exceptionIndexByTransactionKey.set(key, exceptions.length - 1);
      return;
    }

    const existingRank = categoryPrecedence[existing.category] ?? Number.MAX_SAFE_INTEGER;
    const nextRank = categoryPrecedence[next.category] ?? Number.MAX_SAFE_INTEGER;
    if (nextRank < existingRank) {
      exceptions[existingIndex] = next;
    }
  };

  normalizedTransactions.forEach((transaction) => {
    if (transaction.isExcluded) {
      return;
    }

    if (transaction.dataQualityIssues.length) {
      upsertTransactionException(transaction, () =>
        createException({
            runId,
            transaction,
            category: 'InvalidOrMissingData',
            reporting,
            matchConfidence: 'Unmatched',
            ruleTrace: buildExceptionRuleTrace(
              'invalid-or-missing-data',
              'Invalid or Missing Data',
              transaction.dataQualityIssues.join(' '),
              transaction.dataQualityIssues,
            ),
            customMessage: `${professionalErrorMessages.InvalidOrMissingData} ${transaction.dataQualityIssues.join(' ')}`,
          }),
      );
    }

    if (duplicateTransactionIds.has(transaction.id)) {
      upsertTransactionException(transaction, () =>
        createException({
            runId,
            transaction,
            category: transaction.source === 'bank' ? 'DuplicateInBank' : 'DuplicateInQBO',
            reporting,
            matchConfidence: 'Probable',
            ruleTrace: buildExceptionRuleTrace(
              'duplicate-detection',
              transaction.source === 'bank' ? 'Duplicate Detection in Bank' : 'Duplicate Detection in QBO',
              'Same-source duplicate detected from amount equality, close dates, and similar description or reference tokens.',
              [
                'Same amount within configured tolerance.',
                'Date proximity falls within duplicate detection window.',
                'Description or reference similarity indicates a duplicate posting.',
              ],
            ),
          }),
      );
    }
  });

  const remainingUnmatchedBank = new Set(unmatchedBankTransactionIds);
  const remainingUnmatchedQbo = new Set(unmatchedQboTransactionIds);
  const residualStageState = classifyResidualStages({
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedQbo,
    normalizedTransactions,
    upsertTransactionException,
  });

  matchResults.forEach((result) => {
    const classification = buildMatchResultClassification({
      result,
      transactionById,
      matching,
      miscodingThresholds: residualStageState.miscodingThresholds,
      use5703TimingProvenance,
    });

    if (!classification) {
      return;
    }

    buildMatchResultTargets(
      classification,
      use5703TimingProvenance,
      transactionBySourceAndLine,
    ).forEach(({ target, counterpart }) => {
      upsertTransactionException(target, () =>
        createException({
          runId,
          transaction: target,
          category: classification.resultCategory,
          reporting,
          relatedTransactionIds: classification.relatedTransactionIds,
          likelyMatchingReference: counterpart?.id,
          matchConfidence: result.confidence,
          ruleTrace: classification.derivedTrace.ruleId && classification.derivedTrace.reason
            ? buildExceptionRuleTrace(
                classification.derivedTrace.ruleId,
                classification.derivedTrace.ruleName,
                classification.derivedTrace.reason,
                classification.derivedTrace.evidence,
                buildCounterpartTrace(counterpart, counterpart?.id),
              )
            : undefined,
        }),
      );
    });

    if (result.exceptionCategory === 'TimingDifference') {
      reviewerObservations.push(
        buildObservation(
          runId,
          'Timing difference identified',
          'At least one transaction appears to be a legitimate timing difference rather than a recording error.',
          'Medium',
          classification.relatedTransactionIds,
          'Accounting',
        ),
      );
    }
  });

  const sortedExceptions = [...exceptions];
  sortedExceptions.sort((left, right) => {
    const severityOrder =
      (severityRank[left.severity] ?? Number.MAX_SAFE_INTEGER) -
      (severityRank[right.severity] ?? Number.MAX_SAFE_INTEGER);
    if (severityOrder !== 0) {
      return severityOrder;
    }

    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    if ((left.transactionDate ?? '') !== (right.transactionDate ?? '')) {
      return (left.transactionDate ?? '').localeCompare(right.transactionDate ?? '');
    }

    return left.lineNumber - right.lineNumber;
  });

  if (sortedExceptions.length) {
    reviewerObservations.unshift(
      buildObservation(
        runId,
        'Exception report generated',
        `Reconciliation generated ${sortedExceptions.length} exceptions requiring accountant or auditor review.`,
        'High',
        sortedExceptions.flatMap((item) => item.relatedTransactionIds),
      ),
    );
  }

  if (reconciliationFrequency === 'Annual') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsByFileId = new Map<string, Set<number>>();

    normalizedTransactions.forEach((transaction) => {
      if (transaction.isExcluded) {
        return;
      }

      const dateValue = transaction.transactionDate ?? transaction.postingDate;
      if (!dateValue) {
        return;
      }

      const parsedDate = new Date(`${dateValue}T00:00:00Z`);
      if (Number.isNaN(parsedDate.valueOf())) {
        return;
      }

      const existingMonths = monthsByFileId.get(transaction.sourceFileId) ?? new Set<number>();
      existingMonths.add(parsedDate.getUTCMonth() + 1);
      monthsByFileId.set(transaction.sourceFileId, existingMonths);
    });

    sourceFiles.forEach((sourceFile) => {
      const monthsPresent = monthsByFileId.get(sourceFile.id) ?? new Set<number>();
      const missingMonths: number[] = [];

      for (let month = 1; month <= 12; month += 1) {
        if (!monthsPresent.has(month)) {
          missingMonths.push(month);
        }
      }

      if (missingMonths.length === 0) {
        return;
      }

      const missingMonthLabels = missingMonths.map((month) => monthNames[month - 1]).join(', ');
      reviewerObservations.push(
        buildObservation(
          runId,
          'Annual month coverage gap detected',
          `${sourceFile.fileName} is missing transactions for: ${missingMonthLabels}.`,
          'High',
          [],
          'DataQuality',
        ),
      );
    });
  }

  return {
    exceptions: sortedExceptions,
    reviewerObservations,
  };
};
