import type {
  GroupedMatchResult,
  MatchCandidate,
  MatchDisposition,
  MatchResult,
  MatchingConfig,
  NormalizedTransaction,
  PayeeAlias,
} from '@recon/domain';
import {
  amountDifference,
  currencyEquals,
  dateDifferenceDays,
  describeTokenSimilarity,
  tokenSimilarity,
} from './similarity';
import {
  reserveGroupedTransactionIds,
  type GroupedReservationCandidate,
} from './groupedReservations';

import { randomUUID } from 'node:crypto';

interface DuplicateFinding {
  duplicateTransactionIds: Set<string>;
}

/**
 * Every one-to-one match rule name `buildCandidate` can attach to a `MatchCandidate`. `ruleName`
 * below is typed against this union, so a new literal used at a call site without being added
 * here fails typecheck — the same guarantee `ruleCatalog.ts` relies on to stay complete.
 */
export const MATCHING_RULE_NAMES = [
  'Check Number Amount Mismatch',
  'Check Number Date Variance',
  'Reference + Amount Match',
  'Reference Match with Amount Variance',
  'Historical Pattern Match',
  'Month-End Transfer Review Match',
  'Amount + Date + Text with Reference Variance',
  'Amount + Date + Text Match',
  'Amount + Date with Description Variance',
  'Amount + Date Match, Weak Description',
  'Amount + Extended Date Window Match',
  'Wire Correspondent Fee Deduction',
  'Credit Card Service Fee Deduction',
  'FX Rate Variance',
  'Possible Amount Mismatch',
] as const;

/** Union of every valid one-to-one match rule name; see `MATCHING_RULE_NAMES`. */
export type MatchingRuleName = (typeof MATCHING_RULE_NAMES)[number];

/** Derives the kebab-case rule id `MatchResult.ruleId` carries, from its display rule name. */
export const slugifyRuleName = (name: string): string => name.toLowerCase().replaceAll(/\s+/g, '-');

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
    canonicalTokens: bestAlias.canonicalPayeeName.toUpperCase().split(/\s+/).filter(Boolean),
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
  glTransaction: NormalizedTransaction,
  dateDifference: number | null,
): boolean => {
  if (dateDifference === null || dateDifference < 3 || dateDifference > 31) {
    return false;
  }

  if (!includesText(bankTransaction.description, 'online from')) {
    return false;
  }

  if ((glTransaction.transactionType ?? '').toLowerCase() !== 'journal entry') {
    return false;
  }

  if (!includesText(glTransaction.description, 'money transfers')) {
    return false;
  }

  const bankDateValue = bankTransaction.transactionDate ?? bankTransaction.postingDate;
  const glDateValue = glTransaction.transactionDate ?? glTransaction.postingDate;
  const bankDate = parseIsoDate(bankDateValue);
  const glDate = parseIsoDate(glDateValue);

  if (!bankDate || !glDate || !isMonthEndDate(glDateValue)) {
    return false;
  }

  return (
    glDate >= bankDate &&
    bankDate.getUTCFullYear() === glDate.getUTCFullYear() &&
    bankDate.getUTCMonth() === glDate.getUTCMonth()
  );
};

const isDistinctiveShortContextExactMatch = (
  bankTransaction: NormalizedTransaction,
  glTransaction: NormalizedTransaction,
  bankAmountFrequency: Map<number, number>,
  glAmountFrequency: Map<number, number>,
): boolean => {
  if (bankTransaction.amount === null) {
    return false;
  }

  return (
    (bankAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
    (glAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
    glTransaction.normalizedComparisonTokens.length <= SHORT_CONTEXT_TOKEN_LIMIT
  );
};

/** Same "is this amount rare enough to trust on its own" question as
 * isDistinctiveShortContextExactMatch, but generalized to config.distinctiveAmountMaxOccurrences
 * instead of a hardcoded 1, and without the short-token-count restriction (that restriction is
 * specific to the Exact-tier bypass this pairs with above; this guards the separate weak-
 * description fuzzy-matching pass in rankFuzzyCandidates, which has no token-count ceiling). */
const isDistinctiveAmountPair = (
  bankTransaction: NormalizedTransaction,
  bankAmountFrequency: Map<number, number>,
  glAmountFrequency: Map<number, number>,
  config: MatchingConfig,
): boolean => {
  if (bankTransaction.amount === null) {
    return false;
  }

  return (
    (bankAmountFrequency.get(bankTransaction.amount) ?? 0) <= config.distinctiveAmountMaxOccurrences &&
    (glAmountFrequency.get(bankTransaction.amount) ?? 0) <= config.distinctiveAmountMaxOccurrences
  );
};

const buildCandidate = (
  bankTransaction: NormalizedTransaction,
  glTransaction: NormalizedTransaction,
  ruleName: MatchingRuleName,
  score: number,
  confidence: MatchCandidate['confidence'],
  evidence: string[],
  exceptionCategory?: MatchCandidate['exceptionCategory'],
): MatchCandidate => {
  const dateDifference = dateDifferenceDays(
    bankTransaction.transactionDate ?? bankTransaction.postingDate,
    glTransaction.transactionDate ?? glTransaction.postingDate,
  );
  const textSimilarity = tokenSimilarity(
    bankTransaction.normalizedComparisonTokens,
    glTransaction.normalizedComparisonTokens,
  );
  const referenceSimilarity = tokenSimilarity(
    bankTransaction.normalizedReferenceTokens,
    glTransaction.normalizedReferenceTokens,
  );

  return {
    bankTransactionId: bankTransaction.id,
    glTransactionId: glTransaction.id,
    confidence,
    exceptionCategory,
    score,
    ruleName,
    dateDifferenceDays: dateDifference,
    amountDifference: amountDifference(bankTransaction.amount, glTransaction.amount),
    textSimilarity,
    referenceSimilarity,
    evidence,
    evaluations: [
      {
        ruleId: slugifyRuleName(ruleName),
        ruleName,
        passed: true,
        score,
        reason: evidence.join(' '),
        evidence,
        candidateTransactionId: glTransaction.id,
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
  glTransactionId: candidate.glTransactionId,
  dateDifferenceDays: candidate.dateDifferenceDays,
  amountDifference: candidate.amountDifference,
  evidence: candidate.evidence,
  likelyMatchingReference: candidate.glTransactionId,
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

const createGroupedMatchResult = (candidate: GroupedReservationCandidate): GroupedMatchResult => ({
  id: randomUUID(),
  disposition: 'GroupedReviewMatch',
  confidence: 'Probable',
  category: candidate.category,
  bankTransactionIds: candidate.bankTransactionIds,
  glTransactionIds: candidate.glTransactionIds,
  bankMembers: buildGroupedMatchMembers(candidate.bankTransactions),
  glMembers: buildGroupedMatchMembers(candidate.glTransactions),
  totalAmount: candidate.bankTransactions.reduce(
    (total, transaction) => total + transaction.amount,
    0,
  ),
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
  glTransactions: NormalizedTransaction[],
  config: MatchingConfig,
  aliases: PayeeAlias[] = [],
): MatchCandidate[] => {
  const candidates: MatchCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const glAmountFrequency = buildAmountFrequency(glTransactions);
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
    for (const glTransaction of glTransactions) {
      if (bankTransaction.amount === null || glTransaction.amount === null) {
        continue;
      }

      const sameAmount = currencyEquals(
        bankTransaction.amount,
        glTransaction.amount,
        config.amountTolerance,
      );
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        glTransaction.transactionDate ?? glTransaction.postingDate,
      );
      const textSimilarity = tokenSimilarity(
        bankTransaction.normalizedComparisonTokens,
        glTransaction.normalizedComparisonTokens,
      );
      const referenceSimilarity = tokenSimilarity(
        bankTransaction.normalizedReferenceTokens,
        glTransaction.normalizedReferenceTokens,
      );
      const hasCheckOrReferenceValues =
        Boolean(bankTransaction.checkNumber || glTransaction.checkNumber) ||
        Boolean(bankTransaction.referenceNumber || glTransaction.referenceNumber) ||
        (bankTransaction.normalizedReferenceTokens.length > 0 &&
          glTransaction.normalizedReferenceTokens.length > 0);

      const referenceMismatchCategory: MatchCandidate['exceptionCategory'] =
        bankTransaction.checkNumber || glTransaction.checkNumber
          ? 'CheckNumberMismatch'
          : 'ReferenceNumberMismatch';
      const lowContextExactMatch =
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity === 0 &&
        isDistinctiveShortContextExactMatch(
          bankTransaction,
          glTransaction,
          bankAmountFrequency,
          glAmountFrequency,
        );
      const reviewSimilarityThreshold = Math.min(config.probableTextSimilarityThreshold, 0.4);

      // When both sides carry a check number and reference similarity confirms the same check,
      // handle the amount-mismatch and extended-date cases before the generic Reference + Amount
      // Match rule so that check-specific evidence is preserved in the exception category.
      if (
        bankTransaction.checkNumber &&
        glTransaction.checkNumber &&
        referenceSimilarity >= config.referenceSimilarityThreshold
      ) {
        if (
          !sameAmount &&
          (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
        ) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
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
              glTransaction,
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
          buildCandidate(bankTransaction, glTransaction, 'Reference + Amount Match', 1, 'Exact', [
            'Reference or check values align strongly.',
            'Amounts agree within configured tolerance.',
          ]),
        );
        continue;
      }

      // A strongly matching reference/document number is enough to pair a transaction even when
      // description wording diverges (as real bank feeds routinely do) — mirror the checkNumber
      // branch above but keyed on reference similarity generally, not just an explicit check number.
      if (
        !sameAmount &&
        referenceSimilarity >= config.referenceSimilarityThreshold &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
      ) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            glTransaction,
            'Reference Match with Amount Variance',
            0.83,
            'AmountMismatch',
            [
              'Reference or document number aligns strongly across both sources.',
              'Recorded amounts differ beyond configured tolerance — likely a transposition or recording error.',
            ],
            'AmountMismatch',
          ),
        );
        continue;
      }

      const aliasHit = bankAliasHits.get(bankTransaction.id) ?? null;
      if (
        aliasHit &&
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
      ) {
        const aliasSimilarity = tokenSimilarity(
          aliasHit.canonicalTokens,
          glTransaction.normalizedComparisonTokens,
        );
        const effectiveSimilarity = aliasSimilarity * aliasHit.alias.matchConfidence;

        if (effectiveSimilarity >= config.textSimilarityThreshold) {
          const withinPrimaryWindow =
            (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays;
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
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

      if (
        sameAmount &&
        isMonthEndTransferProbable(bankTransaction, glTransaction, dateDifference)
      ) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            glTransaction,
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
            glTransaction,
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
          buildCandidate(
            bankTransaction,
            glTransaction,
            'Amount + Date + Text Match',
            0.93,
            'Exact',
            [
              'Amounts agree within configured tolerance.',
              'Dates fall within the primary tolerance window.',
              'Merchant, payee, or description tokens align strongly.',
            ],
          ),
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
            glTransaction,
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

      // The lower-bound check is load-bearing, not redundant with the branches above: a same-day,
      // same-amount pair with text similarity below even reviewSimilarityThreshold falls through
      // every earlier branch on text grounds, not date grounds, and would otherwise land here and
      // get mislabeled DateVariance despite dateDifference being 0.
      if (
        sameAmount &&
        (dateDifference ?? Number.POSITIVE_INFINITY) > config.dateToleranceDays &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.timingDifferenceDays
      ) {
        candidates.push(
          buildCandidate(
            bankTransaction,
            glTransaction,
            'Amount + Extended Date Window Match',
            0.82,
            'DateVariance',
            [
              'Amounts agree within configured tolerance.',
              'Date variance remains outside the primary tolerance but inside the extended review window.',
            ],
            'DateVariance',
          ),
        );
        continue;
      }

      // Wire Correspondent Fee: same direction, small absolute amount difference, strong text match.
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(glTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        Math.abs(bankTransaction.amount - glTransaction.amount) <= config.wireFeeTolerance &&
        textSimilarity >= config.textSimilarityThreshold
      ) {
        const feeDeducted = Math.abs(bankTransaction.amount - glTransaction.amount);
        candidates.push(
          buildCandidate(
            bankTransaction,
            glTransaction,
            'Wire Correspondent Fee Deduction',
            0.77,
            'AmountMismatch',
            [
              `Bank amount of ${bankTransaction.amount.toFixed(2)} and GL amount of ${glTransaction.amount.toFixed(2)} differ by ${feeDeducted.toFixed(2)}.`,
              'Amounts share the same sign and the difference is within the wire-fee tolerance, suggesting a correspondent bank or processing fee was deducted in transit.',
              'Reviewer should confirm against wire advice or settlement detail.',
            ],
            'AmountMismatch',
          ),
        );
        continue;
      }

      // Credit Card Service Fee: same direction, percentage amount difference within tolerance,
      // strong text match. Checked before FX Rate Variance below (whose own window, 0.5%-15%, is
      // wide enough to otherwise swallow a genuine ~1-3% card-processing-fee pair under the wrong,
      // less-specific FX label -- each block `continue`s on match, so order picks the winner).
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(glTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= config.textSimilarityThreshold
      ) {
        const largerAmount = Math.max(
          Math.abs(bankTransaction.amount),
          Math.abs(glTransaction.amount),
        );
        const creditCardDiffPct =
          largerAmount > 0
            ? Math.abs(bankTransaction.amount - glTransaction.amount) / largerAmount
            : 0;
        if (creditCardDiffPct > 0 && creditCardDiffPct <= config.creditCardFeeTolerance) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
              'Credit Card Service Fee Deduction',
              0.77,
              'AmountMismatch',
              [
                `Bank amount of ${bankTransaction.amount.toFixed(2)} and GL amount of ${glTransaction.amount.toFixed(2)} differ by ${(creditCardDiffPct * 100).toFixed(2)}%.`,
                'Amounts share the same sign and the percentage variance is within the credit-card fee tolerance, suggesting a card processor or merchant services fee was deducted before settlement.',
                'Reviewer should confirm against the card processor statement or merchant services fee schedule.',
              ],
              'AmountMismatch',
            ),
          );
          continue;
        }
      }

      // FX Rate Variance: same direction, percentage amount difference 0.5%–15%, strong text match.
      const FX_VARIANCE_MIN_PCT = 0.005;
      const FX_VARIANCE_MAX_PCT = 0.15;
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(glTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= config.dateToleranceDays &&
        textSimilarity >= config.textSimilarityThreshold
      ) {
        const larger = Math.max(Math.abs(bankTransaction.amount), Math.abs(glTransaction.amount));
        const diffPct =
          larger > 0 ? Math.abs(bankTransaction.amount - glTransaction.amount) / larger : 0;
        if (diffPct >= FX_VARIANCE_MIN_PCT && diffPct <= FX_VARIANCE_MAX_PCT) {
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
              'FX Rate Variance',
              0.74,
              'AmountMismatch',
              [
                `Bank amount of ${bankTransaction.amount.toFixed(2)} and GL amount of ${glTransaction.amount.toFixed(2)} differ by ${(diffPct * 100).toFixed(2)}%.`,
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
          buildCandidate(
            bankTransaction,
            glTransaction,
            'Possible Amount Mismatch',
            0.7,
            'AmountMismatch',
            [
              'Dates and narrative context indicate likely related transactions.',
              'Recorded amounts differ beyond configured tolerance.',
            ],
          ),
        );
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
};

/**
 * Second matching pass, run only against whatever bank/GL transactions `reconcileMatches`'s
 * primary pass (`rankCandidates`, above) left unmatched. Unlike every rule in that primary pass,
 * eligibility here never depends on description text similarity -- only amount, same-day date
 * equality, and a distinctiveness guardrail. Description similarity (`describeTokenSimilarity`)
 * is computed only for scoring/evidence quality on pairs that already qualify, never as a
 * pass/fail condition. Deliberately same-day only, not the full primary date-tolerance window --
 * see the inline comment on the date check below for why.
 *
 * This is deliberately a separate pass rather than one more branch inside `rankCandidates`: it
 * lets cheap, strict rules run to completion first, and reserves the comparatively expensive
 * fuzzy string-distance work (`fuzzyContainmentSimilarity`) for the much smaller leftover pool
 * instead of every bank x GL pair up front.
 */
const rankFuzzyCandidates = (
  bankTransactions: NormalizedTransaction[],
  glTransactions: NormalizedTransaction[],
  config: MatchingConfig,
): MatchCandidate[] => {
  const candidates: MatchCandidate[] = [];
  const bankAmountFrequency = buildAmountFrequency(bankTransactions);
  const glAmountFrequency = buildAmountFrequency(glTransactions);

  for (const bankTransaction of bankTransactions) {
    for (const glTransaction of glTransactions) {
      if (bankTransaction.amount === null || glTransaction.amount === null) {
        continue;
      }

      const sameAmount = currencyEquals(
        bankTransaction.amount,
        glTransaction.amount,
        config.amountTolerance,
      );
      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        glTransaction.transactionDate ?? glTransaction.postingDate,
      );
      const referenceSimilarity = tokenSimilarity(
        bankTransaction.normalizedReferenceTokens,
        glTransaction.normalizedReferenceTokens,
      );
      const hasCheckOrReferenceValues =
        Boolean(bankTransaction.checkNumber || glTransaction.checkNumber) ||
        Boolean(bankTransaction.referenceNumber || glTransaction.referenceNumber) ||
        (bankTransaction.normalizedReferenceTokens.length > 0 &&
          glTransaction.normalizedReferenceTokens.length > 0);

      if (
        !sameAmount ||
        // Same-day only, not the full primary date-tolerance window: a >0-day gap with a
        // distinctive amount and conflicting narrative is exactly what LikelyMiscoding's residual
        // stage exists to flag (exceptionClassifierCandidates.ts's buildLikelyMiscodingCandidate
        // narrows its own same-day override the same way, for the same reason) -- widening this
        // to dateToleranceDays would intercept those pairs here first and silently downgrade a
        // real miscoding signal into a bland "weak description" match. Confirmed against the
        // existing 'likely-miscoding' fixture (1-day gap, "ACME PAYROLL" vs "Office supplies" --
        // genuinely conflicting narrative, not just absent/abbreviated text).
        dateDifference !== 0 ||
        (hasCheckOrReferenceValues && referenceSimilarity < config.referenceSimilarityThreshold) ||
        !isDistinctiveAmountPair(bankTransaction, bankAmountFrequency, glAmountFrequency, config)
      ) {
        continue;
      }

      const fuzzy = describeTokenSimilarity(
        bankTransaction.normalizedComparisonTokens,
        glTransaction.normalizedComparisonTokens,
      );
      candidates.push(
        buildCandidate(
          bankTransaction,
          glTransaction,
          'Amount + Date Match, Weak Description',
          0.55 + fuzzy.best * 0.1,
          'Probable',
          [
            'Amounts agree within configured tolerance and dates fall within the primary tolerance window.',
            `Description or payee text shares little vocabulary between sources (best similarity ${(fuzzy.best * 100).toFixed(0)}%), but this amount occurs at most ${config.distinctiveAmountMaxOccurrences} time(s) on each side, making amount and date alone a trustworthy signal.`,
            'Reviewer confirmation is required before treating this as a confirmed match.',
          ],
          'WeakDescriptionMatch',
        ),
      );
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
  unmatchedGlTransactionIds: Set<string>;
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
/** Fires once per candidate as the classification loop disposes of it, `undefined` unless a
 * caller actually wants the detail (apps/api only supplies one when LOG_LEVEL=debug). Bounded by
 * candidate count (already the post-filter output of rankCandidates), not the O(bank x gl) raw
 * comparison count -- packages/core stays logger-free, this is the seam a caller uses to emit
 * its own "row, rule, result" fault-finding log line. */
export type CandidateOutcomeObserver = (
  candidate: MatchCandidate,
  disposition:
    | 'SkippedAlreadyMatched'
    | 'SkippedAlreadyReviewed'
    | 'AmbiguousReview'
    | MatchDisposition,
) => void;

export const reconcileMatches = (
  transactions: NormalizedTransaction[],
  config: MatchingConfig,
  aliases: PayeeAlias[] = [],
  onCandidateOutcome?: CandidateOutcomeObserver,
): MatchEngineResult => {
  const activeTransactions = transactions.filter(
    (transaction) => !transaction.isExcluded && transaction.dataQualityIssues.length === 0,
  );
  const bankTransactions = activeTransactions.filter(
    (transaction) => transaction.source === 'bank',
  );
  const glTransactions = activeTransactions.filter((transaction) => transaction.source === 'gl');

  const duplicateBank = detectDuplicates(bankTransactions, config);
  const duplicateGl = detectDuplicates(glTransactions, config);
  const duplicateIds = new Set<string>([
    ...duplicateBank.duplicateTransactionIds,
    ...duplicateGl.duplicateTransactionIds,
  ]);

  const remainingBank = bankTransactions.filter((transaction) => !duplicateIds.has(transaction.id));
  const remainingGl = glTransactions.filter((transaction) => !duplicateIds.has(transaction.id));

  const candidates = rankCandidates(remainingBank, remainingGl, config, aliases);
  const exactMatchedBank = new Set<string>();
  const exactMatchedGl = new Set<string>();
  const reviewedBank = new Set<string>();
  const reviewedGl = new Set<string>();
  const groupedReservations = reserveGroupedTransactionIds(remainingBank, remainingGl, config);
  const matchResults: MatchResult[] = [];
  const groupedMatchResults = groupedReservations.selectedCandidates.map(createGroupedMatchResult);
  const probableMatches: MatchResult[] = [];

  for (const candidate of candidates) {
    if (
      exactMatchedBank.has(candidate.bankTransactionId) ||
      exactMatchedGl.has(candidate.glTransactionId)
    ) {
      onCandidateOutcome?.(candidate, 'SkippedAlreadyMatched');
      continue;
    }

    const isGroupedReserved =
      groupedReservations.reservedBankTransactionIds.has(candidate.bankTransactionId) ||
      groupedReservations.reservedGlTransactionIds.has(candidate.glTransactionId);

    const siblingCandidates = candidates.filter(
      (item) =>
        item.bankTransactionId === candidate.bankTransactionId ||
        item.glTransactionId === candidate.glTransactionId,
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
        reviewedGl.has(candidate.glTransactionId)
      ) {
        onCandidateOutcome?.(candidate, 'SkippedAlreadyReviewed');
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
      reviewedGl.add(candidate.glTransactionId);
      onCandidateOutcome?.(candidate, 'AmbiguousReview');
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
      exactMatchedGl.add(candidate.glTransactionId);
      onCandidateOutcome?.(candidate, disposition);
      continue;
    }

    if (
      isGroupedReserved ||
      reviewedBank.has(candidate.bankTransactionId) ||
      reviewedGl.has(candidate.glTransactionId)
    ) {
      onCandidateOutcome?.(candidate, 'SkippedAlreadyReviewed');
      continue;
    }

    if (disposition === 'ProbableMatch') {
      probableMatches.push(result);
    }
    matchResults.push(result);
    reviewedBank.add(candidate.bankTransactionId);
    reviewedGl.add(candidate.glTransactionId);
    onCandidateOutcome?.(candidate, disposition);
  }

  // Second pass, effort-staged behind the primary rule cascade above: only run the fuzzy
  // amount+date matcher against whatever's still genuinely unmatched, not the full pool.
  const stillUnmatchedBank = remainingBank.filter(
    (transaction) =>
      !exactMatchedBank.has(transaction.id) &&
      !reviewedBank.has(transaction.id) &&
      !groupedReservations.reservedBankTransactionIds.has(transaction.id),
  );
  const stillUnmatchedGl = remainingGl.filter(
    (transaction) =>
      !exactMatchedGl.has(transaction.id) &&
      !reviewedGl.has(transaction.id) &&
      !groupedReservations.reservedGlTransactionIds.has(transaction.id),
  );

  const fuzzyCandidates = rankFuzzyCandidates(stillUnmatchedBank, stillUnmatchedGl, config);
  for (const candidate of fuzzyCandidates) {
    if (
      exactMatchedBank.has(candidate.bankTransactionId) ||
      exactMatchedGl.has(candidate.glTransactionId) ||
      reviewedBank.has(candidate.bankTransactionId) ||
      reviewedGl.has(candidate.glTransactionId)
    ) {
      onCandidateOutcome?.(candidate, 'SkippedAlreadyMatched');
      continue;
    }

    const result = createMatchResult(candidate, 'ProbableMatch', 'WeakDescriptionMatch');
    probableMatches.push(result);
    matchResults.push(result);
    reviewedBank.add(candidate.bankTransactionId);
    reviewedGl.add(candidate.glTransactionId);
    onCandidateOutcome?.(candidate, 'ProbableMatch');
  }

  return {
    matchResults,
    groupedMatchResults,
    probableMatches,
    unmatchedBankTransactionIds: new Set(
      remainingBank
        .filter((transaction) => !exactMatchedBank.has(transaction.id))
        .map((transaction) => transaction.id),
    ),
    unmatchedGlTransactionIds: new Set(
      remainingGl
        .filter((transaction) => !exactMatchedGl.has(transaction.id))
        .map((transaction) => transaction.id),
    ),
    duplicateTransactionIds: duplicateIds,
  };
};
