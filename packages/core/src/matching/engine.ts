import type {
  MatchCandidate,
  MatchDisposition,
  MatchResult,
  MatchingConfig,
  NormalizedTransaction,
} from '@recon/domain';
import { amountDifference, currencyEquals, dateDifferenceDays, tokenSimilarity } from './similarity';

import { randomUUID } from 'node:crypto';

interface DuplicateFinding {
  duplicateTransactionIds: Set<string>;
}

const SHORT_CONTEXT_TOKEN_LIMIT = 2;

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

const parseIsoDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const isMonthEndDate = (value?: string): boolean => {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return false;
  }

  const month = parsed.getUTCMonth();
  const next = new Date(Date.UTC(parsed.getUTCFullYear(), month, parsed.getUTCDate() + 1));
  return next.getUTCMonth() !== month;
};

const includesText = (value: string | undefined, fragment: string): boolean =>
  Boolean(value?.toLowerCase().includes(fragment));

const isMonthEndTransferProbable = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
  dateDifference: number | null,
): boolean => {
  if (dateDifference === null || dateDifference < 3 || dateDifference > 31) {
    return false;
  }

  if (!includesText(bankTransaction.description, 'online from')) {
    return false;
  }

  if ((qboTransaction.transactionType ?? '').toLowerCase() !== 'journal entry') {
    return false;
  }

  if (!includesText(qboTransaction.description, 'money transfers')) {
    return false;
  }

  const bankDateValue = bankTransaction.transactionDate ?? bankTransaction.postingDate;
  const qboDateValue = qboTransaction.transactionDate ?? qboTransaction.postingDate;
  const bankDate = parseIsoDate(bankDateValue);
  const qboDate = parseIsoDate(qboDateValue);

  if (!bankDate || !qboDate || !isMonthEndDate(qboDateValue)) {
    return false;
  }

  return qboDate >= bankDate &&
    bankDate.getUTCFullYear() === qboDate.getUTCFullYear() &&
    bankDate.getUTCMonth() === qboDate.getUTCMonth();
};

const isDistinctiveShortContextExactMatch = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
  bankAmountFrequency: Map<number, number>,
  qboAmountFrequency: Map<number, number>,
): boolean => {
  if (bankTransaction.amount === null) {
    return false;
  }

  return (bankAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
    (qboAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
    qboTransaction.normalizedComparisonTokens.length <= SHORT_CONTEXT_TOKEN_LIMIT;
};

const buildCandidate = (
  bankTransaction: NormalizedTransaction,
  qboTransaction: NormalizedTransaction,
  ruleName: string,
  score: number,
  confidence: MatchCandidate['confidence'],
  evidence: string[],
  exceptionCategory?: MatchCandidate['exceptionCategory'],
): MatchCandidate => {
  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    qboTransaction.transactionDate ?? qboTransaction.postingDate,
  );
  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    qboTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    qboTransaction.normalizedReferenceTokens,
  );

  return {
    bankTransactionId: bankTransaction.id,
    qboTransactionId: qboTransaction.id,
    confidence,
    exceptionCategory,
    score,
    ruleName,
    dateDifferenceDays: dateDifference,
    amountDifference: amountDifference(bankTransaction.amount, qboTransaction.amount),
    textSimilarity,
    referenceSimilarity,
    evidence,
    evaluations: [
      {
        ruleId: ruleName.toLowerCase().replaceAll(/\s+/g, '-'),
        ruleName,
        passed: true,
        score,
        reason: evidence.join(' '),
        evidence,
        candidateTransactionId: qboTransaction.id,
      },
    ],
  };
};

const createMatchResult = (
  candidate: MatchCandidate,
  disposition: MatchDisposition,
  exceptionCategory?: MatchResult['exceptionCategory'],
): MatchResult => ({
  id: randomUUID(),
  disposition,
  confidence: candidate.confidence,
  ruleId: candidate.evaluations[0]?.ruleId,
  ruleName: candidate.ruleName,
  reason: candidate.evaluations[0]?.reason ?? candidate.evidence.join(' '),
  score: candidate.score,
  bankTransactionId: candidate.bankTransactionId,
  qboTransactionId: candidate.qboTransactionId,
  dateDifferenceDays: candidate.dateDifferenceDays,
  amountDifference: candidate.amountDifference,
  evidence: candidate.evidence,
  likelyMatchingReference: candidate.qboTransactionId,
  exceptionCategory,
});

const detectDuplicates = (
  transactions: NormalizedTransaction[],
  config: MatchingConfig,
): DuplicateFinding => {
  const duplicateIds = new Set<string>();
  const sorted = [...transactions].sort((left, right) => left.lineNumber - right.lineNumber);

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current) {
      continue;
    }

    if (duplicateIds.has(current.id) || current.amount === null) {
      continue;
    }

    for (let comparisonIndex = index + 1; comparisonIndex < sorted.length; comparisonIndex += 1) {
      const comparison = sorted[comparisonIndex];
      if (!comparison) {
        continue;
      }

      if (comparison.amount === null || duplicateIds.has(comparison.id)) {
        continue;
      }

      const sameAmount = currencyEquals(current.amount, comparison.amount, config.amountTolerance);
      const dateDifference = dateDifferenceDays(
        current.transactionDate ?? current.postingDate,
        comparison.transactionDate ?? comparison.postingDate,
      );
      const similarity = tokenSimilarity(
        current.normalizedComparisonTokens,
        comparison.normalizedComparisonTokens,
      );
      const referenceSimilarity = tokenSimilarity(
        current.normalizedReferenceTokens,
        comparison.normalizedReferenceTokens,
      );

      if (
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.duplicateDateWindowDays &&
        (similarity >= config.duplicateSimilarityThreshold || referenceSimilarity >= 1)
      ) {
        duplicateIds.add(comparison.id);
      }
    }
  }

  return {
    duplicateTransactionIds: duplicateIds,
  };
};

const rankCandidates = (
  bankTransactions: NormalizedTransaction[],
  qboTransactions: NormalizedTransaction[],
  config: MatchingConfig,
): MatchCandidate[] => {
  const candidates: MatchCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const qboAmountFrequency = buildAmountFrequency(qboTransactions);
  const amountDrivenMatching = config.textSimilarityThreshold <= 0.12;

  for (const bankTransaction of bankTransactions) {
    for (const qboTransaction of qboTransactions) {
      if (bankTransaction.amount === null || qboTransaction.amount === null) {
        continue;
      }

      const sameAmount = currencyEquals(bankTransaction.amount, qboTransaction.amount, config.amountTolerance);
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        qboTransaction.transactionDate ?? qboTransaction.postingDate,
      );
      const textSimilarity = tokenSimilarity(
        bankTransaction.normalizedComparisonTokens,
        qboTransaction.normalizedComparisonTokens,
      );
      const referenceSimilarity = tokenSimilarity(
        bankTransaction.normalizedReferenceTokens,
        qboTransaction.normalizedReferenceTokens,
      );
      const hasCheckOrReferenceValues =
        Boolean(bankTransaction.checkNumber || qboTransaction.checkNumber) ||
        Boolean(bankTransaction.referenceNumber || qboTransaction.referenceNumber) ||
        (bankTransaction.normalizedReferenceTokens.length > 0 && qboTransaction.normalizedReferenceTokens.length > 0);

      const referenceMismatchCategory: MatchCandidate['exceptionCategory'] =
        bankTransaction.checkNumber || qboTransaction.checkNumber
          ? 'CheckNumberMismatch'
          : 'ReferenceNumberMismatch';
      const lowContextExactMatch =
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity === 0 &&
        isDistinctiveShortContextExactMatch(
          bankTransaction,
          qboTransaction,
          bankAmountFrequency,
          qboAmountFrequency,
        );
      const reviewSimilarityThreshold = Math.min(config.probableTextSimilarityThreshold, 0.4);

      if (sameAmount && referenceSimilarity >= config.referenceSimilarityThreshold) {
        candidates.push(
          buildCandidate(bankTransaction, qboTransaction, 'Reference + Amount Match', 1, 'Exact', [
            'Reference or check values align strongly.',
            'Amounts agree within configured tolerance.',
          ]),
        );
        continue;
      }

      if (sameAmount && isMonthEndTransferProbable(bankTransaction, qboTransaction, dateDifference)) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            qboTransaction,
            'Month-End Transfer Review Match',
            0.79,
            'Probable',
            [
              'Bank-side incoming transfer aligns to a same-month month-end journal entry.',
              'Reviewer confirmation is needed for the month-end transfer booking pattern.',
            ],
            'TimingDifference',
          ),
        );
        continue;
      }

      if (
        !amountDrivenMatching &&
        sameAmount &&
        hasCheckOrReferenceValues &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= config.textSimilarityThreshold &&
        referenceSimilarity < config.referenceSimilarityThreshold
      ) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            qboTransaction,
            'Amount + Date + Text with Reference Variance',
            0.78,
            'Probable',
            [
              'Amounts agree and narrative context appears materially related.',
              'Reference or check values differ and require reviewer validation.',
            ],
            referenceMismatchCategory,
          ),
        );
        continue;
      }

      if (
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        (!hasCheckOrReferenceValues ||
          referenceSimilarity >= config.referenceSimilarityThreshold) &&
        (textSimilarity >= config.textSimilarityThreshold || lowContextExactMatch)
      ) {
        candidates.push(
          buildCandidate(bankTransaction, qboTransaction, 'Amount + Date + Text Match', 0.93, 'Exact', [
            'Amounts agree within configured tolerance.',
            'Dates fall within the primary tolerance window.',
            'Merchant, payee, or description tokens align strongly.',
          ]),
        );
        continue;
      }

      if (
        !amountDrivenMatching &&
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= reviewSimilarityThreshold &&
        textSimilarity < config.textSimilarityThreshold
      ) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            qboTransaction,
            'Amount + Date with Description Variance',
            0.72,
            'Probable',
            [
              'Amounts align and dates are close, but description or merchant context still needs review.',
              'Reviewer confirmation is required before the match can be treated as exact.',
            ],
            'DescriptionMerchantVariance',
          ),
        );
        continue;
      }

      if (
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
      ) {
        candidates.push(
          buildCandidate(bankTransaction, qboTransaction, 'Amount + Extended Date Window Match', 0.82, 'DateVariance', [
            'Amounts agree within configured tolerance.',
            'Date variance remains outside the primary tolerance but inside the extended review window.',
          ], 'DateVariance'),
        );
        continue;
      }

      if (
        !sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= config.amountMismatchTextSimilarityThreshold
      ) {
        candidates.push(
          buildCandidate(bankTransaction, qboTransaction, 'Possible Amount Mismatch', 0.7, 'AmountMismatch', [
            'Dates and narrative context indicate likely related transactions.',
            'Recorded amounts differ beyond configured tolerance.',
          ]),
        );
      }

    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

export interface MatchEngineResult {
  matchResults: MatchResult[];
  probableMatches: MatchResult[];
  unmatchedBankTransactionIds: Set<string>;
  unmatchedQboTransactionIds: Set<string>;
  duplicateTransactionIds: Set<string>;
}

export const reconcileMatches = (
  transactions: NormalizedTransaction[],
  config: MatchingConfig,
): MatchEngineResult => {
  const activeTransactions = transactions.filter(
    (transaction) => !transaction.isExcluded && transaction.dataQualityIssues.length === 0,
  );
  const bankTransactions = activeTransactions.filter((transaction) => transaction.source === 'bank');
  const qboTransactions = activeTransactions.filter((transaction) => transaction.source === 'qbo');

  const duplicateBank = detectDuplicates(bankTransactions, config);
  const duplicateQbo = detectDuplicates(qboTransactions, config);
  const duplicateIds = new Set<string>([
    ...duplicateBank.duplicateTransactionIds,
    ...duplicateQbo.duplicateTransactionIds,
  ]);

  const remainingBank = bankTransactions.filter((transaction) => !duplicateIds.has(transaction.id));
  const remainingQbo = qboTransactions.filter((transaction) => !duplicateIds.has(transaction.id));

  const candidates = rankCandidates(remainingBank, remainingQbo, config);
  const matchedBank = new Set<string>();
  const matchedQbo = new Set<string>();
  const matchResults: MatchResult[] = [];
  const probableMatches: MatchResult[] = [];

  for (const candidate of candidates) {
    if (matchedBank.has(candidate.bankTransactionId) || matchedQbo.has(candidate.qboTransactionId)) {
      continue;
    }

    const siblingCandidates = candidates.filter(
      (item) =>
        item.bankTransactionId === candidate.bankTransactionId ||
        item.qboTransactionId === candidate.qboTransactionId,
    );
    const topScore = siblingCandidates[0]?.score ?? candidate.score;
    const closeAlternatives = siblingCandidates.filter((item) => topScore - item.score < 0.1);

    if (
      config.textSimilarityThreshold > 0.12 &&
      closeAlternatives.length > 1 &&
      candidate.score < 0.95 &&
      candidate.referenceSimilarity < config.referenceSimilarityThreshold
    ) {
      const ambiguousResult = createMatchResult(
        candidate,
        'AmbiguousReview',
        'AmbiguousMatchRequiringReview',
      );
      probableMatches.push(ambiguousResult);
      matchResults.push(ambiguousResult);
      matchedBank.add(candidate.bankTransactionId);
      matchedQbo.add(candidate.qboTransactionId);
      continue;
    }

    let disposition: MatchDisposition = 'ProbableMatch';
    let exceptionCategory: MatchResult['exceptionCategory'] = candidate.exceptionCategory;

    if (candidate.confidence === 'Exact') {
      disposition = 'ExactMatch';
    } else if (candidate.confidence === 'DateVariance') {
      disposition = 'DateVariance';
      exceptionCategory = 'DateVariance';
    } else if (candidate.confidence === 'TimingDifference') {
      disposition = 'TimingDifference';
      exceptionCategory = 'TimingDifference';
    } else if (candidate.confidence === 'AmountMismatch') {
      disposition = 'AmountMismatch';
      exceptionCategory = 'AmountMismatch';
    }

    const result = createMatchResult(candidate, disposition, exceptionCategory);
    if (disposition === 'ProbableMatch') {
      probableMatches.push(result);
    }
    matchResults.push(result);
    matchedBank.add(candidate.bankTransactionId);
    matchedQbo.add(candidate.qboTransactionId);
  }

  return {
    matchResults,
    probableMatches,
    unmatchedBankTransactionIds: new Set(
      remainingBank.filter((transaction) => !matchedBank.has(transaction.id)).map((transaction) => transaction.id),
    ),
    unmatchedQboTransactionIds: new Set(
      remainingQbo.filter((transaction) => !matchedQbo.has(transaction.id)).map((transaction) => transaction.id),
    ),
    duplicateTransactionIds: duplicateIds,
  };
};
