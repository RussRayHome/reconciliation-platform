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
import {
  areGroupedTransactionsCompatible,
  areTimingKindsCompatible,
  buildAmountFrequency,
  calculateGroupedDateDifference,
  formatKinds,
  generateTransactionCombinations,
  inferTransactionKind,
  isCheckLikeQboTransaction,
  isDepositLikeKind,
  mergeComparisonTokens,
  mergeReferenceTokens,
  parseIsoDate,
  sumTransactionAmounts,
} from './exceptionClassifierUtils';

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

const advisoryReviewCategoriesExcludedFromResidualStages = new Set<ExceptionItem['category']>([
  'AmountMismatch',
  'CheckNumberMismatch',
  'ReferenceNumberMismatch',
  'DescriptionMerchantVariance',
  'AmbiguousMatchRequiringReview',
]);

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

const buildMiscodingThresholds = (matching: MatchingConfig): MiscodingThresholds => ({
  textSimilarityMax: Math.min(0.35, Math.max(0.15, matching.probableTextSimilarityThreshold / 2)),
  referenceSimilarityMax: Math.min(0.5, matching.referenceSimilarityThreshold / 2),
});

const buildGroupedCandidateCategory = (
  bankTransactions: Array<NormalizedTransaction & { amount: number }>,
  qboTransactions: Array<NormalizedTransaction & { amount: number }>,
): GroupedResidualCandidate['category'] => {
  const bankTotal = sumTransactionAmounts(bankTransactions);
  const qboTotal = sumTransactionAmounts(qboTransactions);
  const allKinds = [...bankTransactions, ...qboTransactions].map((transaction) =>
    inferTransactionKind(transaction),
  );

  if (bankTotal > 0 && qboTotal > 0 && allKinds.every((kind) => isDepositLikeKind(kind))) {
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
        `${transaction.source.toUpperCase()} line ${transaction.lineNumber} (${transaction.amount.toFixed(2)})`,
    )
    .join(', ');

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
      `Bank total is ${bankTotal.toFixed(2)} across ${bankTransactions.length} line(s); QBO total is ${qboTotal.toFixed(2)} across ${qboTransactions.length} line(s).`,
      `Maximum cross-source date difference is ${dateDifference} day(s).`,
      `Observed transaction kinds are bank=${bankKinds} and qbo=${qboKinds}.`,
      `Narrative similarity score is ${textSimilarity.toFixed(2)} and reference similarity score is ${referenceSimilarity.toFixed(2)}.`,
      `Bank members: ${describeTransactionGroup(bankTransactions)}.`,
      `QBO members: ${describeTransactionGroup(qboTransactions)}.`,
    ],
    bankTransactions,
    qboTransactions,
    relatedTransactionIds: [...bankTransactions, ...qboTransactions].map(
      (transaction) => transaction.id,
    ),
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

const findGroupedResidualCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  matching: MatchingConfig,
): GroupedResidualCandidate[] => {
  const candidates: GroupedResidualCandidate[] = [];
  const bankResiduals = bankTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );
  const qboResiduals = qboTransactions.filter(
    (transaction): transaction is NormalizedTransaction & { amount: number } =>
      transaction.amount !== null,
  );

  for (const bankTransaction of bankResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(bankTransaction, qboResiduals, matching);
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

  for (const qboTransaction of qboResiduals) {
    const counterpartPool = collectGroupedCounterpartPool(qboTransaction, bankResiduals, matching);
    const combinations = generateTransactionCombinations(
      counterpartPool,
      2,
      matching.groupedMatchMaxSize,
    );

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

      const candidate = buildTimingDifferenceCandidate(bankTransaction, qboTransaction, matching);

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
      reason:
        'A same-amount, near-date counterpart exists, but the descriptive or reference context conflicts materially.',
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
      reason:
        'A same-amount, timing-compatible counterpart exists outside the primary date tolerance but within the timing-difference window.',
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
  relatedTransactionIds: string[];
  sourceTrace: {
    ruleId: string | undefined;
    ruleName: string;
    reason: string | undefined;
    evidence: string[];
  };
  derivedTrace: {
    ruleId: string | undefined;
    ruleName: string;
    reason: string | undefined;
    evidence: string[];
  };
}

const resolveMatchResultCategory = (params: {
  result: MatchResult;
  bankTransaction?: NormalizedTransaction;
  qboTransaction?: NormalizedTransaction;
  matching: MatchingConfig;
  miscodingThresholds: MiscodingThresholds;
}): {
  resultCategory?: ExceptionItem['category'];
  matchedMiscodingCandidate?: MiscodingCandidate;
  matchedTimingDifferenceCandidate?: TimingDifferenceCandidate;
} => {
  const { result, bankTransaction, qboTransaction, matching, miscodingThresholds } = params;
  let resultCategory: ExceptionItem['category'] | undefined = result.exceptionCategory;

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
  };
};

const buildMatchResultClassification = (params: {
  result: MatchResult;
  transactionById: Map<string, NormalizedTransaction>;
  matching: MatchingConfig;
  miscodingThresholds: MiscodingThresholds;
}): MatchResultClassification | undefined => {
  const { result, transactionById, matching, miscodingThresholds } = params;
  const bankTransaction = result.bankTransactionId
    ? transactionById.get(result.bankTransactionId)
    : undefined;
  const qboTransaction = result.qboTransactionId
    ? transactionById.get(result.qboTransactionId)
    : undefined;
  const categoryResolution = resolveMatchResultCategory({
    result,
    bankTransaction,
    qboTransaction,
    matching,
    miscodingThresholds,
  });

  if (!categoryResolution.resultCategory) {
    return undefined;
  }

  if (!bankTransaction && !qboTransaction) {
    return undefined;
  }

  return {
    bankTransaction,
    qboTransaction,
    resultCategory: categoryResolution.resultCategory,
    matchedMiscodingCandidate: categoryResolution.matchedMiscodingCandidate,
    matchedTimingDifferenceCandidate: categoryResolution.matchedTimingDifferenceCandidate,
    relatedTransactionIds: [result.bankTransactionId, result.qboTransactionId].filter(
      Boolean,
    ) as string[],
    sourceTrace: {
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      reason: result.reason,
      evidence: result.evidence,
    },
    derivedTrace: buildDerivedMatchTrace(
      result,
      categoryResolution.matchedMiscodingCandidate,
      categoryResolution.matchedTimingDifferenceCandidate,
    ),
  };
};

const buildMatchResultTargets = (
  classification: MatchResultClassification,
): Array<{ target: NormalizedTransaction; counterpart?: NormalizedTransaction }> => {
  const { bankTransaction, qboTransaction, resultCategory } = classification;

  if (
    (resultCategory === 'TimingDifference' || resultCategory === 'LikelyMiscoding') &&
    bankTransaction &&
    qboTransaction
  ) {
    return [
      { target: bankTransaction, counterpart: qboTransaction },
      { target: qboTransaction, counterpart: bankTransaction },
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
    Boolean(
      bankTransaction.checkNumber ||
      bankTransaction.referenceNumber ||
      qboTransaction.checkNumber ||
      qboTransaction.referenceNumber,
    ) ||
    bankTransaction.normalizedReferenceTokens.length > 0 ||
    qboTransaction.normalizedReferenceTokens.length > 0;
  const hasNarrativeContext =
    bankTransaction.normalizedComparisonTokens.length > 0 &&
    qboTransaction.normalizedComparisonTokens.length > 0;
  const conflictingNarrative =
    hasNarrativeContext && textSimilarity <= thresholds.textSimilarityMax;
  const conflictingReference =
    hasReferenceContext && referenceSimilarity <= thresholds.referenceSimilarityMax;

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

const createException = (params: {
  runId: string;
  transaction: NormalizedTransaction;
  category: ExceptionItem['category'];
  reporting: ReportingConfig;
  relatedTransactionIds?: string[];
  likelyMatchingReference?: string;
  matchConfidence?: ExceptionItem['matchConfidence'];
  ruleTrace?: ExceptionRuleTrace;
  priorRuleTraces?: ExceptionItem['priorRuleTraces'];
  customMessage?: string;
}): ExceptionItem => ({
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
  priorRuleTraces: params.priorRuleTraces,
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

const buildCounterpartTraces = (
  counterparts: Array<NormalizedTransaction | undefined>,
): CounterpartTrace[] => {
  const traces = counterparts
    .map((counterpart) => buildCounterpartTrace(counterpart, counterpart?.id))
    .filter((trace): trace is CounterpartTrace => trace !== undefined);

  return traces.filter(
    (trace, index) =>
      traces.findIndex(
        (candidate) =>
          candidate.transactionId === trace.transactionId &&
          candidate.source === trace.source &&
          candidate.spreadsheetFileName === trace.spreadsheetFileName &&
          candidate.lineNumber === trace.lineNumber,
      ) === index,
  );
};

const buildExceptionRuleTrace = (
  ruleId: string,
  ruleName: string,
  reason: string,
  evidence: string[],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace => ({
  ruleId,
  ruleName,
  reason,
  evidence,
  counterpart,
  counterparts: counterparts?.length || !counterpart ? counterparts : [counterpart],
});

const buildPriorRuleTraces = (
  sourceTrace: MatchResultClassification['sourceTrace'],
  derivedTrace: MatchResultClassification['derivedTrace'],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace[] | undefined => {
  if (!sourceTrace.ruleId || !sourceTrace.reason) {
    return undefined;
  }

  const isSameTrace =
    sourceTrace.ruleId === derivedTrace.ruleId &&
    sourceTrace.ruleName === derivedTrace.ruleName &&
    sourceTrace.reason === derivedTrace.reason &&
    sourceTrace.evidence.length === derivedTrace.evidence.length &&
    sourceTrace.evidence.every((entry, index) => entry === derivedTrace.evidence[index]);

  if (isSameTrace) {
    return undefined;
  }

  return [
    buildExceptionRuleTrace(
      sourceTrace.ruleId,
      sourceTrace.ruleName,
      sourceTrace.reason,
      sourceTrace.evidence,
      counterpart,
      counterparts,
    ),
  ];
};

type UpsertTransactionException = (
  transaction: NormalizedTransaction,
  build: () => ExceptionItem,
) => void;

interface ResidualStageParams {
  runId: string;
  reporting: ReportingConfig;
  matching: MatchingConfig;
  matchResults: MatchResult[];
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
  [...transactionIds]
    .map((transactionId) => transactionById.get(transactionId))
    .filter(Boolean) as NormalizedTransaction[];

const findMatchResultByPair = (
  matchResults: MatchResult[],
  bankTransactionId: string,
  qboTransactionId: string,
): MatchResult | undefined =>
  matchResults.find(
    (result) =>
      result.bankTransactionId === bankTransactionId &&
      result.qboTransactionId === qboTransactionId,
  );

const buildPriorRuleTracesFromMatchResult = (
  result: MatchResult | undefined,
  derivedTrace: MatchResultClassification['derivedTrace'],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace[] | undefined => {
  if (!result) {
    return undefined;
  }

  return buildPriorRuleTraces(
    {
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      reason: result.reason,
      evidence: result.evidence,
    },
    derivedTrace,
    counterpart,
    counterparts,
  );
};

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

const classifyStaleOutstandingChecksStage = (params: ResidualStageParams): Set<string> => {
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

    const ageInDays = Math.floor(
      (reconciliationAnchorDate.getTime() - transactionDate.getTime()) / 86400000,
    );
    if (ageInDays < params.matching.staleOutstandingCheckDays) {
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
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedQbo,
    upsertTransactionException,
  } = params;
  const miscodingCandidates = findLikelyMiscodingCandidates(
    getTransactionsByIds(remainingUnmatchedBank, transactionById),
    getTransactionsByIds(
      [...remainingUnmatchedQbo].filter(
        (transactionId) => !staleOutstandingQboIds.has(transactionId),
      ),
      transactionById,
    ),
    matching,
  );
  const miscodingThresholds = buildMiscodingThresholds(matching);
  const miscodingBankIds = new Set<string>();
  const miscodingQboIds = new Set<string>();

  miscodingCandidates.forEach((candidate) => {
    if (
      miscodingBankIds.has(candidate.bankTransaction.id) ||
      miscodingQboIds.has(candidate.qboTransaction.id)
    ) {
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
  groupedBankIds: Set<string>,
  groupedQboIds: Set<string>,
): {
  timingBankIds: Set<string>;
  timingQboIds: Set<string>;
} => {
  const {
    runId,
    reporting,
    matching,
    matchResults,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedQbo,
    upsertTransactionException,
  } = params;
  const residualTimingCandidates = findResidualTimingDifferenceCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank]
        .filter((transactionId) => !miscodingBankIds.has(transactionId))
        .filter((transactionId) => !groupedBankIds.has(transactionId)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedQbo]
        .filter((transactionId) => !staleOutstandingQboIds.has(transactionId))
        .filter((transactionId) => !miscodingQboIds.has(transactionId))
        .filter((transactionId) => !groupedQboIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const timingBankIds = new Set<string>();
  const timingQboIds = new Set<string>();

  residualTimingCandidates.forEach((candidate) => {
    if (
      timingBankIds.has(candidate.bankTransaction.id) ||
      timingQboIds.has(candidate.qboTransaction.id)
    ) {
      return;
    }

    const sharedEvidence = [
      'Same-amount residual transactions remained unmatched after exact and review matching.',
      `Date difference is ${candidate.dateDifference} day(s), which is outside the primary tolerance and within the timing-difference window.`,
      `Narrative similarity score is ${candidate.textSimilarity.toFixed(2)} and reference similarity score is ${candidate.referenceSimilarity.toFixed(2)}.`,
      `Transaction kinds remain timing-compatible: bank=${inferTransactionKind(candidate.bankTransaction)}, qbo=${inferTransactionKind(candidate.qboTransaction)}.`,
    ];
    const qboCounterpartTrace = buildCounterpartTrace(
      candidate.qboTransaction,
      candidate.qboTransaction.id,
    );
    const bankCounterpartTrace = buildCounterpartTrace(
      candidate.bankTransaction,
      candidate.bankTransaction.id,
    );
    const derivedTrace = {
      ruleId: 'residual-timing-difference',
      ruleName: 'Residual Timing Difference',
      reason:
        'A same-amount, timing-compatible transaction remained in the residual pool within the extended timing window.',
      evidence: sharedEvidence,
    };
    const sourceMatchResult = findMatchResultByPair(
      matchResults,
      candidate.bankTransaction.id,
      candidate.qboTransaction.id,
    );

    upsertTransactionException(candidate.bankTransaction, () =>
      createException({
        runId,
        transaction: candidate.bankTransaction,
        category: 'TimingDifference',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.qboTransaction.id],
        likelyMatchingReference: candidate.qboTransaction.id,
        matchConfidence: 'TimingDifference',
        priorRuleTraces: buildPriorRuleTracesFromMatchResult(
          sourceMatchResult,
          derivedTrace,
          qboCounterpartTrace,
        ),
        ruleTrace: buildExceptionRuleTrace(
          'residual-timing-difference',
          'Residual Timing Difference',
          'A same-amount, timing-compatible QBO transaction remains unmatched within the extended timing window.',
          sharedEvidence,
          qboCounterpartTrace,
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
        priorRuleTraces: buildPriorRuleTracesFromMatchResult(
          sourceMatchResult,
          derivedTrace,
          bankCounterpartTrace,
        ),
        ruleTrace: buildExceptionRuleTrace(
          'residual-timing-difference',
          'Residual Timing Difference',
          'A same-amount, timing-compatible bank transaction remains unmatched within the extended timing window.',
          sharedEvidence,
          bankCounterpartTrace,
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
  stageState: Pick<
    ResidualStageState,
    | 'staleOutstandingQboIds'
    | 'miscodingBankIds'
    | 'miscodingQboIds'
    | 'timingBankIds'
    | 'timingQboIds'
  >,
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
      const counterpartTraces = buildCounterpartTraces(counterparts);

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
            counterpartTraces,
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
  stageState: Pick<
    ResidualStageState,
    | 'staleOutstandingQboIds'
    | 'miscodingBankIds'
    | 'miscodingQboIds'
    | 'timingBankIds'
    | 'timingQboIds'
    | 'groupedBankIds'
    | 'groupedQboIds'
  >,
): void => {
  const {
    runId,
    reporting,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedQbo,
    upsertTransactionException,
  } = params;

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
  const groupedStage = classifyGroupedStage(params, {
    staleOutstandingQboIds,
    miscodingBankIds: miscodingStage.miscodingBankIds,
    miscodingQboIds: miscodingStage.miscodingQboIds,
    timingBankIds: new Set<string>(),
    timingQboIds: new Set<string>(),
  });
  const timingStage = classifyTimingStage(
    params,
    staleOutstandingQboIds,
    miscodingStage.miscodingBankIds,
    miscodingStage.miscodingQboIds,
    groupedStage.groupedBankIds,
    groupedStage.groupedQboIds,
  );

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
  const transactionById = new Map(
    normalizedTransactions.map((transaction) => [transaction.id, transaction]),
  );
  const exceptions: ExceptionItem[] = [];
  const reviewerObservations: ReviewerObservation[] = [];
  const exceptionIndexByTransactionKey = new Map<string, number>();

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
            transaction.source === 'bank'
              ? 'Duplicate Detection in Bank'
              : 'Duplicate Detection in QBO',
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

  const advisoryProtectedBankIds = new Set(
    matchResults
      .filter(
        (result) =>
          result.bankTransactionId &&
          result.exceptionCategory &&
          advisoryReviewCategoriesExcludedFromResidualStages.has(result.exceptionCategory),
      )
      .map((result) => result.bankTransactionId as string),
  );
  const advisoryProtectedQboIds = new Set(
    matchResults
      .filter(
        (result) =>
          result.qboTransactionId &&
          result.exceptionCategory &&
          advisoryReviewCategoriesExcludedFromResidualStages.has(result.exceptionCategory),
      )
      .map((result) => result.qboTransactionId as string),
  );

  const remainingUnmatchedBank = new Set(
    [...unmatchedBankTransactionIds].filter(
      (transactionId) => !advisoryProtectedBankIds.has(transactionId),
    ),
  );
  const remainingUnmatchedQbo = new Set(
    [...unmatchedQboTransactionIds].filter(
      (transactionId) => !advisoryProtectedQboIds.has(transactionId),
    ),
  );
  const residualStageState = classifyResidualStages({
    runId,
    reporting,
    matching,
    matchResults,
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
    });

    if (!classification) {
      return;
    }

    buildMatchResultTargets(classification).forEach(({ target, counterpart }) => {
      const primaryCounterpart = buildCounterpartTrace(counterpart, counterpart?.id);
      const counterpartTraces = primaryCounterpart ? [primaryCounterpart] : undefined;

      upsertTransactionException(target, () =>
        createException({
          runId,
          transaction: target,
          category: classification.resultCategory,
          reporting,
          relatedTransactionIds: classification.relatedTransactionIds,
          likelyMatchingReference: counterpart?.id,
          matchConfidence: result.confidence,
          priorRuleTraces: buildPriorRuleTraces(
            classification.sourceTrace,
            classification.derivedTrace,
            primaryCounterpart,
            counterpartTraces,
          ),
          ruleTrace:
            classification.derivedTrace.ruleId && classification.derivedTrace.reason
              ? buildExceptionRuleTrace(
                  classification.derivedTrace.ruleId,
                  classification.derivedTrace.ruleName,
                  classification.derivedTrace.reason,
                  classification.derivedTrace.evidence,
                  primaryCounterpart,
                  counterpartTraces,
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
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
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
