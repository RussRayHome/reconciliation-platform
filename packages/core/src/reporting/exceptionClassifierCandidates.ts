import type { MatchingConfig, NormalizedTransaction } from '@recon/domain';
import { currencyEquals, dateDifferenceDays, tokenSimilarity } from '../matching/similarity';
import {
  areGroupedTransactionsCompatible,
  areTimingKindsCompatible,
  buildAmountFrequency,
  calculateGroupedDateDifference,
  formatKinds,
  generateTransactionCombinations,
  inferTransactionKind,
  isDepositLikeKind,
  mergeComparisonTokens,
  mergeReferenceTokens,
  sumTransactionAmounts,
} from './exceptionClassifierUtils';
import type {
  GroupedResidualCandidate,
  MiscodingCandidate,
  MiscodingThresholds,
  TimingDifferenceCandidate,
} from './exceptionClassifierTypes';

export const buildMiscodingThresholds = (matching: MatchingConfig): MiscodingThresholds => ({
  textSimilarityMax: Math.min(0.35, Math.max(0.15, matching.probableTextSimilarityThreshold / 2)),
  referenceSimilarityMax: Math.min(0.5, matching.referenceSimilarityThreshold / 2),
});

const buildGroupedCandidateCategory = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  glTransactions: Array<NormalizedTransaction & { amount: number }>,
): GroupedResidualCandidate['category'] => {
  const bankTotal = sumTransactionAmounts(bankTransactions);
  const glTotal = sumTransactionAmounts(glTransactions);
  const allKinds = [...bankTransactions, ...glTransactions].map((transaction) =>
    inferTransactionKind(transaction),
  );

  if (bankTotal > 0 && glTotal > 0 && allKinds.every((kind) => isDepositLikeKind(kind))) {
    return 'DepositGroupingIssue';
  }

  return 'LikelySplitCombineIssue';
};

const describeTransactionGroup = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): string =>
  transactions
    .map(
      (transaction) =>
        `${transaction.source === 'gl' ? 'GL' : transaction.source.toUpperCase()} line ${transaction.lineNumber} (${transaction.amount.toFixed(2)})`,
    )
    .join(', ');

const buildGroupedResidualCandidate = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  glTransactions: Array<NormalizedTransaction & { amount: number }>,
  matching: MatchingConfig,
): GroupedResidualCandidate | undefined => {
  if (!bankTransactions.length || !glTransactions.length) {
    return undefined;
  }

  if (bankTransactions.length === 1 && glTransactions.length === 1) {
    return undefined;
  }

  const bankTotal = sumTransactionAmounts(bankTransactions);
  const glTotal = sumTransactionAmounts(glTransactions);

  if (!currencyEquals(bankTotal, glTotal, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTotal) !== Math.sign(glTotal)) {
    return undefined;
  }

  if (!areGroupedTransactionsCompatible(bankTransactions, glTransactions)) {
    return undefined;
  }

  const dateDifference = calculateGroupedDateDifference(bankTransactions, glTransactions);
  if (dateDifference === null || dateDifference > matching.timingDifferenceDays) {
    return undefined;
  }

  const textSimilarity = tokenSimilarity(
    mergeComparisonTokens(bankTransactions),
    mergeComparisonTokens(glTransactions),
  );
  const referenceSimilarity = tokenSimilarity(
    mergeReferenceTokens(bankTransactions),
    mergeReferenceTokens(glTransactions),
  );
  const category = buildGroupedCandidateCategory(bankTransactions, glTransactions);
  const bankKinds = formatKinds(bankTransactions);
  const glKinds = formatKinds(glTransactions);

  return {
    category,
    ruleId:
      category === 'DepositGroupingIssue'
        ? 'grouped-deposit-residual'
        : 'grouped-split-combine-residual',
    ruleName:
      category === 'DepositGroupingIssue'
        ? 'Grouped Deposit Residual'
        : 'Grouped Split/Combine Residual',
    reason:
      category === 'DepositGroupingIssue'
        ? 'Residual unmatched deposits form a grouped receipt pattern rather than independent missing items.'
        : 'Residual unmatched transactions form a one-to-many or many-to-one relationship that the one-to-one matcher cannot settle cleanly.',
    evidence: [
      'Residual unmatched transactions form a balanced grouped amount across sources.',
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); GL total is ${glTotal.toFixed(2)} across ${glTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and gl=${glKinds}.`,
      `Narrative similarity score is ${textSimilarity.toFixed(2)} and reference similarity score is ${referenceSimilarity.toFixed(2)}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `GL members: ${describeTransactionGroup(glTransactions)}.`,
    ],
    bankTransactions,
    glTransactions,
    relatedTransactionIds: [...bankTransactions, ...glTransactions].map(
      (transaction) => transaction.id,
    ),
    score:
      100 -
      dateDifference * 2 -
      (bankTransactions.length + glTransactions.length) +
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

      if (
        Math.abs(counterpartTransaction.amount) >
        Math.abs(anchorTransaction.amount) + matching.amountTolerance
      ) {
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

      return (
        Math.abs(anchorTransaction.amount - left.amount) -
        Math.abs(anchorTransaction.amount - right.amount)
      );
    })
    .slice(0, matching.groupedCandidatePoolSize);

export const findGroupedResidualCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedResidualCandidate[] => {
  const candidates: GroupedResidualCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );
  const glResiduals = glTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, glResiduals, matching);
    const combinations = generateTransactionCombinations(
      counterpartPool,
      2,
      matching.groupedMatchMaxSize,
    );

    for (const combination of combinations) {
      const candidate = buildGroupedResidualCandidate([bankTransaction], combination, matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const glTransaction of glResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(glTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(
      counterpartPool,
      2,
      matching.groupedMatchMaxSize,
    );

    for (const combination of combinations) {
      const candidate = buildGroupedResidualCandidate(combination, [glTransaction], matching);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
};

export const buildTimingDifferenceCandidate = (
  bankTransaction: NormalizedTransaction & { amount: number },
  glTransaction: NormalizedTransaction & { amount: number },
  matching: MatchingConfig,
): TimingDifferenceCandidate | undefined => {
  if (!currencyEquals(bankTransaction.amount, glTransaction.amount, matching.amountTolerance)) {
    return undefined;
  }

  if (Math.sign(bankTransaction.amount) !== Math.sign(glTransaction.amount)) {
    return undefined;
  }

  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    glTransaction.transactionDate ?? glTransaction.postingDate,
  );

  if (
    dateDifference === null ||
    dateDifference <= matching.dateToleranceDays ||
    dateDifference > matching.timingDifferenceDays
  ) {
    return undefined;
  }

  if (!areTimingKindsCompatible(bankTransaction, glTransaction)) {
    return undefined;
  }

  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    glTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    glTransaction.normalizedReferenceTokens,
  );

  return {
    bankTransaction,
    glTransaction,
    dateDifference,
    textSimilarity,
    referenceSimilarity,
    score: 100 - dateDifference + textSimilarity * 10 + referenceSimilarity * 5,
  };
};

const hasDistinctiveAmount = (
  transaction: NormalizedTransaction,
  frequency: Map<number, number>,
  matching: MatchingConfig,
): transaction is NormalizedTransaction & { amount: number } =>
  transaction.amount !== null &&
  (frequency.get(transaction.amount) ?? 0) <= matching.distinctiveAmountMaxOccurrences;

export const findResidualTimingDifferenceCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): TimingDifferenceCandidate[] => {
  const candidates: TimingDifferenceCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const glAmountFrequency = buildAmountFrequency(glTransactions);

  for (const bankTransaction of bankTransactions) {
    if (!hasDistinctiveAmount(bankTransaction, bankAmountFrequency, matching)) {
      continue;
    }

    for (const glTransaction of glTransactions) {
      if (!hasDistinctiveAmount(glTransaction, glAmountFrequency, matching)) {
        continue;
      }

      const candidate = buildTimingDifferenceCandidate(bankTransaction, glTransaction, matching);

      if (!candidate) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
};

export const buildLikelyMiscodingCandidate = (
  bankTransaction: NormalizedTransaction & { amount: number },
  glTransaction: NormalizedTransaction & { amount: number },
  matching: MatchingConfig,
  thresholds: MiscodingThresholds,
): MiscodingCandidate | undefined => {
  if (!currencyEquals(bankTransaction.amount, glTransaction.amount, matching.amountTolerance)) {
    return undefined;
  }

  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    glTransaction.transactionDate ?? glTransaction.postingDate,
  );

  if (dateDifference === null || dateDifference > matching.dateToleranceDays) {
    return undefined;
  }

  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    glTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    glTransaction.normalizedReferenceTokens,
  );
  const hasReferenceContext =
    Boolean(
      bankTransaction.checkNumber ||
      bankTransaction.referenceNumber ||
      glTransaction.checkNumber ||
      glTransaction.referenceNumber,
    ) ||
    bankTransaction.normalizedReferenceTokens.length > 0 ||
    glTransaction.normalizedReferenceTokens.length > 0;
  const hasNarrativeContext =
    bankTransaction.normalizedComparisonTokens.length > 0 &&
    glTransaction.normalizedComparisonTokens.length > 0;
  const conflictingNarrative =
    hasNarrativeContext && textSimilarity <= thresholds.textSimilarityMax;
  const conflictingReference =
    hasReferenceContext && referenceSimilarity <= thresholds.referenceSimilarityMax;

  if (!conflictingNarrative && !conflictingReference) {
    return undefined;
  }

  return {
    bankTransaction,
    glTransaction,
    dateDifference,
    textSimilarity,
    referenceSimilarity,
    score: 100 - dateDifference * 10 - textSimilarity * 5 - referenceSimilarity * 5,
  };
};

export const findLikelyMiscodingCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): MiscodingCandidate[] => {
  const candidates: MiscodingCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const glAmountFrequency = buildAmountFrequency(glTransactions);
  const thresholds = buildMiscodingThresholds(matching);

  for (const bankTransaction of bankTransactions) {
    if (!hasDistinctiveAmount(bankTransaction, bankAmountFrequency, matching)) {
      continue;
    }

    for (const glTransaction of glTransactions) {
      if (!hasDistinctiveAmount(glTransaction, glAmountFrequency, matching)) {
        continue;
      }

      const candidate = buildLikelyMiscodingCandidate(
        bankTransaction,
        glTransaction,
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
