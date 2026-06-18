import type {
  GroupedMatchResult,
  MatchCandidate,
  MatchDisposition,
  MatchResult,
  MatchingConfig,
  NormalizedTransaction,
  PayeeAlias,
} from '@recon/domain';
import { amountDifference, currencyEquals, dateDifferenceDays, tokenSimilarity } from './similarity';
import {
  reserveGroupedTransactionIds,
  type GroupedReservationCandidate,
} from './groupedReservations';

import { randomUUID } from 'node:crypto';

interface DuplicateFinding {
  duplicateTransactionIds: Set<string>;
}

const SHORT_CONTEXT_TOKEN_LIMIT = 2;
const ALIAS_PATTERN_MATCH_THRESHOLD = 0.5;

/**
 * For a bank transaction, finds the best-matching alias by comparing its
 * `normalizedTokens` against the bank's `normalizedComparisonTokens`.
 * Returns the alias and the canonical payee tokens when the pattern similarity
 * meets `ALIAS_PATTERN_MATCH_THRESHOLD`; otherwise returns null.
 */
const findMatchingAlias = (
  bankTokens: string[],
  aliases: PayeeAlias[],
): { alias: PayeeAlias; canonicalTokens: string[] } | null => {
  let bestAlias: PayeeAlias | null = null;
  let bestSimilarity = ALIAS_PATTERN_MATCH_THRESHOLD - Number.EPSILON;

  for (const alias of aliases) {
    if (!alias.isActive || alias.normalizedTokens.length === 0) {
      continue;
    }

    const similarity = tokenSimilarity(bankTokens, alias.normalizedTokens);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestAlias = alias;
    }
  }

  if (!bestAlias) {
    return null;
  }

  return {
    alias: bestAlias,
    canonicalTokens: bestAlias.canonicalPayeeName
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean),
  };
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

const buildGroupedMatchMembers = (
  transactions: Array<NormalizedTransaction & { amount: number }>,
): GroupedMatchResult['bankMembers'] =>
  transactions.map((transaction) => ({
    transactionId: transaction.id,
    source: transaction.source,
    spreadsheetFileName: transaction.spreadsheetFileName,
    lineNumber: transaction.lineNumber,
    amount: transaction.amount,
  }));

const createGroupedMatchResult = (
  candidate: GroupedReservationCandidate,
): GroupedMatchResult => ({
  id: randomUUID(),
  disposition: 'GroupedReviewMatch',
  confidence: 'Probable',
  category: candidate.category,
  bankTransactionIds: candidate.bankTransactionIds,
  qboTransactionIds: candidate.qboTransactionIds,
  bankMembers: buildGroupedMatchMembers(candidate.bankTransactions),
  qboMembers: buildGroupedMatchMembers(candidate.qboTransactions),
  totalAmount: candidate.bankTransactions.reduce((total, transaction) => total + transaction.amount, 0),
  dateDifferenceDays: candidate.dateDifferenceDays,
  score: candidate.score,
  ruleId: candidate.ruleId,
  ruleName: candidate.ruleName,
  reason: candidate.reason,
  evidence: candidate.evidence,
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
  aliases: PayeeAlias[] = [],
): MatchCandidate[] => {
  const candidates: MatchCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const qboAmountFrequency = buildAmountFrequency(qboTransactions);
  const amountDrivenMatching = config.textSimilarityThreshold <= 0.12;

  // Pre-compute per-bank alias hits once to avoid repeated scanning in the inner loop.
  const bankAliasHits = new Map<string, ReturnType<typeof findMatchingAlias>>();
  if (aliases.length > 0) {
    for (const bankTransaction of bankTransactions) {
      bankAliasHits.set(
        bankTransaction.id,
        findMatchingAlias(bankTransaction.normalizedComparisonTokens, aliases),
      );
    }
  }

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

      // When both sides carry a check number and reference similarity confirms the same check,
      // handle the amount-mismatch and extended-date cases before the generic Reference + Amount
      // Match rule so that check-specific evidence is preserved in the exception category.
      if (
        bankTransaction.checkNumber &&
        qboTransaction.checkNumber &&
        referenceSimilarity >= config.referenceSimilarityThreshold
      ) {
        if (!sameAmount && (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              qboTransaction,
              'Check Number Amount Mismatch',
              0.86,
              'AmountMismatch',
              [
                `Check #${bankTransaction.checkNumber} matches across both sources.`,
                'Recorded amounts differ beyond configured tolerance — likely a posting error or partial payment.',
              ],
              'CheckNumberMismatch',
            ),
          );
          continue;
        }

        if (
          sameAmount &&
          (dateDifference ?? Number.POSITIVE_INFINITY) > config.dateToleranceDays &&
          (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
        ) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              qboTransaction,
              'Check Number Date Variance',
              0.87,
              'DateVariance',
              [
                `Check #${bankTransaction.checkNumber} matches across both sources.`,
                'Amounts agree within configured tolerance.',
                'Posting date variance exceeds the primary window — check may have been recorded in a different period.',
              ],
              'DateVariance',
            ),
          );
          continue;
        }
      }

      if (sameAmount && referenceSimilarity >= config.referenceSimilarityThreshold) {
        candidates.push(
          buildCandidate(bankTransaction, qboTransaction, 'Reference + Amount Match', 1, 'Exact', [
            'Reference or check values align strongly.',
            'Amounts agree within configured tolerance.',
          ]),
        );
        continue;
      }

      const aliasHit = bankAliasHits.get(bankTransaction.id) ?? null;
      if (
        aliasHit &&
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
      ) {
        const aliasSimilarity = tokenSimilarity(aliasHit.canonicalTokens, qboTransaction.normalizedComparisonTokens);
        const effectiveSimilarity = aliasSimilarity * aliasHit.alias.matchConfidence;

        if (effectiveSimilarity >= config.textSimilarityThreshold) {
          const withinPrimaryWindow = (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays;
          candidates.push(
            buildCandidate(
              bankTransaction,
              qboTransaction,
              'Historical Pattern Match',
              withinPrimaryWindow ? 0.88 : 0.8,
              withinPrimaryWindow ? 'Exact' : 'DateVariance',
              [
                `Bank description matched learned alias "${aliasHit.alias.bankPattern}" → "${aliasHit.alias.canonicalPayeeName}".`,
                `Alias confidence ${(aliasHit.alias.matchConfidence * 100).toFixed(0)}%; effective similarity ${(effectiveSimilarity * 100).toFixed(0)}%.`,
                'Amounts agree within configured tolerance.',
              ],
              withinPrimaryWindow ? undefined : 'DateVariance',
            ),
          );
          continue;
        }
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

      // Wire Correspondent Fee: same direction, small absolute amount difference, strong text match.
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(qboTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        Math.abs(bankTransaction.amount - qboTransaction.amount) <= config.wireFeeTolerance &&
        textSimilarity >= config.textSimilarityThreshold
      ) {
        const feeDeducted = Math.abs(bankTransaction.amount - qboTransaction.amount);
        candidates.push(
          buildCandidate(
            bankTransaction,
            qboTransaction,
            'Wire Correspondent Fee Deduction',
            0.77,
            'AmountMismatch',
            [
              `Bank amount of ${bankTransaction.amount.toFixed(2)} and QBO amount of ${qboTransaction.amount.toFixed(2)} differ by ${feeDeducted.toFixed(2)}.`,
              'Amounts share the same sign and the difference is within the wire-fee tolerance, suggesting a correspondent bank or processing fee was deducted in transit.',
              'Reviewer should confirm against wire advice or settlement detail.',
            ],
            'AmountMismatch',
          ),
        );
        continue;
      }

      // FX Rate Variance: same direction, percentage amount difference 0.5%–15%, strong text match.
      const FX_VARIANCE_MIN_PCT = 0.005;
      const FX_VARIANCE_MAX_PCT = 0.15;
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(qboTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= config.textSimilarityThreshold
      ) {
        const larger = Math.max(Math.abs(bankTransaction.amount), Math.abs(qboTransaction.amount));
        const diffPct = larger > 0 ? Math.abs(bankTransaction.amount - qboTransaction.amount) / larger : 0;
        if (diffPct >= FX_VARIANCE_MIN_PCT && diffPct <= FX_VARIANCE_MAX_PCT) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              qboTransaction,
              'FX Rate Variance',
              0.74,
              'AmountMismatch',
              [
                `Bank amount of ${bankTransaction.amount.toFixed(2)} and QBO amount of ${qboTransaction.amount.toFixed(2)} differ by ${(diffPct * 100).toFixed(2)}%.`,
                'The percentage variance is consistent with a foreign exchange rate difference or a processing discount.',
                'Reviewer should confirm the FX rate or discount applied and record an adjusting entry if needed.',
              ],
              'AmountMismatch',
            ),
          );
          continue;
        }
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

/** All match output sets produced by a single `reconcileMatches` pass. */
export interface MatchEngineResult {
  matchResults: MatchResult[];
  groupedMatchResults: GroupedMatchResult[];
  probableMatches: MatchResult[];
  unmatchedBankTransactionIds: Set<string>;
  unmatchedQboTransactionIds: Set<string>;
  duplicateTransactionIds: Set<string>;
}

/**
 * Runs the full matching pipeline: exact matching, grouped/split matching, probable
 * matching, and duplicate detection. Returns all categorized match sets and unmatched ID
 * sets needed by the exception classifier and summary builder.
 *
 * @param aliases Optional payee alias table rows loaded from the database. When provided,
 *   the engine applies Historical Pattern Match for bank transactions whose description
 *   matches a known alias pattern, boosting match confidence where raw text similarity
 *   would otherwise be below threshold.
 */
export const reconcileMatches = (
  transactions: NormalizedTransaction[],
  config: MatchingConfig,
  aliases: PayeeAlias[] = [],
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

  const candidates = rankCandidates(remainingBank, remainingQbo, config, aliases);
  const exactMatchedBank = new Set<string>();
  const exactMatchedQbo = new Set<string>();
  const reviewedBank = new Set<string>();
  const reviewedQbo = new Set<string>();
  const groupedReservations = reserveGroupedTransactionIds(remainingBank, remainingQbo, config);
  const matchResults: MatchResult[] = [];
  const groupedMatchResults = groupedReservations.selectedCandidates.map(createGroupedMatchResult);
  const probableMatches: MatchResult[] = [];

  for (const candidate of candidates) {
    if (exactMatchedBank.has(candidate.bankTransactionId) || exactMatchedQbo.has(candidate.qboTransactionId)) {
      continue;
    }

    const isGroupedReserved =
      groupedReservations.reservedBankTransactionIds.has(candidate.bankTransactionId) ||
      groupedReservations.reservedQboTransactionIds.has(candidate.qboTransactionId);

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
      if (
        isGroupedReserved ||
        reviewedBank.has(candidate.bankTransactionId) ||
        reviewedQbo.has(candidate.qboTransactionId)
      ) {
        continue;
      }

      const ambiguousResult = createMatchResult(
        candidate,
        'AmbiguousReview',
        'AmbiguousMatchRequiringReview',
      );
      probableMatches.push(ambiguousResult);
      matchResults.push(ambiguousResult);
      reviewedBank.add(candidate.bankTransactionId);
      reviewedQbo.add(candidate.qboTransactionId);
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
      // Preserve a more specific exception category (e.g. CheckNumberMismatch) if the
      // rule already set one; fall back to the generic AmountMismatch only when unset.
      exceptionCategory = candidate.exceptionCategory ?? 'AmountMismatch';
    }

    const result = createMatchResult(candidate, disposition, exceptionCategory);
    if (disposition === 'ExactMatch') {
      matchResults.push(result);
      exactMatchedBank.add(candidate.bankTransactionId);
      exactMatchedQbo.add(candidate.qboTransactionId);
      continue;
    }

    if (
      isGroupedReserved ||
      reviewedBank.has(candidate.bankTransactionId) ||
      reviewedQbo.has(candidate.qboTransactionId)
    ) {
      continue;
    }

    if (disposition === 'ProbableMatch') {
      probableMatches.push(result);
    }
    matchResults.push(result);
    reviewedBank.add(candidate.bankTransactionId);
    reviewedQbo.add(candidate.qboTransactionId);
  }

  return {
    matchResults,
    groupedMatchResults,
    probableMatches,
    unmatchedBankTransactionIds: new Set(
      remainingBank.filter((transaction) => !exactMatchedBank.has(transaction.id)).map((transaction) => transaction.id),
    ),
    unmatchedQboTransactionIds: new Set(
      remainingQbo.filter((transaction) => !exactMatchedQbo.has(transaction.id)).map((transaction) => transaction.id),
    ),
    duplicateTransactionIds: duplicateIds,
  };
};
