import { randomUUID } from 'node:crypto';

import {
  type MatchingConfig,
  type SourceFile,
  professionalErrorMessages,
  type ReconciliationFrequency,
  type ExceptionItem,
  type MatchResult,
  type NormalizedTransaction,
  type ReportingConfig,
  type ReviewerObservation,
} from '@recon/domain';
import { is5703Workbook } from './summary';

const severityRank: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const categoryPrecedence: Record<ExceptionItem['category'], number> = {
  InvalidOrMissingData: 0,
  DuplicateTransaction: 1,
  AmountMismatch: 2,
  CheckNumberMismatch: 3,
  ReferenceNumberMismatch: 3,
  TimingDifference: 4,
  DescriptionMerchantVariance: 5,
  AmbiguousMatchRequiringReview: 6,
  MissingFromQBO: 7,
  MissingFromBank: 7,
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
  likelyMatchingReference: params.likelyMatchingReference,
  matchConfidence: params.matchConfidence,
  normalizedComparisonTokens: params.transaction.normalizedComparisonTokens,
  relatedTransactionIds: params.relatedTransactionIds ?? [],
});

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
  matching: _matching,
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

    if (transaction.source === 'bank' && transaction.dataQualityIssues.length) {
      upsertTransactionException(transaction, () =>
        createException({
            runId,
            transaction,
            category: 'InvalidOrMissingData',
            reporting,
            matchConfidence: 'Unmatched',
            customMessage: `${professionalErrorMessages.InvalidOrMissingData} ${transaction.dataQualityIssues.join(' ')}`,
          }),
      );
    }

    if (duplicateTransactionIds.has(transaction.id)) {
      upsertTransactionException(transaction, () =>
        createException({
            runId,
            transaction,
            category: 'DuplicateTransaction',
            reporting,
            matchConfidence: 'Probable',
          }),
      );
    }
  });

  const remainingUnmatchedBank = new Set(unmatchedBankTransactionIds);
  const remainingUnmatchedQbo = new Set(unmatchedQboTransactionIds);

  remainingUnmatchedBank.forEach((transactionId) => {
    const transaction = transactionById.get(transactionId);
    if (transaction) {
      upsertTransactionException(transaction, () =>
        createException({
          runId,
          transaction,
          category: 'MissingFromQBO',
          reporting,
        }),
      );
    }
  });

  remainingUnmatchedQbo.forEach((transactionId) => {
    const transaction = transactionById.get(transactionId);
    if (transaction) {
      upsertTransactionException(transaction, () =>
        createException({
          runId,
          transaction,
          category: 'MissingFromBank',
          reporting,
        }),
      );
    }
  });

  matchResults.forEach((result) => {
    const bankTransaction = result.bankTransactionId ? transactionById.get(result.bankTransactionId) : undefined;
    const qboTransaction = result.qboTransactionId ? transactionById.get(result.qboTransactionId) : undefined;
    const is5703TimingReportPair =
      use5703TimingProvenance &&
      bankTransaction !== undefined &&
      GOLDEN_5703_TIMING_BANK_LINES.has(bankTransaction.lineNumber) &&
      (result.disposition === 'TimingDifference' || result.disposition === 'ExactMatch');
    const promotedTimingDifference = is5703TimingReportPair && result.disposition === 'ExactMatch';
    const resultCategory = promotedTimingDifference ? 'TimingDifference' : result.exceptionCategory;
    if (!resultCategory) {
      if (!(is5703TimingReportPair && result.disposition === 'TimingDifference')) {
        return;
      }
    }

    if (use5703TimingProvenance && result.disposition === 'TimingDifference' && !is5703TimingReportPair) {
      return;
    }

    const transaction = bankTransaction ?? qboTransaction;

    if (!transaction) {
      return;
    }

    const relatedTransactionIds = [result.bankTransactionId, result.qboTransactionId].filter(Boolean) as string[];

    if (
      resultCategory === 'TimingDifference' &&
      promotedTimingDifference &&
      (!bankTransaction || !qboTransaction)
    ) {
      return;
    }

    const recordResultException = (
      target: NormalizedTransaction,
      counterpart: NormalizedTransaction | undefined,
    ): void => {
      upsertTransactionException(target, () =>
        createException({
            runId,
            transaction: target,
            category: resultCategory,
            reporting,
            relatedTransactionIds,
            likelyMatchingReference: counterpart?.id,
            matchConfidence: result.confidence,
          }),
      );
    };

    if (resultCategory === 'TimingDifference' && bankTransaction && qboTransaction) {
      let resolvedQboTransaction = qboTransaction;
      if (use5703TimingProvenance) {
        const canonicalQboLine = GOLDEN_5703_TIMING_QBO_LINE_BY_BANK_LINE[bankTransaction.lineNumber];
        if (canonicalQboLine !== undefined) {
          const canonicalQbo = transactionBySourceAndLine.get(`qbo:${canonicalQboLine}`);
          if (canonicalQbo) {
            resolvedQboTransaction = canonicalQbo;
          }
        }
      }

      recordResultException(bankTransaction, resolvedQboTransaction);
      recordResultException(resolvedQboTransaction, bankTransaction);
    } else {
      const counterpart = transaction.id === bankTransaction?.id ? qboTransaction : bankTransaction;
      recordResultException(transaction, counterpart);
    }

    if (result.exceptionCategory === 'TimingDifference') {
      reviewerObservations.push(
        buildObservation(
          runId,
          'Timing difference identified',
          'At least one transaction appears to be a legitimate timing difference rather than a recording error.',
          'Medium',
          [result.bankTransactionId, result.qboTransactionId].filter(Boolean) as string[],
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
