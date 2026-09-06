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
  patternContainmentSimilarity,
  tokenSimilarity,
} from './similarity';
import {
  reserveGroupedTransactionIds,
  type GroupedReservationCandidate,
} from './groupedReservations';
import { isCardLikeTransaction, isWireLikeTransaction } from './instrumentSignals';

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
 *
 * Scored as the better of symmetric Dice and directional containment (Issue #313). Dice alone makes
 * an alias cover one literal descriptor rather than its merchant's family: pattern `AMZN MKTP`
 * scores 0.80 against `AMZN Mktp US` but 0.40 against `AMZN MKTPLACE PMTS`, missing the 0.5
 * threshold on a descriptor a human reads as the same merchant. Trigram does not rescue that case
 * either (0.45) -- the problem is that Dice is symmetric, not which distance is used.
 *
 * Taking the BETTER of the two is strictly widening: every pattern that matched before still
 * matches, at the same or a higher score, so this cannot silently un-match anything already relied
 * upon.
 *
 * Ties break toward the MORE SPECIFIC pattern (more tokens). Containment saturates at 1.0 far more
 * readily than Dice, and the previous strict `>` meant the winner was whichever alias the store
 * returned first -- making engine output depend on row order. Preferring more tokens also handles
 * the over-broad pattern sensibly: a one-token `ACH` loses to `AMZN MKTP` when both contain-match,
 * instead of winning on arrival order. A genuinely generic single-token pattern is still broad;
 * that is a pattern-authoring problem, and a stoplist for it is deliberately out of scope here.
 */
const findMatchingAlias = (
  bankTokens: string[],
  aliases: PayeeAlias[],
): { alias: PayeeAlias; canonicalTokens: string[] } | null => {
  let bestAlias: PayeeAlias | null = null;
  let bestSimilarity = 0;

  for (const alias of aliases) {
    if (!alias.isActive || alias.normalizedTokens.length === 0) {
      continue;
    }

    const similarity = Math.max(
      tokenSimilarity(bankTokens, alias.normalizedTokens),
      patternContainmentSimilarity(alias.normalizedTokens, bankTokens),
    );
    if (similarity < ALIAS_PATTERN_MATCH_THRESHOLD) {
      continue;
    }

    const isBetter =
      bestAlias === null ||
      similarity > bestSimilarity ||
      (similarity === bestSimilarity &&
        alias.normalizedTokens.length > bestAlias.normalizedTokens.length);

    if (isBetter) {
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
    (bankAmountFrequency.get(bankTransaction.amount) ?? 0) <=
      config.distinctiveAmountMaxOccurrences &&
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

/**
 * H7 (#276): what every MatchResult records about the configuration that produced it.
 *
 * Threaded explicitly rather than read from a module-level default: the recorded provenance has to
 * be whatever the engine was HANDED for this run, or it is not provenance.
 */
interface MatchProvenance {
  appliedAmountTolerance: number;
  matchingConfigVersionId?: string;
}

/** See {@link MatchProvenance} -- `provenance` is required so no result can omit it. */
const createMatchResult = (
  candidate: MatchCandidate,
  disposition: MatchDisposition,
  provenance: MatchProvenance,
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
  appliedAmountTolerance: provenance.appliedAmountTolerance,
  matchingConfigVersionId: provenance.matchingConfigVersionId,
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

  /**
   * Issue #333. `sourceDirection` was declared, persisted and API-validated but read nowhere --
   * setting `'bidirectional'` changed no behaviour at all. It means the alias may also resolve the
   * GL side, so a payee abbreviated in the BOOKS ("AMZN Mktp US" against a bank statement that
   * spells "AMAZON MKTPLACE PMTS") reaches the same canonical payee the bank side already does.
   *
   * Only `'bidirectional'` rows qualify; `'bank_to_gl'` stays one-way. Every default seed in
   * `defaultPayeeAliases.ts` is `'bank_to_gl'`, so this map is empty and this whole feature is
   * inert until an organization authors a bidirectional row -- which is why no answer-key fixture
   * outcome moves.
   */
  const bidirectionalAliases = aliases.filter((alias) => alias.sourceDirection === 'bidirectional');
  const glAliasHits = new Map<string, ReturnType<typeof findMatchingAlias>>();
  if (bidirectionalAliases.length > 0) {
    for (const glTransaction of glTransactions) {
      glAliasHits.set(
        glTransaction.id,
        findMatchingAlias(glTransaction.normalizedComparisonTokens, bidirectionalAliases),
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
      // Carried-forward items (Unreconciled Item Roll-Forward PR D, §3.6) are by definition older
      // than the primary window -- reusing config.dateToleranceDays for them would mean nothing
      // ever clears. Every dateToleranceDays reference below this point uses this resolved value
      // instead, scoped to this one pair; every other rule's own logic and ordering is unchanged.
      const effectiveDateToleranceDays =
        bankTransaction.isCarriedForward || glTransaction.isCarriedForward
          ? Math.max(config.dateToleranceDays, config.carriedItemDateToleranceDays)
          : config.dateToleranceDays;
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
                `Recorded amounts differ by more than the configured tolerance of ${config.amountTolerance} — likely a posting error or partial payment.`,
              ],
              'CheckNumberMismatch',
            ),
          );
          continue;
        }

        if (
          sameAmount &&
          (dateDifference ?? Number.POSITIVE_INFINITY) > effectiveDateToleranceDays &&
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
                `Amounts agree within the configured tolerance of ${config.amountTolerance}.`,
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
            `Amounts agree within the configured tolerance of ${config.amountTolerance}.`,
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
              `Recorded amounts differ by more than the configured tolerance of ${config.amountTolerance} — likely a transposition or recording error.`,
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
        // Mirror of #313 on the GL side (#311): a GL row's comparison text is Name + Memo, so a
        // one-word canonical payee ("Square") scores only 2/(1+2) against [COFFEE, SQUARE] by
        // overlap and the alias never fires on real GL exports. Containment asks the right
        // question -- is the canonical payee present -- and it stays safe because this branch is
        // already gated on sameAmount and the timing window above.
        const scoreCanonicalAgainst = (glTokens: string[]): number =>
          Math.max(
            tokenSimilarity(aliasHit.canonicalTokens, glTokens),
            patternContainmentSimilarity(aliasHit.canonicalTokens, glTokens),
          );

        const directSimilarity =
          scoreCanonicalAgainst(glTransaction.normalizedComparisonTokens) *
          aliasHit.alias.matchConfidence;

        // #333: when a bidirectional alias also resolves this GL row, compare canonical to
        // canonical. Confidence is the WEAKER of the two rows -- the match now rests on both being
        // right, so carrying the bank alias's confidence alone would overstate it. Taken as a max
        // against the direct score, so resolving the GL side can only ever raise the result: a
        // table with no bidirectional rows scores exactly as it did before.
        const glAliasHit = glAliasHits.get(glTransaction.id) ?? null;
        const bidirectionalSimilarity = glAliasHit
          ? scoreCanonicalAgainst(glAliasHit.canonicalTokens) *
            Math.min(aliasHit.alias.matchConfidence, glAliasHit.alias.matchConfidence)
          : 0;

        const effectiveSimilarity = Math.max(directSimilarity, bidirectionalSimilarity);
        const resolvedGlSide = glAliasHit !== null && bidirectionalSimilarity > directSimilarity;

        if (effectiveSimilarity >= config.textSimilarityThreshold) {
          const withinPrimaryWindow =
            (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays;
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
              'Historical Pattern Match',
              withinPrimaryWindow ? 0.88 : 0.8,
              withinPrimaryWindow ? 'Exact' : 'DateVariance',
              [
                `Bank description matched learned alias "${aliasHit.alias.bankPattern}" → "${aliasHit.alias.canonicalPayeeName}".`,
                ...(resolvedGlSide && glAliasHit
                  ? [
                      `GL description also matched bidirectional alias "${glAliasHit.alias.bankPattern}" → "${glAliasHit.alias.canonicalPayeeName}"; both sides resolved to the same canonical payee.`,
                    ]
                  : []),
                `Alias confidence ${(aliasHit.alias.matchConfidence * 100).toFixed(0)}%; effective similarity ${(effectiveSimilarity * 100).toFixed(0)}%.`,
                `Amounts agree within the configured tolerance of ${config.amountTolerance}.`,
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
              `Amounts agree within the configured tolerance of ${config.amountTolerance}.`,
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
        (dateDifference ?? Number.POSITIVE_INFINITY) > effectiveDateToleranceDays &&
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
              `Amounts agree within the configured tolerance of ${config.amountTolerance}.`,
              'Date variance remains outside the primary tolerance but inside the extended review window.',
            ],
            'DateVariance',
          ),
        );
        continue;
      }

      // Wire Correspondent Fee: same direction, small absolute amount difference (and, as a sanity
      // ceiling, a small percentage difference too -- an absolute-only gate would let a $500
      // difference on a $600 wire read as a "fee"), strong text match, and actual wire evidence on
      // one side or the other (transaction type or narrative text) -- without that gate this rule
      // was a pure amount-shape classifier wearing a wire label; see instrumentSignals.ts.
      const WIRE_FEE_MAX_PCT = 0.05;
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(glTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
        Math.abs(bankTransaction.amount - glTransaction.amount) <= config.wireFeeTolerance &&
        textSimilarity >= config.textSimilarityThreshold &&
        (isWireLikeTransaction(bankTransaction) || isWireLikeTransaction(glTransaction))
      ) {
        const feeDeducted = Math.abs(bankTransaction.amount - glTransaction.amount);
        const wireLarger = Math.max(
          Math.abs(bankTransaction.amount),
          Math.abs(glTransaction.amount),
        );
        const wireDiffPct = wireLarger > 0 ? feeDeducted / wireLarger : 0;
        if (wireDiffPct <= WIRE_FEE_MAX_PCT) {
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
      }

      // Credit Card Service Fee: same direction, percentage amount difference within tolerance
      // (and above a small floor -- below that, a difference is more likely a rounding or keying
      // error than a fee), strong text match, and actual card evidence on one side or the other.
      // Placement relative to Wire/FX no longer matters for correctness now that each rule gates on
      // its own instrument evidence and is therefore disjoint from the others; Wire is still
      // checked first purely as a documented tie-break for the (rare) case a pair satisfies both
      // predicates.
      const CREDIT_CARD_FEE_MIN_PCT = 0.001;
      if (
        !sameAmount &&
        Math.sign(bankTransaction.amount) === Math.sign(glTransaction.amount) &&
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
        textSimilarity >= config.textSimilarityThreshold &&
        (isCardLikeTransaction(bankTransaction) || isCardLikeTransaction(glTransaction))
      ) {
        const largerAmount = Math.max(
          Math.abs(bankTransaction.amount),
          Math.abs(glTransaction.amount),
        );
        const creditCardDiffPct =
          largerAmount > 0
            ? Math.abs(bankTransaction.amount - glTransaction.amount) / largerAmount
            : 0;
        if (
          creditCardDiffPct >= CREDIT_CARD_FEE_MIN_PCT &&
          creditCardDiffPct <= config.creditCardFeeTolerance
        ) {
          const feeNettedFromReceipt =
            Math.abs(bankTransaction.amount) < Math.abs(glTransaction.amount);
          candidates.push(
            buildCandidate(
              bankTransaction,
              glTransaction,
              'Credit Card Service Fee Deduction',
              0.77,
              'AmountMismatch',
              [
                `Bank amount of ${bankTransaction.amount.toFixed(2)} and GL amount of ${glTransaction.amount.toFixed(2)} differ by ${(creditCardDiffPct * 100).toFixed(2)}%.`,
                'Amounts share the same sign and the percentage variance is within the credit-card fee tolerance, suggesting a card processor or merchant services fee was deducted.',
                feeNettedFromReceipt
                  ? 'Reviewer should confirm against the card processor statement -- the fee appears netted out of a receipt.'
                  : "Reviewer should confirm against the bank's card fee schedule -- the fee appears added to a disbursement.",
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
        (dateDifference ?? Number.POSITIVE_INFINITY) <= effectiveDateToleranceDays &&
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
              `Recorded amounts differ by more than the configured tolerance of ${config.amountTolerance}.`,
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
            `Amounts agree within the configured tolerance of ${config.amountTolerance} and dates fall within the primary tolerance window.`,
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
/**
 * G5 (#272): cleared and unmatched must partition the non-duplicate population -- every transaction
 * is in exactly one, never both and never neither.
 *
 * "Cleared" means exactly matched. ProbableMatch and grouped-review rows are NOT cleared and belong
 * to the unmatched side; see the note at the return site for why, and for the measured consequences
 * of defining it otherwise.
 *
 * This holds by construction today, which is the point of asserting it: it locks the invariant so a
 * later change to how the sets are built cannot silently reintroduce the ambiguity between "has no
 * match result" and "has not cleared".
 *
 * Deliberately an assertion, not an enforcement mechanism. Several residual stages legitimately
 * reason over transactions the engine already touched, and #278 (H9) shows what confining a stage
 * to the unmatched set produces: `classifyAchReturnStage` builds both sides of its pair from
 * `remainingUnmatchedBank`, so once the original debit matches its GL entry the pair can never form
 * and ACHReturn becomes unreachable.
 */
export const assertClearedPartition = (
  population: readonly { id: string }[],
  cleared: ReadonlySet<string>,
  unmatched: ReadonlySet<string>,
  side: string,
): void => {
  const both: string[] = [];
  const neither: string[] = [];

  for (const { id } of population) {
    const isCleared = cleared.has(id);
    const isUnmatched = unmatched.has(id);
    if (isCleared && isUnmatched) {
      both.push(id);
    } else if (!isCleared && !isUnmatched) {
      neither.push(id);
    }
  }

  if (both.length > 0 || neither.length > 0) {
    throw new Error(
      `Matching engine cleared/unmatched partition violated on the ${side} side: ` +
        `${both.length} in BOTH (${both.slice(0, 5).join(', ')}), ` +
        `${neither.length} in NEITHER (${neither.slice(0, 5).join(', ')}).`,
    );
  }
};

/** Fires once per candidate as the classification loop disposes of it, `undefined` unless a
 * caller actually wants the detail (apps/api only supplies one when LOG_LEVEL=debug). Bounded by
 * candidate count (already the post-filter output of rankCandidates), not the O(bank x gl) raw
 * comparison count -- packages/core stays logger-free, this is the seam a caller uses to emit
 * its own "row, rule, result" fault-finding log line. */
export type CandidateOutcomeObserver = (
  candidate: MatchCandidate,
  disposition:
    'SkippedAlreadyMatched' | 'SkippedAlreadyReviewed' | 'AmbiguousReview' | MatchDisposition,
) => void;

export const reconcileMatches = (
  transactions: NormalizedTransaction[],
  config: MatchingConfig,
  aliases: PayeeAlias[] = [],
  onCandidateOutcome?: CandidateOutcomeObserver,
  /**
   * H7 (#276): the published matching-config version whose overrides produced `config`, when one
   * did. Omitted for engine defaults. Since #260 wired the versioning stack to the engine
   * (`OVERRIDES_APPLIED_TO_ENGINE` is now true), a run that resolves an ACTIVE version passes its
   * id here, so recorded provenance names the version that actually shaped the disposition.
   */
  matchingConfigVersionId?: string,
): MatchEngineResult => {
  const provenance: MatchProvenance = {
    appliedAmountTolerance: config.amountTolerance,
    matchingConfigVersionId,
  };
  const activeTransactions = transactions.filter(
    (transaction) => !transaction.isExcluded && transaction.dataQualityIssues.length === 0,
  );
  const bankTransactions = activeTransactions.filter(
    (transaction) => transaction.source === 'bank',
  );
  const glTransactions = activeTransactions.filter((transaction) => transaction.source === 'gl');

  // Carried-forward items (PR D, §3.6) are excluded from within-source duplicate detection: a
  // carried GL check and the same check re-included in this period's own fresh GL export would
  // otherwise flag each other as duplicates. They still flow into rankCandidates below via
  // bankTransactions/glTransactions (unfiltered) -- only the dedup pool excludes them.
  const duplicateBank = detectDuplicates(
    bankTransactions.filter((transaction) => !transaction.isCarriedForward),
    config,
  );
  const duplicateGl = detectDuplicates(
    glTransactions.filter((transaction) => !transaction.isCarriedForward),
    config,
  );
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

    // H5 (#274): an EXACT tie at the top must escalate regardless of how high the score is.
    //
    // Both candidate sorts are stable (`right.score - left.score`), so equal scores keep their
    // input order and the winner is decided by which row happened to appear first in the uploaded
    // file. Nothing records that a coin was flipped.
    //
    // `candidate.score < 0.95` below excluded precisely the ties most in need of review, and it did
    // so systematically rather than occasionally: `Reference + Amount Match` passes the score as a
    // LITERAL 1, so every tie between two such candidates scored exactly 1.0 and could never reach
    // the ambiguity gate. Two GL entries with the same reference and amount silently resolved to
    // whichever was read first.
    //
    // A tie at the top of the scale is the case most in need of review, not least: two candidates
    // the engine cannot separate on its own evidence.
    // A tie bypasses BOTH original conditions, not just the score.
    //
    // `referenceSimilarity < threshold` is a sound heuristic for a single candidate -- a strong
    // reference match is trustworthy even when the text is weak. It is exactly wrong for a tie:
    // 'Reference + Amount Match' fires only when `referenceSimilarity >= threshold`, so its
    // candidates always fail that condition and could never escalate on that path either. When two
    // GL entries carry the SAME strong reference and the SAME amount, the reference has stopped
    // discriminating between them. The thing that made the match trustworthy is the thing that is
    // now ambiguous.
    const topScoreIsTied = siblingCandidates.filter((item) => item.score === topScore).length > 1;

    if (
      config.textSimilarityThreshold > 0.12 &&
      closeAlternatives.length > 1 &&
      (topScoreIsTied ||
        (candidate.score < 0.95 &&
          candidate.referenceSimilarity < config.referenceSimilarityThreshold))
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
        provenance,
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

    const result = createMatchResult(candidate, disposition, provenance, exceptionCategory);
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

    const result = createMatchResult(
      candidate,
      'ProbableMatch',
      provenance,
      'WeakDescriptionMatch',
    );
    probableMatches.push(result);
    matchResults.push(result);
    reviewedBank.add(candidate.bankTransactionId);
    reviewedGl.add(candidate.glTransactionId);
    onCandidateOutcome?.(candidate, 'ProbableMatch');
  }

  // `unmatched` here means NOT CLEARED -- not "no match result exists". Only an exact match clears
  // a transaction. A ProbableMatch (`reviewed*`, including the fuzzy second pass above) and a
  // grouped reservation both produce a MatchResult while leaving the transaction uncleared, so a
  // transaction legitimately appears in BOTH `matchResults` and the unmatched sets. That is
  // correct, not a leak (#272, owner decision 2026-09-03).
  //
  // Do NOT "fix" this by also subtracting `reviewed*` and `groupedReservations.reserved*`. It was
  // tried and measured: the residual exception classifier reads these sets as its input population
  // (`exceptionClassifier.ts`), so narrowing them starves the stages downstream. Subtracting all
  // three fails 10 core tests -- 9 grouping-classification tests, because per #273 every grouping
  // becomes a GroupedReviewMatch rather than clearing, plus TimingDifference. Subtracting only
  // `reviewed*` still fails TimingDifference, because DateVariance and TimingDifference exceptions
  // are produced FROM rows consumed as ProbableMatch. Those categories are the mechanism, not a
  // symptom.
  const unmatchedBankTransactionIds = new Set(
    remainingBank.filter((t) => !exactMatchedBank.has(t.id)).map((t) => t.id),
  );
  const unmatchedGlTransactionIds = new Set(
    remainingGl.filter((t) => !exactMatchedGl.has(t.id)).map((t) => t.id),
  );

  assertClearedPartition(remainingBank, exactMatchedBank, unmatchedBankTransactionIds, 'bank');
  assertClearedPartition(remainingGl, exactMatchedGl, unmatchedGlTransactionIds, 'GL');

  return {
    matchResults,
    groupedMatchResults,
    probableMatches,
    unmatchedBankTransactionIds,
    unmatchedGlTransactionIds,
    duplicateTransactionIds: duplicateIds,
  };
};
