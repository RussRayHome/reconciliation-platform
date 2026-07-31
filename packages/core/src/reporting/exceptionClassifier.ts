import {
  type ExceptionItem,
  type GroupedMatchResult,
  type MatchingConfig,
  type MatchResult,
  type NormalizedTransaction,
  professionalErrorMessages,
  type ReconciliationFrequency,
  type ReportingConfig,
  type ReviewerObservation,
  type SourceFile,
} from '@recon/domain';
import {
  advisoryReviewCategoriesExcludedFromResidualStages,
  categoryPrecedence,
  severityRank,
} from './exceptionClassifierTypes';
import {
  buildCounterpartTrace,
  buildExceptionRuleTrace,
  buildObservation,
  buildPriorRuleTraces,
  createException,
} from './exceptionClassifierTraces';
import {
  buildMatchResultClassification,
  buildMatchResultTargets,
  classifyResidualStages,
} from './exceptionClassifierStages';

/** All inputs required to run the multi-stage exception classification pipeline. */
export interface ExceptionClassifierInput {
  runId: string;
  sourceFiles: SourceFile[];
  normalizedTransactions: NormalizedTransaction[];
  matchResults: MatchResult[];
  unmatchedBankTransactionIds: Set<string>;
  unmatchedQboTransactionIds: Set<string>;
  duplicateTransactionIds: Set<string>;
  groupedMatchResults?: GroupedMatchResult[];
  reporting: ReportingConfig;
  matching: MatchingConfig;
  reconciliationFrequency?: ReconciliationFrequency;
}

/** Classified exceptions and reviewer observations produced by `classifyExceptions`. */
export interface ExceptionClassifierOutput {
  exceptions: ExceptionItem[];
  reviewerObservations: ReviewerObservation[];
}

/**
 * Runs the multi-stage exception classification pipeline: data quality, exact/grouped
 * unmatched, timing differences, amount mismatches, reference/description variances,
 * likely miscodings, and stale outstanding checks. Returns all classified exceptions and
 * reviewer observations.
 */
const ENGINE_GROUPED_CATEGORIES = new Set([
  'FeeNettingMatch',
  'PartialPaymentMatch',
  'PayrollBatchMatch',
  'BankServiceChargeAmortization',
  'LoanPaymentSplit',
]);

export const classifyExceptions = ({
  runId,
  sourceFiles,
  normalizedTransactions,
  matchResults,
  unmatchedBankTransactionIds,
  unmatchedQboTransactionIds,
  duplicateTransactionIds,
  groupedMatchResults,
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
              : 'Duplicate Detection in GL',
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
  const engineReservedGroups = (groupedMatchResults ?? []).filter(
    (result) => result.category && ENGINE_GROUPED_CATEGORIES.has(result.category),
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
    engineReservedGroups,
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
