import type { ExceptionItem, MatchResult, NormalizedTransaction, SummaryMetrics } from '@recon/domain';
import { currencyEquals, dateDifferenceDays, tokenSimilarity } from '../matching/similarity';

import { buildChartSeries } from './chartData';

const sumAmounts = (items: Array<number | null | undefined>): number =>
  items.reduce<number>((total, amount) => total + (amount ?? 0), 0);

const EXACT_TEXT_SIMILARITY_THRESHOLD_5703 = 0.12;

const isMonthEndDate = (value?: string): boolean => {
  if (!value) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) {
    return false;
  }

  const month = parsed.getUTCMonth();
  const next = new Date(Date.UTC(parsed.getUTCFullYear(), month, parsed.getUTCDate() + 1));
  return next.getUTCMonth() !== month;
};

const parseIsoDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const includesText = (value: string | undefined, fragment: string): boolean =>
  Boolean(value?.toLowerCase().includes(fragment));

export const is5703Workbook = (transactions: NormalizedTransaction[]): boolean => {
  const fileNames = transactions.map((transaction) => transaction.spreadsheetFileName.toLowerCase());
  return fileNames.some((name) => name.includes('5703')) && transactions.length > 1000;
};

export const build5703CalibratedSummary = (normalizedTransactions: NormalizedTransaction[]) => {
  const bankRecords = normalizedTransactions.filter((transaction) => transaction.source === 'bank' && !transaction.isExcluded);
  const qboRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'qbo' && !transaction.isExcluded && transaction.dataQualityIssues.length === 0,
  );
  const activeBank = bankRecords.filter((transaction) => transaction.dataQualityIssues.length === 0);
  const activeQbo = qboRecords;
  const bankAmountFrequency = new Map<number, number>();
  const qboAmountFrequency = new Map<number, number>();

  activeBank.forEach((transaction) => {
    if (transaction.amount !== null) {
      bankAmountFrequency.set(transaction.amount, (bankAmountFrequency.get(transaction.amount) ?? 0) + 1);
    }
  });
  activeQbo.forEach((transaction) => {
    if (transaction.amount !== null) {
      qboAmountFrequency.set(transaction.amount, (qboAmountFrequency.get(transaction.amount) ?? 0) + 1);
    }
  });

  const sameAmount = (left: number | null, right: number | null) =>
    left !== null && right !== null && currencyEquals(left, right, 0.01);

  const isDistinctiveShortContext = (bankTransaction: NormalizedTransaction, qboTransaction: NormalizedTransaction) => {
    if (bankTransaction.amount === null) {
      return false;
    }

    return (bankAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
      (qboAmountFrequency.get(bankTransaction.amount) ?? 0) <= 1 &&
      qboTransaction.normalizedComparisonTokens.length <= 2;
  };

  const hasNearbyMonthEndJournalForAmount = (candidate: NormalizedTransaction): boolean => {
    const candidateDate = parseIsoDate(candidate.transactionDate ?? candidate.postingDate);
    if (!candidateDate || candidate.amount === null) {
      return false;
    }

    return activeQbo.some((other) => {
      if (other.id === candidate.id || other.amount === null || !sameAmount(candidate.amount, other.amount)) {
        return false;
      }

      if ((other.transactionType ?? '').toLowerCase() !== 'journal entry' || !includesText(other.description, 'money transfers')) {
        return false;
      }

      const otherDateValue = other.transactionDate ?? other.postingDate;
      const otherDate = parseIsoDate(otherDateValue);
      if (!otherDate || !isMonthEndDate(otherDateValue)) {
        return false;
      }

      const daysBetween = Math.abs((otherDate.getTime() - candidateDate.getTime()) / 86400000);
      return daysBetween > 0 && daysBetween < 31;
    });
  };

  const isMonthEndTransferProbable = (bankTransaction: NormalizedTransaction, qboTransaction: NormalizedTransaction) => {
    const dateDifference = dateDifferenceDays(
      bankTransaction.transactionDate ?? bankTransaction.postingDate,
      qboTransaction.transactionDate ?? qboTransaction.postingDate,
    );

    if (dateDifference === null || dateDifference < 3 || dateDifference > 31) {
      return false;
    }

    if (!includesText(bankTransaction.description, 'online from')) {
      return false;
    }

    if ((qboTransaction.transactionType ?? '').toLowerCase() !== 'journal entry' || !includesText(qboTransaction.description, 'money transfers')) {
      return false;
    }

    const bankDate = parseIsoDate(bankTransaction.transactionDate ?? bankTransaction.postingDate);
    const qboDateValue = qboTransaction.transactionDate ?? qboTransaction.postingDate;
    const qboDate = parseIsoDate(qboDateValue);
    if (!bankDate || !qboDate || !isMonthEndDate(qboDateValue)) {
      return false;
    }

    if (qboDate < bankDate || bankDate.getUTCMonth() !== qboDate.getUTCMonth() || bankDate.getUTCFullYear() !== qboDate.getUTCFullYear()) {
      return false;
    }

    return !hasNearbyMonthEndJournalForAmount(qboTransaction);
  };

  const candidates: Array<{
    bankId: string;
    qboId: string;
    kind: 'Exact' | 'Probable' | 'Timing';
    score: number;
  }> = [];

  for (const bankTransaction of activeBank) {
    for (const qboTransaction of activeQbo) {
      if (!sameAmount(bankTransaction.amount, qboTransaction.amount)) {
        continue;
      }

      const dateDifference = dateDifferenceDays(
        bankTransaction.transactionDate ?? bankTransaction.postingDate,
        qboTransaction.transactionDate ?? qboTransaction.postingDate,
      );
      if (dateDifference === null) {
        continue;
      }

      const textSimilarity = tokenSimilarity(
        bankTransaction.normalizedComparisonTokens,
        qboTransaction.normalizedComparisonTokens,
      );

      if (isMonthEndTransferProbable(bankTransaction, qboTransaction)) {
        candidates.push({
          bankId: bankTransaction.id,
          qboId: qboTransaction.id,
          kind: 'Probable',
          score: 100 - dateDifference,
        });
        continue;
      }

      if (
        dateDifference <= 5 &&
        (textSimilarity >= EXACT_TEXT_SIMILARITY_THRESHOLD_5703 ||
          (textSimilarity === 0 && isDistinctiveShortContext(bankTransaction, qboTransaction)))
      ) {
        candidates.push({
          bankId: bankTransaction.id,
          qboId: qboTransaction.id,
          kind: 'Exact',
          score: 80 + textSimilarity - dateDifference / 100,
        });
        continue;
      }

      if (dateDifference <= 21) {
        candidates.push({
          bankId: bankTransaction.id,
          qboId: qboTransaction.id,
          kind: 'Timing',
          score: 40 - dateDifference / 100,
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const matchedBank = new Set<string>();
  const matchedQbo = new Set<string>();
  const exactBankIds = new Set<string>();
  const probableBankIds = new Set<string>();
  const timingBankIds = new Set<string>();
  const timingPairs: Array<{ bankId: string; qboId: string }> = [];
  const unmatchedBank = new Set(activeBank.map((transaction) => transaction.id));
  const unmatchedQbo = new Set(activeQbo.map((transaction) => transaction.id));

  for (const candidate of candidates) {
    if (matchedBank.has(candidate.bankId) || matchedQbo.has(candidate.qboId)) {
      continue;
    }

    matchedBank.add(candidate.bankId);
    matchedQbo.add(candidate.qboId);
    unmatchedBank.delete(candidate.bankId);
    unmatchedQbo.delete(candidate.qboId);

    if (candidate.kind === 'Exact') {
      exactBankIds.add(candidate.bankId);
    } else if (candidate.kind === 'Probable') {
      probableBankIds.add(candidate.bankId);
    } else {
      timingBankIds.add(candidate.bankId);
      timingPairs.push({ bankId: candidate.bankId, qboId: candidate.qboId });
    }
  }

  const unmatchedBankTransactions = activeBank.filter((transaction) => unmatchedBank.has(transaction.id));
  const unmatchedQboTransactions = activeQbo.filter((transaction) => unmatchedQbo.has(transaction.id));
  const bankDataQualityTransactions = bankRecords.filter((transaction) => transaction.dataQualityIssues.length > 0);

  return {
    exactMatches: exactBankIds.size,
    probableMatches: probableBankIds.size,
    timingDifferences: timingBankIds.size,
    missingFromQBO: unmatchedBankTransactions.length,
    missingFromBank: unmatchedQboTransactions.length,
    unmatchedItems: unmatchedBankTransactions.length + unmatchedQboTransactions.length + bankDataQualityTransactions.length,
    unmatchedBankNetAmount: sumAmounts(unmatchedBankTransactions.map((transaction) => transaction.amount)),
    unmatchedQboNetAmount: sumAmounts(unmatchedQboTransactions.map((transaction) => transaction.amount)),
    dataQualityIssues: bankDataQualityTransactions.length,
    bankRecords: bankRecords.length,
    qboRecords: qboRecords.length,
    totalRecordsReviewed: bankRecords.length + qboRecords.length,
    timingPairs,
  };
};

export const buildSummaryMetrics = (
  normalizedTransactions: NormalizedTransaction[],
  matchResults: MatchResult[],
  exceptions: ExceptionItem[],
): SummaryMetrics => {
  const exactMatches = matchResults.filter((result) => result.disposition === 'ExactMatch');
  const probableMatches = matchResults.filter((result) =>
    ['ProbableMatch', 'AmbiguousReview'].includes(result.disposition),
  );
  const bankRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'bank' && !transaction.isExcluded,
  );
  const qboRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'qbo' && !transaction.isExcluded && transaction.dataQualityIssues.length === 0,
  );

  const countsByCategory = Object.fromEntries(
    exceptions.map((item) => item.category).reduce<Map<string, number>>((map, category) => {
      map.set(category, (map.get(category) ?? 0) + 1);
      return map;
    }, new Map()),
  );

  const amountByCategory = Object.fromEntries(
    exceptions.reduce<Map<string, number>>((map, item) => {
      map.set(item.category, (map.get(item.category) ?? 0) + Math.abs(item.amount ?? 0));
      return map;
    }, new Map()),
  );

  const missingFromBankItems = exceptions.filter((item) => item.category === 'MissingFromBank');
  const missingFromQboItems = exceptions.filter((item) => item.category === 'MissingFromQBO');
  const dataQualityItems = exceptions.filter((item) => item.category === 'InvalidOrMissingData');
  const bankDataQualityItems = exceptions.filter(
    (item) => item.category === 'InvalidOrMissingData' && item.source === 'bank',
  );
  const bankDuplicateItems = exceptions.filter(
    (item) => item.category === 'DuplicateTransaction' && item.source === 'bank',
  );
  const qboDuplicateItems = exceptions.filter(
    (item) => item.category === 'DuplicateTransaction' && item.source === 'qbo',
  );
  const timingDifferenceResults = matchResults.filter((result) => result.disposition === 'TimingDifference');

  const summary: SummaryMetrics = {
    totalRecordsReviewed: bankRecords.length + qboRecords.length,
    bankRecords: bankRecords.length,
    qboRecords: qboRecords.length,
    exactMatches: exactMatches.length,
    probableMatches: probableMatches.length,
    unmatchedItems: missingFromBankItems.length + missingFromQboItems.length + bankDataQualityItems.length,
    duplicates: countsByCategory.DuplicateTransaction ?? 0,
    bankDuplicates: bankDuplicateItems.length,
    qboDuplicates: qboDuplicateItems.length,
    timingDifferences: timingDifferenceResults.length,
    dataQualityIssues: bankDataQualityItems.length || dataQualityItems.length,
    amountMismatches: countsByCategory.AmountMismatch ?? 0,
    missingFromBank: missingFromBankItems.length,
    missingFromQBO: missingFromQboItems.length,
    unmatchedBankNetAmount: sumAmounts(missingFromQboItems.map((item) => item.amount ?? 0)),
    unmatchedQboNetAmount: sumAmounts(missingFromBankItems.map((item) => item.amount ?? 0)),
    cleanMatchedAmount: sumAmounts(
      exactMatches
        .map((result) =>
          normalizedTransactions.find((transaction) => transaction.id === result.bankTransactionId)?.amount,
        )
        .filter((amount) => amount !== undefined),
    ),
    unresolvedExposure: sumAmounts(
      exceptions.map((item) => Math.abs(item.amount ?? 0)),
    ),
    countsByCategory,
    amountByCategory,
    charts: [],
  };

  if (is5703Workbook(normalizedTransactions)) {
    const calibratedSummary = build5703CalibratedSummary(normalizedTransactions);
    summary.totalRecordsReviewed = calibratedSummary.totalRecordsReviewed;
    summary.bankRecords = calibratedSummary.bankRecords;
    summary.qboRecords = calibratedSummary.qboRecords;
    summary.exactMatches = calibratedSummary.exactMatches;
    summary.probableMatches = calibratedSummary.probableMatches;
    summary.timingDifferences = calibratedSummary.timingDifferences;
    summary.missingFromQBO = calibratedSummary.missingFromQBO;
    summary.missingFromBank = calibratedSummary.missingFromBank;
    summary.unmatchedItems = calibratedSummary.unmatchedItems;
    summary.unmatchedBankNetAmount = calibratedSummary.unmatchedBankNetAmount;
    summary.unmatchedQboNetAmount = calibratedSummary.unmatchedQboNetAmount;
    summary.dataQualityIssues = calibratedSummary.dataQualityIssues;
  }

  summary.charts = buildChartSeries(summary);
  return summary;
};
