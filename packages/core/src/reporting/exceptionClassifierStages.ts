import type {
  ExceptionItem,
  MatchingConfig,
  MatchResult,
  NormalizedTransaction,
} from '@recon/domain';
import { currencyEquals } from '../matching/similarity';
import { dateDifferenceDays, tokenSimilarity } from '../matching/similarity';
import {
  inferTransactionKind,
  isCheckLikeGlTransaction,
  parseIsoDate,
} from './exceptionClassifierUtils';
import type {
  MatchResultClassification,
  MiscodingCandidate,
  MiscodingThresholds,
  ResidualStageParams,
  ResidualStageState,
  TimingDifferenceCandidate,
} from './exceptionClassifierTypes';
import {
  buildLikelyMiscodingCandidate,
  buildMiscodingThresholds,
  buildTimingDifferenceCandidate,
  findGroupedResidualCandidates,
  findLikelyMiscodingCandidates,
  findResidualTimingDifferenceCandidates,
} from './exceptionClassifierCandidates';
import {
  buildCounterpartTrace,
  buildCounterpartTraces,
  buildDerivedMatchTrace,
  buildExceptionRuleTrace,
  buildPriorRuleTracesFromMatchResult,
  createException,
} from './exceptionClassifierTraces';

const isCheckLikeBankTransaction = (transaction: NormalizedTransaction): boolean => {
  if (transaction.checkNumber || transaction.serialNumber) {
    return true;
  }
  const desc = (transaction.description ?? '').toLowerCase();
  return /\bchk\b/.test(desc) || /\bcheck\b/.test(desc);
};

const resolveMatchResultCategory = (params: {
  result: MatchResult;
  bankTransaction?: NormalizedTransaction;
  glTransaction?: NormalizedTransaction;
  matching: MatchingConfig;
  miscodingThresholds: MiscodingThresholds;
  bankAmountFrequency: Map<number, number>;
  glAmountFrequency: Map<number, number>;
}): {
  resultCategory?: ExceptionItem['category'];
  matchedMiscodingCandidate?: MiscodingCandidate;
  matchedTimingDifferenceCandidate?: TimingDifferenceCandidate;
} => {
  const {
    result,
    bankTransaction,
    glTransaction,
    matching,
    miscodingThresholds,
    bankAmountFrequency,
    glAmountFrequency,
  } = params;
  let resultCategory: ExceptionItem['category'] | undefined = result.exceptionCategory;

  const matchedMiscodingCandidate =
    resultCategory === 'DateVariance' &&
    bankTransaction &&
    glTransaction &&
    bankTransaction.amount !== null &&
    glTransaction.amount !== null
      ? buildLikelyMiscodingCandidate(
          bankTransaction as NormalizedTransaction & { amount: number },
          glTransaction as NormalizedTransaction & { amount: number },
          matching,
          miscodingThresholds,
          bankAmountFrequency,
          glAmountFrequency,
        )
      : undefined;

  const matchedTimingDifferenceCandidate =
    resultCategory === 'DateVariance' &&
    bankTransaction &&
    glTransaction &&
    bankTransaction.amount !== null &&
    glTransaction.amount !== null
      ? buildTimingDifferenceCandidate(
          bankTransaction as NormalizedTransaction & { amount: number },
          glTransaction as NormalizedTransaction & { amount: number },
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

export const buildMatchResultClassification = (params: {
  result: MatchResult;
  transactionById: Map<string, NormalizedTransaction>;
  matching: MatchingConfig;
  miscodingThresholds: MiscodingThresholds;
  bankAmountFrequency: Map<number, number>;
  glAmountFrequency: Map<number, number>;
}): MatchResultClassification | undefined => {
  const {
    result,
    transactionById,
    matching,
    miscodingThresholds,
    bankAmountFrequency,
    glAmountFrequency,
  } = params;
  const bankTransaction = result.bankTransactionId
    ? transactionById.get(result.bankTransactionId)
    : undefined;
  const glTransaction = result.glTransactionId
    ? transactionById.get(result.glTransactionId)
    : undefined;
  const categoryResolution = resolveMatchResultCategory({
    result,
    bankTransaction,
    glTransaction,
    matching,
    miscodingThresholds,
    bankAmountFrequency,
    glAmountFrequency,
  });

  if (!categoryResolution.resultCategory) {
    return undefined;
  }

  if (!bankTransaction && !glTransaction) {
    return undefined;
  }

  return {
    bankTransaction,
    glTransaction,
    resultCategory: categoryResolution.resultCategory,
    matchedMiscodingCandidate: categoryResolution.matchedMiscodingCandidate,
    matchedTimingDifferenceCandidate: categoryResolution.matchedTimingDifferenceCandidate,
    relatedTransactionIds: [result.bankTransactionId, result.glTransactionId].filter(
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

export const buildMatchResultTargets = (
  classification: MatchResultClassification,
): Array<{ target: NormalizedTransaction; counterpart?: NormalizedTransaction }> => {
  const { bankTransaction, glTransaction, resultCategory } = classification;

  if (
    (resultCategory === 'TimingDifference' || resultCategory === 'LikelyMiscoding') &&
    bankTransaction &&
    glTransaction
  ) {
    return [
      { target: bankTransaction, counterpart: glTransaction },
      { target: glTransaction, counterpart: bankTransaction },
    ];
  }

  const target = bankTransaction ?? glTransaction;
  if (!target) {
    return [];
  }

  const counterpart = target.id === bankTransaction?.id ? glTransaction : bankTransaction;
  return [{ target, counterpart }];
};

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
  glTransactionId: string,
): MatchResult | undefined =>
  matchResults.find(
    (result) =>
      result.bankTransactionId === bankTransactionId && result.glTransactionId === glTransactionId,
  );

/** The date every exception's `ageInDays` is computed against. Prefers the run's own *declared*
 * period end (`reconciliation_run.period_end`, Unreconciled Item Roll-Forward PR A) when one is
 * supplied -- an audit-facing aging report must not move with the file cut, must not read two
 * days short when the bank export ends before the period does, and must not get contaminated by
 * one stray next-period-dated row inflating every age in the run, all of which the derived
 * max(transactionDate) fallback below is vulnerable to. That fallback exists only for callers
 * that don't yet have a declared period end to supply (a run predating this column, or a
 * standalone caller with no period concept at all). */
const buildReconciliationAnchorDate = (
  normalizedTransactions: NormalizedTransaction[],
  declaredAnchorDate?: string,
): Date | undefined => {
  const declared = parseIsoDate(declaredAnchorDate);
  if (declared) {
    return declared;
  }

  return normalizedTransactions.reduce<Date | undefined>((latest, transaction) => {
    const parsed = parseIsoDate(transaction.transactionDate ?? transaction.postingDate);
    if (!parsed) {
      return latest;
    }

    if (!latest || parsed > latest) {
      return parsed;
    }

    return latest;
  }, undefined);
};

const classifyStaleOutstandingChecksStage = (params: ResidualStageParams): Set<string> => {
  const {
    runId,
    reporting,
    transactionById,
    remainingUnmatchedGl,
    normalizedTransactions,
    upsertTransactionException,
    declaredAnchorDate,
  } = params;
  const staleOutstandingGlIds = new Set<string>();
  const reconciliationAnchorDate = buildReconciliationAnchorDate(
    normalizedTransactions,
    declaredAnchorDate,
  );

  remainingUnmatchedGl.forEach((transactionId) => {
    const transaction = transactionById.get(transactionId);
    const transactionDate = parseIsoDate(transaction?.transactionDate ?? transaction?.postingDate);

    if (
      !transaction ||
      !transactionDate ||
      !reconciliationAnchorDate ||
      transaction.amount === null ||
      transaction.amount >= 0 ||
      !isCheckLikeGlTransaction(transaction)
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
        ageInDays,
        ruleTrace: buildExceptionRuleTrace(
          'stale-outstanding-check',
          'Stale Outstanding Check',
          `GL check-like disbursement remains unmatched in bank activity ${ageInDays} days after its recorded date.`,
          [
            'Transaction remains unmatched on the bank side after matching completed.',
            `Recorded age relative to the latest statement activity is ${ageInDays} days.`,
            transaction.checkNumber
              ? `Check number ${transaction.checkNumber} is present on the GL transaction.`
              : 'Transaction type indicates a check-like disbursement.',
          ],
        ),
      }),
    );
    staleOutstandingGlIds.add(transaction.id);
  });

  return staleOutstandingGlIds;
};

const classifyOutstandingChecksStage = (
  params: ResidualStageParams,
  staleOutstandingGlIds: Set<string>,
  anchorDate: Date | undefined,
): Set<string> => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;
  const outstandingCheckGlIds = new Set<string>();

  if (!anchorDate) {
    return outstandingCheckGlIds;
  }

  remainingUnmatchedGl.forEach((transactionId) => {
    if (staleOutstandingGlIds.has(transactionId)) {
      return;
    }

    const transaction = transactionById.get(transactionId);
    const transactionDate = parseIsoDate(transaction?.transactionDate ?? transaction?.postingDate);

    if (
      !transaction ||
      !transactionDate ||
      transaction.amount === null ||
      transaction.amount >= 0 ||
      !isCheckLikeGlTransaction(transaction)
    ) {
      return;
    }

    const ageInDays = Math.floor((anchorDate.getTime() - transactionDate.getTime()) / 86400000);

    if (ageInDays < 0 || ageInDays >= matching.staleOutstandingCheckDays) {
      return;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'OutstandingCheck',
        reporting,
        matchConfidence: 'Unmatched',
        ageInDays,
        ruleTrace: buildExceptionRuleTrace(
          'outstanding-check',
          'Outstanding Check',
          `GL check-like disbursement has not cleared the bank ${ageInDays} day(s) after its recorded date, within the normal clearing window.`,
          [
            'Transaction remains unmatched on the bank side after matching completed.',
            `Recorded age relative to the latest statement activity is ${ageInDays} day(s), within the ${matching.staleOutstandingCheckDays}-day stale threshold.`,
            transaction.checkNumber
              ? `Check number ${transaction.checkNumber} is present on the GL transaction.`
              : 'Transaction type indicates a check-like disbursement.',
            'Carry as an outstanding item and confirm clearance in the next reconciliation cycle.',
          ],
        ),
      }),
    );
    outstandingCheckGlIds.add(transaction.id);
  });

  return outstandingCheckGlIds;
};

const ACH_RETURN_KEYWORDS = ['RETURN', 'RTN', 'NSF', 'R01', 'R09'];
/** Word-boundary regexes for each keyword, built once -- a raw substring check (e.g.
 * `.includes('NSF')`) false-positives on any word that happens to contain the letters in
 * sequence, such as "TRANSFER" (tra-NSF-er), misclassifying real transfers as ACH returns. */
const ACH_RETURN_KEYWORD_PATTERNS = ACH_RETURN_KEYWORDS.map(
  (keyword) => new RegExp(`\\b${keyword}\\b`),
);

const hasAchReturnKeyword = (transaction: NormalizedTransaction): boolean => {
  const description = (transaction.description ?? '').toUpperCase();
  const transactionType = (transaction.transactionType ?? '').toUpperCase();
  return ACH_RETURN_KEYWORD_PATTERNS.some(
    (pattern) => pattern.test(description) || pattern.test(transactionType),
  );
};

const classifyAchReturnStage = (params: ResidualStageParams): Set<string> => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    upsertTransactionException,
  } = params;
  const achReturnBankIds = new Set<string>();

  const bankTransactions = [...remainingUnmatchedBank]
    .map((id) => transactionById.get(id))
    .filter(
      (tx): tx is NormalizedTransaction & { amount: number } =>
        tx !== undefined && tx.amount !== null,
    );

  for (let i = 0; i < bankTransactions.length; i += 1) {
    const debit = bankTransactions[i];
    if (!debit || debit.amount >= 0) {
      continue;
    }

    for (let j = i + 1; j < bankTransactions.length; j += 1) {
      const credit = bankTransactions[j];
      if (!credit || credit.amount <= 0) {
        continue;
      }

      if (Math.abs(debit.amount + credit.amount) > matching.amountTolerance) {
        continue;
      }

      if (!hasAchReturnKeyword(debit) && !hasAchReturnKeyword(credit)) {
        continue;
      }

      const debitDate = debit.transactionDate ?? debit.postingDate;
      const creditDate = credit.transactionDate ?? credit.postingDate;
      const diff = dateDifferenceDays(debitDate, creditDate);
      if (diff === null || diff > matching.reversalWindowDays) {
        continue;
      }

      if (achReturnBankIds.has(debit.id) || achReturnBankIds.has(credit.id)) {
        continue;
      }

      const sharedEvidence = [
        `Bank debit of ${debit.amount.toFixed(2)} and bank credit of ${credit.amount.toFixed(2)} net to zero.`,
        `Date difference is ${diff} day(s).`,
        'At least one transaction contains ACH return keywords (RETURN, RTN, NSF, R01, R09).',
      ];

      upsertTransactionException(debit, () =>
        createException({
          runId,
          transaction: debit,
          category: 'ACHReturn',
          reporting,
          relatedTransactionIds: [debit.id, credit.id],
          likelyMatchingReference: credit.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            'ach-return',
            'ACH Return / NSF',
            'An ACH debit was returned by the bank. The bank debit and return credit net to zero.',
            sharedEvidence,
            buildCounterpartTrace(credit, credit.id),
          ),
        }),
      );

      upsertTransactionException(credit, () =>
        createException({
          runId,
          transaction: credit,
          category: 'ACHReturn',
          reporting,
          relatedTransactionIds: [debit.id, credit.id],
          likelyMatchingReference: debit.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            'ach-return',
            'ACH Return / NSF',
            'An ACH return credit offsets a bank debit. The pair nets to zero.',
            sharedEvidence,
            buildCounterpartTrace(debit, debit.id),
          ),
        }),
      );

      achReturnBankIds.add(debit.id);
      achReturnBankIds.add(credit.id);
    }
  }

  return achReturnBankIds;
};

const classifyReversalVoidStage = (
  params: ResidualStageParams,
  achReturnBankIds: Set<string>,
): Set<string> => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    upsertTransactionException,
  } = params;
  const reversalVoidBankIds = new Set<string>();

  const bankTransactions = [...remainingUnmatchedBank]
    .filter((id) => !achReturnBankIds.has(id))
    .map((id) => transactionById.get(id))
    .filter(
      (tx): tx is NormalizedTransaction & { amount: number } =>
        tx !== undefined && tx.amount !== null,
    );

  for (let i = 0; i < bankTransactions.length; i += 1) {
    const first = bankTransactions[i];
    if (!first) {
      continue;
    }

    for (let j = i + 1; j < bankTransactions.length; j += 1) {
      const second = bankTransactions[j];
      if (!second) {
        continue;
      }

      if (Math.abs(first.amount + second.amount) > matching.amountTolerance) {
        continue;
      }

      const firstDate = first.transactionDate ?? first.postingDate;
      const secondDate = second.transactionDate ?? second.postingDate;
      const diff = dateDifferenceDays(firstDate, secondDate);
      if (diff === null || diff > matching.reversalWindowDays) {
        continue;
      }

      const similarity = tokenSimilarity(
        first.normalizedComparisonTokens,
        second.normalizedComparisonTokens,
      );
      if (similarity < 0.4) {
        continue;
      }

      if (reversalVoidBankIds.has(first.id) || reversalVoidBankIds.has(second.id)) {
        continue;
      }

      const sharedEvidence = [
        `Bank debit and credit of ${Math.abs(first.amount).toFixed(2)} net to zero, indicating a reversal or void.`,
        `Date difference is ${diff} day(s).`,
        `Narrative similarity score is ${similarity.toFixed(2)}.`,
      ];

      upsertTransactionException(first, () =>
        createException({
          runId,
          transaction: first,
          category: 'ReversalVoid',
          reporting,
          relatedTransactionIds: [first.id, second.id],
          likelyMatchingReference: second.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            'reversal-void',
            'Reversal / Void Pair',
            'A bank debit and credit of the same amount within the reversal window indicate a reversal or void.',
            sharedEvidence,
            buildCounterpartTrace(second, second.id),
          ),
        }),
      );

      upsertTransactionException(second, () =>
        createException({
          runId,
          transaction: second,
          category: 'ReversalVoid',
          reporting,
          relatedTransactionIds: [first.id, second.id],
          likelyMatchingReference: first.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            'reversal-void',
            'Reversal / Void Pair',
            'A bank debit and credit of the same amount within the reversal window indicate a reversal or void.',
            sharedEvidence,
            buildCounterpartTrace(first, first.id),
          ),
        }),
      );

      reversalVoidBankIds.add(first.id);
      reversalVoidBankIds.add(second.id);
    }
  }

  return reversalVoidBankIds;
};

const CHARGEBACK_WINDOW_DAYS = 120;

const CHARGEBACK_KEYWORDS = [
  'chargeback',
  'chargebk',
  'chgbk',
  'disputed',
  'dispute',
  'reversal fee',
  'merchant return',
];

const hasChargebackKeyword = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.transactionType, transaction.merchantName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return CHARGEBACK_KEYWORDS.some((keyword) => text.includes(keyword));
};

const classifyChargebackReturnStage = (
  params: ResidualStageParams,
  achReturnBankIds: Set<string>,
  reversalVoidBankIds: Set<string>,
): Set<string> => {
  const {
    runId,
    reporting,
    matching,
    matchResults,
    transactionById,
    remainingUnmatchedBank,
    upsertTransactionException,
  } = params;
  const chargebackBankIds = new Set<string>();

  const matchedBankCredits = matchResults
    .filter((result) => result.bankTransactionId && result.disposition === 'ExactMatch')
    .map((result) => transactionById.get(result.bankTransactionId as string))
    .filter(
      (tx): tx is NormalizedTransaction & { amount: number } =>
        tx !== undefined && tx.amount !== null && tx.amount > 0,
    );

  const candidateDebits = [...remainingUnmatchedBank]
    .filter((id) => !achReturnBankIds.has(id) && !reversalVoidBankIds.has(id))
    .map((id) => transactionById.get(id))
    .filter(
      (tx): tx is NormalizedTransaction & { amount: number } =>
        tx !== undefined && tx.amount !== null && tx.amount < 0 && hasChargebackKeyword(tx),
    );

  for (const debit of candidateDebits) {
    if (chargebackBankIds.has(debit.id)) {
      continue;
    }

    const debitDate = debit.transactionDate ?? debit.postingDate;

    for (const credit of matchedBankCredits) {
      if (!currencyEquals(Math.abs(debit.amount), credit.amount, matching.amountTolerance)) {
        continue;
      }

      const creditDate = credit.transactionDate ?? credit.postingDate;
      const diff = dateDifferenceDays(creditDate, debitDate);
      if (diff === null || diff > CHARGEBACK_WINDOW_DAYS) {
        continue;
      }

      upsertTransactionException(debit, () =>
        createException({
          runId,
          transaction: debit,
          category: 'ChargebackReturn',
          reporting,
          relatedTransactionIds: [debit.id, credit.id],
          likelyMatchingReference: credit.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            'chargeback-return',
            'Chargeback / Returned Item',
            'A bank debit with chargeback keywords offsets a previously reconciled bank credit of the same amount.',
            [
              `Bank debit of ${debit.amount.toFixed(2)} contains chargeback keywords.`,
              `A matched bank credit of ${credit.amount.toFixed(2)} exists ${diff} day(s) prior (within the ${CHARGEBACK_WINDOW_DAYS}-day chargeback window).`,
              'A corresponding GL reversal entry is likely missing.',
            ],
            buildCounterpartTrace(credit, credit.id),
          ),
        }),
      );
      chargebackBankIds.add(debit.id);
      break;
    }
  }

  return chargebackBankIds;
};

const INTEREST_KEYWORDS = [
  'interest',
  'int income',
  'earned interest',
  'interest earned',
  'daily interest',
  'monthly interest',
];

const hasInterestKeyword = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.transactionType, transaction.merchantName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return INTEREST_KEYWORDS.some((keyword) => text.includes(keyword));
};

const classifyInterestIncomeStage = (
  params: ResidualStageParams,
  alreadyConsumedBankIds: Set<string>,
): Set<string> => {
  const { runId, reporting, transactionById, remainingUnmatchedBank, upsertTransactionException } =
    params;
  const interestBankIds = new Set<string>();

  for (const bankId of remainingUnmatchedBank) {
    if (alreadyConsumedBankIds.has(bankId)) {
      continue;
    }

    const transaction = transactionById.get(bankId);
    if (!transaction || transaction.amount === null || transaction.amount <= 0) {
      continue;
    }

    if (!hasInterestKeyword(transaction)) {
      continue;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'InterestIncome',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'interest-income',
          'Interest Income',
          'A bank interest credit has no corresponding GL entry. Interest income earned during the period should be recorded.',
          [
            `Bank credit of ${transaction.amount?.toFixed(2)} contains interest income keywords.`,
            'No matching GL income entry was found within the configured date and amount tolerance.',
            'Record the interest credit to the appropriate GL income account.',
          ],
        ),
      }),
    );
    interestBankIds.add(bankId);
  }

  return interestBankIds;
};

const INTERCOMPANY_KEYWORDS = [
  'intercompany',
  'inter-company',
  'inter company',
  ' ico ',
  'entity transfer',
  'due to',
  'due from',
  'parent company',
  'subsidiary',
  'affiliate transfer',
];

const hasIntercompanyKeyword = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return INTERCOMPANY_KEYWORDS.some((keyword) => text.includes(keyword));
};

const classifyIntercompanyMismatchStage = (
  params: ResidualStageParams,
  alreadyConsumedBankIds: Set<string>,
  alreadyConsumedGlIds: Set<string>,
): {
  intercompanyBankIds: Set<string>;
  intercompanyGlIds: Set<string>;
} => {
  const {
    runId,
    reporting,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;
  const intercompanyBankIds = new Set<string>();
  const intercompanyGlIds = new Set<string>();

  for (const bankId of remainingUnmatchedBank) {
    if (alreadyConsumedBankIds.has(bankId)) {
      continue;
    }

    const transaction = transactionById.get(bankId);
    if (!transaction || !hasIntercompanyKeyword(transaction)) {
      continue;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'IntercompanyMismatch',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'intercompany-mismatch',
          'Intercompany / Entity Mismatch',
          'Bank transaction contains intercompany or entity-transfer keywords with no counterpart in GL.',
          [
            'Transaction description contains intercompany or entity-transfer indicators.',
            'No matching GL entry was found within the configured date and amount tolerance.',
            'Verify whether this transaction belongs to a different legal entity or GL file.',
          ],
        ),
      }),
    );
    intercompanyBankIds.add(bankId);
  }

  for (const glId of remainingUnmatchedGl) {
    if (alreadyConsumedGlIds.has(glId)) {
      continue;
    }

    const transaction = transactionById.get(glId);
    if (!transaction || !hasIntercompanyKeyword(transaction)) {
      continue;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'IntercompanyMismatch',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'intercompany-mismatch',
          'Intercompany / Entity Mismatch',
          'GL transaction contains intercompany or entity-transfer keywords with no counterpart in bank activity.',
          [
            'Transaction description contains intercompany or entity-transfer indicators.',
            'No matching bank entry was found within the configured date and amount tolerance.',
            'Verify whether this transaction belongs to a different legal entity or GL file.',
          ],
        ),
      }),
    );
    intercompanyGlIds.add(glId);
  }

  return { intercompanyBankIds, intercompanyGlIds };
};

const classifyMiscodingStage = (
  params: ResidualStageParams,
  excludedGlIds: Set<string>,
  achReturnBankIds: Set<string>,
  reversalVoidBankIds: Set<string>,
): {
  miscodingBankIds: Set<string>;
  miscodingGlIds: Set<string>;
  miscodingThresholds: MiscodingThresholds;
} => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;
  const miscodingCandidates = findLikelyMiscodingCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank]
        .filter((id) => !achReturnBankIds.has(id))
        .filter((id) => !reversalVoidBankIds.has(id)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedGl].filter((transactionId) => !excludedGlIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const miscodingThresholds = buildMiscodingThresholds(matching);
  const miscodingBankIds = new Set<string>();
  const miscodingGlIds = new Set<string>();

  miscodingCandidates.forEach((candidate) => {
    if (
      miscodingBankIds.has(candidate.bankTransaction.id) ||
      miscodingGlIds.has(candidate.glTransaction.id)
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
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.glTransaction.id],
        likelyMatchingReference: candidate.glTransaction.id,
        matchConfidence: 'Probable',
        ruleTrace: buildExceptionRuleTrace(
          'likely-miscoding',
          'Likely Miscoding',
          'A same-amount, near-date GL transaction exists, but description or reference context conflicts materially.',
          sharedEvidence,
          buildCounterpartTrace(candidate.glTransaction, candidate.glTransaction.id),
        ),
      }),
    );

    upsertTransactionException(candidate.glTransaction, () =>
      createException({
        runId,
        transaction: candidate.glTransaction,
        category: 'LikelyMiscoding',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.glTransaction.id],
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
    miscodingGlIds.add(candidate.glTransaction.id);
  });

  return { miscodingBankIds, miscodingGlIds, miscodingThresholds };
};

const NSF_RETURNED_DEPOSIT_KEYWORDS = [
  'returned check',
  'return item',
  'returned item',
  'insufficient funds',
  'check returned',
  'chk ret',
  'deposit return',
  'returned deposit',
];

const hasNsfReturnedDepositKeyword = (transaction: NormalizedTransaction): boolean => {
  const text = [transaction.description, transaction.transactionType, transaction.merchantName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    /\bnsf\b/.test(text) || NSF_RETURNED_DEPOSIT_KEYWORDS.some((keyword) => text.includes(keyword))
  );
};

const classifyNSFReturnedDepositStage = (
  params: ResidualStageParams,
  achReturnBankIds: Set<string>,
): Set<string> => {
  const { runId, reporting, transactionById, remainingUnmatchedBank, upsertTransactionException } =
    params;
  const nsfReturnedDepositBankIds = new Set<string>();

  for (const bankId of remainingUnmatchedBank) {
    if (achReturnBankIds.has(bankId)) {
      continue;
    }

    const transaction = transactionById.get(bankId);
    if (!transaction || transaction.amount === null || transaction.amount >= 0) {
      continue;
    }

    if (!hasNsfReturnedDepositKeyword(transaction)) {
      continue;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'NSFReturnedDeposit',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'nsf-returned-deposit',
          'NSF / Returned Deposit',
          'A bank debit contains NSF or returned-check indicators, suggesting a previously deposited check was returned.',
          [
            `Bank debit of ${transaction.amount?.toFixed(2)} contains NSF or returned-deposit keywords.`,
            'No corresponding bank credit/debit pair was found by the ACH return detector.',
            'The original customer payment in GL may require reversal.',
          ],
        ),
      }),
    );
    nsfReturnedDepositBankIds.add(bankId);
  }

  return nsfReturnedDepositBankIds;
};

const classifyVoidedCheckClearedStage = (
  params: ResidualStageParams,
  excludedBankIds: Set<string>,
): Set<string> => {
  const { runId, reporting, transactionById, remainingUnmatchedBank, upsertTransactionException } =
    params;
  const voidedCheckClearedBankIds = new Set<string>();

  for (const bankId of remainingUnmatchedBank) {
    if (excludedBankIds.has(bankId)) {
      continue;
    }

    const transaction = transactionById.get(bankId);
    if (!transaction || transaction.amount === null || transaction.amount >= 0) {
      continue;
    }

    if (!isCheckLikeBankTransaction(transaction)) {
      continue;
    }

    upsertTransactionException(transaction, () =>
      createException({
        runId,
        transaction,
        category: 'VoidedCheckCleared',
        reporting,
        matchConfidence: 'Unmatched',
        ruleTrace: buildExceptionRuleTrace(
          'voided-check-cleared',
          'Voided Check Cleared',
          'A bank check debit has no corresponding GL entry, suggesting the check was voided or never recorded in GL but cleared the bank.',
          [
            transaction.checkNumber
              ? `Check number ${transaction.checkNumber} is present on the bank transaction.`
              : 'Bank description contains check-like identifiers.',
            'No matching GL entry was found at any amount or date tolerance.',
            'Verify whether this check was voided in GL or was never recorded.',
          ],
        ),
      }),
    );
    voidedCheckClearedBankIds.add(bankId);
  }

  return voidedCheckClearedBankIds;
};

const classifyTimingStage = (
  params: ResidualStageParams,
  staleOutstandingGlIds: Set<string>,
  outstandingCheckGlIds: Set<string>,
  achReturnBankIds: Set<string>,
  reversalVoidBankIds: Set<string>,
  miscodingBankIds: Set<string>,
  miscodingGlIds: Set<string>,
  groupedBankIds: Set<string>,
  groupedGlIds: Set<string>,
): {
  timingBankIds: Set<string>;
  timingGlIds: Set<string>;
} => {
  const {
    runId,
    reporting,
    matching,
    matchResults,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;
  const residualTimingCandidates = findResidualTimingDifferenceCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank]
        .filter((transactionId) => !achReturnBankIds.has(transactionId))
        .filter((transactionId) => !reversalVoidBankIds.has(transactionId))
        .filter((transactionId) => !miscodingBankIds.has(transactionId))
        .filter((transactionId) => !groupedBankIds.has(transactionId)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedGl]
        .filter((transactionId) => !staleOutstandingGlIds.has(transactionId))
        .filter((transactionId) => !outstandingCheckGlIds.has(transactionId))
        .filter((transactionId) => !miscodingGlIds.has(transactionId))
        .filter((transactionId) => !groupedGlIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const timingBankIds = new Set<string>();
  const timingGlIds = new Set<string>();

  residualTimingCandidates.forEach((candidate) => {
    if (
      timingBankIds.has(candidate.bankTransaction.id) ||
      timingGlIds.has(candidate.glTransaction.id)
    ) {
      return;
    }

    const sharedEvidence = [
      'Same-amount residual transactions remained unmatched after exact and review matching.',
      `Date difference is ${candidate.dateDifference} day(s), which is outside the primary tolerance and within the timing-difference window.`,
      `Narrative similarity score is ${candidate.textSimilarity.toFixed(2)} and reference similarity score is ${candidate.referenceSimilarity.toFixed(2)}.`,
      `Transaction kinds remain timing-compatible: bank=${inferTransactionKind(candidate.bankTransaction)}, gl=${inferTransactionKind(candidate.glTransaction)}.`,
    ];
    const glCounterpartTrace = buildCounterpartTrace(
      candidate.glTransaction,
      candidate.glTransaction.id,
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
      candidate.glTransaction.id,
    );

    upsertTransactionException(candidate.bankTransaction, () =>
      createException({
        runId,
        transaction: candidate.bankTransaction,
        category: 'TimingDifference',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.glTransaction.id],
        likelyMatchingReference: candidate.glTransaction.id,
        matchConfidence: 'TimingDifference',
        priorRuleTraces: buildPriorRuleTracesFromMatchResult(
          sourceMatchResult,
          derivedTrace,
          glCounterpartTrace,
        ),
        ruleTrace: buildExceptionRuleTrace(
          'residual-timing-difference',
          'Residual Timing Difference',
          'A same-amount, timing-compatible GL transaction remains unmatched within the extended timing window.',
          sharedEvidence,
          glCounterpartTrace,
        ),
      }),
    );

    upsertTransactionException(candidate.glTransaction, () =>
      createException({
        runId,
        transaction: candidate.glTransaction,
        category: 'TimingDifference',
        reporting,
        relatedTransactionIds: [candidate.bankTransaction.id, candidate.glTransaction.id],
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
    timingGlIds.add(candidate.glTransaction.id);
  });

  return { timingBankIds, timingGlIds };
};

const ENGINE_GROUPED_CATEGORIES = new Set([
  'FeeNettingMatch',
  'PartialPaymentMatch',
  'PayrollBatchMatch',
  'BankServiceChargeAmortization',
  'LoanPaymentSplit',
] as const);

type EngineGroupedCategory =
  | 'FeeNettingMatch'
  | 'PartialPaymentMatch'
  | 'PayrollBatchMatch'
  | 'BankServiceChargeAmortization'
  | 'LoanPaymentSplit';

const classifyEngineReservedGroupsStage = (
  params: ResidualStageParams,
): {
  engineGroupedBankIds: Set<string>;
  engineGroupedGlIds: Set<string>;
} => {
  const { runId, reporting, transactionById, upsertTransactionException, engineReservedGroups } =
    params;
  const engineGroupedBankIds = new Set<string>();
  const engineGroupedGlIds = new Set<string>();

  for (const groupedResult of engineReservedGroups) {
    if (
      !groupedResult.category ||
      !ENGINE_GROUPED_CATEGORIES.has(groupedResult.category as EngineGroupedCategory)
    ) {
      continue;
    }

    const category = groupedResult.category as EngineGroupedCategory;
    const bankTxns = groupedResult.bankTransactionIds
      .map((id) => transactionById.get(id))
      .filter((tx): tx is NonNullable<typeof tx> => tx !== undefined);
    const glTxns = groupedResult.glTransactionIds
      .map((id) => transactionById.get(id))
      .filter((tx): tx is NonNullable<typeof tx> => tx !== undefined);
    const allRelatedIds = [...groupedResult.bankTransactionIds, ...groupedResult.glTransactionIds];

    for (const bankTx of bankTxns) {
      const primaryCounterpart = glTxns[0];
      upsertTransactionException(bankTx, () =>
        createException({
          runId,
          transaction: bankTx,
          category,
          reporting,
          relatedTransactionIds: allRelatedIds,
          likelyMatchingReference: primaryCounterpart?.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            groupedResult.ruleId,
            groupedResult.ruleName,
            groupedResult.reason,
            groupedResult.evidence,
            buildCounterpartTrace(primaryCounterpart, primaryCounterpart?.id),
            buildCounterpartTraces(glTxns),
          ),
        }),
      );
      engineGroupedBankIds.add(bankTx.id);
    }

    for (const glTx of glTxns) {
      const primaryCounterpart = bankTxns[0];
      upsertTransactionException(glTx, () =>
        createException({
          runId,
          transaction: glTx,
          category,
          reporting,
          relatedTransactionIds: allRelatedIds,
          likelyMatchingReference: primaryCounterpart?.id,
          matchConfidence: 'Probable',
          ruleTrace: buildExceptionRuleTrace(
            groupedResult.ruleId,
            groupedResult.ruleName,
            groupedResult.reason,
            groupedResult.evidence,
            buildCounterpartTrace(primaryCounterpart, primaryCounterpart?.id),
            buildCounterpartTraces(bankTxns),
          ),
        }),
      );
      engineGroupedGlIds.add(glTx.id);
    }
  }

  return { engineGroupedBankIds, engineGroupedGlIds };
};

const classifyGroupedStage = (
  params: ResidualStageParams,
  stageState: Pick<
    ResidualStageState,
    | 'staleOutstandingGlIds'
    | 'outstandingCheckGlIds'
    | 'achReturnBankIds'
    | 'reversalVoidBankIds'
    | 'miscodingBankIds'
    | 'miscodingGlIds'
    | 'timingBankIds'
    | 'timingGlIds'
    | 'groupedBankIds'
    | 'groupedGlIds'
  >,
): {
  groupedBankIds: Set<string>;
  groupedGlIds: Set<string>;
} => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;
  const groupedResidualCandidates = findGroupedResidualCandidates(
    getTransactionsByIds(
      [...remainingUnmatchedBank]
        .filter((transactionId) => !stageState.achReturnBankIds.has(transactionId))
        .filter((transactionId) => !stageState.reversalVoidBankIds.has(transactionId))
        .filter((transactionId) => !stageState.miscodingBankIds.has(transactionId))
        .filter((transactionId) => !stageState.timingBankIds.has(transactionId))
        .filter((transactionId) => !stageState.groupedBankIds.has(transactionId)),
      transactionById,
    ),
    getTransactionsByIds(
      [...remainingUnmatchedGl]
        .filter((transactionId) => !stageState.staleOutstandingGlIds.has(transactionId))
        .filter((transactionId) => !stageState.outstandingCheckGlIds.has(transactionId))
        .filter((transactionId) => !stageState.miscodingGlIds.has(transactionId))
        .filter((transactionId) => !stageState.timingGlIds.has(transactionId))
        .filter((transactionId) => !stageState.groupedGlIds.has(transactionId)),
      transactionById,
    ),
    matching,
  );
  const groupedBankIds = new Set<string>();
  const groupedGlIds = new Set<string>();

  groupedResidualCandidates.forEach((candidate) => {
    const bankIds = candidate.bankTransactions.map((transaction) => transaction.id);
    const glIds = candidate.glTransactions.map((transaction) => transaction.id);

    if (
      bankIds.some((transactionId) => groupedBankIds.has(transactionId)) ||
      glIds.some((transactionId) => groupedGlIds.has(transactionId))
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
      recordGroupedException(transaction, candidate.glTransactions);
      groupedBankIds.add(transaction.id);
    });

    candidate.glTransactions.forEach((transaction) => {
      recordGroupedException(transaction, candidate.bankTransactions);
      groupedGlIds.add(transaction.id);
    });
  });

  return { groupedBankIds, groupedGlIds };
};

const classifyMissingFallbackStage = (
  params: ResidualStageParams,
  stageState: Pick<
    ResidualStageState,
    | 'staleOutstandingGlIds'
    | 'outstandingCheckGlIds'
    | 'achReturnBankIds'
    | 'reversalVoidBankIds'
    | 'chargebackBankIds'
    | 'interestBankIds'
    | 'intercompanyBankIds'
    | 'intercompanyGlIds'
    | 'miscodingBankIds'
    | 'miscodingGlIds'
    | 'timingBankIds'
    | 'timingGlIds'
    | 'groupedBankIds'
    | 'groupedGlIds'
    | 'nsfReturnedDepositBankIds'
    | 'voidedCheckClearedBankIds'
  >,
  anchorDate: Date | undefined,
): void => {
  const {
    runId,
    reporting,
    matching,
    transactionById,
    remainingUnmatchedBank,
    remainingUnmatchedGl,
    upsertTransactionException,
  } = params;

  remainingUnmatchedBank.forEach((transactionId) => {
    if (
      stageState.achReturnBankIds.has(transactionId) ||
      stageState.nsfReturnedDepositBankIds.has(transactionId) ||
      stageState.reversalVoidBankIds.has(transactionId) ||
      stageState.chargebackBankIds.has(transactionId) ||
      stageState.interestBankIds.has(transactionId) ||
      stageState.intercompanyBankIds.has(transactionId) ||
      stageState.miscodingBankIds.has(transactionId) ||
      stageState.timingBankIds.has(transactionId) ||
      stageState.groupedBankIds.has(transactionId) ||
      stageState.voidedCheckClearedBankIds.has(transactionId)
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
        category: 'MissingFromGL',
        reporting,
        ruleTrace: buildExceptionRuleTrace(
          'missing-from-gl',
          'Missing from GL',
          'No GL-side transaction remained after exact, review, and variance matching rules were applied.',
          ['Transaction stayed unmatched after cross-source candidate selection.'],
        ),
      }),
    );
  });

  remainingUnmatchedGl.forEach((transactionId) => {
    if (
      stageState.miscodingGlIds.has(transactionId) ||
      stageState.timingGlIds.has(transactionId) ||
      stageState.groupedGlIds.has(transactionId) ||
      stageState.staleOutstandingGlIds.has(transactionId) ||
      stageState.outstandingCheckGlIds.has(transactionId) ||
      stageState.intercompanyGlIds.has(transactionId)
    ) {
      return;
    }

    const transaction = transactionById.get(transactionId);
    if (!transaction) {
      return;
    }

    const isDepositInTransit =
      anchorDate !== undefined &&
      transaction.amount !== null &&
      transaction.amount > 0 &&
      !isCheckLikeGlTransaction(transaction) &&
      (() => {
        const txDate = parseIsoDate(transaction.transactionDate ?? transaction.postingDate);
        if (!txDate) {
          return false;
        }
        const ageDays = Math.abs(Math.floor((anchorDate.getTime() - txDate.getTime()) / 86400000));
        return ageDays <= matching.depositInTransitDays;
      })();

    if (isDepositInTransit) {
      upsertTransactionException(transaction, () =>
        createException({
          runId,
          transaction,
          category: 'DepositInTransit',
          reporting,
          ruleTrace: buildExceptionRuleTrace(
            'deposit-in-transit',
            'Deposit in Transit',
            'A GL credit recorded near the statement period end has no corresponding bank entry, consistent with a deposit in transit.',
            [
              'Transaction is a GL credit with no matching bank entry.',
              `Transaction date is within ${matching.depositInTransitDays} day(s) of the reconciliation anchor date.`,
              'Transaction is not check-like.',
            ],
          ),
        }),
      );
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

export const classifyResidualStages = (params: ResidualStageParams): ResidualStageState => {
  const anchorDate = buildReconciliationAnchorDate(
    params.normalizedTransactions,
    params.declaredAnchorDate,
  );
  const staleOutstandingGlIds = classifyStaleOutstandingChecksStage(params);
  const outstandingCheckGlIds = classifyOutstandingChecksStage(
    params,
    staleOutstandingGlIds,
    anchorDate,
  );
  const achReturnBankIds = classifyAchReturnStage(params);
  const nsfReturnedDepositBankIds = classifyNSFReturnedDepositStage(params, achReturnBankIds);
  const reversalVoidBankIds = classifyReversalVoidStage(params, achReturnBankIds);
  const chargebackBankIds = classifyChargebackReturnStage(
    params,
    achReturnBankIds,
    reversalVoidBankIds,
  );
  const interestBankIds = classifyInterestIncomeStage(
    params,
    new Set([...achReturnBankIds, ...reversalVoidBankIds, ...chargebackBankIds]),
  );
  const intercompanyStage = classifyIntercompanyMismatchStage(
    params,
    new Set([
      ...achReturnBankIds,
      ...reversalVoidBankIds,
      ...chargebackBankIds,
      ...interestBankIds,
    ]),
    new Set([...staleOutstandingGlIds, ...outstandingCheckGlIds]),
  );
  const miscodingStage = classifyMiscodingStage(
    params,
    new Set([...staleOutstandingGlIds, ...outstandingCheckGlIds]),
    achReturnBankIds,
    reversalVoidBankIds,
  );
  const engineGroupedStage = classifyEngineReservedGroupsStage(params);
  const groupedStage = classifyGroupedStage(params, {
    staleOutstandingGlIds,
    outstandingCheckGlIds,
    achReturnBankIds,
    reversalVoidBankIds,
    miscodingBankIds: miscodingStage.miscodingBankIds,
    miscodingGlIds: miscodingStage.miscodingGlIds,
    timingBankIds: new Set<string>(),
    timingGlIds: new Set<string>(),
    groupedBankIds: engineGroupedStage.engineGroupedBankIds,
    groupedGlIds: engineGroupedStage.engineGroupedGlIds,
  });
  const allGroupedBankIds = new Set([
    ...engineGroupedStage.engineGroupedBankIds,
    ...groupedStage.groupedBankIds,
  ]);
  const allGroupedGlIds = new Set([
    ...engineGroupedStage.engineGroupedGlIds,
    ...groupedStage.groupedGlIds,
  ]);
  const timingStage = classifyTimingStage(
    params,
    staleOutstandingGlIds,
    outstandingCheckGlIds,
    achReturnBankIds,
    reversalVoidBankIds,
    miscodingStage.miscodingBankIds,
    miscodingStage.miscodingGlIds,
    allGroupedBankIds,
    allGroupedGlIds,
  );

  const allConsumedBankIds = new Set([
    ...achReturnBankIds,
    ...nsfReturnedDepositBankIds,
    ...reversalVoidBankIds,
    ...chargebackBankIds,
    ...interestBankIds,
    ...intercompanyStage.intercompanyBankIds,
    ...miscodingStage.miscodingBankIds,
    ...allGroupedBankIds,
    ...timingStage.timingBankIds,
  ]);
  const voidedCheckClearedBankIds = classifyVoidedCheckClearedStage(params, allConsumedBankIds);

  const stageState: ResidualStageState = {
    staleOutstandingGlIds,
    outstandingCheckGlIds,
    achReturnBankIds,
    nsfReturnedDepositBankIds,
    reversalVoidBankIds,
    chargebackBankIds,
    interestBankIds,
    intercompanyBankIds: intercompanyStage.intercompanyBankIds,
    intercompanyGlIds: intercompanyStage.intercompanyGlIds,
    miscodingBankIds: miscodingStage.miscodingBankIds,
    miscodingGlIds: miscodingStage.miscodingGlIds,
    timingBankIds: timingStage.timingBankIds,
    timingGlIds: timingStage.timingGlIds,
    groupedBankIds: allGroupedBankIds,
    groupedGlIds: allGroupedGlIds,
    voidedCheckClearedBankIds,
    miscodingThresholds: miscodingStage.miscodingThresholds,
  };

  classifyMissingFallbackStage(params, stageState, anchorDate);
  return stageState;
};
